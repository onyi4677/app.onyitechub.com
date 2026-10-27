
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import projects_table
from app.modules.literature_evidence import get_literature_evidence_spec
from app.modules.references_citations import get_references_citations_spec
from app.modules.research_foundation import get_research_foundation_spec
from app.modules.registry import get_modules
from app.services.analysis import analyze_idea
from app.services.project_modules import get_module, save_module
from app.services.canonical_sources import build_canonical_sources, canonical_source_id


router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


class NatlasChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)


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


# ---------------------------------------------------------------------
# Shared research-module helpers
# ---------------------------------------------------------------------

def _project_module_or_empty(
    project_id: str,
    module_key: str,
) -> dict[str, Any]:
    try:
        return get_module(project_id, module_key)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {}
        raise


def _append_to_module(
    project_id: str,
    module_key: str,
    list_key: str,
    item: dict[str, Any],
) -> dict[str, Any]:
    module = _project_module_or_empty(project_id, module_key)
    values = list(module.get(list_key) or [])
    values.append(item)
    module[list_key] = values
    save_module(project_id, module_key, module)
    return item


# ---------------------------------------------------------------------
# Health and module routes
# ---------------------------------------------------------------------

@router.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "onyitech-research-api",
    }


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


# ---------------------------------------------------------------------
# Existing research analysis
# ---------------------------------------------------------------------

@router.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    return analyze_idea(request.text)


# ---------------------------------------------------------------------
# N-ATLaS model integration
# ---------------------------------------------------------------------

@router.post("/natlas/chat")
def natlas_chat(payload: NatlasChatRequest) -> dict[str, Any]:
    """
    Send a research question to the private N-ATLaS model server.

    NATLAS_URL should point to the EC2 model server, for example:
    http://172.31.85.40:8080
    """
    natlas_url = os.getenv("NATLAS_URL", "").rstrip("/")

    if not natlas_url:
        raise HTTPException(
            status_code=503,
            detail="N-ATLaS service is not configured",
        )

    request_body = {
        "model": "N-ATLaS",
        "messages": [
            {
                "role": "user",
                "content": payload.message,
            }
        ],
        "max_tokens": 250,
        "temperature": 0.2,
    }

    model_request = Request(
        url=f"{natlas_url}/v1/chat/completions",
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(model_request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))

        choices = result.get("choices", [])

        if not choices:
            raise HTTPException(
                status_code=502,
                detail="N-ATLaS returned no answer",
            )

        answer = choices[0].get("message", {}).get("content", "")

        if not isinstance(answer, str) or not answer.strip():
            raise HTTPException(
                status_code=502,
                detail="N-ATLaS returned an empty answer",
            )

        return {
            "status": "ok",
            "model": "N-ATLaS",
            "answer": answer,
        }

    except HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"N-ATLaS returned HTTP {exc.code}",
        ) from exc

    except (URLError, TimeoutError, OSError):
        raise HTTPException(
            status_code=504,
            detail="N-ATLaS could not respond before the timeout",
        )

    except (json.JSONDecodeError, KeyError, TypeError):
        raise HTTPException(
            status_code=502,
            detail="Invalid response from N-ATLaS",
        )


# ---------------------------------------------------------------------
# Research projects
# ---------------------------------------------------------------------

@router.post("/projects")
def create_project(payload: ProjectCreateRequest) -> dict[str, Any]:
    project_id = str(uuid4())

    project = {
        "id": project_id,
        "title": payload.title,
        "question": payload.question,
        "discipline": payload.discipline,
        "status": "draft",
        "modules": {},
    }

    try:
        projects_table.put_item(Item=project)
    except ClientError as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to save project",
        ) from exc

    return {
        "id": project_id,
        "status": "created",
        "project": project,
    }


@router.get("/projects")
def list_projects() -> dict[str, Any]:
    try:
        response = projects_table.scan()
    except ClientError as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to list projects",
        ) from exc

    projects = response.get("Items", [])
    projects.sort(
        key=lambda item: item.get(
            "updated_at",
            item.get("id", ""),
        ),
        reverse=True,
    )

    return {"projects": projects}


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    try:
        response = projects_table.get_item(
            Key={"id": project_id}
        )
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

    return {"project": project}


# ---------------------------------------------------------------------
# Research project modules
# ---------------------------------------------------------------------

@router.get("/projects/{project_id}/research-sources")
def project_research_sources(project_id: str) -> dict[str, Any]:
    try:
        response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc
    project = response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    sources = build_canonical_sources(project)
    return {"sources": sources, "count": len(sources)}


