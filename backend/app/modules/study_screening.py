from typing import Any


SCREENING_FIELDS: dict[str, dict[str, Any]] = {
    "review_type": {
        "type": "enum",
        "required": True,
        "values": ["scoping", "systematic"],
        "description": "Review design that controls protocol guidance and screening context.",
    },
    "protocol_version": {
        "type": "string",
        "required": True,
        "description": "Protocol snapshot identifier applied to screening records.",
    },
    "search_provenance": {
        "type": "list[object]",
        "required": False,
        "description": "Database/source, query or import batch, search date and record counts.",
    },
    "duplicates_removed": {
        "type": "integer",
        "required": False,
        "description": "Duplicates removed before title/abstract screening.",
    },
    "records": {
        "type": "list[object]",
        "required": True,
        "description": "Project source records with stage decisions and decision history.",
    },
}


def get_study_screening_spec() -> dict[str, Any]:
    return {
        "module": "study_screening",
        "fields": SCREENING_FIELDS,
        "review_types": {
            "scoping": {
                "framework": "PCC",
                "guidance": "Map the breadth, characteristics and gaps in an evidence base; evidence types may be diverse.",
            },
            "systematic": {
                "framework": "PICO/PECO",
                "guidance": "Apply predefined population, intervention/exposure, comparator and outcome or eligibility rules.",
            },
        },
        "record_decisions": {
            "title_abstract": ["not_screened", "include", "exclude", "maybe"],
            "full_text": ["not_assessed", "include", "exclude", "not_retrieved"],
        },
        "integrity_rules": [
            "A screening record must link to one canonical project source.",
            "Title/abstract and full-text decisions are stored separately.",
            "Every exclusion requires a recorded reason.",
            "Not-retrieved full texts require documented retrieval attempts and are not counted as assessed.",
            "Flow counts are calculated from records and remain provisional while unresolved records exist.",
            "Changing a decision must preserve the decision history.",
        ],
    }
