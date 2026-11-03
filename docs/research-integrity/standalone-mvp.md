# Research Integrity & Quality — Standalone MVP

## Product decision

The first release is a standalone manuscript-assessment service for authenticated editors and researchers. A user can submit one manuscript without creating a Workspace research project. Full-project assessment is a later extension that reuses the same assessment engine.

Study Screening remains a separate module and is outside this feature.

## MVP user journey

1. An authenticated Cognito user opens Research Integrity & Quality.
2. The user uploads one DOCX or PDF manuscript and confirms they have permission to submit it.
3. The service creates a private submission owned by the authenticated Cognito subject.
4. The service extracts text and runs deterministic checks before any model call.
5. The user explicitly starts an AI-assisted assessment. The assessment is limited to the selected manuscript and a bounded token budget.
6. The service stores a structured report and displays findings grouped by severity and verification status.
7. The user can download the report and delete the submission.

## Initial assessment scope

- Manuscript structure and section completeness.
- Alignment between title, aim/objectives, research questions, methods and reported results where those elements are present.
- Methodological clarity and internal consistency.
- Citation/reference consistency and suspicious or incomplete DOI/reference metadata.
- Unsupported claims, unclear attribution and statistical-reporting issues that require human verification.
- Transparency, ethics, limitations and reporting completeness.

Every finding must quote or identify the relevant manuscript location where possible. The report must distinguish:
- deterministic checks (directly observed by software),
- AI-assisted concerns (interpretive suggestions),
- items requiring author/editor verification.

The system must not invent sources, DOIs, quotations, study findings, sample sizes, statistical values or methods. It must not present a suspected issue as proven misconduct.

## Explicit limitations

This MVP is not a substitute for peer review and does not claim iThenticate-equivalent plagiarism detection. An isolated manuscript cannot establish textual originality against an external corpus. Similarity detection would require a separately licensed or lawfully available comparison corpus/service.

PDF extraction may be incomplete for scanned or image-only documents. Such submissions must be marked as requiring OCR or a text-readable source; the system must not pretend that an empty extraction is a complete assessment.

## Data and security boundary

- Standalone submissions are not research projects and must not be written into the existing `onyitech-research-projects` project records.
- Submission metadata and assessment results use a dedicated data store/table.
- Original documents use a private S3 bucket with encryption at rest, blocked public access, and short-lived presigned upload/download URLs.
- Every read, write, assessment and deletion is scoped to the authenticated Cognito subject. Unknown or another user's submission should return 404.
- Do not log manuscript text, extracted text, access tokens, presigned URLs or model prompts.
- Define retention and deletion behavior before external editor launch.
- Existing project ownership logic, project module storage, and Study Screening backward compatibility must remain unchanged.

## Cost and model controls

- Run deterministic checks before calling Bedrock.
- Require an explicit user action to start AI assessment.
- Use Amazon Nova 2 Lite in the configured AWS region, with a strict input and output token ceiling.
- Extract and analyze bounded sections rather than repeatedly sending the full document.
- Persist a result against a document version/hash so an unchanged file is not billed again unless the user explicitly requests a rerun.
- Show assessment scope and usage estimate/limit before execution.
- Add per-user rate limits and a configurable hard usage ceiling.
- Do not introduce queues, OCR, external similarity vendors or additional paid services in the first release unless testing demonstrates they are necessary.

## Delivery sequence

1. Establish isolated submission storage, upload validation and authenticated submission lifecycle.
2. Add DOCX/PDF text extraction and deterministic checks with tests.
3. Add the bounded Nova 2 Lite assessment and structured report validation.
4. Build the standalone editor UI and report download.
5. Test ownership isolation, malformed/oversized files, empty/scanned PDFs, model failures, duplicate runs and deletion.
6. Only after the standalone path is stable, add optional cross-module project assessment.

## Release gate

Do not deploy or merge until backend tests, frontend production build, security/ownership tests, and a controlled end-to-end test pass. Do not change existing project data or existing module persistence as part of this feature.
