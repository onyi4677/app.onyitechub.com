from uuid import uuid4
import os

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.analysis import analyze_idea

router = APIRouter(prefix="/api")

DYNAMODB_TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "onyitech-research-projects")
dynamodb = boto3.resource("dynamodb")
projects_table = dynamodb.Table(DYNAMODB_TABLE_NAME)


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
