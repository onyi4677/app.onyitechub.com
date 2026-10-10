import os
from typing import Any
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_user
from app.db import projects_table
from app.modules.literature_evidence import get_literature_evidence_spec
from app.modules.references_citations import get_references_citations_spec
from app.modules.research_foundation import get_research_foundation_spec
from app.modules.registry import get_modules
from app.services.analysis import analyze_idea
from app.services.project_modules import get_module, save_module

router = APIRouter(prefix="/api")


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1, max_length=100_000)
    discipline: str = Field(min_length=1, max_length=100)


class ModuleUpdateRequest(BaseModel):
    content: dict[str, Any]


class LiteratureSourceRequest(BaseModel):
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    title: str = Field(min_length=1, max_length=1000)
    source_type: str = Field(default="journal_article", max_length=100)
    journal_or_publisher: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    doi: str | None = None
    url: str | None = None
    abstract: str | None = None
    keywords: list[str] = Field(default_factory=list)
    verified: bool = False


class EvidenceItemRequest(BaseModel):
    source_id: str
    finding: str = Field(min_length=1, max_length=5000)
    population: str | None = None
    setting: str | None = None
    method: str | None = None
    sample_size: int | None = None
    limitations: list[str] = Field(default_factory=list)
    notes: str | None = None


class ClaimRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    evidence_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    confidence: str | None = None


class ReferenceRequest(BaseModel):
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    title: str = Field(min_length=1, max_length=1000)
    source_type: str = Field(default="journal_article", max_length=100)
    journal_or_book: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    publisher: str | None = None
    doi: str | None = None
    url: str | None = None
    abstract: str | None = None
    keywords: list[str] = Field(default_factory=list)


class CitationRequest(BaseModel):
    reference_ids: list[str] = Field(min_length=1)
    text: str = Field(min_length=1, max_length=2000)
    citation_form: str = Field(min_length=1, max_length=500)
    location: str | None = None
    page: str | None = None



def _require_project_access(project_id: str, user: dict[str, Any]) -> dict[str, Any]:
    """Return a project only to its owner; the configured founder may claim legacy records."""
    try:
        response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc
    project = response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.get("owner_sub") == user["sub"]:
        return project
    founder_sub = os.getenv("FOUNDER_COGNITO_SUB", "")
    if not project.get("owner_sub") and founder_sub and user["sub"] == founder_sub:
        project["owner_sub"] = user["sub"]
        try:
            projects_table.put_item(Item=project)
        except ClientError as exc:
            raise HTTPException(status_code=500, detail="Unable to secure legacy project") from exc
        return project
    raise HTTPException(status_code=404, detail="Project not found")


def _public_project(project: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in project.items() if key != "owner_sub"}


def _project_module_or_empty(project_id: str, module_key: str) -> dict[str, Any]:
    try:
        return get_module(project_id, module_key)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {}
        raise


def _append_to_module(project_id: str, module_key: str, list_key: str, item: dict[str, Any]) -> dict[str, Any]:
    module = _project_module_or_empty(project_id, module_key)
    values = list(module.get(list_key) or [])
    values.append(item)
    module[list_key] = values
    save_module(project_id, module_key, module)
    return item


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "onyitech-research-api"}


@router.get("/modules")
def modules() -> dict[str, dict[str, Any]]:
    return get_modules()


@router.get("/modules/research-foundation/spec")
def research_foundation_spec() -> dict[str, Any]:
    return get_research_foundation_spec()


@router.get("/modules/literature-evidence/spec")
def literature_evidence_spec() -> dict[str, Any]:
    return get_literature_evidence_spec()


@router.get("/modules/references-citations/spec")
def references_citations_spec() -> dict[str, Any]:
    return get_references_citations_spec()


@router.post("/analyze")
def analyze(request: AnalyzeRequest, user: dict[str, Any] = Depends(require_user)) -> dict:
    return analyze_idea(request.text)


@router.post("/projects")
def create_project(payload: ProjectCreateRequest, user: dict[str, Any] = Depends(require_user)) -> dict:
    project_id = str(uuid4())
    project = {
        "id": project_id,
        "owner_sub": user["sub"],
        "title": payload.title,
        "question": payload.question,
        "discipline": payload.discipline,
        "status": "draft",
        "modules": {},
    }
    try:
        projects_table.put_item(Item=project)
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to save project") from exc
    return {"id": project_id, "status": "created", "project": _public_project(project)}


@router.get("/projects")
def list_projects(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    try:
        response = projects_table.scan()
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to list projects") from exc
    projects = response.get("Items", [])
    founder_sub = os.getenv("FOUNDER_COGNITO_SUB", "")
    visible = []
    for project in projects:
        if project.get("owner_sub") == user["sub"]:
            visible.append(project)
        elif not project.get("owner_sub") and founder_sub and user["sub"] == founder_sub:
            project["owner_sub"] = user["sub"]
            try:
                projects_table.put_item(Item=project)
                visible.append(project)
            except ClientError as exc:
                raise HTTPException(status_code=500, detail="Unable to secure legacy project") from exc
    visible.sort(key=lambda item: item.get("updated_at", item.get("id", "")), reverse=True)
    return {"projects": [_public_project(item) for item in visible]}


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: dict[str, Any] = Depends(require_user)) -> dict:
    project = _require_project_access(project_id, user)
    return {"project": _public_project(project)}


