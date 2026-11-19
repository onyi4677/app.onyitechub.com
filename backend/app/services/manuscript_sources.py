"""Read-only collection of research modules for manuscript assembly.

The collector deliberately uses the project-module service so separately stored
modules (notably Study Screening) remain behind their existing storage adapter.
It does not write to or normalise any source module.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from app.services.canonical_sources import build_canonical_sources
from app.services.project_modules import get_module_read_only


SOURCE_MODULE_KEYS = (
    "research_foundation",
    "literature_evidence",
    "study_screening",
    "references_citations",
    "methodology",
)

COUNT_FIELDS = (
    "sources",
    "evidence_items",
    "evidence",
    "evidence_extractions",
    "source_verifications",
    "search_provenance",
    "import_batches",
    "claims",
    "references",
    "citations",
    "records",
    "searches",
    "extractions",
    "verification_records",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _module_summary(content: dict[str, Any]) -> dict[str, Any]:
    """Return transparent counts for known list fields without guessing schemas."""
    counts = {
        field: len(content[field])
        for field in COUNT_FIELDS
        if isinstance(content.get(field), list)
    }
    return {
        "status": "populated" if content else "empty",
        "record_counts": counts,
        "updated_at": content.get("updated_at"),
    }


def collect_project_sources(
    project_id: str,
    project: dict[str, Any],
    module_loader: Callable[[str, str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Capture a read-only, reproducible snapshot of manuscript source modules.

    project must be the already-authorized project record from the API layer.
    Module reads go through get_module by default, including the Study Screening
    storage adapter. The returned data is a snapshot candidate; this function
    does not persist it.
    """
    if not isinstance(project_id, str) or not project_id.strip():
        raise ValueError("A project ID is required.")
    if not isinstance(project, dict) or project.get("id") != project_id:
        raise ValueError("The authorized project record does not match the project ID.")

    loader = module_loader or get_module_read_only
    module_snapshots: dict[str, dict[str, Any]] = {}
    canonical_project = deepcopy(project)
    canonical_project["modules"] = dict(canonical_project.get("modules") or {})

    for module_key in SOURCE_MODULE_KEYS:
        raw_content = loader(project_id, module_key)
        content = deepcopy(raw_content) if isinstance(raw_content, dict) else {}
        module_snapshots[module_key] = {
            **_module_summary(content),
            "content": content,
        }
        # Canonical source projection expects project-item modules. Populate a
        # copy only; this does not write anything back to the project or modules.
        if module_key in {"literature_evidence", "references_citations"}:
            canonical_project["modules"][module_key] = content

    return {
        "source_snapshot_id": str(uuid4()),
        "snapshot_schema_version": 1,
        "project_id": project_id,
        "project": {
            "title": project.get("title"),
            "question": project.get("question"),
            "discipline": project.get("discipline"),
        },
        "captured_at": _utc_now(),
        "modules": module_snapshots,
        "canonical_sources": build_canonical_sources(canonical_project),
    }
