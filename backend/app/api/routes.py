from typing import Any
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

router = APIRouter(prefix="/api")


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1, max_length=100_000)
    discipline: str = Field(min_length=1, max_length=100)


class ModuleUpdateRequest(BaseModel):
    content: dict[str, Any]


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
def analyze(request: AnalyzeRequest) -> dict:
    return analyze_idea(request.text)


@router.post("/projects")
def create_project(payload: ProjectCreateRequest) -> dict:
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
        raise HTTPException(status_code=500, detail="Unable to save project") from exc
    return {"id": project_id, "status": "created", "project": project}


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    try:
        response = projects_table.get_item(Key={"id": project_id})
    except ClientError as exc:
        raise HTTPException(status_code=500, detail="Unable to retrieve project") from exc
    project = response.get("Item")
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": project}


@router.get("/projects/{project_id}/modules/{module_key}")
def get_project_module(project_id: str, module_key: str) -> dict[str, Any]:
    return {"module": module_key, "content": get_module(project_id, module_key)}


@router.put("/projects/{project_id}/modules/{module_key}")
def update_project_module(project_id: str, module_key: str, payload: ModuleUpdateRequest) -> dict[str, Any]:
    if module_key not in get_modules():
        raise HTTPException(status_code=404, detail="Unknown research module")
    content = save_module(project_id, module_key, payload.content)
    return {"status": "saved", "module": module_key, "content": content}
