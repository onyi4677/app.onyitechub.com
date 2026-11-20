"""Authenticated manuscript workspace and source-collection API routes."""
from __future__ import annotations

import json
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import require_user
from app.api.routes import _require_project_access
from app.db import manuscript_table
from app.services.manuscript_objects import (
    BUCKET_NAME,
    build_object_key,
    put_json,
    s3_client,
)
from app.services.manuscript_sources import collect_project_sources
from app.services.manuscript_backup_import import import_project_backup
from app.services.manuscript_storage import (
    WORKSPACE_KEY,
    create_workspace,
    create_version,
    delete_workspace,
    get_workspace,
    save_section,
)

router = APIRouter(prefix="/api")


class ManuscriptWorkspaceCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    article_type: str = Field(min_length=1, max_length=100)


class ManuscriptVersionCreate(BaseModel):
    source_snapshot_id: str = Field(min_length=1, max_length=100)
    template_id: str = Field(min_length=1, max_length=100)
    template_version: int = Field(ge=1)


class ManuscriptSectionSave(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    order: int = Field(ge=0)
    content: str = Field(max_length=250000)
    status: str = Field(default="draft", pattern=r"^(empty|needs_input|draft|in_review|approved)$")


def _workspace_or_503(project_id: str, owner_sub: str) -> dict[str, Any]:
    return get_workspace(project_id, owner_sub)


def _manuscript_table():
    if manuscript_table is None:
        raise HTTPException(status_code=503, detail="Manuscript storage is not configured.")
    return manuscript_table


@router.post("/projects/{project_id}/manuscript/workspace")
def create_project_manuscript_workspace(
    project_id: str,
    payload: ManuscriptWorkspaceCreate,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    _require_project_access(project_id, user)
    return create_workspace(project_id, user["sub"], payload.title, payload.article_type)


@router.get("/projects/{project_id}/manuscript/workspace")
def get_project_manuscript_workspace(
    project_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    _require_project_access(project_id, user)
    return get_workspace(project_id, user["sub"])


@router.delete("/projects/{project_id}/manuscript/workspace")
def delete_project_manuscript_workspace(
    project_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, str]:
    _require_project_access(project_id, user)
    delete_workspace(project_id, user["sub"])
    return {"status": "deleted"}


@router.post("/projects/{project_id}/manuscript/sources/collect")
def collect_manuscript_sources(
    project_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    project = _require_project_access(project_id, user)
    workspace = _workspace_or_503(project_id, user["sub"])
    snapshot = collect_project_sources(project_id, project)
    snapshot_id = snapshot["source_snapshot_id"]
    key = build_object_key(
        project_id, workspace["manuscript_id"], "snapshots", f"{snapshot_id}.json"
    )
    put_json(key, snapshot)
    return {
        "source_snapshot_id": snapshot_id,
        "captured_at": snapshot["captured_at"],
        "snapshot_key": key,
        "modules": snapshot["modules"],
        "canonical_source_count": len(snapshot["canonical_sources"]),
    }


@router.get("/projects/{project_id}/manuscript/sources/{snapshot_id}")
def get_manuscript_source_snapshot(
    project_id: str,
    snapshot_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    _require_project_access(project_id, user)
    workspace = _workspace_or_503(project_id, user["sub"])
    key = build_object_key(
        project_id, workspace["manuscript_id"], "snapshots", f"{snapshot_id}.json"
    )
    try:
        response = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
        payload = json.loads(response["Body"].read().decode("utf-8"))
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NotFound"}:
            raise HTTPException(status_code=404, detail="Source snapshot not found.") from exc
        raise HTTPException(status_code=500, detail="Unable to retrieve source snapshot.") from exc
    except (KeyError, ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Stored source snapshot is invalid.") from exc
    if payload.get("source_snapshot_id") != snapshot_id:
        raise HTTPException(status_code=404, detail="Source snapshot not found.")
    return payload


@router.post("/projects/{project_id}/manuscript/versions")
def create_project_manuscript_version(
    project_id: str,
    payload: ManuscriptVersionCreate,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    _require_project_access(project_id, user)
    workspace = _workspace_or_503(project_id, user["sub"])
    key = build_object_key(
        project_id,
        workspace["manuscript_id"],
        "snapshots",
        f"{payload.source_snapshot_id}.json",
    )
    try:
        s3_client.head_object(Bucket=BUCKET_NAME, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NotFound"}:
            raise HTTPException(status_code=404, detail="The source snapshot does not exist.") from exc
        raise HTTPException(status_code=500, detail="Unable to verify source snapshot.") from exc
    return create_version(
        project_id,
        user["sub"],
        payload.source_snapshot_id,
        payload.template_id,
        payload.template_version,
    )


@router.get("/projects/{project_id}/manuscript/current")
def get_current_project_manuscript(
    project_id: str,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    _require_project_access(project_id, user)
    workspace = _workspace_or_503(project_id, user["sub"])
    version_id = workspace.get("current_version_id")
    if not version_id:
        return {"workspace": workspace, "version": None, "sections": []}
    table = _manuscript_table()
    try:
        version = table.get_item(
            Key={"project_id": project_id, "record_key": f"VERSION#{version_id}"},
            ConsistentRead=True,
        ).get("Item")
        if not version or version.get("manuscript_id") != workspace["manuscript_id"]:
            raise HTTPException(status_code=404, detail="Current manuscript version not found.")
        response = table.query(
            KeyConditionExpression=Key("project_id").eq(project_id)
            & Key("record_key").begins_with(f"SECTION#{version_id}#"),
            ConsistentRead=True,
        )
        sections = list(response.get("Items", []))
        while response.get("LastEvaluatedKey"):
            response = table.query(
                KeyConditionExpression=Key("project_id").eq(project_id)
                & Key("record_key").begins_with(f"SECTION#{version_id}#"),
                ExclusiveStartKey=response["LastEvaluatedKey"],
                ConsistentRead=True,
            )
            sections.extend(response.get("Items", []))
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve current manuscript.") from exc
    sections.sort(key=lambda item: (int(item.get("order", 0)), item.get("section_id", "")))
    return {"workspace": workspace, "version": version, "sections": sections}


@router.put("/projects/{project_id}/manuscript/versions/{version_id}/sections/{section_id}")
def save_project_manuscript_section(
    project_id: str,
    version_id: str,
    section_id: str,
    payload: ManuscriptSectionSave,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    _require_project_access(project_id, user)
    return save_section(
        project_id=project_id,
        owner_sub=user["sub"],
        version_id=version_id,
        section_id=section_id,
        title=payload.title,
        order=payload.order,
        content=payload.content,
        status=payload.status,
    )



@router.post("/projects/{project_id}/modules/backup/import")
async def import_project_module_backup(
    project_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    """Import a verified project backup ZIP into an empty project owned by the caller."""
    _require_project_access(project_id, user)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"application/zip", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Upload the Project Backup ZIP file.")
    archive_bytes = await request.body()
    return import_project_backup(project_id, user["sub"], archive_bytes)
