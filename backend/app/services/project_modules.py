from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.db import projects_table


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_module(
    project_id: str,
    module_key: str,
    content: dict[str, Any],
) -> dict[str, Any]:
    try:
        response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve project",
        ) from exc

    project = response.get("Item")
    if not project:
        raise HTTPException(
            status_code=404,
            detail="Project not found",
        )

    modules = dict(project.get("modules") or {})
    modules[module_key] = content
    project["modules"] = modules
    project["updated_at"] = _now()

    try:
        projects_table.put_item(Item=project)
    except ClientError as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to save research module",
        ) from exc

    return content


def get_module(
    project_id: str,
    module_key: str,
) -> dict[str, Any]:
    try:
        response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve project",
        ) from exc

    project = response.get("Item")
    if not project:
        raise HTTPException(
            status_code=404,
            detail="Project not found",
        )

    modules = project.get("modules") or {}
    module = modules.get(module_key)

    # Backward compatibility: older versions stored screening inside methodology.
    # Prefer a populated standalone screening module, but do not hide legacy records
    # behind an empty placeholder created by a newer version.
    if module_key == "study_screening":
        standalone_records = module.get("records") if isinstance(module, dict) else None
        legacy_methodology = modules.get("methodology") or {}
        legacy_screening = legacy_methodology.get("study_screening") if isinstance(legacy_methodology, dict) else None
        legacy_records = legacy_screening.get("records") if isinstance(legacy_screening, dict) else None
        if (
            (not isinstance(standalone_records, list) or not standalone_records)
            and isinstance(legacy_records, list)
            and legacy_records
        ):
            return legacy_screening

    # A valid project may not have saved content for this module yet.
    # Return an empty object so the frontend can open a blank workspace.
    if module is None:
        return {}

    return module
