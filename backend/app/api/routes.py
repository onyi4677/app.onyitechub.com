
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
from app.services.reference_identity import duplicate_report, metadata_key, normalise_doi


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

    content = save_module(
        project_id,
        module_key,
        payload.content,
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

    source_ids = {
        source.get("source_id")
        for source in module.get("sources", [])
    }

    if payload.source_id not in source_ids:
        raise HTTPException(
            status_code=422,
            detail="Evidence must reference an existing literature source",
        )

    item = {
        "evidence_id": str(uuid4()),
        **payload.model_dump(),
    }

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

    source_ids = {
        source.get("source_id")
        for source in module.get("sources", [])
    }

    if any(
        evidence_id not in evidence_ids
        for evidence_id in payload.evidence_ids
    ):
        raise HTTPException(
            status_code=422,
            detail="Claim references unknown evidence",
        )

    if any(
        source_id not in source_ids
        for source_id in payload.source_ids
    ):
        raise HTTPException(
            status_code=422,
            detail="Claim references unknown source",
        )

    item = {
        "claim_id": str(uuid4()),
        **payload.model_dump(),
    }

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
    literature_module = _project_module_or_empty(project_id, "literature_evidence")
    sources = literature_module.get("sources", [])

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

    duplicate_results = duplicate_report(references, "reference_id")
    duplicates = duplicate_results["duplicate_records"]
    possible_duplicate_groups = duplicate_results["possible_duplicate_groups"]
    source_duplicate_results = duplicate_report(sources, "source_id")

    # Report cross-module identity matches without silently merging records.
    cross_module_matches = []
    linked_reference_ids = set()
    linked_source_ids = set()
    for reference in references:
        for source in sources:
            reference_id = str(reference.get("reference_id") or "")
            source_id = str(source.get("source_id") or "")
            reference_doi = normalise_doi(reference.get("doi"))
            source_doi = normalise_doi(source.get("doi"))
            same_metadata = bool(metadata_key(reference)) and metadata_key(reference) == metadata_key(source)
            explicitly_linked = bool(source_id) and (
                reference.get("source_id") == source_id or reference_id == source_id
            )

            if explicitly_linked:
                match_type = "linked"
                linked_reference_ids.add(reference_id)
                linked_source_ids.add(source_id)
            elif reference_doi and source_doi and reference_doi == source_doi:
                match_type = "doi_match_needs_link"
            elif same_metadata and (not reference_doi or not source_doi or reference_doi == source_doi):
                match_type = "metadata_match_needs_link"
            elif same_metadata and reference_doi and source_doi and reference_doi != source_doi:
                match_type = "metadata_match_doi_conflict"
            else:
                continue

            cross_module_matches.append({
                "reference_id": reference.get("reference_id"),
                "reference_title": reference.get("title"),
                "source_id": source.get("source_id"),
                "source_title": source.get("title"),
                "match_type": match_type,
            })

    report = {
        "status": (
            "pass"
            if not orphan_citations
            and not duplicates
            and not possible_duplicate_groups
            and not source_duplicate_results["duplicate_records"]
            and not source_duplicate_results["possible_duplicate_groups"]
            and all(match["match_type"] == "linked" for match in cross_module_matches)
            else "review_required"
        ),
        "citation_count": len(citations),
        "reference_count": len(references),
        "literature_source_count": len(sources),
        "orphan_citations": orphan_citations,
        "uncited_references": uncited_references,
        "duplicate_references": duplicates,
        "possible_duplicate_groups": possible_duplicate_groups,
        "duplicate_literature_sources": source_duplicate_results["duplicate_records"],
        "possible_duplicate_literature_sources": source_duplicate_results["possible_duplicate_groups"],
        "cross_module_matches": cross_module_matches,
        "references_without_literature_source_link": [
            reference.get("reference_id") for reference in references
            if reference.get("reference_id") not in linked_reference_ids
        ],
        "literature_sources_without_reference_link": [
            source.get("source_id") for source in sources
            if source.get("source_id") not in linked_source_ids
        ],
        "style": module.get("citation_style", "APA 7"),
    }

    module["integrity_report"] = report
    save_module(
        project_id,
        "references_citations",
        module,
    )

    return report
