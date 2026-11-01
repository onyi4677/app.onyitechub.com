# Instruments & Data Collection — Technical Specification

**Status:** Foundation specification  
**Product placement:** One of the 12 existing Onyitech Research Workspace modules  
**Module key:** `instruments`  
**Module status in registry:** `planned` until the implementation milestones are complete

## 1. Product decision

All instrument-development and data-collection capabilities described here are internal parts of the existing **Instruments & Data Collection** module. They are not separate top-level modules and are not a Google Forms integration.

The module must support two research pathways:

- **Primary data:** design an instrument, build a digital survey, publish it on Onyitech, collect responses, assess response quality and transfer approved data to Data Workspace.
- **Secondary data:** create structured extraction forms for scoping/systematic reviews, document review and existing datasets. This pathway must work without publishing a public respondent survey.

Project 001 is a secondary-data review. It must not be forced into a participant-survey workflow.

## 2. Internal workspaces

1. **Instrument Development** — questionnaires, interview guides, focus-group guides, observation checklists, experimental forms and document/data-extraction forms.
2. **Instrument Validation** — expert review, face/content-validity records, pilot testing, revisions and reliability results where appropriate.
3. **Survey Builder** — sections, questions, response options, required fields, validation rules, branching/skip logic and preview.
4. **Survey Publishing** — publish/unpublish, public respondent URL, opening/closing dates, collection target, pause/resume and distribution campaigns.
5. **Response Protection** — consent capture, rate limits, one-time invitation tokens and configurable verification; risk flags and audit trail.
6. **Response Management** — response listing, completion status, quality flags, safe review and export preparation.
7. **Data Export & Integration** — data dictionary, CSV/XLSX/JSON export and controlled hand-off to Data Workspace.

These are internal sections of one module. Navigation must retain the existing project/module shell and must not add another top-level module.

## 3. Respondent experience

- A researcher publishes a survey and receives a public Onyitech URL, for example `/survey/{public_id}`.
- Respondents do not need an Onyitech account.
- The public page is mobile-first and usable from WhatsApp, email and social-media links.
- Show the study information and consent choice before collecting answers.
- Do not expose project-owner details, private project content, draft questions or response data through public endpoints.
- A respondent can submit only while the survey is published and open.
- Show a neutral confirmation after a successful submission; do not expose another respondent's details.
- Support anonymous surveys and controlled/invitation surveys as distinct collection modes.

## 4. Instrument and survey capabilities

### Instrument types
Structured questionnaire; semi-structured questionnaire; interview guide; focus-group guide; observation checklist; document/data-extraction checklist; experimental data form; and other researcher-defined instruments.

### Question types
Single choice, multiple choice, checkbox, short text, long text, numeric, Likert/rating scale, date, dropdown and consent. Questions may be required or optional and may have validation constraints. Sections and conditional display/skip logic are supported by the survey schema.

### Validation integrity
The interface must distinguish:
- established/standardised instruments with verifiable source and permission/licence details;
- researcher-developed instruments;
- AI-assisted drafts.

The system must never label an instrument as validated merely because AI generated or reviewed it. Validation status must be supported by recorded evidence, reviewer details, pilot/reliability results where applicable, date and version.

Published survey versions are immutable. Editing a published instrument creates a new draft version; existing responses remain attached to the exact version answered.

## 5. Duplicate-response protection and privacy

No anonymous web form can prove that every submission came from a different human. The product must communicate the actual protection level and never promise perfect duplicate prevention.

Offer configurable modes:

- **Open anonymous:** no identity verification; session/cookie controls, rate limiting and risk flags may deter repeat submissions but are not identity proof.
- **Token-controlled:** unique, high-entropy, single-use invitation tokens. Token consumption must be atomic/conditional so concurrent submissions cannot redeem the same token twice.
- **Verified participation:** optional email or phone verification where justified and disclosed. Verification identifiers must be kept separate from answer payloads where possible.

Rules:
- IP address is a risk signal only; do not automatically reject respondents solely because they share an IP address.
- Do not use invasive browser fingerprinting.
- Do not silently delete or rewrite suspicious responses. Flag them for researcher review with a reason and audit record.
- Apply request-size limits, schema validation, abuse/rate limiting, survey-open checks and appropriate bot mitigation.
- Obtain informed consent and disclose what personal data is collected, why, retention and contact/privacy information. Anonymous mode must not quietly collect direct identifiers.
- Separate any invitation/verification identity records from anonymous answer records. Restrict access to identifiable records.
- Define retention and deletion controls before production release and align the implementation with applicable data-protection requirements.

## 6. Backend and data architecture

Retain the existing application architecture: Next.js frontend, FastAPI API, API Gateway/Lambda and DynamoDB. Use existing project authentication and ownership checks for researcher operations. Public respondent routes are deliberately unauthenticated but narrowly scoped to published survey retrieval and submission.

Do **not** store survey definitions at scale, respondent identities, tokens or response payloads inside the project's `modules` map. The existing project module record is suitable for small planning metadata only; survey responses must be independently stored to avoid DynamoDB item-size and write-contention problems.

Initial cost-conscious persistence proposal:
- One dedicated DynamoDB table for survey-domain records, using typed partition/sort keys for survey definitions/versions, campaign records, invitation tokens, response records, optional participant/verification references and audit events.
- Add only the indexes required by real access patterns (researcher survey list, survey response list, token lookup and response export).
- Store large export files in S3 only when generated; use short-lived, authorised download links.
- Keep a stable survey/public identifier separate from the internal project ID. Public identifiers must be unguessable and must not expose sequential database keys.

