"""Author-year citation/reference reconciliation and DOI registry checks.

This module reports evidence and uncertainty; it does not determine plagiarism
or prove that a cited work was actually consulted.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import socket
import threading
import time
from difflib import SequenceMatcher
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

logger = logging.getLogger(__name__)

YEAR_RE = re.compile(r"\b((?:19|20)\d{2})([a-z])?\b", re.I)
DOI_RE = re.compile(r'(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/[^\s<>"\]]+)', re.I)
URL_RE = re.compile(r'https?://[^\s<>"\]]+', re.I)
PAREN_CITATION_RE = re.compile(r"\(([^()]{1,350}?(?:19|20)\d{2}[a-z]?[^()]*)\)")
NARRATIVE_CITATION_RE = re.compile(
    r"(?P<author>[A-Z][A-Za-z'’.-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][A-Za-z'’.-]+|and\s+[A-Z][A-Za-z'’.-]+))?)"
    r"\s*\((?P<year>(?:19|20)\d{2}[a-z]?)\)", re.I
)
REFERENCE_HEADING_RE = re.compile(r"^\s*(references|bibliography|works cited)\s*$", re.I)
REFERENCE_START_RE = re.compile(
    r"^\s*(?:\[?\d{1,3}\]?\.?\s+)?(.{2,180}?)\s*\(((?:19|20)\d{2}[a-z]?)\)",
    re.I,
)
YEAR_SUFFIX_RE = re.compile(r"\(((?:19|20)\d{2}[a-z]?)\)", re.I)
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.Lock()
CACHE_SECONDS = 24 * 60 * 60
HTTP_TIMEOUT = 4
MAX_DOI_LOOKUPS = 10
MAX_URL_CHECKS = 8


def _clean(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip()
    return value.rstrip(".,;: ")


def _author_key(value: str) -> str:
    value = re.sub(r"^\s*\d+[.)]?\s*", "", value)
    value = re.sub(r"\bet\s+al\.?\b", "", value, flags=re.I)
    value = re.split(r"\s+(?:&|and)\s+", value, maxsplit=1, flags=re.I)[0]
    value = re.sub(r"[^A-Za-z'’-]", "", value.split(",")[0] if "," in value else value.split()[0] if value.split() else "")
    return value.casefold()


def _split_citation_group(group: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for part in group.split(";"):
        match = re.search(r"(?P<author>.*?)(?:,\s*|\s+) (?P<year>(?:19|20)\d{2}[a-z]?)$", part.strip(), re.I)
        if not match:
            match = re.search(r"(?P<author>.+?)[, ]+(?P<year>(?:19|20)\d{2}[a-z]?)$", part.strip(), re.I)
        if match:
            author = _author_key(match.group("author"))
            if author:
                found.append((author, match.group("year").casefold()))
    return found


def _extract_citations(body: str) -> list[dict[str, str]]:
    citations: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for match in PAREN_CITATION_RE.finditer(body):
        for author, year in _split_citation_group(match.group(1)):
            key = (author, year, match.group(0))
            if key not in seen:
                citations.append({"author_key": author, "year": year, "text": match.group(0), "style": "parenthetical"})
                seen.add(key)
    for match in NARRATIVE_CITATION_RE.finditer(body):
        author = _author_key(match.group("author"))
        year = match.group("year").casefold()
        key = (author, year, match.group(0))
        if author and key not in seen:
            citations.append({"author_key": author, "year": year, "text": match.group(0), "style": "narrative"})
            seen.add(key)
    return citations


def _reference_entries(text: str) -> tuple[str, list[dict[str, Any]]]:
    lines = [line.strip() for line in text.replace("\r", "\n").splitlines() if line.strip()]
    heading = next((i for i, line in enumerate(lines) if REFERENCE_HEADING_RE.match(line)), None)
    if heading is None:
        return text, []
    body = "\n".join(lines[:heading])
    raw_lines = lines[heading + 1:]
    entries: list[str] = []
    for line in raw_lines:
        if REFERENCE_START_RE.match(line):
            entries.append(line)
        elif entries:
            entries[-1] += " " + line
    parsed: list[dict[str, Any]] = []
    for entry in entries:
        match = REFERENCE_START_RE.match(entry)
        if not match:
            continue
        author = _author_key(match.group(1))
        year = match.group(2).casefold()
        dois = [m.group(1).rstrip(".,;:)]}") for m in DOI_RE.finditer(entry)]
        urls = [m.group(0).rstrip(".,;:)]}") for m in URL_RE.finditer(entry)]
        title_match = re.search(r"\)\.\s*(.+?)(?:\.\s+(?=[A-Z][A-Za-z &-]{2,}(?:,|\.)|https?://|doi:)|$)", entry, re.I)
        title = _clean(title_match.group(1)) if title_match else ""
        parsed.append({
            "text": entry[:500],
            "author_key": author,
            "year": year,
            "title": title[:300],
            "doi": dois[0] if dois else None,
            "url": urls[0] if urls else None,
        })
    return body, parsed


def _registry_lookup(doi: str, registry: str, email: str | None) -> dict[str, Any]:
    key = registry + ":" + doi.casefold()
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and now - cached[0] < CACHE_SECONDS:
            return dict(cached[1])
    if registry == "crossref":
        endpoint = "https://api.crossref.org/works/" + quote(doi, safe="/")
        if email:
            endpoint += "?mailto=" + quote(email, safe="@.+-")
        headers = {"User-Agent": "OnyitechResearchWorkspace/1.0"}
        if email:
            headers["User-Agent"] += " (mailto:" + email + ")"
    else:
        endpoint = "https://api.datacite.org/dois/" + quote(doi, safe="/")
        headers = {"Accept": "application/vnd.api+json", "User-Agent": "OnyitechResearchWorkspace/1.0"}
    request = Request(endpoint, headers=headers)
    try:
        with urlopen(request, timeout=HTTP_TIMEOUT) as response:
            payload = json.loads(response.read(1_000_000).decode("utf-8"))
        record = payload.get("message") if registry == "crossref" else (payload.get("data") or {}).get("attributes")
        if not isinstance(record, dict):
            raise ValueError("Unexpected registry response")
        titles = record.get("title") or record.get("titles") or []
        if titles and isinstance(titles[0], dict):
            titles = [item.get("title", "") for item in titles]
        authors = record.get("author") or record.get("creators") or []
        if registry == "crossref":
            author_names = [((a.get("family") or a.get("name") or "").strip()) for a in authors if isinstance(a, dict)]
            year_parts = (record.get("published-print") or record.get("published-online") or record.get("created") or {}).get("date-parts", [[]])
            year = str(year_parts[0][0]) if year_parts and year_parts[0] else None
            container = record.get("container-title") or []
        else:
            author_names = [((a.get("familyName") or a.get("name") or "").strip()) for a in authors if isinstance(a, dict)]
            year = str(record.get("publicationYear") or "") or None
            container = [record.get("containerTitle") or ""]
        result = {
            "status": "found",
            "registry": registry,
            "doi": doi,
            "title": (titles[0] if titles else "") if titles else "",
            "authors": [a for a in author_names if a][:12],
            "year": year,
            "container_title": container[0] if container else "",
        }
    except HTTPError as exc:
        result = {"status": "not_found" if exc.code == 404 else "unavailable", "registry": registry, "http_status": exc.code}
    except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        logger.info("%s lookup unavailable (%s)", registry, type(exc).__name__)
        result = {"status": "unavailable", "registry": registry}
    with _CACHE_LOCK:
        _CACHE[key] = (now, result)
    return dict(result)


def _normalise_title(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (value or "").casefold()))


def _metadata_comparison(reference: dict[str, Any], metadata: dict[str, Any]) -> str:
    """Compare parsed reference fields with registry metadata; never infer a match from DOI presence alone."""
    if metadata.get("status") != "found":
        return "not_verified"
    ref_title = _normalise_title(reference.get("title", ""))
    registry_title = _normalise_title(metadata.get("title", ""))
    ref_author = reference.get("author_key", "")
    registry_authors = [_author_key(a) for a in metadata.get("authors", []) if a]
    registry_authors = [a for a in registry_authors if a]
    registry_year = str(metadata.get("year") or "")[:4]
    reference_year = str(reference.get("year") or "")[:4]

    author_match = bool(ref_author and registry_authors and ref_author in registry_authors)
    year_match = bool(registry_year and reference_year and registry_year == reference_year)
    title_ratio = SequenceMatcher(None, ref_title, registry_title).ratio() if ref_title and registry_title else 0.0
    title_match = title_ratio >= 0.90

    if author_match and year_match and title_match:
        return "verified"
    if (author_match and year_match) or (author_match and title_match) or (year_match and title_match):
        return "partial_match"
    if ref_title and registry_title and (title_ratio < 0.55 or (registry_year and reference_year and not year_match)):
        return "metadata_mismatch"
    return "insufficient_metadata"



class _PublicOnlyRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _is_public_http_url(newurl):
            raise URLError("Redirect target is not a public HTTP(S) address")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _is_public_http_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
        if parts.scheme.casefold() not in {"http", "https"} or not parts.hostname:
            return False
        if parts.username or parts.password:
            return False
        host = parts.hostname.rstrip(".").casefold()
        if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
            return False
        try:
            addresses = [ipaddress.ip_address(host)]
        except ValueError:
            addresses = [
                ipaddress.ip_address(item[4][0])
                for item in socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80), type=socket.SOCK_STREAM)
            ]
        return bool(addresses) and all(address.is_global for address in addresses)
    except (ValueError, OSError, URLError):
        return False


def _check_url(url: str) -> dict[str, Any]:
    key = "url:" + url
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and now - cached[0] < CACHE_SECONDS:
            return dict(cached[1])
    if not _is_public_http_url(url):
        result = {"status": "not_checked", "reason": "unsafe_or_invalid_url"}
    else:
        opener = build_opener(_PublicOnlyRedirectHandler())
        request = Request(url, headers={"User-Agent": "OnyitechResearchWorkspace/1.0", "Range": "bytes=0-0"}, method="HEAD")
        try:
            with opener.open(request, timeout=HTTP_TIMEOUT) as response:
                result = {"status": "accessible", "http_status": response.status, "final_url": response.geturl()}
        except HTTPError as exc:
            if exc.code in {405, 501}:
                try:
                    get_request = Request(url, headers={"User-Agent": "OnyitechResearchWorkspace/1.0", "Range": "bytes=0-0"}, method="GET")
                    with opener.open(get_request, timeout=HTTP_TIMEOUT) as response:
                        result = {"status": "accessible", "http_status": response.status, "final_url": response.geturl()}
                except HTTPError as get_exc:
                    result = {"status": "inaccessible", "http_status": get_exc.code}
                except (URLError, TimeoutError, OSError) as get_exc:
                    result = {"status": "unavailable", "reason": type(get_exc).__name__}
            else:
                result = {"status": "inaccessible", "http_status": exc.code}
        except (URLError, TimeoutError, OSError) as exc:
            result = {"status": "unavailable", "reason": type(exc).__name__}
    with _CACHE_LOCK:
        _CACHE[key] = (now, result)
    return dict(result)


def verify_citations_and_references(
    manuscript_text: str,
    *,
    crossref_email: str | None = None,
    check_external: bool = True,
) -> dict[str, Any]:
    """Reconcile author-year citations and references; optionally query DOI registries."""
    if not isinstance(manuscript_text, str) or not manuscript_text.strip():
        return {"status": "not_assessed", "citation_count": 0, "parsed_reference_count": 0, "citations": [], "references": [], "doi_checks": [], "findings": [], "summary": "No readable text was available."}

    body, references = _reference_entries(manuscript_text)
    citations = _extract_citations(body)
    reference_keys = {(r["author_key"], r["year"]) for r in references if r["author_key"]}
    citation_keys = {(c["author_key"], c["year"]) for c in citations}
    findings: list[dict[str, Any]] = []

    for citation in citations:
        if (citation["author_key"], citation["year"]) not in reference_keys:
            findings.append({
                "rule_id": "citation.reference_missing",
                "status": "unmatched",
                "severity": "major",
                "citation": citation["text"],
                "detail": "This author-year citation was not matched to a parsed reference entry. Check spelling, year suffixes, citation style, and reference formatting.",
                "source": "deterministic",
            })
    for reference in references:
        key = (reference["author_key"], reference["year"])
        if key not in citation_keys:
            findings.append({
                "rule_id": "reference.not_cited",
                "status": "uncited",
                "severity": "minor",
                "reference": reference["text"][:300],
                "detail": "This parsed reference entry was not matched to an author-year citation in the manuscript body.",
                "source": "deterministic",
            })

    duplicates: set[tuple[str, str]] = set()
    seen_refs: set[tuple[str, str]] = set()
    for reference in references:
        key = (reference["author_key"], reference["year"])
        if key in seen_refs and key not in duplicates:
            duplicates.add(key)
            findings.append({
                "rule_id": "reference.possible_duplicate",
                "status": "possible_duplicate",
                "severity": "moderate",
                "reference": reference["text"][:300],
                "detail": "More than one reference entry has the same parsed first-author surname and year. Confirm whether these are duplicates or require year suffixes such as 2021a and 2021b.",
                "source": "deterministic",
            })
        seen_refs.add(key)

    doi_checks: list[dict[str, Any]] = []
    url_checks: list[dict[str, Any]] = []
    if check_external:
        email = crossref_email or os.getenv("CROSSREF_MAILTO")
        doi_references = [reference for reference in references if reference.get("doi")]
        for reference in doi_references[:MAX_DOI_LOOKUPS]:
            doi = reference.get("doi")
            crossref = _registry_lookup(doi, "crossref", email)
            registry = crossref
            if crossref["status"] == "not_found":
                registry = _registry_lookup(doi, "datacite", email)
            comparison = _metadata_comparison(reference, registry)
            doi_checks.append({
                "doi": doi,
                "reference": reference["text"][:300],
                "registry_result": registry,
                "metadata_comparison": comparison,
            })
            if registry["status"] == "not_found":
                findings.append({
                    "rule_id": "reference.doi_not_found",
                    "status": "not_found_in_checked_registries",
                    "severity": "major",
                    "doi": doi,
                    "detail": "The DOI was not found in Crossref or DataCite. It may belong to another registration agency or contain a transcription error.",
                    "source": "registry",
                })
            elif comparison == "metadata_mismatch":
                findings.append({
                    "rule_id": "reference.doi_metadata_mismatch",
                    "status": "metadata_mismatch",
                    "severity": "major",
                    "doi": doi,
                    "detail": "The DOI resolves to registry metadata that does not agree with the parsed reference author and/or year. Human verification is required.",
                    "source": "registry",
                })
            elif comparison == "insufficient_metadata":
                findings.append({
                    "rule_id": "reference.doi_metadata_incomplete",
                    "status": "insufficient_metadata",
                    "severity": "info",
                    "doi": doi,
                    "detail": "The DOI was found, but the available reference and registry fields were insufficient for a reliable metadata match.",
                    "source": "registry",
                })

        url_references = [reference for reference in references if reference.get("url")]
        for reference in url_references[:MAX_URL_CHECKS]:
            checked = _check_url(reference["url"])
            url_checks.append({
                "url": reference["url"],
                "reference": reference["text"][:300],
                **checked,
            })
            if checked.get("status") == "inaccessible":
                findings.append({
                    "rule_id": "reference.url_inaccessible",
                    "status": "inaccessible",
                    "severity": "moderate",
                    "reference": reference["text"][:300],
                    "detail": "The reference URL returned an HTTP error during this check. Confirm the link manually; access controls and temporary server errors can affect results.",
                    "source": "url_check",
                })
            elif checked.get("status") in {"unavailable", "not_checked"}:
                findings.append({
                    "rule_id": "reference.url_not_verified",
                    "status": "not_verified",
                    "severity": "info",
                    "reference": reference["text"][:300],
                    "detail": "The reference URL could not be safely or reliably checked. This does not mean the source is invalid.",
                    "source": "url_check",
                })

    return {
        "status": "completed",
        "citation_style_scope": "author_year",
        "citation_count": len(citations),
        "parsed_reference_count": len(references),
        "citations": citations[:200],
        "references": references[:100],
        "doi_checks": doi_checks[:MAX_DOI_LOOKUPS],
        "url_checks": url_checks[:MAX_URL_CHECKS],
        "url_check_limit": MAX_URL_CHECKS,
        "url_checks_skipped": max(0, sum(1 for r in references if r.get("url")) - len(url_checks)),
        "doi_lookup_limit": MAX_DOI_LOOKUPS,
        "doi_lookups_skipped": max(0, sum(1 for r in references if r.get("doi")) - len(doi_checks)),
        "findings": findings[:100],
        "summary": {
            "matched_citation_count": sum(1 for c in citations if (c["author_key"], c["year"]) in reference_keys),
            "unmatched_citation_count": sum(1 for c in citations if (c["author_key"], c["year"]) not in reference_keys),
            "uncited_reference_count": sum(1 for r in references if (r["author_key"], r["year"]) not in citation_keys),
            "doi_checked_count": len(doi_checks),
            "url_checked_count": len(url_checks),
            "url_inaccessible_count": sum(1 for item in url_checks if item.get("status") == "inaccessible"),
        },
        "limitations": [
            "Initial reconciliation supports common author-year patterns; numbered styles such as Vancouver are not yet reconciled.",
            "Complex multi-line, footnote, and unusual reference formats may not be parsed.",
            "Registry presence and metadata agreement do not prove that a source was read or that its claims support the manuscript.",
            "A DOI absent from Crossref and DataCite may be registered with another DOI agency.",
            "URL checks test HTTP accessibility only; they do not establish that a destination is relevant to the cited work.",
            "External DOI and URL checks are time-limited and capped; some links may remain unverified.",
            "This feature does not compare manuscript passages against a plagiarism corpus.",
        ],
    }
