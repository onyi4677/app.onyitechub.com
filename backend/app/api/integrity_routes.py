import json
import logging
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_user
from app.services.integrity_extraction import extract_and_check_submission
from app.services.integrity_submissions import (
    SubmissionConfigurationError,
    SubmissionExpiredError,
    SubmissionNotFoundError,
    SubmissionValidationError,
    _now,
    _now_epoch,
    _resources,
    acquire_processing_lease,
    release_processing_lease,
    complete_submission,
    create_submission,
    delete_submission,
    get_submission,
    list_submissions,
)

router = APIRouter(prefix="/api/integrity", tags=["research-integrity"])


class SubmissionCreateRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=150)
    size_bytes: int = Field(gt=0, le=15 * 1024 * 1024)
    permission_confirmed: bool


def _handle_error(exc: Exception) -> None:
    if isinstance(exc, SubmissionNotFoundError):
        raise HTTPException(status_code=404, detail="Submission not found") from exc
    if isinstance(exc, SubmissionExpiredError):
        raise HTTPException(status_code=410, detail=str(exc)) from exc
    if isinstance(exc, SubmissionValidationError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if isinstance(exc, SubmissionConfigurationError):
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if isinstance(exc, ClientError):
        raise HTTPException(status_code=503, detail="Manuscript storage is temporarily unavailable.") from exc
    raise HTTPException(status_code=500, detail="Unable to process manuscript submission.") from exc


logger = logging.getLogger(__name__)


def _fail_ai_review_queue(
    owner_sub: str,
    submission_id: str,
    token: str | None,
    table: Any = None,
    queued: bool = False,
) -> None:
    if not token:
        return

    if queued and table is not None:
        try:
            table.update_item(
                Key={"owner_sub": owner_sub, "submission_id": submission_id},
                UpdateExpression=(
                    "SET ai_review_status = :failed, "
                    "ai_review_message = :message, "
                    "ai_review_updated_at = :updated, updated_at = :updated"
                ),
                ConditionExpression=(
                    "processing_lease_token = :token "
                    "AND ai_review_status = :queued"
                ),
                ExpressionAttributeValues={
                    ":failed": "failed",
                    ":message": "The AI review could not be queued. Please try again later.",
                    ":updated": _now(),
                    ":token": token,
                    ":queued": "queued",
                },
            )
        except Exception as exc:
            logger.error(
                "Could not mark AI review queue failure for submission %s (%s)",
                submission_id,
                type(exc).__name__,
            )

    try:
        release_processing_lease(owner_sub, submission_id, token)
    except Exception as exc:
        logger.error(
            "Could not release AI review dispatch lease for submission %s (%s)",
            submission_id,
            type(exc).__name__,
        )


@router.post("/submissions", status_code=201)
def start_submission(
    payload: SubmissionCreateRequest,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    try:
        return create_submission(
            owner_sub=user["sub"],
            file_name=payload.file_name,
            content_type=payload.content_type,
            size_bytes=payload.size_bytes,
            permission_confirmed=payload.permission_confirmed,
        )
    except Exception as exc:
        _handle_error(exc)


@router.post("/submissions/{submission_id}/complete")
def finish_submission(
    submission_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    try:
        return {"submission": complete_submission(user["sub"], submission_id)}
    except Exception as exc:
        _handle_error(exc)


@router.post("/submissions/{submission_id}/extract")
def extract_submission(
    submission_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    try:
        return extract_and_check_submission(user["sub"], submission_id)
    except Exception as exc:
        _handle_error(exc)


@router.post("/submissions/{submission_id}/ai-review", status_code=202)
def queue_ai_review(
    submission_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    """Queue one asynchronous AI review for an extracted manuscript."""
    if os.getenv("AWS_LAMBDA_FUNCTION_NAME") != "onyitech-research-api-staging":
        raise HTTPException(
            status_code=503,
            detail="AI review dispatch is available only in the staging service.",
        )

    owner_sub = user["sub"]
    token = None
    queued = False
    key = {"owner_sub": owner_sub, "submission_id": submission_id}

    try:
        token = acquire_processing_lease(
            owner_sub,
            submission_id,
            allowed_statuses=("extraction_completed",),
            require_extracted=True,
            lease_seconds=240,
        )

        _, table, _ = _resources()
        response = table.get_item(Key=key, ConsistentRead=True)
        item = response.get("Item")
        if not item:
            raise SubmissionNotFoundError()

        extraction = item.get("extraction") or {}
        if extraction.get("status") != "text_extracted":
            raise SubmissionValidationError(
                "Readable manuscript text must be extracted before AI review."
            )

        current_ai_status = item.get("ai_review_status", "not_started")
        if current_ai_status not in ("not_started", "queued", "processing"):
            raise HTTPException(
                status_code=409,
                detail="This submission has already had a completed or terminal AI review attempt.",
            )

        now_epoch = _now_epoch()
        now_text = _now()

        table.update_item(
            Key=key,
            UpdateExpression=(
                "SET ai_review_status = :queued, "
                "ai_review_updated_at = :updated, updated_at = :updated"
            ),
            ConditionExpression=(
                "#status = :completed "
                "AND cleanup_status = :pending AND cleanup_at > :now "
                "AND processing_lease_token = :token "
                "AND processing_lease_until > :now "
                "AND (attribute_not_exists(ai_review_status) "
                "OR ai_review_status IN (:not_started, :queued_existing, :processing_existing))"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":completed": "extraction_completed",
                ":pending": "pending",
                ":now": now_epoch,
                ":token": token,
                ":queued": "queued",
                ":not_started": "not_started",
                ":queued_existing": "queued",
                ":processing_existing": "processing",
                ":updated": now_text,
            },
        )
        queued = True

        event = {
            "source": "onyitech.integrity",
            "detail": {
                "task": "ai-review",
                "owner_sub": owner_sub,
                "submission_id": submission_id,
                "lease_token": token,
            },
        }

        invoke_response = boto3.client("lambda").invoke(
            FunctionName="onyitech-research-api-staging",
            InvocationType="Event",
            Payload=json.dumps(event).encode("utf-8"),
        )
        if invoke_response.get("StatusCode") != 202:
            raise RuntimeError("The staging AI review worker did not accept the event.")

        return {
            "submission_id": submission_id,
            "ai_review_status": "queued",
            "message": "AI review has been queued.",
        }

    except HTTPException:
        _fail_ai_review_queue(owner_sub, submission_id, token)
        raise
    except ClientError as exc:
        _fail_ai_review_queue(owner_sub, submission_id, token, table if queued else None, queued)

        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(
                status_code=409,
                detail="The submission changed or an AI review has already been attempted.",
            ) from exc
        raise HTTPException(
            status_code=503,
            detail="AI review dispatch is temporarily unavailable.",
        ) from exc
    except Exception as exc:
        _fail_ai_review_queue(owner_sub, submission_id, token, table if queued else None, queued)
        _handle_error(exc)

@router.get("/submissions")
def submissions(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    try:
        return {"submissions": list_submissions(user["sub"])}
    except Exception as exc:
        _handle_error(exc)


@router.get("/submissions/{submission_id}")
def submission(
    submission_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    try:
        return {"submission": get_submission(user["sub"], submission_id)}
    except Exception as exc:
        _handle_error(exc)


@router.delete("/submissions/{submission_id}", status_code=204)
def remove_submission(
    submission_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> None:
    try:
        delete_submission(user["sub"], submission_id)
    except Exception as exc:
        _handle_error(exc)
