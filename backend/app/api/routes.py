from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.analysis import analyze_idea

router = APIRouter(prefix="/api")

projects: dict[str, dict] = {}


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1, max_length=100_000)
    discipline: str = Field(min_length=1, max_length=100)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "onyitech-research-api"}


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
    }
    projects[project_id] = project
    return {"id": project_id, "status": "created", "project": project}


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    project = projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": project}
