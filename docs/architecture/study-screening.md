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

## Implementation note

This document defines the target architecture, not a claim that the feature is already implemented. Before coding, inspect the current frontend routes, API schemas, persistence model and project-module patterns; extend those conventions rather than creating parallel infrastructure. Implement incrementally with tests and review the generated Methods text against the protocol before release.
