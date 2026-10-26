from typing import Any

MODULES: dict[str, dict[str, Any]] = {
    "research_foundation": {
        "name": "Research Foundation",
        "description": "Problem, title, aim, objectives, questions, hypotheses, variables and conceptual framework.",
        "status": "active",
    },
    "literature_evidence": {
        "name": "Literature & Evidence",
        "description": "Shared project source registry, source verification, evidence extraction, claims, synthesis and research gap development.",
        "status": "active",
    },
    "references_citations": {
        "name": "References & Citations",
        "description": "Bibliographic metadata and in-text citation mapping connected to the shared project source registry, citation styles and integrity checks.",
        "status": "active",
    },
    "methodology": {"name": "Research Design & Methodology", "description": "Review protocol, PCC framework, eligibility criteria, and analysis plan.", "status": "active"},
    "instruments": {"name": "Instruments & Data Collection", "description": "Validated instruments, questionnaire structure, consent and data collection plan.", "status": "planned"},
    "data": {"name": "Data Workspace", "description": "Raw data intake, validation, cleaning, metadata and dataset versions.", "status": "planned"},
    "analysis": {"name": "Statistical Analysis", "description": "Descriptive and inferential analysis with reproducible analysis specifications.", "status": "planned"},
    "prediction": {"name": "Machine Learning & Prediction", "description": "Prediction only when justified by genuine data and an appropriate research question.", "status": "planned"},
    "manuscript": {"name": "Manuscript", "description": "Results, discussion, conclusion, recommendations and manuscript assembly.", "status": "planned"},
    "integrity": {"name": "Research Integrity & Quality", "description": "Consistency, citations, methodology checks, transparency and integrity controls.", "status": "planned"},
    "journal": {"name": "Journal Preparation", "description": "Journal requirements, formatting, DOCX/PDF export and publication metadata.", "status": "planned"},
    "study_screening": {"name": "Study Screening Log", "description": "Protocol-linked title/abstract and full-text screening decisions, retrieval attempts, and selection counts.", "status": "active"},
}


def get_modules() -> dict[str, dict[str, Any]]:
    return MODULES
