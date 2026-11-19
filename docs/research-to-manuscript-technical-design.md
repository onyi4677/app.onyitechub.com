# Research-to-Manuscript Engine — Technical Design

**Status:** Initial technical design for staging implementation  
**Parent product:** Onyitech Research Workspace  
**Implementation branch:** `feat/research-to-manuscript-engine`  
**Baseline:** Current `main` branch at the time this feature branch was created  
**Deployment policy:** Staging/preview only until explicit production approval

## 1. Design objective

Implement Manuscript Assemblage as a first-class, reusable project workflow that reads existing research modules and creates a versioned, source-traceable manuscript. It must not create a parallel research workspace or require researchers to export and re-upload each module.

The first implementation should establish the manuscript foundation: project association, article-type templates, source snapshots, section records, validation results and researcher review states. AI drafting and document export can build on these contracts.

## 2. Existing architecture findings

The following are observed in the current `main` branch and should guide implementation:

### 2.1 Module registry

File: `backend/app/modules/registry.py`

The backend already registers a `manuscript` module with status `planned`. The existing registry keys include:

- `research_foundation`
- `literature_evidence`
- `references_citations`
- `methodology`
- `study_screening`
- `manuscript`

The user-facing Research Design & Methodology module is currently stored under the backend key `methodology`. Do not assume its key is `research_design_methodology`.

### 2.2 Generic project-module API

File: `backend/app/api/routes.py`

Existing authenticated routes are:

- `GET /api/projects/{project_id}/modules/{module_key}`
- `PUT /api/projects/{project_id}/modules/{module_key}`

They validate project ownership and use `get_module` / `save_module` from `backend/app/services/project_modules.py`.

The generic module interface is useful for small module configuration and metadata. It should not automatically become the storage mechanism for an entire long manuscript.

### 2.3 Module storage

File: `backend/app/services/project_modules.py`

Most module content is currently stored inside the project item in the projects DynamoDB table. Study Screening is special-cased to use `study_screening_storage` when its dedicated table is configured, with legacy migration support.

File: `backend/app/services/study_screening_storage.py`

Study Screening uses a separate DynamoDB table, a metadata item, generated data generations, and separate list-entry items. Manuscript source collection must call the existing module service so it respects this storage abstraction. It must not read the Screening table directly or duplicate Screening records.

### 2.4 Frontend module routing

Files include:

- `frontend/app/projects/[id]/page.tsx`
- `frontend/app/projects/[id]/modules/[module]/page.tsx`
- `frontend/components/workspace/module-card.tsx`
- `frontend/components/workspace/workspace-sidebar.tsx`
- `frontend/lib/api/modules.ts`

The project page builds its module cards from the backend registry. The module page dispatches to a module-specific editor and currently displays a placeholder for modules without a dedicated editor. The existing module API client already exposes `getProjectModule` and `saveProjectModule`.

This provides a natural route for adding a dedicated Manuscript editor without introducing a separate application.

## 3. Initial source integration contract

The initial source collector should read the project and the following module keys through the existing project-module service:

| Source | Backend module key | Intended manuscript use |
| --- | --- | --- |
| Research Foundation (when populated) | `research_foundation` | Title, aim, objectives, questions, hypotheses and conceptual framework |
| Literature and Evidence | `literature_evidence` | Sources, evidence items, claims and synthesis |
| Study Screening | `study_screening` | Search provenance, screening records, extraction and verification data |
| Reference and Citation | `references_citations` | Bibliographic records and citation mappings |
| Research Design and Methodology | `methodology` | Review/study design, eligibility, population, procedures and analysis plan |

The four modules confirmed as populated for Project 001 are Literature and Evidence, Study Screening, Reference and Citation, and Research Design and Methodology. Research Foundation is an optional source and must not be treated as populated unless its saved data confirms that.

The source collector should return a read-only project snapshot. It must not update or normalise the original source modules as a side effect.

### 3.1 Canonical source identity

