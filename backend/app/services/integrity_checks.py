"""Deterministic, explainable checks for extracted manuscript text.

These checks do not establish plagiarism, fabrication, or misconduct. They
surface observable document-quality issues for an editor to verify.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any


SECTION_PATTERNS: dict[str, tuple[str, ...]] = {
    "abstract": (r"^\s*abstract\s*$",),
    "introduction": (r"^\s*(?:1\.?\s*)?introduction\s*$", r"^\s*background\s*$"),
    "methods": (
        r"^\s*(?:research\s+)?methods?\s*$",
        r"^\s*methodology\s*$",
        r"^\s*materials\s+and\s+methods\s*$",
    ),
    "results": (r"^\s*results?\s*$", r"^\s*findings\s*$"),
    "discussion": (r"^\s*discussion\s*$",),
    "conclusion": (r"^\s*conclusions?\s*$",),
    "references": (r"^\s*(?:references|bibliography|works\s+cited)\s*$",),
}

DOI_PATTERN = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
URL_DOI_PATTERN = re.compile(r"https?://(?:dx\.)?doi\.org/[^\s)]+", re.IGNORECASE)
IN_TEXT_AUTHOR_YEAR = re.compile(r"\([A-Z][A-Za-z'’-]+(?:\s+et\s+al\.)?,?\s*[,;]?\s*(?:19|20)\d{2}[a-z]?\)")
PLACEHOLDER_PATTERN = re.compile(
    r"\b(?:insert\s+(?:text|reference|citation)|to\s+be\s+completed|"
    r"lorem\s+ipsum|xxx+|\[\s*(?:citation|reference|insert|author)\s*\])\b",
    re.IGNORECASE,
)


def _finding(
    rule_id: str,
    severity: str,
    title: str,
    detail: str,
    evidence: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "rule_id": rule_id,
        "severity": severity,
        "title": title,
        "detail": detail,
        "source": "deterministic",
        "requires_human_verification": True,
    }
    if evidence:
        item["evidence"] = evidence[:300]
    return item


def run_deterministic_checks(text: str) -> dict[str, Any]:
    """Return bounded document metrics and transparent rule-based findings."""
    if not isinstance(text, str) or not text.strip():
        return {
            "status": "needs_attention",
            "word_count": 0,
            "character_count": 0,
            "detected_sections": [],
            "findings": [
                _finding(
                    "document.empty_extraction",
                    "critical",
                    "No readable manuscript text found",
                    "The uploaded file produced no readable text. A text-readable DOCX/PDF or OCR is required before assessment.",
                )
            ],
        }

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    lowered_lines = [line.lower() for line in lines]
    detected: list[str] = []
    for section, patterns in SECTION_PATTERNS.items():
        if any(re.match(pattern, line, re.IGNORECASE) for pattern in patterns for line in lines):
            detected.append(section)

    findings: list[dict[str, Any]] = []
    if "abstract" not in detected:
        findings.append(_finding(
            "structure.abstract_not_detected", "minor", "Abstract heading not detected",
            "No standalone Abstract heading was detected. Confirm whether the manuscript type requires an abstract or uses another heading.",
        ))
    if "methods" not in detected:
        findings.append(_finding(
            "structure.methods_not_detected", "major", "Methods section not detected",
            "No conventional Methods/Methodology heading was detected. Check whether the study design and methods are reported under another heading.",
        ))
    if "references" not in detected:
        findings.append(_finding(
            "references.section_not_detected", "major", "References section not detected",
            "No References, Bibliography or Works Cited heading was detected. Confirm whether references are present in another format or omitted.",
        ))

    placeholders = list(PLACEHOLDER_PATTERN.finditer(normalized))
    for match in placeholders[:10]:
        line_start = normalized.rfind("\n", 0, match.start()) + 1
        line_end = normalized.find("\n", match.start())
        if line_end < 0:
            line_end = len(normalized)
        findings.append(_finding(
            "content.placeholder_text", "major", "Possible drafting placeholder",
            "A common placeholder expression remains in the manuscript and should be checked before submission.",
            normalized[line_start:line_end].strip(),
        ))

    doi_values = URL_DOI_PATTERN.findall(normalized)
    bare_dois = DOI_PATTERN.findall(normalized)
    doi_count = max(len(doi_values), len(bare_dois))
    doi_like = re.findall(r"10\.\d{3,}/[^\s]+", normalized, re.IGNORECASE)
    valid_doi_tokens = {value.rstrip(".,;)]}") for value in DOI_PATTERN.findall(normalized)}
    for token in doi_like:
        cleaned = token.rstrip(".,;)]}")
        if cleaned not in valid_doi_tokens:
            findings.append(_finding(
                "references.doi_format_suspicious", "minor", "DOI-like text needs verification",
                "This string resembles a DOI but does not match the basic DOI syntax check. Verify it against the publisher or DOI registry.",
                token,
            ))

    reference_start = next(
        (i for i, line in enumerate(lowered_lines)
         if re.match(r"^(references|bibliography|works cited)$", line)),
        None,
    )
    duplicate_reference_lines: list[str] = []
    if reference_start is not None:
        reference_lines = [
            re.sub(r"\s+", " ", line).strip().lower()
            for line in lines[reference_start + 1:]
            if len(line.split()) >= 4
        ]
        counts = Counter(reference_lines)
        duplicate_reference_lines = [line for line, count in counts.items() if count > 1]
        for duplicate in duplicate_reference_lines[:10]:
            findings.append(_finding(
                "references.exact_duplicate_line", "major", "Possible duplicate reference entry",
                "An identical non-heading line appears more than once in the detected references section. Confirm whether this is a duplicated reference.",
                duplicate,
            ))

    citation_count = len(IN_TEXT_AUTHOR_YEAR.findall(normalized))
    status = "review_required" if findings else "no_deterministic_flags"
    return {
        "status": status,
        "word_count": len(normalized.split()),
        "character_count": len(normalized),
        "detected_sections": detected,
        "citation_pattern_count": citation_count,
        "doi_pattern_count": doi_count,
        "findings": findings,
        "limitations": [
            "Section detection uses heading patterns and may miss valid alternative headings.",
            "Citation counting is pattern-based and is not a full citation-to-reference reconciliation.",
            "DOI syntax checks do not verify DOI registration or metadata accuracy.",
            "These checks do not detect plagiarism or establish research misconduct.",
        ],
    }
