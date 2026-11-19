"""Generate private DOCX/PDF exports from a saved manuscript version."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.db import manuscript_table
from app.services.manuscript_export_rendering import render_docx, render_pdf
from app.services.manuscript_objects import build_object_key, put_bytes, s3_client
from app.services.manuscript_storage import (
    WORKSPACE_KEY,
    _workspace_for_owner,
    record_successful_export,
)


MIME_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


def export_current_version(
    project_id: str,
    owner_sub: str,
    export_format: str,
    table=None,
    storage_client=None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Create a private export and start retention only after S3 accepts it."""
    fmt = export_format.lower().strip() if isinstance(export_format, str) else ""
    if fmt not in MIME_TYPES:
        raise HTTPException(status_code=422, detail="Export format must be DOCX or PDF.")
    target = table or manuscript_table
    if target is None:
        raise HTTPException(status_code=503, detail="Manuscript storage is not configured.")

    workspace = _workspace_for_owner(project_id, owner_sub)
    version_id = workspace.get("current_version_id")
    if not isinstance(version_id, str) or not version_id:
        raise HTTPException(status_code=409, detail="Create a manuscript version before exporting.")

    try:
        version = target.get_item(
            Key={"project_id": project_id, "record_key": f"VERSION#{version_id}"},
            ConsistentRead=True,
        ).get("Item")
        if not version or version.get("manuscript_id") != workspace.get("manuscript_id"):
            raise HTTPException(status_code=404, detail="Current manuscript version was not found.")
        response = target.query(
            KeyConditionExpression=(
                Key("project_id").eq(project_id)
                & Key("record_key").begins_with(f"SECTION#{version_id}#")
            ),
            ConsistentRead=True,
        )
        sections = list(response.get("Items", []))
        while response.get("LastEvaluatedKey"):
            response = target.query(
                KeyConditionExpression=(
                    Key("project_id").eq(project_id)
                    & Key("record_key").begins_with(f"SECTION#{version_id}#")
                ),
                ExclusiveStartKey=response["LastEvaluatedKey"],
                ConsistentRead=True,
            )
            sections.extend(response.get("Items", []))
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to load the manuscript for export.") from exc

    sections.sort(key=lambda item: (int(item.get("order", 0)), item.get("section_id", "")))
    generated_at = now or datetime.now(timezone.utc)
    renderer = render_docx if fmt == "docx" else render_pdf
    payload = renderer(
        title=workspace.get("title", "Untitled manuscript"),
        sections=sections,
        project_title=workspace.get("title", ""),
        article_type=workspace.get("article_type", ""),
        generated_at=generated_at,
    )
    filename = f"{version_id}-{generated_at.strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}.{fmt}"
    key = build_object_key(
        project_id, workspace["manuscript_id"], "exports", filename
    )
    objects = storage_client or s3_client
    put_bytes(key, payload, MIME_TYPES[fmt], client=objects)

    # Generate the download link before switching retention phase. If the
    # link cannot be created, the 30-day/14-day deadline is not advanced.
    try:
        download_url = objects.generate_presigned_url(
            "get_object",
            Params={"Bucket": __import__("app.services.manuscript_objects", fromlist=["BUCKET_NAME"]).BUCKET_NAME, "Key": key},
            ExpiresIn=900,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Export was stored but a download link could not be created.") from exc

    updated = record_successful_export(
        project_id=project_id,
        owner_sub=owner_sub,
        export_format=fmt,
        export_key=key,
        now_epoch=int(generated_at.timestamp()),
    )
    return {
        "status": "exported",
        "format": fmt,
        "version_id": version_id,
        "object_key": key,
        "download_url": download_url,
        "download_url_expires_in": 900,
        "retention_phase": updated.get("retention_phase", "post_export"),
        "expires_at": updated.get("expires_at_iso"),
    }