The existing `canonical_sources.py` creates a read-only projection from literature and reference records in the project item. It can help connect bibliographic records across those modules.

Important limitation: that projection currently reads project-item module data and does not include the separately stored Study Screening rows. Screening records already link to source IDs. The manuscript collector must preserve those IDs and join them to canonical source information where possible; it must not assume that canonical source projection contains screening evidence itself.

## 4. Proposed manuscript domain model

The following is a logical model, not yet a committed database schema. Exact persistence fields and storage location must be finalised before implementation.

### 4.1 Manuscript workspace

One manuscript workspace belongs to one project. A project may support more than one manuscript in a later phase, but the first release may expose one active manuscript workspace per project.

Suggested fields:

- `manuscript_id`
- `project_id`
- `title`
- `article_type`
- `template_id`
- `template_version`
- `status`
- `current_version_id`
- `created_at`
- `updated_at`

### 4.2 Manuscript version

Each assembly creates an immutable version baseline. Subsequent researcher edits create a new saved revision or version according to the chosen versioning policy.

Suggested fields:

- `version_id`
- `manuscript_id`
- `version_number`
- `source_snapshot_id`
- `template_id` and `template_version`
- `assembly_status`
- `created_at`
- `created_by`

### 4.3 Source snapshot

A source snapshot records exactly which project/module state was used for an assembly.

Suggested fields:

- `source_snapshot_id`
- `project_id`
- `captured_at`
- `module_keys`
- `module_updated_at` values when available
- `source_record_ids` or stable record references
- `snapshot_schema_version`

The design should prefer stable record references and captured source payloads sufficient to reproduce the assembly. It must not rely only on timestamps if the source modules do not maintain reliable per-record versions.

### 4.4 Manuscript section

Suggested fields:

- `section_id`
- `version_id`
- `section_key`
- `title`
- `order`
- `content`
- `status` (for example: empty, needs_input, draft, in_review, approved)
- `source_links`
- `updated_at`
- `approved_at`
- `approved_by`

Section content should be independently editable. Regenerating one section must not silently overwrite other approved sections.

### 4.5 Tables and figures

Tables and figures should be structured records, not only embedded text. Each should include a stable identifier, caption/title, structured content, source links, review status and display order. Initial implementation may focus on tables and defer complex figure editing.

### 4.6 Validation findings

Each validation finding should include:

- Stable finding identifier.
- Category (missing, conflict, duplicate, unverified, unsupported, stale-source).
- Severity.
- Affected section/table/source record.
- Human-readable explanation.
- Suggested next action.
- Resolution state and researcher note.

Validation findings are advisory workflow records. They must not be represented as misconduct verdicts or proof of research validity.

## 5. Article-type template model

Templates should be configuration-driven and versioned. A template defines:

- Article type and display name.
- Suggested section order and required/optional status.
- Section purpose and drafting guidance.
- Applicable reporting checklist or framework.
- Expected tables/figures and required source inputs.
- Journal-specific overrides in a later phase.

Initial template identifiers:

- `original_empirical`
- `scoping_review`
- `systematic_review`
- `narrative_review`
- `research_protocol`
- `case_study`

The template is a starting structure, not a substitute for the target journal's author instructions. Researchers must be able to customise section names/order where appropriate.

## 6. Assembly lifecycle

Proposed lifecycle:

1. `not_started` — no manuscript assembly exists.
2. `source_collection` — read relevant project modules.
3. `reconciliation_required` — material conflicts or missing inputs need researcher attention.
4. `ready_to_draft` — source map and validation are available.
5. `drafting` — one or more sections are being drafted.
6. `in_review` — researcher review is in progress.
7. `approved` — researcher has approved the current manuscript version.
8. `stale` — one or more source modules changed after the snapshot.
9. `failed` — assembly could not complete; preserve diagnostic information.

A project should be allowed to proceed with explicitly acknowledged gaps where scientifically appropriate. A warning must not be converted into a fabricated value simply to make the workflow appear complete.

