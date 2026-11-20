"""Validated, owner-scoped import of a read-only Project Backup ZIP."""
from __future__ import annotations

import hashlib
import io
import json
import logging
import zipfile
from decimal import Decimal
from typing import Any

from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.db import projects_table, study_screening_table
from app.modules.registry import get_modules
from app.services.study_screening_storage import save as save_screening_storage

logger = logging.getLogger(__name__)

MAX_ARCHIVE_BYTES = 5 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 5 * 1024 * 1024
BACKUP_ROOT = "Project_001_Backup/"


def _record_counts(content: dict[str, Any]) -> dict[str, int]:
    return {key: len(value) for key, value in content.items() if isinstance(value, list)}


def _read_and_validate_archive(archive_bytes: bytes) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    if not archive_bytes or len(archive_bytes) > MAX_ARCHIVE_BYTES:
        raise HTTPException(status_code=413, detail="Backup ZIP is empty or exceeds the 5 MB upload limit.")

    try:
        archive = zipfile.ZipFile(io.BytesIO(archive_bytes))
    except (zipfile.BadZipFile, OSError) as exc:
        raise HTTPException(status_code=422, detail="The uploaded file is not a valid ZIP archive.") from exc

    with archive:
        infos = archive.infolist()
        if len(infos) > 30 or sum(item.file_size for item in infos) > MAX_UNCOMPRESSED_BYTES:
            raise HTTPException(status_code=413, detail="Backup archive exceeds the allowed file or uncompressed size limit.")
        names = [item.filename for item in infos if not item.is_dir()]
        if len(names) != len(set(names)):
            raise HTTPException(status_code=422, detail="Backup archive contains duplicate file paths.")
        if any(item.is_dir() for item in infos):
            # Directory entries are harmless, but all actual files must stay in the expected root.
            pass
        expected_root = BACKUP_ROOT
        if any(not name.startswith(expected_root) or ".." in name.split("/") for name in names):
            raise HTTPException(status_code=422, detail="Backup archive contains an unexpected or unsafe file path.")

        manifest_path = expected_root + "manifest.json"
        if manifest_path not in names:
            raise HTTPException(status_code=422, detail="Backup manifest is missing.")

        try:
            manifest = json.loads(archive.read(manifest_path).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError) as exc:
            raise HTTPException(status_code=422, detail="Backup manifest is not valid JSON.") from exc

        if manifest.get("backup_type") != "read_only_project_module_backup":
            raise HTTPException(status_code=422, detail="Unsupported backup type.")
        source_project_id = manifest.get("source_project_id")
        if not isinstance(source_project_id, str) or not source_project_id.strip():
            raise HTTPException(status_code=422, detail="Backup source project ID is missing.")
        checksums = manifest.get("file_sha256")
        if not isinstance(checksums, dict) or not checksums:
            raise HTTPException(status_code=422, detail="Backup checksum manifest is missing.")

        expected_files = {manifest_path}
        for relative_path, expected_hash in checksums.items():
            if not isinstance(relative_path, str) or relative_path.startswith("/") or ".." in relative_path.split("/"):
                raise HTTPException(status_code=422, detail="Backup manifest contains an unsafe file path.")
            full_path = expected_root + relative_path
            if full_path not in names:
                raise HTTPException(status_code=422, detail=f"Backup file is missing: {relative_path}")
            if not isinstance(expected_hash, str) or len(expected_hash) != 64:
                raise HTTPException(status_code=422, detail=f"Invalid checksum for {relative_path}.")
            actual_hash = hashlib.sha256(archive.read(full_path)).hexdigest()
            if actual_hash != expected_hash:
                raise HTTPException(status_code=422, detail=f"Checksum verification failed for {relative_path}.")
            expected_files.add(full_path)

        if set(names) != expected_files:
            raise HTTPException(status_code=422, detail="Archive contains files not declared in its manifest.")

        modules: dict[str, dict[str, Any]] = {}
        for full_path in names:
            if not full_path.startswith(expected_root + "modules/") and full_path != expected_root + "study_screening.json":
                continue
            relative_path = full_path[len(expected_root):]
            if relative_path == "study_screening.json":
                module_key = "study_screening"
            else:
                filename = relative_path[len("modules/"):]
                if not filename.endswith(".json") or "/" in filename:
                    raise HTTPException(status_code=422, detail="Unexpected module filename in backup.")
                module_key = filename[:-5]
            if module_key not in get_modules():
                raise HTTPException(status_code=422, detail=f"Unknown research module in backup: {module_key}")
            try:
                content = json.loads(archive.read(full_path).decode("utf-8"), parse_float=Decimal)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise HTTPException(status_code=422, detail=f"Module file is not valid JSON: {module_key}") from exc
            if not isinstance(content, dict):
                raise HTTPException(status_code=422, detail=f"Module content must be a JSON object: {module_key}")
            modules[module_key] = content

        if not modules:
            raise HTTPException(status_code=422, detail="Backup contains no research modules.")
        if not isinstance(modules.get("study_screening"), dict):
            raise HTTPException(status_code=422, detail="Study Screening backup file is missing.")
        return manifest, modules


