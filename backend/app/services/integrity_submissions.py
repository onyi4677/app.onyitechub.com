"""Private, owner-scoped storage lifecycle for standalone integrity submissions.

The S3 bucket and DynamoDB table are provisioned separately. This module only
uses them when the corresponding environment variables are configured.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_FILE_BYTES = 15 * 1024 * 1024
UPLOAD_URL_SECONDS = 300


class SubmissionConfigurationError(RuntimeError):
    pass


class SubmissionNotFoundError(LookupError):
    pass


class SubmissionValidationError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resources():
    bucket = os.getenv("INTEGRITY_SUBMISSIONS_BUCKET", "").strip()
    table_name = os.getenv("INTEGRITY_SUBMISSIONS_TABLE", "").strip()
    if not bucket or not table_name:
        raise SubmissionConfigurationError("Manuscript submission storage is not configured.")
    region = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
    return boto3.client("s3", region_name=region), boto3.resource("dynamodb", region_name=region).Table(table_name), bucket


def _safe_file_name(file_name: str) -> str:
    leaf = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    leaf = re.sub(r"[^A-Za-z0-9._ -]", "_", leaf)[:160]
    if not leaf or leaf in {".", ".."}:
        raise SubmissionValidationError("A valid manuscript filename is required.")
    return leaf


def validate_upload(file_name: str, content_type: str, size_bytes: int) -> str:
    safe_name = _safe_file_name(file_name)
    suffix = os.path.splitext(safe_name)[1].lower()
    expected_type = ALLOWED_TYPES.get(suffix)
    if not expected_type or content_type != expected_type:
        raise SubmissionValidationError("Only PDF and DOCX manuscripts are accepted.")
    if not isinstance(size_bytes, int) or size_bytes < 1 or size_bytes > MAX_FILE_BYTES:
        raise SubmissionValidationError("The manuscript must be between 1 byte and 15 MB.")
    return safe_name


def create_submission(
    owner_sub: str,
    file_name: str,
    content_type: str,
    size_bytes: int,
    permission_confirmed: bool,
) -> dict[str, Any]:
    if not permission_confirmed:
        raise SubmissionValidationError("Confirm that you have permission to submit this manuscript.")
    safe_name = validate_upload(file_name, content_type, size_bytes)
    s3, table, bucket = _resources()
    submission_id = str(uuid4())
    now = _now()
    suffix = os.path.splitext(safe_name)[1].lower()
    object_key = f"submissions/{owner_sub}/{submission_id}/original{suffix}"
    item = {
        "owner_sub": owner_sub,
        "submission_id": submission_id,
        "file_name": safe_name,
        "content_type": content_type,
        "expected_size_bytes": size_bytes,
        "object_key": object_key,
        "status": "pending_upload",
        "created_at": now,
        "updated_at": now,
    }
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(submission_id)")
        post = s3.generate_presigned_post(
            Bucket=bucket,
            Key=object_key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},
                ["content-length-range", 1, MAX_FILE_BYTES],
            ],
            ExpiresIn=UPLOAD_URL_SECONDS,
        )
    except ClientError:
        # A failed signing step must not leave an orphaned pending record.
        try:
            table.delete_item(Key={"owner_sub": owner_sub, "submission_id": submission_id})
        except ClientError:
            pass
        raise
    return {
        "submission": {
            "submission_id": submission_id,
            "file_name": safe_name,
            "content_type": content_type,
            "size_bytes": size_bytes,
            "status": "pending_upload",
            "created_at": now,
        },
        "upload": post,
        "upload_expires_in_seconds": UPLOAD_URL_SECONDS,
    }


def complete_submission(owner_sub: str, submission_id: str) -> dict[str, Any]:
    s3, table, bucket = _resources()
    try:
        response = table.get_item(
            Key={"owner_sub": owner_sub, "submission_id": submission_id},
            ConsistentRead=True,
        )
    except ClientError:
        raise
    item = response.get("Item")
    if not item:
        raise SubmissionNotFoundError()
    if item.get("status") == "uploaded":
        return _public_submission(item)
    if item.get("status") != "pending_upload":
        raise SubmissionValidationError("This submission is not awaiting an upload.")
    try:
        head = s3.head_object(Bucket=bucket, Key=item["object_key"])
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise SubmissionValidationError("The manuscript upload was not found. Please upload it first.") from exc
        raise
    actual_size = int(head.get("ContentLength", 0))
    actual_type = head.get("ContentType", "")
    if actual_size != int(item["expected_size_bytes"]) or actual_size < 1 or actual_size > MAX_FILE_BYTES:
        raise SubmissionValidationError("The uploaded file size does not match the submission details.")
    if actual_type != item["content_type"]:
        raise SubmissionValidationError("The uploaded file type does not match the submission details.")
    now = _now()
    table.update_item(
        Key={"owner_sub": owner_sub, "submission_id": submission_id},
        UpdateExpression="SET #status = :status, updated_at = :updated",
        ConditionExpression="#status = :pending",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":status": "uploaded", ":pending": "pending_upload", ":updated": now},
    )
    item["status"] = "uploaded"
    item["updated_at"] = now
    return _public_submission(item)


def _public_submission(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "submission_id": item["submission_id"],
        "file_name": item["file_name"],
        "content_type": item["content_type"],
        "size_bytes": int(item["expected_size_bytes"]),
        "status": item["status"],
        "created_at": item["created_at"],
        "updated_at": item.get("updated_at", item["created_at"]),
    }


def list_submissions(owner_sub: str) -> list[dict[str, Any]]:
    _, table, _ = _resources()
    response = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("owner_sub").eq(owner_sub),
        ScanIndexForward=False,
    )
    items = response.get("Items", [])
    while response.get("LastEvaluatedKey"):
        response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("owner_sub").eq(owner_sub),
            ScanIndexForward=False,
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        items.extend(response.get("Items", []))
    return [_public_submission(item) for item in items]


def get_submission(owner_sub: str, submission_id: str) -> dict[str, Any]:
    _, table, _ = _resources()
    response = table.get_item(Key={"owner_sub": owner_sub, "submission_id": submission_id})
    item = response.get("Item")
    if not item:
        raise SubmissionNotFoundError()
    return _public_submission(item)


def delete_submission(owner_sub: str, submission_id: str) -> None:
    s3, table, bucket = _resources()
    response = table.get_item(Key={"owner_sub": owner_sub, "submission_id": submission_id}, ConsistentRead=True)
    item = response.get("Item")
    if not item:
        raise SubmissionNotFoundError()
    s3.delete_object(Bucket=bucket, Key=item["object_key"])
    table.delete_item(
        Key={"owner_sub": owner_sub, "submission_id": submission_id},
        ConditionExpression="attribute_exists(submission_id)",
    )