## 7. API design proposal

The generic module endpoints can continue to expose the manuscript module's small configuration/summary metadata. Dedicated manuscript endpoints are recommended for source assembly and version/section operations.

Proposed endpoints (names are provisional and should be aligned with existing route conventions during implementation):

- `GET /api/projects/{project_id}/manuscript` — retrieve workspace metadata and current version summary.
- `POST /api/projects/{project_id}/manuscript/assemble` — collect sources, create a source snapshot, run validation and create an assembly version.
- `GET /api/projects/{project_id}/manuscript/versions/{version_id}` — retrieve a version and its sections.
- `PUT /api/projects/{project_id}/manuscript/versions/{version_id}/sections/{section_id}` — save a researcher edit to one section.
- `POST /api/projects/{project_id}/manuscript/versions/{version_id}/validate` — rerun deterministic validation against the recorded snapshot.
- `POST /api/projects/{project_id}/manuscript/versions/{version_id}/approve` — record researcher approval.

Every route must use the existing authentication dependency and project-ownership check. Version and section identifiers must be checked against the requested project to prevent cross-project access.

Do not implement AI generation in the first source-assembly milestone. First make source collection, snapshots, validation and manual section editing reliable.

## 8. Persistence decision and size constraints

DynamoDB items have a 400 KB maximum item size. The existing project item is already used for project metadata and module content, so storing a complete manuscript and all section history inside that single item is not an acceptable long-term design.

Before choosing the production persistence model, inspect the staging environment for existing object-storage buckets, access policies and deployment configuration. A likely separation is:

- Small manuscript workspace/version metadata in DynamoDB.
- Larger section bodies, snapshots or export files in object storage.
- Stable references from metadata to stored objects.

The implementation must reuse existing infrastructure where suitable and remain cost-conscious. Do not create new AWS resources or change IAM policies as part of this design step. Any new staging resource requirement must be documented and approved before provisioning. Production resources must remain untouched.

## 9. Deterministic validation rules for the first milestone

The first validation pass should be deterministic and transparent. It may check:

- Required project title and selected article type.
- Availability of expected source modules.
- Empty or missing source-module content.
- Missing required template inputs.
- Duplicate stable source identifiers within the collected snapshot.
- Screening records that reference unknown source identifiers.
- Unresolved screening decisions or provisional records.
- References without sufficient bibliographic fields.
- Tables or claims with no source links.
- Differences between source-module update times and the snapshot.

The validator should report findings and affected records. It must not silently decide inclusion/exclusion, infer search counts, invent methods, calculate unsupported results or declare a study verified.

## 10. Frontend integration

The Manuscript module should be a first-class entry in the existing project module registry and module navigation.

The dedicated editor should provide these initial views:

1. **Overview** — article type, assembly status, source readiness and current version.
2. **Source map** — module availability, source counts where reliable, and unresolved reconciliation items.
3. **Manuscript sections** — ordered section list with status and a focused editor.
4. **Tables and figures** — structured table review and source links.
5. **Validation** — missing/conflicting/unverified information and resolution tracking.
6. **Version history** — source snapshot and saved manuscript revisions.

The initial UI should not imply that AI drafting, DOCX/PDF export or journal submission is already available. Those capabilities should appear only when implemented.

## 11. Testing requirements

Backend tests should cover:

- Source collection reads the expected module keys.
- Study Screening is retrieved through `get_module` and its configured storage adapter.
- Source collection does not mutate any source module.
- Missing modules return explicit empty/missing states rather than invented content.
- Snapshot IDs and manuscript/version IDs are stable and correctly scoped.
- Duplicate and dangling source links are reported.
- A section edit changes only the targeted section.
- Approval state is retained.
- A changed source module marks the current version stale without rewriting it.
- Users cannot access another project's manuscript version or section.

Frontend tests/manual staging acceptance should cover:

- Manuscript appears in the project workspace.
- Article type selection and template loading.
- Source readiness and validation display.
- Section navigation and editing.
- Saving and reloading edits.
- Version and stale-source indicators.

