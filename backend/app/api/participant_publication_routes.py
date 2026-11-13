import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_user
from app.db import projects_table

router = APIRouter(prefix="/api")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def publication_key(token: str) -> str:
    if not isinstance(token, str) or not 40 <= len(token) <= 200:
        raise HTTPException(status_code=404, detail="This technical pilot is unavailable.")
    return "participant-publication#" + digest(token)


def owned_project(project_id: str, user: dict[str, Any]) -> dict[str, Any]:
    try:
        project = projects_table.get_item(Key={"id": project_id}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project.") from exc
    if not project or project.get("owner_sub") != user["sub"]:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def scan_all(expression: Any) -> list[dict[str, Any]]:
    try:
        response = projects_table.scan(FilterExpression=expression)
        items = list(response.get("Items", []))
        while response.get("LastEvaluatedKey"):
            response = projects_table.scan(FilterExpression=expression, ExclusiveStartKey=response["LastEvaluatedKey"])
            items.extend(response.get("Items", []))
        return items
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve pilot records.") from exc


class PublishRequest(BaseModel):
    version_id: str = Field(min_length=1, max_length=200)


class SubmitRequest(BaseModel):
    token: str = Field(min_length=40, max_length=200)
    browser_token: str = Field(min_length=20, max_length=200)
    consent: bool
    eligible: bool
    answers: dict[str, Any]
    elapsed_seconds: int = Field(ge=0, le=86400)
    website: str = Field(default="", max_length=500)


def valid_answer(item: dict[str, Any], answer: Any) -> bool:
    kind = item.get("response_type")
    options = item.get("options") if isinstance(item.get("options"), list) else []
    options = [x for x in options if isinstance(x, str)]
    if answer is None or answer == "":
        return item.get("required") is not True
    if kind in {"single_choice", "dropdown"}:
        return isinstance(answer, str) and answer in options
    if kind == "multiple_choice":
        return isinstance(answer, list) and len(answer) == len(set(answer)) and all(isinstance(x, str) and x in options for x in answer)
    if isinstance(kind, str) and kind.startswith("likert_"):
        try:
            scale, value = int(kind.split("_")[1]), int(answer)
            return not isinstance(answer, bool) and 1 <= value <= scale
        except (ValueError, TypeError, IndexError):
            return False
    if kind in {"short_text", "long_text"}:
        return isinstance(answer, str) and len(answer) <= (1000 if kind == "short_text" else 5000)
    if kind == "number":
        return isinstance(answer, (int, float)) and not isinstance(answer, bool)
    if kind == "date" and isinstance(answer, str):
        try:
            datetime.strptime(answer, "%Y-%m-%d")
            return len(answer) == 10
        except ValueError:
            return False
    return False


@router.post("/projects/{project_id}/participant-publications")
def create_publication(project_id: str, payload: PublishRequest, user: dict[str, Any] = Depends(require_user)):
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
        raise HTTPException(status_code=404, detail="The selected saved primary-data version was not found or has no questions.")
    ids = [i.get("item_id") for i in items if isinstance(i, dict)]
    if len(ids) != len(items) or len(ids) != len(set(ids)) or any(not isinstance(i, str) or not i for i in ids):
        raise HTTPException(status_code=422, detail="The saved instrument has an invalid question structure.")
    token = secrets.token_urlsafe(48)
    publication_id = str(uuid4())
    record = {
        "id": publication_key(token), "entity_type": "participant_publication",
        "publication_id": publication_id, "project_id": project_id, "owner_sub": user["sub"],
        "version_id": payload.version_id, "version_number": version.get("version_number"),
        "snapshot": snapshot, "status": "test_open", "mode": "technical_pilot",
        "is_test": True, "created_at": now(),
    }
    try:
        projects_table.put_item(Item=record, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to create the technical pilot link.") from exc
    return {"publication_id": publication_id, "token": token, "public_url_path": f"/participant/{token}", "version_number": version.get("version_number"), "status": "test_open", "mode": "technical_pilot"}


@router.get("/public/participant-publications/{token}")
def get_publication(token: str):
    try:
        record = projects_table.get_item(Key={"id": publication_key(token)}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to load this questionnaire.") from exc
    if not record or record.get("entity_type") != "participant_publication" or record.get("status") != "test_open" or record.get("mode") != "technical_pilot":
        raise HTTPException(status_code=404, detail="This technical pilot is closed or unavailable.")
    snapshot = record.get("snapshot") if isinstance(record.get("snapshot"), dict) else {}
    return {
        "publication_id": record["publication_id"], "version_number": record.get("version_number"),
        "instrument_title": snapshot.get("instrument_title", "Research questionnaire"),
        "purpose": snapshot.get("purpose", ""), "target_population": snapshot.get("target_population", ""),
        "instrument_instructions": snapshot.get("instrument_instructions", ""),
        "instrument_sections": snapshot.get("instrument_sections", []),
        "instrument_items": snapshot.get("instrument_items", []),
        "pilot_notice": "Technical pilot only. Responses are test submissions used to check the questionnaire and dashboard. They will not be treated as research data.",
        "consent_text": "I understand this is a technical pilot. I voluntarily agree to submit test responses for functionality testing. These responses will not be used as research data.",
        "eligibility_text": "I confirm that I am aged 18–35 and currently reside in Anambra State, Nigeria.",
    }


@router.post("/public/participant-publications/submit")
def submit_publication(payload: SubmitRequest):
    if payload.website.strip():
        raise HTTPException(status_code=400, detail="Submission could not be accepted.")
    if not payload.consent:
        raise HTTPException(status_code=400, detail="Please confirm consent before submitting.")
    if not payload.eligible:
        raise HTTPException(status_code=400, detail="This technical pilot is for eligible test participants.")
    if payload.elapsed_seconds < 8:
        raise HTTPException(status_code=400, detail="Please review the questionnaire before submitting.")
    try:
        publication = projects_table.get_item(Key={"id": publication_key(payload.token)}).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to save this pilot response.") from exc
    if not publication or publication.get("entity_type") != "participant_publication" or publication.get("status") != "test_open":
        raise HTTPException(status_code=404, detail="This technical pilot is closed or unavailable.")
    snapshot = publication.get("snapshot") if isinstance(publication.get("snapshot"), dict) else {}
    items = snapshot.get("instrument_items") if isinstance(snapshot.get("instrument_items"), list) else []
    expected = {i.get("item_id") for i in items if isinstance(i, dict)}
    if not set(payload.answers).issubset(expected):
        raise HTTPException(status_code=422, detail="Please check that all questions have valid responses.")
    for item in items:
        if not isinstance(item, dict) or not valid_answer(item, payload.answers.get(item.get("item_id"))):
            raise HTTPException(status_code=422, detail="Please check the response to each required question and its response options.")
    browser_hash = digest(payload.browser_token)
    dedupe_id = f"participant-dedupe#{publication['publication_id']}#{browser_hash}"
    response_id = "participant-response#" + str(uuid4())
    timestamp = now()
    try:
        projects_table.put_item(Item={
            "id": dedupe_id, "entity_type": "participant_dedupe",
            "publication_id": publication["publication_id"], "project_id": publication["project_id"],
            "browser_token_hash": browser_hash, "created_at": timestamp,
        }, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="A response has already been submitted from this browser for this pilot.") from exc
        raise HTTPException(status_code=500, detail="Unable to register the pilot submission.") from exc
    try:
        projects_table.put_item(Item={
            "id": response_id, "entity_type": "participant_response",
            "publication_id": publication["publication_id"], "project_id": publication["project_id"],
            "owner_sub": publication["owner_sub"], "version_id": publication["version_id"],
            "version_number": publication.get("version_number"), "mode": "technical_pilot",
            "is_test": True, "answers": payload.answers, "question_count": len(items),
            "elapsed_seconds": payload.elapsed_seconds, "submitted_at": timestamp,
        }, ConditionExpression="attribute_not_exists(id)")
    except ClientError as exc:
        try:
            projects_table.delete_item(Key={"id": dedupe_id})
        except ClientError:
            pass
        raise HTTPException(status_code=500, detail="Unable to save the pilot response.") from exc
    return {"status": "submitted", "message": "Your technical pilot response has been saved as test data."}


@router.get("/projects/{project_id}/participant-publications")
def list_publications(project_id: str, user: dict[str, Any] = Depends(require_user)):
    owned_project(project_id, user)
    publications = scan_all(Attr("entity_type").eq("participant_publication") & Attr("project_id").eq(project_id) & Attr("owner_sub").eq(user["sub"]))
    responses = scan_all(Attr("entity_type").eq("participant_response") & Attr("project_id").eq(project_id) & Attr("owner_sub").eq(user["sub"]))
    grouped: dict[str, list[dict[str, Any]]] = {}
    for response in responses:
        grouped.setdefault(response.get("publication_id", ""), []).append(response)
    publications.sort(key=lambda p: p.get("created_at", ""), reverse=True)
    return {"publications": [{
        "publication_id": p.get("publication_id"), "version_id": p.get("version_id"),
        "version_number": p.get("version_number"), "status": p.get("status"),
        "mode": "technical_pilot", "is_test": True, "created_at": p.get("created_at"),
        "response_count": len(grouped.get(p.get("publication_id", ""), [])),
        "responses": [{
            "response_id": r.get("id"), "question_count": r.get("question_count"),
            "submitted_at": r.get("submitted_at"), "elapsed_seconds": r.get("elapsed_seconds"),
            "is_test": True, "answers": r.get("answers", {}),
        } for r in sorted(grouped.get(p.get("publication_id", ""), []), key=lambda x: x.get("submitted_at", ""), reverse=True)],
    } for p in publications]}


@router.post("/projects/{project_id}/participant-publications/{publication_id}/close")
def close_publication(project_id: str, publication_id: str, user: dict[str, Any] = Depends(require_user)):
    owned_project(project_id, user)
    found = scan_all(Attr("entity_type").eq("participant_publication") & Attr("project_id").eq(project_id) & Attr("publication_id").eq(publication_id) & Attr("owner_sub").eq(user["sub"]))
    if not found:
        raise HTTPException(status_code=404, detail="Pilot publication not found.")
    try:
        projects_table.update_item(
            Key={"id": found[0]["id"]}, UpdateExpression="SET #s = :closed, closed_at = :now",
            ConditionExpression="#s = :open AND owner_sub = :owner",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":closed": "closed", ":open": "test_open", ":owner": user["sub"], ":now": now()},
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="This pilot link is already closed.") from exc
        raise HTTPException(status_code=500, detail="Unable to close the pilot link.") from exc
    return {"status": "closed"}
