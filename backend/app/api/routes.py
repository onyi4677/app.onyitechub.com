from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.services.analysis import analyze_idea

router = APIRouter(prefix="/api")

class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)

@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "onyitech-research-api"}

@router.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict:
    return analyze_idea(request.text)

@router.post("/projects")
def create_project(payload: dict) -> dict:
    return {"id": "prototype-project", "status": "created", "project": payload}