Before implementing infrastructure, inspect the existing DynamoDB table configuration, key schema, IAM permissions, environment-variable conventions and deployment workflow. Do not create AWS resources or alter production infrastructure as part of a frontend-only change.

### Core record concepts
- **Instrument:** project association, title, type, purpose, provenance, current version and lifecycle.
- **Instrument version:** immutable schema, validation state/evidence and creation metadata.
- **Survey:** instrument/version association, public ID, lifecycle state, response mode, schedule and settings.
- **Campaign:** optional source label such as a particular WhatsApp group; never treat campaign attribution as respondent identity.
- **Invitation token:** hashed token, survey/version scope, expiry, redemption state and minimal audit metadata.
- **Response:** survey/version, submitted answers, timestamps, completion and quality flags; avoid direct identifiers in anonymous payloads.
- **Verification/participant reference:** separate restricted identity data only when the study design requires it.
- **Audit event:** actor or system, action, target, timestamp and reason.

## 7. API capability boundaries

Exact paths should follow the existing API naming and error conventions after reviewing the full route structure. Required operations:

### Authenticated researcher operations
- Create/read/update instrument drafts.
- Create immutable instrument versions.
- Record validation reviews and pilot/reliability evidence.
- Create/edit/preview survey drafts.
- Publish, pause, resume, close and reopen surveys with lifecycle checks.
- Configure collection window, target, response mode and campaign links.
- List and inspect responses subject to project ownership.
- Flag, review and disposition suspicious responses without deleting the audit history.
- Export approved response datasets and request Data Workspace hand-off.

### Public respondent operations
- Retrieve only a published survey's public-safe definition.
- Submit a response to an open survey version.
- Redeem a valid single-use token when token mode is enabled.
- Return a generic submission receipt/status without disclosing private information.

Public routes must not accept a project ID as proof of access. Every researcher operation must enforce project ownership. Public submissions must be validated against the exact published version.

## 8. Data Workspace integration

A researcher explicitly initiates transfer after reviewing collection status and data quality. The hand-off should create a dataset in Data Workspace with:
- source survey and immutable survey-version reference;
- collection dates and response mode;
- variable/field names, labels, types and option coding;
- missing-value conventions;
- data dictionary and transformation log;
- included/excluded response counts and exclusion reasons.

Never silently remove flagged responses during transfer. Provide a transparent inclusion decision and preserve the raw response record.

## 9. Implementation milestones

### Milestone 0 — Foundation and safety (this PR)
- Record this product/technical specification.
- Confirm module registry key and existing generic module persistence.
- Make no production infrastructure changes and no changes to existing research modules.

### Milestone 1 — Instrument Development foundation
- Add a dedicated Instruments & Data Collection editor inside the existing module route.
- Load and save only small project-level planning metadata through existing authenticated module endpoints.
- Add instrument type, title, purpose, population/context, administration mode, consent plan and provenance.
- Support primary-data and secondary-data paths.
- Preserve all existing module data and avoid changing the project record shape for other modules.

### Milestone 2 — Instrument schema and versioning
- Define validated schemas and immutable versions.
- Add expert review, pilot and reliability evidence records.
- Add unit tests for schema validation and version immutability.

### Milestone 3 — Survey Builder
- Build section/question editor, supported question types, constraints, required fields, branching and preview.
- Test save/reload and validation before any publication capability.

### Milestone 4 — Native Survey Publishing
- Add survey persistence, public IDs, lifecycle controls and public respondent page.
- Add consent and public-safe retrieval/submission endpoints.
- Test unpublished/paused/closed survey access and cross-project isolation.

### Milestone 5 — Response protection and management
- Add atomic single-use tokens, rate limits, audit events, response flags and optional verification.
- Test concurrent token redemption, duplicate attempts, abuse limits and privacy separation.

### Milestone 6 — Export and Data Workspace hand-off
- Add data dictionary, CSV/XLSX/JSON export and controlled dataset creation.
- Verify reproducibility and preserve raw submissions and audit history.

## 10. Acceptance and regression requirements

- The module remains one of the existing 12 modules; no extra top-level module is introduced.
- Existing project data and the other 11 modules remain unchanged.
- Project 001 can use a secondary-data extraction form without publishing a public survey.
- A new primary-data project can publish an Onyitech-hosted survey and receive submissions without respondent accounts.
- Respondent links work on mobile and can be shared in WhatsApp.
- Draft, published, paused and closed states are enforced server-side.
- Public endpoints reveal only published survey content and accept only schema-valid answers.
- Survey version answered by each response is retained.
- Duplicate protection is described honestly and works according to the configured mode.
- No response is silently altered/deleted; quality flags and audit events remain reviewable.
- Researcher access is isolated by project ownership.
- Automated tests cover permissions, validation, lifecycle, token atomicity and data separation.
- No production deployment or AWS resource mutation occurs without a separate explicit deployment decision.

## 11. Engineering guardrails

- Work on a feature branch and deliver reviewable pull requests.
- Inspect existing conventions before adding models, routes, tables or frontend components.
- Keep changes scoped to this module; do not refactor unrelated modules.
- Add tests with each backend capability.
- Never fabricate validation results, sources, respondent identities or research findings.
- Keep the module marked `planned` until its essential capabilities are implemented and tested; status can be advanced in a later, explicit change.