@router.get("/projects/{project_id}/modules/{module_key}")
def get_project_module(
    project_id: str,
    module_key: str,
) -> dict[str, Any]:
    if module_key not in get_modules():
        raise HTTPException(
            status_code=404,
            detail="Unknown research module",
        )

    return {
        "module": module_key,
        "content": get_module(project_id, module_key),
    }


@router.put("/projects/{project_id}/modules/{module_key}")
def update_project_module(
    project_id: str,
    module_key: str,
    payload: ModuleUpdateRequest,
) -> dict[str, Any]:
    if module_key not in get_modules():
        raise HTTPException(
            status_code=404,
            detail="Unknown research module",
        )

    # Screening is persisted as its own module. Never interpret a methodology
    # payload as screening data, even if an old client sends an empty nested object.
    screening_content = payload.content if module_key == "study_screening" else None
    if screening_content is not None:
        if not isinstance(screening_content, dict):
            raise HTTPException(status_code=422, detail="Screening data must be an object")
        records = screening_content.get("records", [])
        if not isinstance(records, list):
            raise HTTPException(status_code=422, detail="Screening records must be a list")

        try:
            project_response = projects_table.get_item(Key={"id": project_id})
        except ClientError as exc:
            raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc
        project = project_response.get("Item")
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        canonical_sources = build_canonical_sources(project)
        source_id_map = {
            alias: source["canonical_source_id"]
            for source in canonical_sources
            for alias in source.get("aliases", [])
        }
        seen_source_ids: set[str] = set()
        allowed_ta = {"not_screened", "include", "exclude", "maybe"}
        allowed_ft = {"not_assessed", "include", "exclude", "not_retrieved"}

        for record in records:
            if not isinstance(record, dict):
                raise HTTPException(status_code=422, detail="Each screening record must be an object")
            source_id = record.get("source_id")
            if not isinstance(source_id, str) or source_id not in source_id_map:
                raise HTTPException(
                    status_code=422,
                    detail="Each screening record must link to an existing project source",
                )
            source_id = source_id_map[source_id]
            record["source_id"] = source_id
            if source_id in seen_source_ids:
                raise HTTPException(
                    status_code=422,
                    detail="A literature source can appear only once in this screening log",
                )
            seen_source_ids.add(source_id)

            ta_decision = record.get("title_abstract_decision", "not_screened")
            ft_decision = record.get("full_text_decision", "not_assessed")
            if ta_decision not in allowed_ta or ft_decision not in allowed_ft:
                raise HTTPException(status_code=422, detail="Invalid screening decision value")
            if ta_decision == "exclude" and not str(record.get("title_abstract_reason") or "").strip():
                raise HTTPException(status_code=422, detail="Title/abstract exclusions require a reason")
            if ft_decision == "exclude" and not str(record.get("full_text_reason") or "").strip():
                raise HTTPException(status_code=422, detail="Full-text exclusions require a reason")
            if ft_decision != "not_assessed" and ta_decision not in {"include", "maybe"}:
                raise HTTPException(
                    status_code=422,
                    detail="A full-text decision requires a title/abstract decision to advance the record",
                )
            if ft_decision == "not_retrieved" and not record.get("retrieval_attempts"):
                raise HTTPException(
                    status_code=422,
                    detail="Records marked not retrieved require documented retrieval attempts",
                )

    content_to_save = payload.content
    if module_key == "methodology":
        # Methodology saves may be partial, so merge only within methodology.
        # Screening uses a separate module key and cannot replace this content.
        existing = _project_module_or_empty(project_id, "methodology")
        content_to_save = {**existing, **payload.content}

    content = save_module(
        project_id,
        module_key,
        content_to_save,
    )

    return {
        "status": "saved",
        "module": module_key,
        "content": content,
    }


# ---------------------------------------------------------------------
# Literature sources, evidence, and claims
# ---------------------------------------------------------------------

@router.post("/projects/{project_id}/literature/sources")
def add_literature_source(
    project_id: str,
    payload: LiteratureSourceRequest,
) -> dict[str, Any]:
    item = {
        "source_id": str(uuid4()),
        **payload.model_dump(),
    }

    saved_item = _append_to_module(
        project_id,
        "literature_evidence",
        "sources",
        item,
    )

    return {
        "status": "created",
        "source": saved_item,
    }


@router.post("/projects/{project_id}/literature/evidence")
def add_evidence_item(
    project_id: str,
    payload: EvidenceItemRequest,
) -> dict[str, Any]:
    module = _project_module_or_empty(
        project_id,
        "literature_evidence",
    )

    try:
        project_response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc
    project = project_response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    canonical_id = canonical_source_id(project, payload.source_id)
    if not canonical_id:
        raise HTTPException(status_code=422, detail="Evidence must reference an existing canonical source")
    evidence_payload = payload.model_dump()
    evidence_payload["source_id"] = canonical_id
    item = {"evidence_id": str(uuid4()), **evidence_payload}

    saved_item = _append_to_module(
        project_id,
        "literature_evidence",
        "evidence_items",
        item,
    )

    return {
        "status": "created",
        "evidence": saved_item,
    }


