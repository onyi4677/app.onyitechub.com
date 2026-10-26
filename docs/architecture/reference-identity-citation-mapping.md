# Reference Identity and Citation Mapping

Status: Initial reusable infrastructure; review before merge/deployment.

## Purpose

Provide one repeatable way to detect duplicate bibliographic records and inspect relationships between the Literature & Evidence source list and the References & Citations library. The workflow must preserve project data and citation provenance.

## Identity rules

- Normalize DOI URLs and `doi:` prefixes before comparing DOI values.
- Normalize title and author text for metadata comparison.
- Treat an identical non-empty DOI as a strong identity match.
- Treat matching normalized title, year, and first author as a strong metadata match only when the two records do not contain conflicting non-empty DOIs.
- Treat matching title/year with different authors or conflicting DOIs as a manual-review candidate, not an automatic duplicate.
- Never merge or delete a record based on title similarity alone.

## Audit outputs

The citation-integrity endpoint reports:
- orphan citation-to-reference links;
- references that are not cited;
- exact duplicate reference records;
- ambiguous reference groups requiring human review;
- exact and ambiguous duplicate groups in Literature & Evidence;
- cross-module identity matches and records whose source/reference relationship is not yet explicitly linked.

A matching record is not automatically merged. Any future merge action must preserve a canonical ID, update every citation and evidence/claim/screening link, retain a before/after audit record, and require the user to confirm the chosen canonical record.

## Canonical linking model

- Literature & Evidence remains authoritative for source metadata and verified evidence.
- References & Citations stores citation-ready metadata and in-text citation mappings.
- A reference should be linked to its source using a stable `source_id` relationship, not only by matching title text.
- Citation mappings retain stable reference IDs. Removing a reference must not silently delete a multi-reference citation mapping; links should be reassigned or explicitly reviewed.
- Study screening and evidence extraction should reuse the same canonical source identity and must not create new source records for existing works.

## Safety and rollout

This implementation is diagnostic only. It does not automatically merge or delete records and does not change existing live project data. Test duplicate normalization, conflicting DOI handling, cross-module matching, citation integrity, and preservation of evidence/citation links before merge or backend deployment.