def import_project_backup(project_id: str, owner_sub: str, archive_bytes: bytes) -> dict[str, Any]:
    manifest, imported_modules = _read_and_validate_archive(archive_bytes)
    if manifest["source_project_id"] == project_id:
        raise HTTPException(status_code=422, detail="Source and destination project IDs must be different.")

    if study_screening_table is None:
        raise HTTPException(status_code=503, detail="Study Screening storage is not configured.")

    try:
        project = projects_table.get_item(
            Key={"id": project_id}, ConsistentRead=True
        ).get("Item")
        if not project or project.get("owner_sub") != owner_sub:
            raise HTTPException(status_code=404, detail="Destination project not found.")
        existing_modules = project.get("modules") or {}
        if not isinstance(existing_modules, dict) or existing_modules:
            raise HTTPException(status_code=409, detail="Import stopped: destination project already contains module data.")

        screening_meta = study_screening_table.get_item(
            Key={"project_id": project_id, "record_key": "META"},
            ConsistentRead=True,
        ).get("Item")
        if screening_meta:
            raise HTTPException(status_code=409, detail="Import stopped: destination already contains Study Screening data.")

        project_modules = {
            key: value for key, value in imported_modules.items()
            if key != "study_screening"
        }
        projects_table.update_item(
            Key={"id": project_id},
            UpdateExpression="SET #modules = :modules, updated_at = :updated",
            ConditionExpression="owner_sub = :owner AND (attribute_not_exists(#modules) OR #modules = :empty)",
            ExpressionAttributeNames={"#modules": "modules"},
            ExpressionAttributeValues={
                ":modules": project_modules,
                ":empty": {},
                ":owner": owner_sub,
                ":updated": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            },
        )
    except HTTPException:
        raise
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise HTTPException(status_code=409, detail="Import stopped: destination changed or already contains module data.") from exc
        logger.exception("Unable to prepare destination project for backup import")
        raise HTTPException(status_code=500, detail="Unable to prepare destination project for import.") from exc

    try:
        screening_content = imported_modules["study_screening"]
        saved_screening = save_screening_storage(project_id, screening_content)
    except Exception as exc:
        # Roll back the ordinary module map if the separate screening write fails.
        try:
            projects_table.update_item(
                Key={"id": project_id},
                UpdateExpression="SET #modules = :empty",
                ConditionExpression="owner_sub = :owner AND #modules = :imported",
                ExpressionAttributeNames={"#modules": "modules"},
                ExpressionAttributeValues={
                    ":empty": {},
                    ":imported": project_modules,
                    ":owner": owner_sub,
                },
            )
        except Exception:
            logger.exception("Backup import rollback failed for project %s", project_id)
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Study Screening import failed for project %s", project_id)
        raise HTTPException(status_code=500, detail="Study Screening import failed; ordinary module data was rolled back where possible.") from exc

    counts = {
        key: _record_counts(value)
        for key, value in imported_modules.items()
    }
    counts["study_screening"] = _record_counts(saved_screening)
    return {
        "status": "imported",
        "source_project_id": manifest["source_project_id"],
        "destination_project_id": project_id,
        "modules_imported": sorted(imported_modules.keys()),
        "record_counts": counts,
        "checksums_verified": len(manifest["file_sha256"]),
    }