@router.post("/projects/{project_id}/literature/claims")
def add_literature_claim(
    project_id: str,
    payload: ClaimRequest,
) -> dict[str, Any]:
    module = _project_module_or_empty(
        project_id,
        "literature_evidence",
    )

    evidence_ids = {
        evidence.get("evidence_id")
        for evidence in module.get("evidence_items", [])
    }

    try:
        project_response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc
    project = project_response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    canonical_ids = [canonical_source_id(project, source_id) for source_id in payload.source_ids]

    if any(
        evidence_id not in evidence_ids
        for evidence_id in payload.evidence_ids
    ):
        raise HTTPException(
            status_code=422,
            detail="Claim references unknown evidence",
        )

    if any(source_id is None for source_id in canonical_ids):
        raise HTTPException(
            status_code=422,
            detail="Claim references unknown source",
        )

    claim_payload = payload.model_dump()
    claim_payload["source_ids"] = list(dict.fromkeys(source_id for source_id in canonical_ids if source_id))
    item = {"claim_id": str(uuid4()), **claim_payload}

    saved_item = _append_to_module(
        project_id,
        "literature_evidence",
        "claims",
        item,
    )

    return {
        "status": "created",
        "claim": saved_item,
    }


# ---------------------------------------------------------------------
# References and citations
# ---------------------------------------------------------------------

@router.post("/projects/{project_id}/references")
def add_reference(
    project_id: str,
    payload: ReferenceRequest,
) -> dict[str, Any]:
    item = {
        "reference_id": str(uuid4()),
        **payload.model_dump(),
    }

    saved_item = _append_to_module(
        project_id,
        "references_citations",
        "references",
        item,
    )

    return {
        "status": "created",
        "reference": saved_item,
    }


@router.post("/projects/{project_id}/citations")
def add_citation(
    project_id: str,
    payload: CitationRequest,
) -> dict[str, Any]:
    module = _project_module_or_empty(
        project_id,
        "references_citations",
    )

    reference_ids = {
        reference.get("reference_id")
        for reference in module.get("references", [])
    }

    if any(
        reference_id not in reference_ids
        for reference_id in payload.reference_ids
    ):
        raise HTTPException(
            status_code=422,
            detail="Citation references an unknown reference",
        )

    item = {
        "citation_id": str(uuid4()),
        **payload.model_dump(),
    }

    saved_item = _append_to_module(
        project_id,
        "references_citations",
        "in_text_citations",
        item,
    )

    return {
        "status": "created",
        "citation": saved_item,
    }


@router.get("/projects/{project_id}/citation-integrity")
def citation_integrity(
    project_id: str,
) -> dict[str, Any]:
    module = _project_module_or_empty(
        project_id,
        "references_citations",
    )

    references = module.get("references", [])
    citations = module.get("in_text_citations", [])

    reference_ids = {
        reference.get("reference_id")
        for reference in references
    }

    cited_ids = {
        reference_id
        for citation in citations
        for reference_id in citation.get("reference_ids", [])
    }

    orphan_citations = [
        {
            "citation_id": citation.get("citation_id"),
            "reference_id": reference_id,
        }
        for citation in citations
        for reference_id in citation.get("reference_ids", [])
        if reference_id not in reference_ids
    ]

    uncited_references = [
        reference.get("reference_id")
        for reference in references
        if reference.get("reference_id") not in cited_ids
    ]

    seen: dict[tuple[Any, ...], str | None] = {}
    duplicates = []

    for reference in references:
        key = (
            tuple(reference.get("authors", [])),
            reference.get("year"),
            (reference.get("title") or "").strip().lower(),
        )

        if key in seen:
            duplicates.append(
                {
                    "reference_id": reference.get("reference_id"),
                    "duplicate_of": seen[key],
                }
            )
        else:
            seen[key] = reference.get("reference_id")

    report = {
        "status": (
            "pass"
            if not orphan_citations and not duplicates
            else "review_required"
        ),
        "citation_count": len(citations),
        "reference_count": len(references),
        "orphan_citations": orphan_citations,
        "uncited_references": uncited_references,
        "duplicate_references": duplicates,
        "style": module.get("citation_style", "APA 7"),
    }

    module["integrity_report"] = report
    save_module(
        project_id,
        "references_citations",
        module,
    )

    return report
