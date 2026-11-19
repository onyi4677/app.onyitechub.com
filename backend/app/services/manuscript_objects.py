"""Private S3 object storage helpers for manuscript snapshots and exports.

This module is dormant until MANUSCRIPTS_BUCKET_NAME is configured. Object
deletion explicitly removes every version and delete marker under one manuscript
prefix, not merely the current key.
"""
from __future__ import annotations

import json
import os
import re
from decimal import Decimal
from typing import Any
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError
from fastapi import HTTPException


BUCKET_NAME = os.getenv("MANUSCRIPTS_BUCKET_NAME", "").strip()
s3_client = boto3.client("s3")
_SEGMENT = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _safe_segment(value: str, label: str) -> str:
    if not isinstance(value, str) or not _SEGMENT.fullmatch(value):
        raise ValueError(f"Invalid {label}.")
    return value


def manuscript_prefix(project_id: str, manuscript_id: str) -> str:
    project = _safe_segment(project_id, "project identifier")
    manuscript = _safe_segment(manuscript_id, "manuscript identifier")
    return f"projects/{project}/manuscripts/{manuscript}/"


def build_object_key(
    project_id: str,
    manuscript_id: str,
    category: str,
    filename: str | None = None,
) -> str:
    if category not in {"snapshots", "exports", "working"}:
        raise ValueError("Unsupported manuscript object category.")
    name = filename or f"{uuid4().hex}.bin"
    name = _safe_segment(name, "object filename")
    return f"{manuscript_prefix(project_id, manuscript_id)}{category}/{name}"


def _bucket() -> str:
    if not BUCKET_NAME:
        raise HTTPException(
            status_code=503,
            detail="Manuscript object storage is not configured in this environment.",
        )
    return BUCKET_NAME


def put_bytes(
    key: str,
    body: bytes,
    content_type: str,
    client=None,
) -> str:
    if not isinstance(body, bytes) or not body:
        raise HTTPException(status_code=422, detail="Manuscript file content is empty.")
    if not key.startswith("projects/") or ".." in key.split("/"):
        raise HTTPException(status_code=422, detail="Invalid manuscript object key.")
    try:
        (client or s3_client).put_object(
            Bucket=_bucket(),
            Key=key,
            Body=body,
            ContentType=content_type,
            ServerSideEncryption="AES256",
            CacheControl="private, no-store",
        )
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to store manuscript file.") from exc
    return key


def put_json(key: str, payload: dict[str, Any], client=None) -> str:
    def encode(value: Any):
        if isinstance(value, Decimal):
            return str(value)
        raise TypeError(f"Unsupported JSON value: {type(value).__name__}")

    try:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=encode).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Manuscript snapshot cannot be serialised.") from exc
    return put_bytes(key, body, "application/json", client=client)


def delete_all_manuscript_object_versions(
    project_id: str,
    manuscript_id: str,
    client=None,
) -> int:
    """Delete every object version and delete marker for one manuscript prefix."""
    bucket = _bucket()
    s3 = client or s3_client
    prefix = manuscript_prefix(project_id, manuscript_id)
    key_marker = None
    version_marker = None
    deleted = 0

    while True:
        request = {"Bucket": bucket, "Prefix": prefix}
        if key_marker:
            request["KeyMarker"] = key_marker
        if version_marker:
            request["VersionIdMarker"] = version_marker
        try:
            page = s3.list_object_versions(**request)
            objects = []
            for field in ("Versions", "DeleteMarkers"):
                for entry in page.get(field, []):
                    item = {"Key": entry["Key"]}
                    if entry.get("VersionId") is not None:
                        item["VersionId"] = entry["VersionId"]
                    objects.append(item)

            for start in range(0, len(objects), 1000):
                batch = objects[start:start + 1000]
                if not batch:
                    continue
                result = s3.delete_objects(
                    Bucket=bucket,
                    Delete={"Objects": batch, "Quiet": True},
                )
                errors = result.get("Errors", [])
                if errors:
                    raise RuntimeError(f"S3 returned {len(errors)} object deletion errors.")
                deleted += len(batch)

            if not page.get("IsTruncated"):
                break
            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker:
                raise RuntimeError("S3 version listing was truncated without a continuation key.")
        except (ClientError, RuntimeError) as exc:
            raise HTTPException(
                status_code=500,
                detail="Unable to completely remove manuscript object versions; cleanup can be retried.",
            ) from exc

    return deleted
