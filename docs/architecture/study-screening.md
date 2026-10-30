# Study Screening: Architecture Proposal

Status: Proposed architecture for review
Product: Onyitech Research Workspace
Scope: Project-scoped study screening for evidence reviews and other structured literature projects

## Decision

Implement **Study Screening** as a first-class research workflow. Screening records belong to the project-level screening workflow and link to the existing canonical Literature & Evidence source record. Research Design & Methodology stores the review protocol and consumes screening summaries; it must not become a second store of individual screening decisions. Manuscript Production consumes the same canonical screening data to generate study-selection reporting and, where appropriate, populate the review's included-study set.

This separates three concepts:
1. **Source** — bibliographic identity and source metadata.
2. **Screening decision** — whether a record/report meets the protocol at each screening stage, with decision history and reasons.
3. **Evidence extraction** — verified findings extracted from an eligible full text.

Saving a source or extracting evidence must not silently imply that a study has passed screening.

## User-facing information architecture

Within each research project, add a **Study Screening** workspace reachable from the research workflow/navigation. It should provide:

- Review type selection for **scoping** and **systematic** reviews, with PCC or PICO/PECO guidance visible in the workspace.
- Protocol and eligibility criteria (read-only summary with a link to Research Design & Methodology for editing the protocol).
- Import/add records and link them to existing Literature & Evidence sources.
- Title/abstract screening.
- Full-text retrieval and eligibility screening.
- Decision reasons and retrieval-attempt notes.
- Screening progress, counts and a PRISMA-style flow summary.
- Included studies list, with links to source and evidence records.
- Export of screening log and flow data (CSV/XLSX where supported).

Literature & Evidence remains the source of truth for bibliographic metadata, verified evidence, claims and synthesis. A source picker must reuse an existing source ID rather than creating a duplicate source when a screening decision is added.

## Suggested domain model

Adapt names and persistence details to the existing API and storage conventions; do not introduce a second data store without a demonstrated need.

### Screening protocol
- `id`, `project_id`, `version`, `name`
- `population`, `concept`, `context`
- `inclusion_criteria[]`, `exclusion_criteria[]`
- `publication_date_from`, `publication_date_to`
- `language_criteria`, `source_types`, `screening_method`
- `created_at`, `updated_at`, `created_by`

Protocol versions must be retained or snapshotted against screening records so later protocol edits do not rewrite the historical basis for earlier decisions.

### Screening record
- `id`, `project_id`, `protocol_version_id`
- `source_id` (nullable only for imported records not yet reconciled to a canonical source)
- `external_record_id`, `doi_normalized`, `title_snapshot`, `citation_snapshot`
- `record_status`: `identified`, `title_abstract_pending`, `title_abstract_excluded`, `full_text_pending`, `full_text_awaiting_retrieval`, `full_text_not_retrieved`, `full_text_excluded`, `included`
- `title_abstract_decision`: `include`, `exclude`, `maybe`, `not_screened`
- `title_abstract_exclusion_reason`
- `full_text_decision`: `include`, `exclude`, `not_assessed`, `not_retrieved`
- `full_text_exclusion_reason`
- `retrieval_attempts[]` with date, route, outcome and notes
- `reviewer_decisions[]` with reviewer, stage, decision, reason and timestamp (supports independent reviewers later)
- `duplicate_of_screening_record_id` or a canonical-record link
- `linked_study_id` to group multiple reports from the same underlying study
- `created_at`, `updated_at`, `decision_at`

Use enumerated decisions and controlled reason codes plus optional notes. Suggested full-text reason codes: wrong population, wrong concept, wrong context, wrong publication date, wrong language, ineligible publication type/design, duplicate report, insufficient methods, and full text unavailable after reasonable attempts. The unavailable-full-text outcome must be distinguishable from a substantive eligibility exclusion.

### Screening event/audit history
Keep a decision history (append-only events or an equivalent audit mechanism) for status transitions, changed decisions, changed reasons, reviewer, and timestamp. Editing a decision should not erase the previous decision.

## Workflow and state rules

1. Add/import a record, match it to an existing source by normalized DOI first and then by reviewed bibliographic matching. Do not merge records automatically on title similarity alone.
2. Screen title/abstract against the current protocol. Record include, exclude, or maybe and a reason for exclusion.
3. For records advancing, track full-text retrieval attempts and outcomes.
4. Assess the full text and record include or exclude. Every full-text exclusion requires a reason. If the paper cannot be obtained after reasonable documented attempts, mark it as not retrieved/unavailable; keep its abstract-level notes separate from fully verified evidence.
5. Included records can be linked to evidence extraction, but do not auto-create evidence claims or infer missing study findings.
6. If duplicate reports describe the same underlying study, retain the report-level records and link them to one study so flow counts and synthesis do not double-count participants or findings.
7. Permit decisions to be corrected with an audit trail. If a protocol changes, preserve the protocol version used for each decision.

## PRISMA-style counts and manuscript integration

Calculate counts from screening records and their histories, not manually typed totals. At minimum expose:
- records identified (by source/database where recorded)
- duplicates removed before screening
- records screened at title/abstract
- records excluded at title/abstract
- reports sought for retrieval
- reports not retrieved
- full-text reports assessed
- full-text reports excluded, grouped by reason
- studies included in the review
- reports linked to included studies

Keep **reports** distinct from **studies** because one study can have multiple publications. Do not claim a database was searched unless search provenance records it.