@router.get("/projects/{project_id}/modules/{module_key}")
def get_project_module(project_id: str, module_key: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    if module_key not in get_modules():
        raise HTTPException(status_code=404, detail="Unknown research module")
    return {"module": module_key, "content": get_module(project_id, module_key)}


@router.put("/projects/{project_id}/modules/{module_key}")
def update_project_module(project_id: str, module_key: str, payload: ModuleUpdateRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    if module_key not in get_modules():
        raise HTTPException(status_code=404, detail="Unknown research module")
    content = save_module(project_id, module_key, payload.content)
    return {"status": "saved", "module": module_key, "content": content}


@router.post("/projects/{project_id}/literature/sources")
def add_literature_source(project_id: str, payload: LiteratureSourceRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    item = {"source_id": str(uuid4()), **payload.model_dump()}
    return {"status": "created", "source": _append_to_module(project_id, "literature_evidence", "sources", item)}


@router.post("/projects/{project_id}/literature/evidence")
def add_evidence_item(project_id: str, payload: EvidenceItemRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    module = _project_module_or_empty(project_id, "literature_evidence")
    source_ids = {s.get("source_id") for s in module.get("sources", [])}
    if payload.source_id not in source_ids:
        raise HTTPException(status_code=422, detail="Evidence must reference an existing literature source")
    item = {"evidence_id": str(uuid4()), **payload.model_dump()}
    return {"status": "created", "evidence": _append_to_module(project_id, "literature_evidence", "evidence_items", item)}


@router.post("/projects/{project_id}/literature/claims")
def add_literature_claim(project_id: str, payload: ClaimRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    module = _project_module_or_empty(project_id, "literature_evidence")
    evidence_ids = {e.get("evidence_id") for e in module.get("evidence_items", [])}
    source_ids = {s.get("source_id") for s in module.get("sources", [])}
    if any(eid not in evidence_ids for eid in payload.evidence_ids):
        raise HTTPException(status_code=422, detail="Claim references unknown evidence")
    if any(sid not in source_ids for sid in payload.source_ids):
        raise HTTPException(status_code=422, detail="Claim references unknown source")
    item = {"claim_id": str(uuid4()), **payload.model_dump()}
    return {"status": "created", "claim": _append_to_module(project_id, "literature_evidence", "claims", item)}


@router.post("/projects/{project_id}/references")
def add_reference(project_id: str, payload: ReferenceRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    item = {"reference_id": str(uuid4()), **payload.model_dump()}
    return {"status": "created", "reference": _append_to_module(project_id, "references_citations", "references", item)}


@router.post("/projects/{project_id}/citations")
def add_citation(project_id: str, payload: CitationRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    module = _project_module_or_empty(project_id, "references_citations")
    reference_ids = {r.get("reference_id") for r in module.get("references", [])}
    if any(rid not in reference_ids for rid in payload.reference_ids):
        raise HTTPException(status_code=422, detail="Citation references an unknown reference")
    item = {"citation_id": str(uuid4()), **payload.model_dump()}
    return {"status": "created", "citation": _append_to_module(project_id, "references_citations", "in_text_citations", item)}


@router.get("/projects/{project_id}/citation-integrity")
def citation_integrity(project_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    _require_project_access(project_id, user)
    module = _project_module_or_empty(project_id, "references_citations")
    references = module.get("references", [])
    citations = module.get("in_text_citations", [])
    reference_ids = {r.get("reference_id") for r in references}
    cited_ids = {rid for c in citations for rid in c.get("reference_ids", [])}

    orphan_citations = [
        {"citation_id": c.get("citation_id"), "reference_id": rid}
        for c in citations
        for rid in c.get("reference_ids", [])
        if rid not in reference_ids
    ]
    uncited_references = [
        r.get("reference_id") for r in references
        if r.get("reference_id") not in cited_ids
    ]

    seen = {}
    duplicates = []
    for reference in references:
        key = (
            tuple(reference.get("authors", [])),
            reference.get("year"),
            (reference.get("title") or "").strip().lower(),
        )
        if key in seen:
            duplicates.append({
                "reference_id": reference.get("reference_id"),
                "duplicate_of": seen[key],
            })
        else:
            seen[key] = reference.get("reference_id")

    report = {
        "status": "pass" if not orphan_citations and not duplicates else "review_required",
        "citation_count": len(citations),
        "reference_count": len(references),
        "orphan_citations": orphan_citations,
        "uncited_references": uncited_references,
        "duplicate_references": duplicates,
        "style": module.get("citation_style", "APA 7"),
    }
    module["integrity_report"] = report
    save_module(project_id, "references_citations", module)
    return report
