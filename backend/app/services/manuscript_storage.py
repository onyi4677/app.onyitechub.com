"""Persistence primitives for the temporary manuscript workspace.

Large source snapshots and export files belong in the dedicated manuscript S3
bucket; this module stores only bounded metadata and individual section records
in DynamoDB. The table is optional until staging infrastructure is provisioned.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from boto3.dynamodb.conditions import Key
from uuid import uuid4
import logging

from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.db import manuscript_table
from app.services.manuscript_objects import delete_all_manuscript_object_versions


DEVELOPMENT_RETENTION_DAYS = 30
POST_EXPORT_RETENTION_DAYS = 14
WORKSPACE_KEY = "WORKSPACE"
CLEANUP_INDEX_NAME = "cleanup-index"
logger = logging.getLogger(__name__)


def _now_epoch() -> int:
    return int(time.time())


def _iso_from_epoch(value: int) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def development_expiry(created_at: int) -> int:
    return created_at + DEVELOPMENT_RETENTION_DAYS * 24 * 60 * 60


def post_export_expiry(exported_at: int) -> int:
    return exported_at + POST_EXPORT_RETENTION_DAYS * 24 * 60 * 60


def build_workspace_item(
    project_id: str,
    owner_sub: str,
    title: str,
    article_type: str,
    now_epoch: int,
) -> dict[str, Any]:
    """Build the initial workspace item; no project/source data is modified."""
    if not project_id.strip() or not owner_sub.strip():
        raise ValueError("Project and owner identifiers are required.")
    if not title.strip() or not article_type.strip():
        raise ValueError("A manuscript title and article type are required.")

    manuscript_id = str(uuid4())
    expires_at = development_expiry(now_epoch)
    return {
        "project_id": project_id,
        "record_key": WORKSPACE_KEY,
        "entity_type": "manuscript_workspace",
        "manuscript_id": manuscript_id,
        "owner_sub": owner_sub,
        "title": title.strip(),
        "article_type": article_type.strip(),
        "status": "development",
        "retention_phase": "development",
        "created_at": now_epoch,
        "updated_at": now_epoch,
        "development_expires_at": expires_at,
        "expires_at": expires_at,
        "expires_at_iso": _iso_from_epoch(expires_at),
        "cleanup_status": "pending",
        "cleanup_at": expires_at,
        "ttl": expires_at,
        "successful_export_count": 0,
    }


def _table():
    if manuscript_table is None:
        raise HTTPException(
            status_code=503,
            detail="Manuscript storage is not configured in this environment.",
        )
    return manuscript_table


def _workspace_for_owner(project_id: str, owner_sub: str, allow_expired: bool = False) -> dict[str, Any]:
    try:
        item = _table().get_item(
            Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
            ConsistentRead=True,
        ).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve manuscript workspace.") from exc

    if not item or item.get("owner_sub") != owner_sub:
        raise HTTPException(status_code=404, detail="Manuscript workspace not found.")
    if not allow_expired and (
        item.get("status") == "expired" or int(item.get("expires_at", 0)) <= _now_epoch()
    ):
        raise HTTPException(status_code=410, detail="This manuscript workspace has expired.")
    return item


def create_workspace(
    project_id: str,
    owner_sub: str,
    title: str,
    article_type: str,
    now_epoch: int | None = None,
) -> dict[str, Any]:
    """Create one workspace per project with a 30-day no-export deadline."""
    now = int(now_epoch if now_epoch is not None else _now_epoch())
    item = build_workspace_item(project_id, owner_sub, title, article_type, now)
    try:
        _table().put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(project_id) AND attribute_not_exists(record_key)",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(
                status_code=409,
                detail="A manuscript workspace already exists for this project.",
            ) from exc
        raise HTTPException(status_code=500, detail="Unable to create manuscript workspace.") from exc
    return item


def get_workspace(project_id: str, owner_sub: str) -> dict[str, Any]:
    return _workspace_for_owner(project_id, owner_sub)


def create_version(
    project_id: str,
    owner_sub: str,
    source_snapshot_id: str,
    template_id: str,
    template_version: int,
    now_epoch: int | None = None,
) -> dict[str, Any]:
    """Persist version metadata; the full snapshot payload is stored in S3 later."""
    workspace = _workspace_for_owner(project_id, owner_sub)
    if not source_snapshot_id.strip() or not template_id.strip() or template_version < 1:
        raise HTTPException(status_code=422, detail="Valid snapshot and template identifiers are required.")
    version_id = str(uuid4())
    now = int(now_epoch if now_epoch is not None else _now_epoch())
    version_number = int(workspace.get("latest_version_number", 0)) + 1
    item = {
        "project_id": project_id,
        "record_key": f"VERSION#{version_id}",
        "entity_type": "manuscript_version",
        "manuscript_id": workspace["manuscript_id"],
        "version_id": version_id,
        "version_number": version_number,
        "source_snapshot_id": source_snapshot_id,
        "template_id": template_id,
        "template_version": template_version,
        "status": "assembled",
        "created_at": now,
        "updated_at": now,
    }
    table = _table()
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(record_key)")
        table.update_item(
            Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
            UpdateExpression="SET latest_version_number = :number, current_version_id = :version, updated_at = :now",
            ConditionExpression=(
                "owner_sub = :owner AND manuscript_id = :manuscript "
                "AND (attribute_not_exists(latest_version_number) OR latest_version_number = :previous)"
            ),
            ExpressionAttributeValues={
                ":number": version_number,
                ":version": version_id,
                ":now": now,
                ":owner": owner_sub,
                ":manuscript": workspace["manuscript_id"],
                ":previous": version_number - 1,
            },
        )
    except ClientError as exc:
        try:
            table.delete_item(
                Key={"project_id": project_id, "record_key": f"VERSION#{version_id}"}
            )
        except ClientError:
            pass
        raise HTTPException(status_code=409, detail="The manuscript changed in another session; refresh and retry.") from exc
    return item


def save_section(
    project_id: str,
    owner_sub: str,
    version_id: str,
    section_id: str,
    title: str,
    order: int,
    content: str,
    status: str = "draft",
    now_epoch: int | None = None,
) -> dict[str, Any]:
    """Save one bounded section record without overwriting other sections."""
    workspace = _workspace_for_owner(project_id, owner_sub)
    if not all(isinstance(value, str) and value.strip() for value in (version_id, section_id, title)):
        raise HTTPException(status_code=422, detail="Version, section and title are required.")
    if not isinstance(content, str) or len(content.encode("utf-8")) > 250 * 1024:
        raise HTTPException(status_code=413, detail="Section content exceeds the supported size.")
    if order < 0 or status not in {"empty", "needs_input", "draft", "in_review", "approved"}:
        raise HTTPException(status_code=422, detail="Invalid section order or status.")

    table = _table()
    version_key = f"VERSION#{version_id}"
    try:
        version = table.get_item(
            Key={"project_id": project_id, "record_key": version_key},
            ConsistentRead=True,
        ).get("Item")
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve manuscript version.") from exc
    if not version or version.get("manuscript_id") != workspace["manuscript_id"]:
        raise HTTPException(status_code=404, detail="Manuscript version not found.")

    now = int(now_epoch if now_epoch is not None else _now_epoch())
    item = {
        "project_id": project_id,
        "record_key": f"SECTION#{version_id}#{section_id}",
        "entity_type": "manuscript_section",
        "manuscript_id": workspace["manuscript_id"],
        "version_id": version_id,
        "section_id": section_id,
        "title": title.strip(),
        "order": order,
        "content": content,
        "status": status,
        "updated_at": now,
    }
    try:
        table.put_item(Item=item)
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to save manuscript section.") from exc
    return item


def record_successful_export(
    project_id: str,
    owner_sub: str,
    export_format: str,
    export_key: str,
    now_epoch: int | None = None,
) -> dict[str, Any]:
    """Start/reset the 14-day clock only after the export object is available."""
    if export_format.lower() not in {"docx", "pdf"} or not export_key.strip():
        raise HTTPException(status_code=422, detail="A completed DOCX or PDF export is required.")
    workspace = _workspace_for_owner(project_id, owner_sub)
    now = int(now_epoch if now_epoch is not None else _now_epoch())
    expires_at = post_export_expiry(now)
    table = _table()
    try:
        response = table.update_item(
            Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
            UpdateExpression=(
                "SET retention_phase = :phase, last_export_at = :now, "
                "last_export_format = :format, last_export_key = :key, "
                "expires_at = :expires, expires_at_iso = :expires_iso, "
                "cleanup_at = :expires, ttl = :expires, updated_at = :now "
                "ADD successful_export_count :one"
            ),
            ConditionExpression="owner_sub = :owner AND manuscript_id = :manuscript AND #status <> :expired",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":phase": "post_export",
                ":now": now,
                ":format": export_format.lower(),
                ":key": export_key,
                ":expires": expires_at,
                ":expires_iso": _iso_from_epoch(expires_at),
                ":owner": owner_sub,
                ":manuscript": workspace["manuscript_id"],
                ":expired": "expired",
                ":one": 1,
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        raise HTTPException(status_code=409, detail="Unable to update manuscript retention after export.") from exc
    return response.get("Attributes", {})


def delete_workspace(project_id: str, owner_sub: str) -> None:
    """Delete manuscript-domain rows and every S3 version; never touch source modules."""
    workspace = _workspace_for_owner(project_id, owner_sub, allow_expired=True)
    table = _table()
    token = str(uuid4())
    now = _now_epoch()

    try:
        table.update_item(
            Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
            UpdateExpression="SET cleanup_lease_token = :token, cleanup_lease_until = :lease_until",
            ConditionExpression=(
                "owner_sub = :owner AND "
                "(attribute_not_exists(cleanup_lease_until) OR cleanup_lease_until <= :now)"
            ),
            ExpressionAttributeValues={
                ":owner": owner_sub,
                ":token": token,
                ":lease_until": now + 120,
                ":now": now,
            },
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="Manuscript workspace is being cleaned up; retry shortly.") from exc
        raise HTTPException(status_code=500, detail="Unable to lock manuscript workspace for deletion.") from exc

    try:
        # Remove every S3 object version before deleting the DynamoDB manifest.
        # If object cleanup fails, retain metadata so the operation can be retried.
        delete_all_manuscript_object_versions(project_id, workspace["manuscript_id"])

        response = table.query(
            KeyConditionExpression=Key("project_id").eq(project_id),
            ConsistentRead=True,
        )
        items = list(response.get("Items", []))
        while response.get("LastEvaluatedKey"):
            response = table.query(
                KeyConditionExpression=Key("project_id").eq(project_id),
                ExclusiveStartKey=response["LastEvaluatedKey"],
                ConsistentRead=True,
            )
            items.extend(response.get("Items", []))

        with table.batch_writer() as batch:
            for item in items:
                if (
                    item.get("record_key") != WORKSPACE_KEY
                    and item.get("manuscript_id") == workspace["manuscript_id"]
                ):
                    batch.delete_item(
                        Key={"project_id": project_id, "record_key": item["record_key"]}
                    )

        table.delete_item(
            Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
            ConditionExpression=(
                "owner_sub = :owner AND manuscript_id = :manuscript "
                "AND cleanup_lease_token = :token"
            ),
            ExpressionAttributeValues={
                ":owner": owner_sub,
                ":manuscript": workspace["manuscript_id"],
                ":token": token,
            },
        )
    except Exception as exc:
        try:
            table.update_item(
                Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
                UpdateExpression="REMOVE cleanup_lease_token, cleanup_lease_until",
                ConditionExpression="cleanup_lease_token = :token",
                ExpressionAttributeValues={":token": token},
            )
        except ClientError:
            pass
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="Unable to delete manuscript workspace; retry is safe.") from exc



def cleanup_expired_workspaces(
    now_epoch: int | None = None,
    page_size: int = 100,
    table=None,
    object_deleter=delete_all_manuscript_object_versions,
) -> dict[str, int]:
    """Delete expired manuscript workspaces and all their object versions.

    A bounded GSI page is processed per invocation. A short conditional lease
    prevents overlapping scheduled invocations from deleting the same workspace.
    Failed items retain their pending cleanup index entry for a later retry.
    """
    if page_size < 1 or page_size > 1000:
        raise ValueError("page_size must be between 1 and 1000")

    target = table or _table()
    now = int(now_epoch if now_epoch is not None else _now_epoch())
    checked = cleaned = failed = 0

    try:
        response = target.query(
            IndexName=CLEANUP_INDEX_NAME,
            KeyConditionExpression=Key("cleanup_status").eq("pending") & Key("cleanup_at").lte(now),
            Limit=page_size,
        )
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to query expired manuscript workspaces.") from exc

    for candidate in response.get("Items", []):
        checked += 1
        project_id = candidate.get("project_id")
        manuscript_id = candidate.get("manuscript_id")
        if not isinstance(project_id, str) or not isinstance(manuscript_id, str):
            failed += 1
            continue

        token = str(uuid4())
        acquired = False
        try:
            target.update_item(
                Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
                UpdateExpression="SET cleanup_lease_token = :token, cleanup_lease_until = :lease_until",
                ConditionExpression=(
                    "cleanup_status = :pending AND cleanup_at <= :now "
                    "AND (attribute_not_exists(cleanup_lease_until) OR cleanup_lease_until <= :now)"
                ),
                ExpressionAttributeValues={
                    ":token": token,
                    ":lease_until": now + 120,
                    ":pending": "pending",
                    ":now": now,
                },
            )
            acquired = True

            fresh = target.get_item(
                Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
                ConsistentRead=True,
            ).get("Item")
            if (
                not fresh
                or fresh.get("manuscript_id") != manuscript_id
                or fresh.get("cleanup_lease_token") != token
                or int(fresh.get("cleanup_at", now + 1)) > now
            ):
                continue

            object_deleter(project_id, manuscript_id)

            response = target.query(
                KeyConditionExpression=Key("project_id").eq(project_id),
                ConsistentRead=True,
            )
            records = list(response.get("Items", []))
            while response.get("LastEvaluatedKey"):
                response = target.query(
                    KeyConditionExpression=Key("project_id").eq(project_id),
                    ExclusiveStartKey=response["LastEvaluatedKey"],
                    ConsistentRead=True,
                )
                records.extend(response.get("Items", []))

            with target.batch_writer() as batch:
                for record in records:
                    if (
                        record.get("record_key") != WORKSPACE_KEY
                        and record.get("manuscript_id") == manuscript_id
                    ):
                        batch.delete_item(
                            Key={
                                "project_id": project_id,
                                "record_key": record["record_key"],
                            }
                        )

            target.delete_item(
                Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
                ConditionExpression=(
                    "cleanup_status = :pending AND cleanup_at <= :now "
                    "AND cleanup_lease_token = :token AND manuscript_id = :manuscript"
                ),
                ExpressionAttributeValues={
                    ":pending": "pending",
                    ":now": now,
                    ":token": token,
                    ":manuscript": manuscript_id,
                },
            )
            cleaned += 1
        except Exception as exc:
            failed += 1
            logger.warning(
                "Manuscript retention cleanup failed for a workspace (%s).",
                type(exc).__name__,
            )
        finally:
            if acquired:
                try:
                    target.update_item(
                        Key={"project_id": project_id, "record_key": WORKSPACE_KEY},
                        UpdateExpression="REMOVE cleanup_lease_token, cleanup_lease_until",
                        ConditionExpression="cleanup_lease_token = :token AND cleanup_status = :pending",
                        ExpressionAttributeValues={
                            ":token": token,
                            ":pending": "pending",
                        },
                    )
                except ClientError:
                    # Successful cleanup deletes the workspace; failures retain
                    # the pending item and can release the lease on the next run.
                    pass

    logger.info(
        "Manuscript retention cleanup finished: checked=%s cleaned=%s failed=%s",
        checked,
        cleaned,
        failed,
    )
    return {"checked": checked, "cleaned": cleaned, "failed": failed}
