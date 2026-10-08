from typing import Any

REFERENCE_CITATION_FIELDS: dict[str, dict[str, Any]] = {
    "references": {
        "type": "list[object]",
        "required": True,
        "description": "Structured reference-library records.",
    },
    "in_text_citations": {
        "type": "list[object]",
        "required": False,
        "description": "In-text citations linked to reference IDs.",
    },
    "citation_style": {
        "type": "string",
        "required": True,
        "description": "Citation style used for the project.",
    },
    "integrity_report": {
        "type": "object",
        "required": False,
        "description": "Machine-checkable citation/reference consistency results.",
    },
}


def get_references_citations_spec() -> dict[str, Any]:
    return {
        "module": "references_citations",
        "fields": REFERENCE_CITATION_FIELDS,
        "reference_fields": [
            "reference_id", "authors", "year", "title", "source_type",
            "journal_or_book", "volume", "issue", "pages",
            "publisher", "doi", "url", "abstract", "keywords"
        ],
        "citation_fields": [
            "citation_id", "reference_ids", "text", "citation_form",
            "location", "page"
        ],
        "supported_styles": ["APA 7", "Vancouver", "Harvard", "MLA", "Chicago"],
        "integrity_checks": [
            "Every in-text citation must resolve to a reference-library record.",
            "Flag references that are never cited.",
            "Flag author/year mismatches.",
            "Flag duplicate references.",
            "Flag incomplete bibliographic metadata.",
            "Do not invent citations or bibliographic records.",
        ],
    }
