import csv
import hashlib
import io
import secrets
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.auth import require_user
from app.db import projects_table
from app.api.participant_publication_routes import publication_key, scan_all, valid_answer

router = APIRouter(prefix="/api")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def owned_project(project_id: str, user: dict[str, Any]) -> dict[str, Any]:
    try:
        project = projects_table.get_item(Key={"id": project_id}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project.") from exc
    if not project or project.get("owner_sub") != user["sub"]:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


class ResearchPublishRequest(BaseModel):
    version_id: str = Field(min_length=1, max_length=200)
    ethics_committee: str | None = Field(default=None, min_length=3, max_length=300)
    approval_reference: str | None = Field(default=None, min_length=2, max_length=200)
    approval_date: date | None = None
    participant_information: str = Field(min_length=100, max_length=20000)
    consent_text: str = Field(min_length=30, max_length=5000)
    eligibility_text: str = Field(min_length=20, max_length=2000)
    withdrawal_text: str = Field(min_length=20, max_length=3000)
    consent_version: str = Field(min_length=1, max_length=100)

    @field_validator("ethics_committee", "approval_reference", "approval_date", mode="before")
    @classmethod
    def normalize_blank_approval_fields(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value


class ResearchSubmitRequest(BaseModel):
    token: str = Field(min_length=40, max_length=200)
    browser_token: str = Field(min_length=20, max_length=200)
    consent: bool
    consent_version: str = Field(min_length=1, max_length=100)
    consent_hash: str = Field(min_length=64, max_length=64)
    consented_at: datetime
    eligible: bool
    answers: dict[str, Any]
    elapsed_seconds: int = Field(ge=0, le=86400)
    website: str = Field(default="", max_length=500)


@router.post("/projects/{project_id}/research-publications")
def create_research_publication(
    project_id: str,
    payload: ResearchPublishRequest,
    user: dict[str, Any] = Depends(require_user),
):
    project = owned_project(project_id, user)
    modules = project.get("modules") if isinstance(project.get("modules"), dict) else {}
    instruments = modules.get("instruments") if isinstance(modules.get("instruments"), dict) else {}
    pathways = instruments.get("pathways") if isinstance(instruments.get("pathways"), dict) else {}
    primary = pathways.get("primary_data") if isinstance(pathways.get("primary_data"), dict) else {}
    versions = primary.get("instrument_versions") if isinstance(primary.get("instrument_versions"), list) else []
    version = next((v for v in versions if isinstance(v, dict) and v.get("version_id") == payload.version_id), None)
    snapshot = version.get("snapshot") if isinstance(version, dict) else None
    items = snapshot.get("instrument_items") if isinstance(snapshot, dict) else None
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=404, detail="The selected saved instrument version was not found.")
    ids = [item.get("item_id") for item in items if isinstance(item, dict)]
    if len(ids) != len(items) or len(ids) != len(set(ids)) or any(not isinstance(item_id, str) or not item_id for item_id in ids):
        raise HTTPException(status_code=422, detail="The saved instrument has an invalid question structure.")
    info = payload.participant_information.strip()
    consent = payload.consent_text.strip()
    consent_hash = digest("\n".join([info, consent, payload.eligibility_text.strip(), payload.withdrawal_text.strip()]))
    token = secrets.token_urlsafe(48)
    publication_id = str(uuid4())
    record = {
        "id": publication_key(token),
        "entity_type": "participant_publication",
        "publication_id": publication_id,
        "project_id": project_id,
        "owner_sub": user["sub"],
        "version_id": payload.version_id,
        "version_number": version.get("version_number"),
        "snapshot": snapshot,
        "status": "research_open",
        "mode": "research",
        "is_test": False,
        "ethics_committee": payload.ethics_committee.strip() if payload.ethics_committee else "",
        "approval_reference": payload.approval_reference.strip() if payload.approval_reference else "",
        "approval_date": payload.approval_date.isoformat() if payload.approval_date else "",
        "participant_information": info,
        "consent_text": consent,
        "eligibility_text": payload.eligibility_text.strip(),
        "withdrawal_text": payload.withdrawal_text.strip(),
        "consent_version": payload.consent_version.strip(),
        "consent_hash": consent_hash,
        "created_at": now(),
    }
    try:
        projects_table.put_item(Item=record, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to create the research collection link.") from exc
    return {
        "publication_id": publication_id,
        "token": token,
        "public_url_path": f"/research-participant/{token}",
        "version_number": version.get("version_number"),
        "status": "research_open",
        "mode": "research",
        "consent_hash": consent_hash,
    }


@router.get("/public/research-publications/{token}")
def get_public_research_publication(token: str):
    try:
        record = projects_table.get_item(Key={"id": publication_key(token)}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to load this research questionnaire.") from exc
    if not record or record.get("entity_type") != "participant_publication" or record.get("mode") != "research" or record.get("status") != "research_open":
        raise HTTPException(status_code=404, detail="This research questionnaire is closed or unavailable.")
    snapshot = record.get("snapshot") if isinstance(record.get("snapshot"), dict) else {}
    return {
        "publication_id": record["publication_id"],
        "version_number": record.get("version_number"),
        "instrument_title": snapshot.get("instrument_title", "Research questionnaire"),
        "purpose": snapshot.get("purpose", ""),
        "target_population": snapshot.get("target_population", ""),
        "instrument_instructions": snapshot.get("instrument_instructions", ""),
        "instrument_sections": snapshot.get("instrument_sections", []),
        "instrument_items": snapshot.get("instrument_items", []),
        "participant_information": record["participant_information"],
        "consent_text": record["consent_text"],
        "eligibility_text": record["eligibility_text"],
        "withdrawal_text": record["withdrawal_text"],
        "consent_version": record["consent_version"],
        "consent_hash": record["consent_hash"],
    }


@router.post("/public/research-publications/submit")
def submit_research_publication(payload: ResearchSubmitRequest):
    if payload.website.strip():
        raise HTTPException(status_code=400, detail="Submission could not be accepted.")
    if not payload.consent:
        raise HTTPException(status_code=400, detail="Please confirm informed consent before submitting.")
    if not payload.eligible:
        raise HTTPException(status_code=400, detail="You do not meet the study eligibility criteria.")
    if payload.elapsed_seconds < 8:
        raise HTTPException(status_code=400, detail="Please review the questionnaire before submitting.")
    if payload.consented_at.tzinfo is None or payload.consented_at.utcoffset() is None:
        raise HTTPException(status_code=422, detail="Consent timestamp must include a timezone.")
    consent_timestamp = payload.consented_at.astimezone(timezone.utc)
    if consent_timestamp > datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Consent timestamp cannot be in the future.")
    try:
        publication = projects_table.get_item(Key={"id": publication_key(payload.token)}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to save this research response.") from exc
    if not publication or publication.get("entity_type") != "participant_publication" or publication.get("mode") != "research" or publication.get("status") != "research_open":
        raise HTTPException(status_code=404, detail="This research questionnaire is closed or unavailable.")
    if payload.consent_version != publication.get("consent_version") or payload.consent_hash != publication.get("consent_hash"):
        raise HTTPException(status_code=409, detail="The participant information or consent text has changed. Reload the page and review it again.")
    try:
        publication_created = datetime.fromisoformat(str(publication.get("created_at", "")).replace("Z", "+00:00"))
    except ValueError:
        publication_created = None
    if publication_created and consent_timestamp < publication_created:
        raise HTTPException(status_code=422, detail="Consent must be recorded after the study link was created.")
    items = (publication.get("snapshot") or {}).get("instrument_items", [])
    expected = {item.get("item_id") for item in items if isinstance(item, dict)}
    if not set(payload.answers).issubset(expected):
        raise HTTPException(status_code=422, detail="Please check that all questions have valid responses.")
    for item in items:
        if not isinstance(item, dict) or not valid_answer(item, payload.answers.get(item.get("item_id"))):
            raise HTTPException(status_code=422, detail="Please check the response to each required question and its response options.")
    browser_hash = digest(payload.browser_token)
    dedupe_id = f"participant-research-dedupe#{publication['publication_id']}#{browser_hash}"
    timestamp = now()
    response_id = "participant-research-response#" + str(uuid4())
    try:
        projects_table.put_item(Item={
            "id": dedupe_id,
            "entity_type": "participant_research_dedupe",
            "publication_id": publication["publication_id"],
            "project_id": publication["project_id"],
            "browser_token_hash": browser_hash,
            "created_at": timestamp,
        }, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="A response has already been submitted from this browser for this study.") from exc
        raise HTTPException(status_code=500, detail="Unable to register the research submission.") from exc
    try:
        projects_table.put_item(Item={
            "id": response_id,
            "entity_type": "participant_research_response",
            "publication_id": publication["publication_id"],
            "project_id": publication["project_id"],
            "owner_sub": publication["owner_sub"],
            "version_id": publication["version_id"],
            "version_number": publication.get("version_number"),
            "mode": "research",
            "is_test": False,
            "answers": payload.answers,
            "question_count": len(items),
            "elapsed_seconds": payload.elapsed_seconds,
            "consent": True,
            "consent_version": publication["consent_version"],
            "consent_hash": publication["consent_hash"],
            "consented_at": consent_timestamp.isoformat(),
            "submitted_at": timestamp,
        }, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        try:
            projects_table.delete_item(Key={"id": dedupe_id})
        except ClientError:
            pass
        raise HTTPException(status_code=500, detail="Unable to save the research response.") from exc
    return {"status": "submitted", "message": "Your response has been submitted successfully."}


@router.get("/projects/{project_id}/research-publications")
def list_research_publications(project_id: str, user: dict[str, Any] = Depends(require_user)):
    owned_project(project_id, user)
    publications = scan_all(Attr("entity_type").eq("participant_publication") & Attr("mode").eq("research") & Attr("project_id").eq(project_id) & Attr("owner_sub").eq(user["sub"]))
    responses = scan_all(Attr("entity_type").eq("participant_research_response") & Attr("project_id").eq(project_id) & Attr("owner_sub").eq(user["sub"]))
    grouped: dict[str, int] = {}
    for response in responses:
        grouped[response.get("publication_id", "")] = grouped.get(response.get("publication_id", ""), 0) + 1
    publications.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return {"publications": [{
        "publication_id": item.get("publication_id"),
        "version_id": item.get("version_id"),
        "version_number": item.get("version_number"),
        "status": item.get("status"),
        "mode": "research",
        "is_test": False,
        "created_at": item.get("created_at"),
        "ethics_committee": item.get("ethics_committee"),
        "approval_reference": item.get("approval_reference"),
        "approval_date": item.get("approval_date"),
        "consent_version": item.get("consent_version"),
        "response_count": grouped.get(item.get("publication_id", ""), 0),
    } for item in publications]}


@router.post("/projects/{project_id}/research-publications/{publication_id}/close")
def close_research_publication(project_id: str, publication_id: str, user: dict[str, Any] = Depends(require_user)):
    owned_project(project_id, user)
    found = scan_all(Attr("entity_type").eq("participant_publication") & Attr("mode").eq("research") & Attr("project_id").eq(project_id) & Attr("publication_id").eq(publication_id) & Attr("owner_sub").eq(user["sub"]))
    if not found:
        raise HTTPException(status_code=404, detail="Research publication not found.")
    try:
        projects_table.update_item(
            Key={"id": found[0]["id"]},
            UpdateExpression="SET #s = :closed, closed_at = :now",
            ConditionExpression="#s = :open AND mode = :mode AND owner_sub = :owner",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":closed": "research_closed", ":open": "research_open", ":mode": "research", ":owner": user["sub"], ":now": now()},
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="This research collection link is already closed.") from exc
        raise HTTPException(status_code=500, detail="Unable to close the research collection link.") from exc
    return {"status": "research_closed"}


@router.get("/projects/{project_id}/research-publications/{publication_id}/export")
def export_research_publication(project_id: str, publication_id: str, user: dict[str, Any] = Depends(require_user)):
    owned_project(project_id, user)
    found = scan_all(Attr("entity_type").eq("participant_publication") & Attr("mode").eq("research") & Attr("project_id").eq(project_id) & Attr("publication_id").eq(publication_id) & Attr("owner_sub").eq(user["sub"]))
    if not found:
        raise HTTPException(status_code=404, detail="Research publication not found.")
    responses = scan_all(Attr("entity_type").eq("participant_research_response") & Attr("project_id").eq(project_id) & Attr("publication_id").eq(publication_id) & Attr("owner_sub").eq(user["sub"]))
    output = io.StringIO()
    writer = csv.writer(output)
    question_ids = [
        item.get("item_id")
        for item in (found[0].get("snapshot") or {}).get("instrument_items", [])
        if isinstance(item, dict) and isinstance(item.get("item_id"), str)
    ]
    columns = ["response_id", "submitted_at", "consented_at", "consent_version", "instrument_version", "elapsed_seconds", "question_count", *question_ids]
    writer.writerow(columns)
    for response in sorted(responses, key=lambda item: item.get("submitted_at", "")):
        answers = response.get("answers", {}) if isinstance(response.get("answers"), dict) else {}
        writer.writerow([
            response.get("id", "").replace("participant-research-response#", ""),
            response.get("submitted_at", ""),
            response.get("consented_at", ""),
            response.get("consent_version", ""),
            response.get("version_number", ""),
            response.get("elapsed_seconds", ""),
            response.get("question_count", ""),
            *[
                "; ".join(str(value) for value in answer) if isinstance((answer := answers.get(question_id)), list)
                else answer if answer is not None else ""
                for question_id in question_ids
            ],
        ])
    content = "\ufeff" + output.getvalue()
    return StreamingResponse(iter([content]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="research-responses-{publication_id}.csv"'})