## 12. Delivery sequence

### Milestone 1 — Foundation contracts
- Finalise data model and template schema.
- Confirm staging persistence infrastructure and storage choice.
- Define source collector and validation interfaces.
- Add backend tests for read-only source collection.

### Milestone 2 — Manuscript persistence and API
- Implement workspace/version/section persistence.
- Add authenticated manuscript endpoints.
- Add tests for project isolation, versioning and section updates.

### Milestone 3 — Frontend module
- Activate the registry entry when the backend/API is ready.
- Add Manuscript Assemblage editor to the existing module route.
- Implement source map, sections, validation and version history.

### Milestone 4 — Project 001 staging validation
- Load the four populated source modules.
- Compare source records with the existing draft manuscript.
- Reconcile the earlier 15-candidate list against the imported 18 Screening Log records record by record.
- Confirm traceability and ensure unsupported content is flagged.
- Do not infer full database search totals or final PRISMA flow counts from candidate records.

### Milestone 5 — AI drafting and export
- Add section-level AI drafting with source-constrained prompts and traceable outputs.
- Add researcher-controlled regeneration.
- Add DOCX/PDF export after the manuscript data model is stable.

## 13. Non-negotiable safeguards

- No source-module mutation from manuscript editing.
- No fabricated citations, references, searches, counts, study characteristics or findings.
- No automatic overwriting of researcher-approved sections.
- No silent reconciliation of conflicting source records.
- No claim that AI output is verified merely because it was generated.
- No production deployment or production data/resource changes during staging work.
- Production rollout only after staging acceptance and explicit approval.

---

**Technical direction:** use the existing project/module architecture as the source integration boundary; add a dedicated, versioned manuscript domain for assembly and editing; preserve large-content storage outside the single project DynamoDB item; and validate the complete workflow in staging with Project 001.


## 14. Temporary retention, researcher export and cleanup

The Manuscript Development workspace is temporary by default. The initial retention policy is a maximum of **30 calendar days from workspace creation**, with a shorter period permitted by configuration. The expiry date must be visible to the researcher. The policy applies only to manuscript-development data and generated temporary files; it must never delete or modify the original project, research foundation, Literature and Evidence, Study Screening, Reference and Citation, or Methodology module data.

### 14.1 Export before expiry

Researchers must be able to export the manuscript during development and before expiry. The initial export formats are:

- **DOCX** — editable manuscript.
- **PDF** — formatted read-only copy.

The export should include the complete current manuscript, its approved section content, tables and figures with captions, in-text citations and reference list. Where applicable, the researcher may also include supplementary research materials and a validation/development report. Export must preserve source attribution and must not present unresolved or unverified information as verified. Export availability must not depend on the manuscript being approved; the UI should clearly distinguish draft exports from approved versions.

Exports should be generated on request and delivered for researcher download. The system should not treat an export left in temporary S3 storage as the researcher's permanent archive. The researcher is responsible for downloading and retaining their own copy.

### 14.2 Expiry and reminders

- Set `expires_at` when the manuscript workspace is created; default to 30 days after creation.
- Display the expiry date and remaining retention period in the workspace.
- Provide an in-app reminder before expiry (recommended: seven days and one day before expiry).
- Provide a researcher-controlled **Delete workspace now** action, with confirmation and a clear explanation that source research modules are not affected.
- At expiry, mark the workspace expired and prevent further editing/export from the expired workspace. Provide a clear expiry state rather than silently hiding the workspace.
- Cleanup must be idempotent and retryable; a partial failure must be recorded for safe retry.

### 14.3 Deletion scope and implementation

The cleanup operation must delete all temporary manuscript-domain DynamoDB items and all associated S3 objects. If S3 bucket versioning is enabled, cleanup must also remove noncurrent object versions and delete markers; deleting only the current object key is insufficient. A dedicated manuscript bucket/prefix must not share lifecycle rules with integrity submissions.

