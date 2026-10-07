from typing import Any

RESEARCH_FOUNDATION_FIELDS: dict[str, dict[str, Any]] = {
    "title": {"type": "string", "required": True},
    "aim": {"type": "string", "required": True},
    "objectives": {"type": "list[string]", "required": True},
    "research_questions": {"type": "list[string]", "required": True},
    "hypotheses": {"type": "list[string]", "required": False},
    "variables": {"type": "list[object]", "required": True},
    "conceptual_framework": {"type": "object", "required": False},
    "evidence_gap": {"type": "string", "required": False},
}


def get_research_foundation_spec() -> dict[str, Any]:
    return {
        "module": "research_foundation",
        "fields": RESEARCH_FOUNDATION_FIELDS,
        "integrity_rules": [
            "Do not invent research findings or participant data.",
            "Distinguish screening results from clinical diagnosis.",
            "Every variable must have an operational definition before data collection.",
            "Objectives, research questions, hypotheses and planned analyses must be mutually consistent.",
        ],
    }
