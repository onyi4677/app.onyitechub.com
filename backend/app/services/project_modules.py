from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.api.routes import projects_table


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_module(project_id: str, module_key: str, content: dict[str, Any]) -> dict[str, Any]:
    try:
        response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc

    project = response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        projects_table.update_item(
            Key={"id": project_id},
            UpdateExpression="SET #modules.#module = :content, #updated = :updated",
            ExpressionAttributeNames={
                "#modules": "modules",
                "#module": module_key,
                "#updated": "updated_at",
            },
            ExpressionAttributeValues={
                ":content": content,
                ":updated": _now(),
            },
        )
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to save research module") from exc

    return content


def get_module(project_id: str, module_key: str) -> dict[str, Any]:
    try:
        response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc

    project = response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    module = (project.get("modules") or {}).get(module_key)
    if module is None:
        raise HTTPException(status_code=404, detail="Research module not found")

    return module