Use a scheduled cleanup worker for deterministic deletion and status reporting. DynamoDB TTL may be used as a secondary safety net, but must not be the only cleanup mechanism because TTL deletion is asynchronous. S3 lifecycle expiration may provide a secondary safeguard, scoped exclusively to manuscript objects. Retention metadata and cleanup status should make it possible to identify workspaces awaiting deletion and retry failures.

The cleanup service must be constrained to manuscript resources and must never delete source module records or project metadata. It must not delete the research project itself. A manual deletion request must follow the same scoped cleanup path.

### 14.4 Staging acceptance criteria

- Workspace expiry defaults to 30 days and is visible in the UI.
- DOCX and PDF exports can be generated and downloaded before expiry.
- Exported content includes the current manuscript sections, tables, figures, citations and references supported by the manuscript data.
- Pre-expiry reminders are presented to the researcher.
- Manual early deletion removes only manuscript workspace records and associated manuscript files.
- Expiry cleanup removes manuscript records and every associated S3 object version while preserving all source project modules and screening records.
- Cleanup can be safely retried without deleting unrelated data.
- Staging tests verify the expiry and cleanup workflow before any production consideration.


## 15. Staging infrastructure inspection results

Read-only inspection of the staging environment on 19 November 2026 established the following:

| Resource | Observed configuration | Design implication |
| --- | --- | --- |
| `onyitech-research-projects-staging` | ACTIVE, PAY_PER_REQUEST, partition key `id`, no sort key or GSI | Retain for existing project metadata and module storage; do not place the full manuscript history in one project item. |
| `onyitech-study-screening-staging` | ACTIVE, PAY_PER_REQUEST, partition key `project_id`, sort key `record_key` | Existing dedicated-record pattern is a suitable model for manuscript records. |
| `onyitech-integrity-submissions-staging` | ACTIVE, PAY_PER_REQUEST, partition key `owner_sub`, sort key `submission_id`, GSI `cleanup-index` on `cleanup_status` / `cleanup_at` | Keep separate; its cleanup-oriented schema is not the manuscript domain. |
| Integrity S3 bucket `onyitech-research-integrity-staging-530751149539` | AES256 default encryption; all four S3 Block Public Access settings enabled; bucket versioning returned no enabled status; no bucket lifecycle configuration | Do not reuse as the manuscript bucket. |

The staging Lambda role `onyitech-research-api-staging-role` has DynamoDB access to the project and integrity tables. Its integrity S3 object permissions are restricted to `arn:aws:s3:::onyitech-research-integrity-staging-530751149539/submissions/*` for GetObject, PutObject and DeleteObject. The role has separate access to the Study Screening table and Bedrock invocation. No manuscript-specific table or bucket permissions currently exist.

### 15.1 Proposed staging resources (not yet provisioned)

- DynamoDB table: `onyitech-manuscripts-staging`, PAY_PER_REQUEST, partition key `project_id` (String), sort key `record_key` (String).
- S3 bucket: `onyitech-manuscripts-staging-530751149539`, private, Block Public Access enabled, server-side encryption enabled. Configure retention/expiration only for this dedicated manuscript bucket and ensure cleanup removes object versions if versioning is enabled.
- Add narrowly scoped manuscript table and bucket permissions to the staging Lambda role only after resource creation is explicitly approved.

These names and settings are design proposals; the resources and IAM permissions have **not** been created or changed. The production environment remains untouched.

### 15.2 Staging deployment workflow

The current `.github/workflows/deploy-staging-lambda.yml` deploys to `onyitech-research-api-staging` for `main` and a fixed list of feature branches. The branch `feat/research-to-manuscript-engine` is not currently on that list. Before backend implementation is pushed for this feature, update the staging workflow on the feature branch so its backend changes can be deployed to the isolated staging Lambda. Do not add this feature to any production deployment workflow. A workflow change that triggers a staging deployment should be coordinated with the implementation so an unneeded baseline redeployment is avoided.
