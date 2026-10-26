"""Shared identity helpers for deduplicating bibliographic records safely.

The helpers identify likely duplicate records; they do not merge or delete records.
Callers must preserve canonical IDs and review ambiguous matches before merging.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from typing import Any, Iterable


def normalise_doi(value: Any) -> str:
    doi = str(value or "").strip().lower()
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi)
    doi = re.sub(r"^doi:\s*", "", doi)
    return doi.rstrip().rstrip(".,; ")


def normalise_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = text.replace("’", "'").replace("‘", "'")
    return " ".join(re.findall(r"[^\W_]+", text, flags=re.UNICODE))


def _first_author(record: dict[str, Any]) -> str:
    authors = record.get("authors") or []
    if isinstance(authors, str):
        authors = [authors]
    first = next((str(author).strip() for author in authors if str(author).strip()), "")
    return normalise_text(first)


def metadata_key(record: dict[str, Any]) -> str:
    title = normalise_text(record.get("title"))
    if not title:
        return ""
    year = record.get("year")
    author = _first_author(record)
    return f"meta:{title}|{year if year is not None else ''}|{author}"


def identity_keys(record: dict[str, Any]) -> set[str]:
    """Return independent DOI and metadata keys, not a single precedence key."""
    keys: set[str] = set()
    doi = normalise_doi(record.get("doi"))
    if doi:
        keys.add(f"doi:{doi}")
    metadata = metadata_key(record)
    if metadata:
        keys.add(metadata)
    return keys


def duplicate_report(records: Iterable[dict[str, Any]], id_field: str) -> dict[str, Any]:
    """Return exact identity matches and weaker title/year review candidates."""
    records = list(records)
    exact_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    title_year_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for record in records:
        for key in identity_keys(record):
            exact_groups[key].append(record)
        title = normalise_text(record.get("title"))
        if title:
            year = record.get("year")
            title_year_groups[f"title-year:{title}|{year if year is not None else ''}"].append(record)

    # A record can participate in more than one key group (e.g. DOI and metadata).
    # Union matching records into stable groups so they are not double-counted.
    parent: dict[str, str] = {}

    def find(item_id: str) -> str:
        parent.setdefault(item_id, item_id)
        while parent[item_id] != item_id:
            parent[item_id] = parent[parent[item_id]]
            item_id = parent[item_id]
        return item_id

    def union(left: str, right: str) -> None:
        a, b = find(left), find(right)
        if a != b:
            parent[b] = a

    by_id = {str(record.get(id_field)): record for record in records if record.get(id_field)}
    for group in exact_groups.values():
        ids = [str(record.get(id_field)) for record in group if record.get(id_field)]
        for item_id in ids[1:]:
            union(ids[0], item_id)

    merged: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item_id, record in by_id.items():
        root = find(item_id)
        merged[root].append(record)

    duplicates = []
    for group in merged.values():
        if len(group) < 2:
            continue
        # Prefer the earliest stored record as the review anchor; no record is
        # automatically selected for deletion or merge.
        anchor = group[0]
        for record in group[1:]:
            duplicates.append({
                id_field: record.get(id_field),
                "duplicate_of": anchor.get(id_field),
                "match_type": (
                    "doi"
                    if normalise_doi(record.get("doi"))
                    and normalise_doi(record.get("doi")) == normalise_doi(anchor.get("doi"))
                    else "metadata"
                ),
            })

    possible_groups = []
    for group in title_year_groups.values():
        unique = {str(record.get(id_field)): record for record in group if record.get(id_field)}
        if len(unique) < 2:
            continue
        values = list(unique.values())
        doi_values = {normalise_doi(record.get("doi")) for record in values if normalise_doi(record.get("doi"))}
        # If exact DOI/metadata already identifies the group, it is reported above.
        if all(any(
            str(record.get(id_field)) == str(duplicate.get(id_field))
            for duplicate in duplicates
        ) for record in values[1:]):
            continue
        possible_groups.append({
            "title": values[0].get("title"),
            "year": values[0].get("year"),
            "reference_ids": [record.get(id_field) for record in values],
            "doi_values": sorted(doi_values),
            "reason": "Same normalized title and year; author or DOI metadata differs. Review manually.",
        })

    return {
        "duplicate_records": duplicates,
        "possible_duplicate_groups": possible_groups,
    }
