import json
import logging
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.db import study_screening_table


logger = logging.getLogger(__name__)
MAX_ITEM_BYTES = 300 * 1024


def is_configured() -> bool:
    return study_screening_table is not None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_item_size(value: Any, label: str) -> None:
    try:
        size = len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Study Screening {label} contains data that cannot be stored.") from exc
    if size > MAX_ITEM_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"One Study Screening {label} entry is too large for a DynamoDB item. Split the entry or store its large attachment in object storage.",
        )


def _query_generation(project_id: str, generation: str):
    prefix = f"DATA#{generation}#"
    response = study_screening_table.query(
        KeyConditionExpression=Key("project_id").eq(project_id) & Key("record_key").begins_with(prefix),
        ConsistentRead=True,
    )
    items = list(response.get("Items", []))
    while response.get("LastEvaluatedKey"):
        response = study_screening_table.query(
            KeyConditionExpression=Key("project_id").eq(project_id) & Key("record_key").begins_with(prefix),
            ExclusiveStartKey=response["LastEvaluatedKey"],
            ConsistentRead=True,
        )
        items.extend(response.get("Items", []))
    return items


def load(project_id: str) -> dict[str, Any] | None:
    try:
        response = study_screening_table.get_item(
            Key={"project_id": project_id, "record_key": "META"},
            ConsistentRead=True,
        )
        meta = response.get("Item")
        if not meta:
            return None

        result = dict(meta.get("metadata") or {})
        list_fields = meta.get("list_fields") or []
        for field in list_fields:
            result[field] = []

        generation = meta.get("active_generation")
        if not generation:
            return result

        for item in _query_generation(project_id, generation):
            field = item.get("field")
            if not isinstance(field, str):
                continue
            result.setdefault(field, [])
            result[field].append((int(item.get("position", 0)), item.get("value")))

        for field in list_fields:
            values = result.get(field, [])
            if values and isinstance(values[0], tuple):
                result[field] = [value for _, value in sorted(values, key=lambda entry: entry[0])]
        return result
    except ClientError as exc:
        logger.exception("Unable to load Study Screening data for project %s", project_id)
        raise HTTPException(status_code=500, detail="Unable to retrieve Study Screening data") from exc


def _delete_generation(project_id: str, generation: str) -> None:
    items = _query_generation(project_id, generation)
    if not items:
        return
    with study_screening_table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"project_id": project_id, "record_key": item["record_key"]})


def save(project_id: str, content: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(content, dict):
        raise HTTPException(status_code=422, detail="Study Screening content must be an object.")

    saved = dict(content)
    saved.setdefault("updated_at", _now())
    list_fields = [key for key, value in saved.items() if isinstance(value, list)]
    metadata = {key: value for key, value in saved.items() if key not in list_fields}
    _check_item_size(metadata, "module metadata")

    generation = uuid4().hex
    data_items = []
    for field in list_fields:
        for position, value in enumerate(saved[field]):
            item = {
                "project_id": project_id,
                "record_key": f"DATA#{generation}#{field}#{position:08d}",
                "field": field,
                "position": position,
                "value": value,
            }
            _check_item_size(item, f"{field} entry")
            data_items.append(item)

    try:
        previous = study_screening_table.get_item(
            Key={"project_id": project_id, "record_key": "META"},
            ConsistentRead=True,
        ).get("Item") or {}
        previous_generation = previous.get("active_generation")

        if data_items:
            with study_screening_table.batch_writer(overwrite_by_pkeys=["project_id", "record_key"]) as batch:
                for item in data_items:
                    batch.put_item(Item=item)

        meta = {
            "project_id": project_id,
            "record_key": "META",
            "active_generation": generation,
            "list_fields": list_fields,
            "metadata": metadata,
            "updated_at": saved["updated_at"],
        }
        if previous_generation:
            study_screening_table.update_item(
                Key={"project_id": project_id, "record_key": "META"},
                UpdateExpression="SET active_generation = :generation, list_fields = :fields, metadata = :metadata, updated_at = :updated",
                ConditionExpression="active_generation = :previous",
                ExpressionAttributeValues={
                    ":generation": generation,
                    ":fields": list_fields,
                    ":metadata": metadata,
                    ":updated": saved["updated_at"],
                    ":previous": previous_generation,
                },
            )
        else:
            study_screening_table.put_item(
                Item=meta,
                ConditionExpression="attribute_not_exists(active_generation)",
            )
    except ClientError as exc:
        try:
            _delete_generation(project_id, generation)
        except Exception:
            logger.exception("Unable to clean up incomplete Study Screening generation %s", generation)
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(
                status_code=409,
                detail="Study Screening changed in another session. Refresh the module and retry your save.",
            ) from exc
        logger.exception("Unable to save Study Screening data for project %s", project_id)
        raise HTTPException(status_code=500, detail="Unable to save Study Screening data") from exc

    if previous_generation and previous_generation != generation:
        try:
            _delete_generation(project_id, previous_generation)
        except Exception:
            # The active generation is already committed; old rows can be cleaned up later.
            logger.exception("Unable to remove previous Study Screening generation %s", previous_generation)

    return saved
