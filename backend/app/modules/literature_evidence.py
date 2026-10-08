from typing import Any

LITERATURE_EVIDENCE_FIELDS: dict[str, dict[str, Any]] = {
    "sources": {
        "type": "list[object]",
        "required": True,
        "description": "Verified scholarly or authoritative sources used by the project.",
    },
    "evidence_items": {
        "type": "list[object]",
        "required": False,
        "description": "Extracted findings, methods, populations and limitations linked to sources.",
    },
    "claims": {
        "type": "list[object]",
        "required": False,
        "description": "Research claims linked to one or more evidence items.",
    },
    "research_gap": {
        "type": "string",
        "required": False,
        "description": "Evidence-supported gap the project intends to address.",
    },
    "synthesis": {
        "type": "string",
        "required": False,
        "description": "Structured synthesis of the evidence base.",
    },
}


def get_literature_evidence_spec() -> dict[str, Any]:
    return {
        "module": "literature_evidence",
        "fields": LITERATURE_EVIDENCE_FIELDS,
        "source_fields": [
            "source_id", "authors", "year", "title", "source_type",
            "journal_or_publisher", "volume", "issue", "pages",
            "doi", "url", "abstract", "keywords", "verified"
        ],
        "evidence_fields": [
            "evidence_id", "source_id", "finding", "population",
            "setting", "method", "sample_size", "limitations", "notes"
        ],
        "claim_fields": [
            "claim_id", "text", "evidence_ids", "source_ids", "confidence"
        ],
        "integrity_rules": [
            "Do not invent sources, findings, quotations or study results.",
            "A claim should link to verified evidence before it is used as research support.",
            "Screening positivity must not be presented as a clinical diagnosis.",
            "The research gap must be derived from the evidence base rather than assumed.",
        ],
    }
