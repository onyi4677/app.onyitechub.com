import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Attr
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_user
from app.db import projects_table

router = APIRouter(prefix="/api")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _token_key(token: str) -> str:
    if not isinstance(token, str) or len(token) < 40 or len(token) > 200:
        raise HTTPException(status_code=404, detail="This review invitation is invalid or unavailable.")
    return "instrument-review-invite#" + hashlib.sha256(token.encode("utf-8")).hexdigest()


def _owner_project(project_id: str, user: dict[str, Any]) -> dict[str, Any]:
    try:
        project = projects_table.get_item(Key={"id": project_id}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project.") from exc
    if not project or project.get("owner_sub") != user["sub"]:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


class InvitationCreate(BaseModel):
    pathway: str = Field(pattern="^(primary_data|secondary_data)$")
    version_id: str = Field(min_length=1, max_length=200)
    reviewer_name: str = Field(min_length=2, max_length=200)
    reviewer_email: str = Field(min_length=5, max_length=254)
    expires_in_days: int = Field(default=14, ge=1, le=30)


class InvitationRevoke(BaseModel):
    pass


class PublicAccessRequest(BaseModel):
    token: str = Field(min_length=40, max_length=200)


class PublicReviewSubmission(BaseModel):
    token: str = Field(min_length=40, max_length=200)
    reviewer_name: str = Field(min_length=2, max_length=200)
    reviewer_email: str = Field(min_length=5, max_length=254)
    reviewer_role: str = Field(min_length=2, max_length=300)
    expertise: str = Field(min_length=2, max_length=500)
    review_date: str = Field(min_length=10, max_length=10)
    comments: str = Field(min_length=1, max_length=10000)
    recommendation: str = Field(pattern="^(accept|revise|reject)$")
    item_ratings: dict[str, dict[str, Any]]


@router.post("/projects/{project_id}/instrument-review-invitations")
def create_instrument_review_invitation(
    project_id: str,
    payload: InvitationCreate,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    project = _owner_project(project_id, user)
    modules = project.get("modules") if isinstance(project.get("modules"), dict) else {}
    instruments = modules.get("instruments") if isinstance(modules.get("instruments"), dict) else {}
    pathways = instruments.get("pathways") if isinstance(instruments.get("pathways"), dict) else {}
    pathway = pathways.get(payload.pathway) if isinstance(pathways.get(payload.pathway), dict) else {}
    versions = pathway.get("instrument_versions") if isinstance(pathway.get("instrument_versions"), list) else []
    version = next((entry for entry in versions if isinstance(entry, dict) and entry.get("version_id") == payload.version_id), None)
    if not version or not isinstance(version.get("snapshot"), dict):
        raise HTTPException(status_code=404, detail="The selected saved instrument version was not found.")

    token = secrets.token_urlsafe(48)
    key = _token_key(token)
    now = _now()
    expires = now + timedelta(days=payload.expires_in_days)
    record = {
        "id": key,
        "entity_type": "instrument_review_invitation",
        "project_id": project_id,
        "owner_sub": user["sub"],
        "pathway": payload.pathway,
        "version_id": payload.version_id,
        "version_number": version.get("version_number"),
        "snapshot": version["snapshot"],
        "reviewer_name": payload.reviewer_name.strip(),
        "reviewer_email": payload.reviewer_email.strip().lower(),
        "created_at": _iso(now),
        "expires_at": _iso(expires),
        "status": "pending",
    }
    try:
        projects_table.put_item(Item=record, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to create the reviewer invitation.") from exc

    return {
        "invitation_id": key,
        "token": token,
        "review_url_path": "/review/instrument",
        "reviewer_name": record["reviewer_name"],
        "reviewer_email": record["reviewer_email"],
        "version_number": record["version_number"],
        "expires_at": record["expires_at"],
        "status": "pending",
    }


@router.get("/projects/{project_id}/instrument-review-invitations")
def list_instrument_review_invitations(
    project_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    _owner_project(project_id, user)
    try:
        response = projects_table.scan(
            FilterExpression=(
                Attr("entity_type").eq("instrument_review_invitation")
                & Attr("project_id").eq(project_id)
                & Attr("owner_sub").eq(user["sub"])
            )
        )
        items = list(response.get("Items", []))
        while response.get("LastEvaluatedKey"):
            response = projects_table.scan(
                FilterExpression=(
                    Attr("entity_type").eq("instrument_review_invitation")
                    & Attr("project_id").eq(project_id)
                    & Attr("owner_sub").eq(user["sub"])
                ),
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve reviewer invitations.") from exc
    items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return {
        "invitations": [
            {key: value for key, value in item.items() if key not in {"id", "token", "snapshot", "owner_sub"}}
            | {"invitation_id": item["id"], "submission": item.get("submission")}
            for item in items
        ]
    }


@router.delete("/projects/{project_id}/instrument-review-invitations/{invitation_id}")
def revoke_instrument_review_invitation(
    project_id: str,
    invitation_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, str]:
    _owner_project(project_id, user)
    if not invitation_id.startswith("instrument-review-invite#"):
        raise HTTPException(status_code=404, detail="Invitation not found.")
    try:
        projects_table.update_item(
            Key={"id": invitation_id},
            UpdateExpression="SET #status = :revoked, revoked_at = :now",
            ConditionExpression="owner_sub = :owner AND project_id = :project AND #status = :pending",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":revoked": "revoked", ":pending": "pending", ":owner": user["sub"],
                ":project": project_id, ":now": _iso(_now()),
            },
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="Only a pending invitation can be revoked.") from exc
        raise HTTPException(status_code=500, detail="Unable to revoke the invitation.") from exc
    return {"status": "revoked"}


@router.post("/public/instrument-review/access")
def access_instrument_review(payload: PublicAccessRequest) -> dict[str, Any]:
    key = _token_key(payload.token)
    try:
        record = projects_table.get_item(Key={"id": key}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to open the review invitation.") from exc
    now = _now()
    if (
        not record
        or record.get("entity_type") != "instrument_review_invitation"
        or record.get("status") != "pending"
        or not isinstance(record.get("expires_at"), str)
        or record["expires_at"] <= _iso(now)
    ):
        raise HTTPException(status_code=404, detail="This review invitation has expired, been revoked or already submitted.")
    return {
        "reviewer_name": record.get("reviewer_name", ""),
        "reviewer_email": record.get("reviewer_email", ""),
        "version_number": record.get("version_number"),
        "snapshot": record.get("snapshot", {}),
        "expires_at": record.get("expires_at"),
    }


@router.post("/public/instrument-review/submit")
def submit_instrument_review(payload: PublicReviewSubmission) -> dict[str, str]:
    key = _token_key(payload.token)
    now = _now()
    try:
        record = projects_table.get_item(Key={"id": key}).get("Item")
        if (
            not record
            or record.get("entity_type") != "instrument_review_invitation"
            or record.get("status") != "pending"
            or record.get("expires_at", "") <= _iso(now)
        ):
            raise HTTPException(status_code=404, detail="This review invitation is no longer available.")
        if payload.reviewer_email.strip().lower() != str(record.get("reviewer_email", "")).lower():
            raise HTTPException(status_code=403, detail="The email address does not match the invited reviewer.")
        item_ids = {
            str(item.get("item_id"))
            for item in record.get("snapshot", {}).get("instrument_items", [])
            if isinstance(item, dict) and item.get("item_id")
        }
        if set(payload.item_ratings) != item_ids:
            raise HTTPException(status_code=422, detail="The submitted ratings do not match the assigned instrument items.")
        for rating in payload.item_ratings.values():
            if not isinstance(rating, dict) or any(
                isinstance(rating.get(key), bool) or not isinstance(rating.get(key), int) or rating[key] not in range(1, 5)
                for key in ("clarity", "relevance", "coverage")
            ):
                raise HTTPException(status_code=422, detail="Every instrument item requires clarity, relevance and coverage ratings from 1 to 4.")
        submission = {
            "reviewer_name": payload.reviewer_name.strip(),
            "reviewer_email": payload.reviewer_email.strip().lower(),
            "reviewer_role": payload.reviewer_role.strip(),
            "expertise": payload.expertise.strip(),
            "review_date": payload.review_date,
            "comments": payload.comments.strip(),
            "recommendation": payload.recommendation,
            "item_ratings": payload.item_ratings,
            "submitted_at": _iso(now),
        }
        projects_table.update_item(
            Key={"id": key},
            UpdateExpression="SET #status = :submitted, submission = :submission, submitted_at = :now",
            ConditionExpression="#status = :pending AND expires_at > :now",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":submitted": "submitted", ":pending": "pending",
                ":submission": submission, ":now": _iso(now),
            },
        )
    except HTTPException:
        raise
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="This invitation has already been submitted or is no longer active.") from exc
        raise HTTPException(status_code=500, detail="Unable to save the expert review.") from exc
    return {"status": "submitted", "message": "Thank you. Your expert review has been submitted."}
