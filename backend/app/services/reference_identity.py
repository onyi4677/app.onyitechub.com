"""Shared identity helpers for safe bibliographic duplicate review.

These helpers identify exact duplicates and weaker candidates. They never merge
or delete records; ambiguous matches must be reviewed by a researcher.
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


def _authors(record: dict[str, Any]) -> list[str]:
    authors = record.get("authors") or []
    if isinstance(authors, str):
        authors = [authors]
    return [normalise_text(author) for author in authors if str(author).strip()]


def metadata_key(record: dict[str, Any]) -> str:
    title = normalise_text(record.get("title"))
    if not title:
        return ""
    authors = _authors(record)
    year = record.get("year")
    first_author = authors[0] if authors else ""
    return f"meta:{title}|{year if year is not None else ''}|{first_author}"


def identity_keys(record: dict[str, Any]) -> set[str]:
    """Return DOI and metadata keys for matching across module boundaries."""
    keys: set[str] = set()
    doi = normalise_doi(record.get("doi"))
    if doi:
        keys.add(f"doi:{doi}")
    metadata = metadata_key(record)
    if metadata:
        keys.add(metadata)
    return keys


def _title_year_key(record: dict[str, Any]) -> str:
    title = normalise_text(record.get("title"))
    if not title:
        return ""
    year = record.get("year")
    return f"title-year:{title}|{year if year is not None else ''}"


def duplicate_report(records: Iterable[dict[str, Any]], id_field: str) -> dict[str, Any]:
    """Return exact duplicates and ambiguous title/year groups for manual review."""
    records = [record for record in records if record.get(id_field)]
    parent = {str(record[id_field]): str(record[id_field]) for record in records}
    by_id = {str(record[id_field]): record for record in records}

    def find(item_id: str) -> str:
        while parent[item_id] != item_id:
            parent[item_id] = parent[parent[item_id]]
            item_id = parent[item_id]
        return item_id

    def union(left: str, right: str) -> None:
        a, b = find(left), find(right)
        if a != b:
            parent[b] = a

    exact_pairs: set[tuple[str, str, str]] = set()
    for i, left in enumerate(records):
        left_id = str(left[id_field])
        left_doi = normalise_doi(left.get("doi"))
        left_meta = metadata_key(left)
        for right in records[i + 1:]:
            right_id = str(right[id_field])
            right_doi = normalise_doi(right.get("doi"))
            right_meta = metadata_key(right)
            match_type = ""

            if left_doi and right_doi and left_doi == right_doi:
                match_type = "doi"
            elif left_meta and right_meta and left_meta == right_meta and (
                not left_doi or not right_doi or left_doi == right_doi
            ):
                match_type = "metadata"

            if match_type:
                union(left_id, right_id)
                exact_pairs.add((left_id, right_id, match_type))

    components: dict[str, list[str]] = defaultdict(list)
    for item_id in by_id:
        components[find(item_id)].append(item_id)

    duplicates = []
    for ids in components.values():
        if len(ids) < 2:
            continue
        anchor_id = ids[0]
        anchor = by_id[anchor_id]
        for item_id in ids[1:]:
            record = by_id[item_id]
            match_type = "doi" if (
                normalise_doi(anchor.get("doi"))
                and normalise_doi(anchor.get("doi")) == normalise_doi(record.get("doi"))
            ) else "metadata"
            duplicates.append({
                id_field: item_id,
                "duplicate_of": anchor_id,
                "match_type": match_type,
            })

    title_year_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        key = _title_year_key(record)
        if key:
            title_year_groups[key].append(record)

    possible_groups = []
    exact_id_pairs = {
        frozenset((left_id, right_id))
        for left_id, right_id, _ in exact_pairs
    }
    for group in title_year_groups.values():
        if len(group) < 2:
            continue
        ids = [str(record[id_field]) for record in group]
        ambiguous_pair_exists = any(
            frozenset((ids[i], ids[j])) not in exact_id_pairs
            for i in range(len(ids))
            for j in range(i + 1, len(ids))
        )
        if not ambiguous_pair_exists:
            continue
        possible_groups.append({
            "title": group[0].get("title"),
            "year": group[0].get("year"),
            "reference_ids": ids,
            "doi_values": sorted({
                normalise_doi(record.get("doi"))
                for record in group
                if normalise_doi(record.get("doi"))
            }),
            "reason": "Same normalized title and year but identity metadata differs or DOIs conflict. Review manually.",
        })

    return {
        "duplicate_records": duplicates,
        "possible_duplicate_groups": possible_groups,
    }
