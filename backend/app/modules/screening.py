from typing import Any

SCREENING_SPEC: dict[str, Any] = {
    "module": "screening",
    "review_types": {
        "scoping": {"label": "Scoping review", "reporting_guideline": "PRISMA-ScR"},
        "systematic": {"label": "Systematic review", "reporting_guideline": "PRISMA 2020"},
    },
    "stages": ["title_abstract", "full_text"],
    "decisions": ["include", "exclude", "uncertain"],
    "integrity_rules": [
        "Every imported record retains its original bibliographic metadata and stable record ID.",
        "Duplicate candidates are flagged for human confirmation; records are never silently deleted.",
        "An exclusion decision requires a recorded reason.",
        "Uncertain records remain visible and are not counted as included or excluded.",
        "PRISMA counts are calculated only from recorded screening events and search-source records.",
        "Do not invent database names, search dates, search yields, duplicate counts, or included studies.",
        "Reviewer decisions and adjudications remain auditable.",
    ],
    "record_fields": [
        "record_id", "title", "authors", "year", "doi", "url", "abstract",
        "source_database", "import_batch_id", "duplicate_of", "duplicate_status",
        "title_abstract_decision", "title_abstract_reason", "full_text_status",
        "full_text_decision", "full_text_exclusion_reason", "reviewer_decisions",
        "adjudication", "notes",
    ],
}


def get_screening_spec() -> dict[str, Any]:
    return SCREENING_SPEC
