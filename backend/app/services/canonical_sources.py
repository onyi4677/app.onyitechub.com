import re
import unicodedata
from typing import Any


def _text(value: Any) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).strip()


def _doi(value: Any) -> str:
    value = str(value or "").strip().casefold()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value)
    value = re.sub(r"^doi:\s*", "", value)
    return value.rstrip(". ")


def _identity(item: dict[str, Any]) -> str:
    doi = _doi(item.get("doi"))
    if doi:
        return "doi:" + doi
    title = _text(item.get("title"))
    if not title:
        return ""
    authors = item.get("authors") or []
    first_author = _text(authors[0]) if authors else ""
    return f"meta:{title}|{item.get('year') or ''}|{first_author}"


def build_canonical_sources(project: dict[str, Any]) -> list[dict[str, Any]]:
    """Read-only unified view of legacy literature sources and bibliography entries.

    Existing literature source IDs win when a work exists in both modules, keeping
    evidence/claim links stable. Reference-only works use their reference ID.
    The projection never deletes or rewrites either legacy module.
    """
    modules = project.get("modules") or {}
    literature = modules.get("literature_evidence") or {}
    refs_module = modules.get("references_citations") or {}
    grouped: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for source in literature.get("sources") or []:
        if not isinstance(source, dict) or not source.get("source_id"):
            continue
        key = _identity(source) or "literature:" + str(source["source_id"])
        if key not in grouped:
            grouped[key] = {
                "source_id": source["source_id"], "canonical_source_id": source["source_id"],
                "aliases": [source["source_id"]], "literature_source_ids": [source["source_id"]],
                "reference_ids": [], "authors": source.get("authors") or [], "year": source.get("year"),
                "title": source.get("title") or "", "source_type": source.get("source_type") or "journal_article",
                "journal_or_publisher": source.get("journal_or_publisher"), "journal_or_book": source.get("journal_or_publisher"),
                "volume": source.get("volume"), "issue": source.get("issue"), "pages": source.get("pages"),
                "publisher": None, "doi": source.get("doi"), "url": source.get("url"), "abstract": source.get("abstract"),
                "keywords": source.get("keywords") or [], "verified": bool(source.get("verified")), "identity_key": key,
            }
            order.append(key)

    for reference in refs_module.get("references") or []:
        if not isinstance(reference, dict) or not reference.get("reference_id"):
            continue
        key = _identity(reference) or "reference:" + str(reference["reference_id"])
        if key not in grouped:
            grouped[key] = {
                "source_id": reference["reference_id"], "canonical_source_id": reference["reference_id"],
                "aliases": [reference["reference_id"]], "literature_source_ids": [], "reference_ids": [],
                "authors": reference.get("authors") or [], "year": reference.get("year"), "title": reference.get("title") or "",
                "source_type": reference.get("source_type") or "journal_article", "journal_or_publisher": reference.get("journal_or_book"),
                "journal_or_book": reference.get("journal_or_book"), "volume": reference.get("volume"), "issue": reference.get("issue"),
                "pages": reference.get("pages"), "publisher": reference.get("publisher"), "doi": reference.get("doi"),
                "url": reference.get("url"), "abstract": reference.get("abstract"), "keywords": reference.get("keywords") or [],
                "verified": False, "identity_key": key,
            }
            order.append(key)
        item = grouped[key]
        if reference["reference_id"] not in item["aliases"]:
            item["aliases"].append(reference["reference_id"])
        if reference["reference_id"] not in item["reference_ids"]:
            item["reference_ids"].append(reference["reference_id"])
        for field in ("authors", "year", "title", "source_type", "volume", "issue", "pages", "doi", "url", "abstract", "keywords"):
            if not item.get(field) and reference.get(field):
                item[field] = reference[field]
        if not item.get("journal_or_publisher") and reference.get("journal_or_book"):
            item["journal_or_publisher"] = reference["journal_or_book"]
            item["journal_or_book"] = reference["journal_or_book"]
        if not item.get("publisher") and reference.get("publisher"):
            item["publisher"] = reference["publisher"]

    return [grouped[key] for key in order]


def canonical_source_id(project: dict[str, Any], source_id: str) -> str | None:
    for source in build_canonical_sources(project):
        if source_id in source.get("aliases", []):
            return str(source["canonical_source_id"])
    return None