Research Design & Methodology should read the protocol, screening dates/method and calculated flow counts to support reproducible methods text. Manuscript Production should use those same values for the Methods / Study Selection section and a flow diagram or structured equivalent. The included-study list should be derived from final inclusion decisions and linked study identities. Any generated prose must remain editable and visibly traceable to the records it summarizes.

## Integration with existing modules

- **Literature & Evidence:** canonical source metadata, full-text file/reference, verified evidence, claims and synthesis. Add a link/badge showing screening status; do not store a second copy of screening decisions here.
- **Research Design & Methodology:** protocol and screening-method description; consumes calculated counts and date ranges.
- **Manuscript Production:** consumes included studies, verified evidence, methods metadata and calculated flow data; does not infer eligibility from the mere presence of evidence.
- **Project dashboard:** optional progress summary (records awaiting title/abstract, full-text retrieval, full-text decision, and included studies).

## Validation and safeguards

- Enforce project ownership and authorization on every screening/source link.
- Validate state transitions and required exclusion reasons server-side.
- Prevent accidental duplicate screening rows for the same canonical source within a project, while allowing explicitly linked multiple reports/study relationships.
- Never delete or overwrite source evidence when a screening decision changes.
- Show warnings when a full-text decision is made without a retrieval record or when an included record has no linked source/full text; allow documented exceptions where appropriate.
- Store source-of-record/search provenance (database, query, date, imported batch) where available.
- Do not present screening counts as final while records remain unresolved; label provisional counts clearly.

## Acceptance criteria for implementation

1. A researcher can screen a source already saved in Literature & Evidence without creating a duplicate source.
2. Title/abstract and full-text decisions are separately stored and editable with a decision history.
3. Full-text exclusions require a reason; unavailable full texts retain documented retrieval attempts and are not represented as fully assessed papers.
4. Included records link to the existing source and its evidence items.
5. A project-level screening log can be viewed and exported.
6. Flow counts are calculated from records, distinguish reports from studies, and show unresolved items.
7. Research Design & Methodology and Manuscript Production can consume the same calculated values without duplicate manual entry.
8. Changing a decision updates the flow summary and eligible-study set while preserving the audit trail.
9. Tests cover duplicate prevention, state transitions, required reasons, project authorization, count calculations, and source/evidence link integrity.

## Implementation status (initial vertical slice)

The first implementation is on the feature branch for review. It extends the existing project-module registry and DynamoDB-backed module persistence rather than adding a second data store.

Implemented in this branch:
- Study Screening is registered as a separate twelfth module; Research Integrity & Quality remains independently registered.
- The screening protocol stores `review_type` (`scoping` or `systematic`), protocol version, search/import provenance and duplicates removed before screening.
- A project-level Study Screening editor that links to existing Literature & Evidence source IDs and prevents adding the same source twice in one screening log.
- Separate title/abstract and full-text decisions, controlled exclusion reasons, retrieval-attempt notes for records marked not retrieved, protocol snapshots on records, and decision-history entries.
- Server-side checks for valid decisions, source linkage, duplicate source IDs, required exclusion reasons, valid stage progression, and retrieval attempts when full text is not retrieved.
- Calculated provisional flow counts displayed in Study Screening and read by Research Design & Methodology.
- A Manuscript Production editor that reads the same screening records, derives an editable study-selection narrative, and lists reports currently marked included.

Known limitations before production use:
- Multiple reports linked to a single underlying study, exports, authenticated reviewer identity, and immutable server-side audit events are not implemented.
- Protocol version is currently a simple initial value; full protocol version management and reviewer-independent dual screening are future work.
- The manuscript editor is an initial integration slice, not a complete manuscript authoring/export system.
- The branch must pass the deployment preview and be reviewed before merging. Screening counts must be checked against the real search log before being reported in a manuscript.


## Implemented integration contract (2026-10)

The current codebase has two legacy metadata collections: literature_evidence.sources (IDs: source_id) and references_citations.references (IDs: reference_id). Neither collection is deleted or rewritten by the screening integration. The API now exposes a read-only project-level source registry at:

- GET /api/projects/{project_id}/research-sources

The registry groups records by normalized DOI where available, otherwise by normalized title + year + first author. If a work already has a Literature & Evidence source, that existing source_id remains canonical so existing evidence and claim links remain stable. If a work exists only in References & Citations, its reference_id is used as the canonical ID. The response contains aliases and both legacy IDs to support cross-module navigation.

Study Screening and Literature & Evidence evidence/claim selectors use this unified projection. New screening records store canonical IDs. New evidence and claim links submitted with an alias are normalized to the canonical ID by the API. The existing reference IDs inside in-text citation mappings are not rewritten. Existing duplicate legacy rows remain available for safe, explicit cleanup; this integration does not silently delete or merge them.

Important limits: identity matching is deterministic but not a substitute for a human duplicate review; records without a DOI rely on title/year/first-author matching. Protocol history remains a project log, not an immutable regulatory audit trail. Screening counts currently cover only records added to the screening log, not database search totals or study-vs-report deduplication.

### Acceptance checks

1. A DOI-identical work present in both legacy collections appears once in the unified picker.
2. Its canonical ID is the existing Literature & Evidence source_id; its reference ID remains available as an alias.
3. A reference-only work is available for screening and evidence charting without first creating another Literature & Evidence source.
4. Saving screening, evidence, or claims using a recognized alias succeeds and normalizes new links to the canonical ID.
5. Existing evidence IDs, claim IDs, citation IDs, and citation reference IDs remain unchanged.
6. The unified source endpoint is read-only and does not migrate or delete user data.
