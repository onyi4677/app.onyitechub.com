from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.db import projects_table
from app.services.study_screening_storage import is_configured as screening_storage_is_configured, load as load_screening_storage, save as save_screening_storage


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()



def _protect_instrument_history(
    existing: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    """Keep saved instrument versions append-only and validation records version-bound."""
    existing_pathways = existing.get("pathways")
    incoming_pathways = incoming.get("pathways")
    old_pathways = existing_pathways if isinstance(existing_pathways, dict) else {}
    next_pathways = dict(incoming_pathways) if isinstance(incoming_pathways, dict) else {}

    for pathway in ("primary_data", "secondary_data"):
        old_value = old_pathways.get(pathway)
        old_record = old_value if isinstance(old_value, dict) else {}
        new_value = next_pathways.get(pathway)
        if not isinstance(new_value, dict):
            if old_record:
                next_pathways[pathway] = old_record
            continue

        new_record = dict(new_value)
        old_versions = old_record.get("instrument_versions")
        old_versions = old_versions if isinstance(old_versions, list) else []
        if "instrument_versions" not in new_record:
            versions = list(old_versions)
        else:
            versions = new_record.get("instrument_versions")
            if not isinstance(versions, list) or versions[:len(old_versions)] != old_versions:
                raise HTTPException(
                    status_code=422,
                    detail=f"Instrument versions for {pathway} are append-only and cannot be changed or removed",
                )

        seen_version_ids: set[str] = set()
        for index, version in enumerate(versions, start=1):
            if not isinstance(version, dict):
                raise HTTPException(status_code=422, detail="Each instrument version must be an object")
            version_id = version.get("version_id")
            if not isinstance(version_id, str) or not version_id.strip() or version_id in seen_version_ids:
                raise HTTPException(status_code=422, detail="Instrument version IDs must be unique and non-empty")
            if version.get("version_number") != index or not isinstance(version.get("snapshot"), dict):
                raise HTTPException(status_code=422, detail="Instrument versions must have sequential numbers and a snapshot")
            seen_version_ids.add(version_id)

        old_validations = old_record.get("validation_records")
        old_validations = old_validations if isinstance(old_validations, list) else []
        if "validation_records" not in new_record:
            validations = list(old_validations)
        else:
            validations = new_record.get("validation_records")
            if not isinstance(validations, list):
                raise HTTPException(status_code=422, detail="Validation records must be a list")

        validation_by_id: dict[str, dict[str, Any]] = {}
        for validation in validations:
            if not isinstance(validation, dict):
                raise HTTPException(status_code=422, detail="Each validation record must be an object")
            validation_id = validation.get("validation_id")
            version_id = validation.get("version_id")
            if not isinstance(validation_id, str) or not validation_id.strip() or validation_id in validation_by_id:
                raise HTTPException(status_code=422, detail="Validation record IDs must be unique and non-empty")
            if version_id not in seen_version_ids:
                raise HTTPException(status_code=422, detail="Each validation record must reference a saved instrument version")
            validation_by_id[validation_id] = validation

        for old_validation in old_validations:
            old_id = old_validation.get("validation_id") if isinstance(old_validation, dict) else None
            preserved = validation_by_id.get(old_id) if isinstance(old_id, str) else None
            if not preserved or preserved.get("version_id") != old_validation.get("version_id"):
                raise HTTPException(
                    status_code=422,
                    detail="Existing validation records cannot be removed or reassigned to another instrument version",
                )

        new_record["instrument_versions"] = versions
        new_record["validation_records"] = validations
        next_pathways[pathway] = new_record

    result = dict(incoming)
    result["pathways"] = next_pathways
    return result


def _legacy_screening_module(modules: dict[str, Any]) -> dict[str, Any]:
    standalone = modules.get("study_screening")
    standalone = standalone if isinstance(standalone, dict) else {}
    methodology = modules.get("methodology")
    methodology = methodology if isinstance(methodology, dict) else {}
    legacy = methodology.get("study_screening")
    legacy = legacy if isinstance(legacy, dict) else {}

    standalone_records = standalone.get("records")
    legacy_records = legacy.get("records")
    if (
        (not isinstance(standalone_records, list) or not standalone_records)
        and isinstance(legacy_records, list)
        and legacy_records
    ):
        return legacy
    return standalone or legacy


def _touch_project_after_screening_save(project_id: str, modules: dict[str, Any]) -> None:
    names = {"#updated": "updated_at"}
    remove_paths = []
    if "study_screening" in modules:
        names["#modules"] = "modules"
        names["#standalone"] = "study_screening"
        remove_paths.append("#modules.#standalone")
    methodology = modules.get("methodology")
    if isinstance(methodology, dict) and "study_screening" in methodology:
        names["#modules"] = "modules"
        names["#methodology"] = "methodology"
        names["#legacy"] = "study_screening"
        remove_paths.append("#modules.#methodology.#legacy")

    expression = "SET #updated = :now"
    if remove_paths:
        expression += " REMOVE " + ", ".join(remove_paths)
    try:
        projects_table.update_item(
            Key={"id": project_id},
            UpdateExpression=expression,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues={":now": _now()},
        )
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Study Screening was saved, but project metadata could not be updated") from exc


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
    if module_key == "study_screening" and screening_storage_is_configured():
        saved_content = save_screening_storage(project_id, content)
        _touch_project_after_screening_save(project_id, modules)
        return saved_content

    if module_key == "instruments":
        previous = modules.get("instruments")
        previous = previous if isinstance(previous, dict) else {}
        content = _protect_instrument_history(previous, content)
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

    if module_key == "study_screening" and screening_storage_is_configured():
        stored = load_screening_storage(project_id)
        if stored is not None:
            return stored
        legacy = _legacy_screening_module(modules)
        if legacy:
            migrated = save_screening_storage(project_id, legacy)
            _touch_project_after_screening_save(project_id, modules)
            return migrated
        return {}

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


def get_module_read_only(project_id: str, module_key: str) -> dict[str, Any]:
    """Read a module without triggering legacy Study Screening migration writes."""
    if module_key != "study_screening" or not screening_storage_is_configured():
        return get_module(project_id, module_key)

    try:
        response = projects_table.get_item(Key={"id": project_id}, ConsistentRead=True)
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc

    project = response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    stored = load_screening_storage(project_id)
    if stored is not None:
        return stored

    modules = project.get("modules") or {}
    return _legacy_screening_module(modules) or {}
