from typing import Any

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_user
from app.services.integrity_submissions import (
    SubmissionConfigurationError,
    SubmissionNotFoundError,
    SubmissionValidationError,
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
    if isinstance(exc, SubmissionValidationError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if isinstance(exc, SubmissionConfigurationError):
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if isinstance(exc, ClientError):
        raise HTTPException(status_code=503, detail="Manuscript storage is temporarily unavailable.") from exc
    raise HTTPException(status_code=500, detail="Unable to process manuscript submission.") from exc


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
