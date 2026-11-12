# Standalone Instruments & Data Collection — Product and Data Model Addendum

**Status:** Implementation design for the Instruments & Data Collection module  
**Applies to:** The existing `instruments` module and its future standalone entry point  
**Scope:** Researcher-owned instruments, immutable versions, validation evidence and the path to native survey publishing

## 1. Product decision: standalone and project-linked use

A researcher must be able to use Instruments & Data Collection without first creating a Research Workspace project.

The module therefore supports two entry paths:

- **Standalone:** the researcher opens Instruments & Data Collection from the main application, creates an instrument, develops and reviews it, and may later publish it as a survey for recruitment.
- **Project-linked:** the researcher opens the module from a project. The instrument remains owned by the researcher and is additionally associated with that project.

A project association is optional metadata, never the instrument's ownership or access-control boundary. Every instrument has a required authenticated `owner_sub`. A public survey identifier is separate from both the internal instrument identifier and any project identifier.

The existing project-linked planning editor must continue to work. Its saved planning records are not to be deleted, silently migrated or overwritten by the new standalone records.

## 2. Researcher journey

1. Create an instrument from the standalone entry point or a project.
2. Define its purpose, population, context, provenance and structured sections/questions.
3. Record source, copyright/licence and permission details for established instruments.
4. Create a version and invite expert reviewers.
5. Record face/content review, revisions and pilot evidence. Calculate indices only from actual recorded ratings or data.
6. Build a respondent survey from an eligible instrument version.
7. Preview the respondent experience, consent notice and eligibility rules.
8. Publish and receive a public, mobile-friendly URL. Respondents must not need Onyitech accounts.
9. Recruit through links and optional campaign labels, manage responses and export approved data.

Secondary-data extraction instruments remain usable without a public survey.

## 3. Ownership and persistence boundaries

- `owner_sub` is mandatory on every researcher-owned instrument and is checked on every authenticated operation.
- `project_id` is nullable. If present, the backend verifies that the project belongs to the same owner before linking it.
- Public respondent routes never accept a project ID as proof of authority.
- Do not store growing instrument definitions, versions, review records, invitations or responses in the existing project's `modules` map.
- Use a dedicated instrument-domain DynamoDB table, configured through an environment variable such as `INSTRUMENTS_TABLE`. The table must be provisioned and IAM-scoped separately; application code must not create or mutate AWS resources.
- Keep survey responses and any verification/invitation identities logically separate. Store large exports in S3 only when generated and provide authorised, expiring download links.

Proposed single-table access pattern (subject to final infrastructure review):

| Record | Partition key | Sort key |
|---|---|---|
| Instrument metadata | `OWNER#{owner_sub}` | `INSTRUMENT#{instrument_id}` |
| Immutable version | `OWNER#{owner_sub}` | `INSTRUMENT#{instrument_id}#VERSION#{version_number}` |
| Expert review | `OWNER#{owner_sub}` | `INSTRUMENT#{instrument_id}#VERSION#{version_number}#REVIEW#{review_id}` |
| Pilot/reliability evidence | `OWNER#{owner_sub}` | `INSTRUMENT#{instrument_id}#VERSION#{version_number}#EVIDENCE#{evidence_id}` |

The final table and index design must be validated against actual list, detail, review and export access patterns before AWS provisioning.

## 4. Version and status model

Instrument metadata may be edited while a draft is being prepared. A version is a frozen snapshot of its schema and provenance. Once created, the version's content is immutable; a revision creates a new version. Published survey responses always point to the exact version answered.

Do not collapse distinct concepts into one `validated` status. Track separately:

- **Instrument lifecycle:** draft, in_review, ready_for_survey, archived.
- **Expert-review outcome:** not_started, pending, revision_requested, reviewed.
- **Empirical evidence:** none, pilot_recorded, reliability_calculated, other_evidence_recorded.
- **Survey lifecycle:** draft, published, paused, closed.

An expert review is not a psychometric validation. A reliability coefficient is not proof of validity. An established instrument is not automatically suitable for every population, language, setting or adaptation.

## 5. Validation evidence rules

- Preserve reviewer ratings, comments, reviewer role/qualification description, date, version and declared review method.
- Face validity and content validity are recorded as evidence, not inferred from a completed form.
- Item-level and scale-level Content Validity Index calculations must use actual expert ratings, a declared rating scale, a declared relevance threshold and a recorded reviewer count. Display the calculation method and denominator.
- Do not hard-code a universal pass/fail decision independent of reviewer count and method. Show the numeric result and its interpretation basis.
- Pilot records must identify the sample size, population/context, procedure and date. Do not create synthetic pilot results.
- Reliability statistics must be calculated only from actual eligible response data. Record the method, item set, missing-data handling, reverse-scoring rules and sample size. Do not calculate or imply Cronbach's alpha from the question text alone.
- Keep AI suggestions advisory and distinguish them from human expert ratings and empirical evidence.

## 6. Survey publication and respondent safeguards

- Publishing creates a survey that references a frozen instrument version; it does not make the instrument's private draft public.
- Public retrieval returns only the published respondent-safe definition and study information.
- Consent and eligibility checks occur before answers are accepted.
- Support open-anonymous and token-controlled modes as separate, clearly described protection levels. Anonymous mode must not quietly collect direct identifiers.
- Single-use invitation tokens require high entropy, hashed storage and atomic conditional redemption.
- IP addresses are risk signals only; shared IPs must not automatically disqualify participants. Do not use invasive browser fingerprinting.
- Flag suspicious submissions for transparent researcher review; do not silently delete or rewrite them.
- Every response retains its survey and immutable version identifiers.
- Define retention, deletion, privacy notice and access controls before production release, with applicable data-protection obligations reviewed.

## 7. Delivery sequence

1. **Standalone instrument records and versioning:** authenticated owner-scoped create/list/read/update-draft operations, optional verified project association, immutable version snapshots and regression tests.
2. **Expert review and validation evidence:** review records, face/content evidence, transparent CVI calculations and tests using actual ratings.
3. **Pilot and reliability evidence:** pilot records and statistical calculations from real, eligible response data.
4. **Survey builder:** structured sections, supported question types, required/optional fields, constraints, branching and preview.
5. **Native survey publishing:** public IDs, publication lifecycle, consent and unauthenticated public retrieval/submission.
6. **Response protection and management:** token mode, rate limiting, quality flags, audit trail and response review.
7. **Export and Data Workspace hand-off:** data dictionary, CSV/XLSX/JSON export and explicit transfer with raw-response preservation.

Each delivery remains on a feature branch and is tested in isolation. No production deployment, production table creation, IAM change or live-data migration is included in this design addendum.
