# Research-to-Manuscript Engine

## 1. Purpose

The Research-to-Manuscript Engine is a reusable capability within **Onyitech Research Workspace**. It connects the structured work researchers complete across project modules and helps transform that work into a coherent, evidence-traceable scholarly manuscript.

It is not simply an AI writing page and it is not a collection of independent module exports. It is a central workflow that brings a project's saved research materials together for validation, organisation, drafting, review and manuscript assembly.

**Core principle:** researchers should not have to manually transfer information from one research module into a separate document. The workspace should help transform their organised research activities into a manuscript while keeping the researcher in control.

## 2. Product goals

The engine should:

1. Connect to the existing research modules belonging to the same project.
2. Assemble a unified manuscript from the project's saved research materials.
3. Identify missing, conflicting, duplicated or insufficiently verified information before it is used.
4. Map source records to manuscript sections, tables and figures.
5. Support multiple scholarly article types through reusable templates.
6. Assist with drafting while preserving evidence and citation traceability.
7. Let researchers edit, approve, reject and regenerate individual sections.
8. Preserve manuscript versions and the source state used for each assembly.
9. Support later export to editable DOCX and PDF, and journal-specific formatting.

## 3. Architectural principles

### 3.1 One project, one connected workflow

All source modules and the manuscript belong to the same research project. The manuscript workflow reads from the project's modules rather than asking researchers to export and re-upload each module.

### 3.2 One unified manuscript

The engine maintains one manuscript workspace containing its sections, tables, figures and references. Individual research modules remain available as structured source material; they are not replaced by manuscript documents.

### 3.3 Preserve source data

The engine must not silently modify source-module records when a researcher edits manuscript text. Corrections to source evidence should be made in the appropriate research module. A subsequent assembly can then incorporate the updated source state.

### 3.4 Researcher authority

AI may help organise, summarise and draft material, but it must not make unsupported research decisions or present suggestions as verified findings. Researchers retain responsibility for validating and approving manuscript content.

### 3.5 Evidence traceability

Where possible, generated statements, tables and references should retain links to the source records and module data that support them. The system should make unsupported or unlinked content visible for review.

### 3.6 Reusable by design

The engine must support future projects and different researchers. Project-specific rules, such as the scoping-review workflow used for Project 001, must not be hard-coded as the only manuscript workflow.

## 4. Source modules

The initial integration should use the existing modules in Onyitech Research Workspace:

- **Literature and Evidence** — literature records, evidence notes and relevant source material.
- **Study Screening** — screening decisions, study records, extraction entries and source-verification information.
- **Reference and Citation** — bibliographic records, in-text citation information and reference verification.
- **Research Design and Methodology** — research questions, design, methods, population, sampling, instruments, procedures and related methodological information.

The engine should obtain each module through its supported project/module service or API. It must respect the separate storage implementation used by Study Screening rather than assuming that every module is stored in the same database table.

Additional modules may be connected in future as the workspace grows.

## 5. Manuscript assembly workflow

The proposed workflow has the following stages.

### Stage 1 — Select article type

The researcher selects or confirms the type of manuscript. The selection determines the suggested section structure, reporting guidance and required materials.

### Stage 2 — Collect project materials

The engine retrieves the latest saved information from the relevant modules for the selected project. It records which module data and versions were used.

### Stage 3 — Validate and reconcile

Before drafting, the engine checks for:

- Missing information required by the selected article type.
- Conflicting project details or study decisions.
- Duplicate or potentially overlapping records.
- References that are incomplete or not verified.
- Claims, figures or tables without an identifiable source.
- Information that is provisional, pending or unsupported.

The engine should present these issues to the researcher. It must not silently resolve material discrepancies.

### Stage 4 — Map materials to the manuscript

The engine maps available source materials to appropriate manuscript sections, tables and figures. It identifies which content is ready to use, which requires researcher input and which requires further verification.

### Stage 5 — Draft and assemble

The engine assists with drafting individual sections using the mapped project materials. It assembles those sections into one coherent manuscript and maintains links to supporting records.

### Stage 6 — Researcher review and approval

Researchers can edit, approve, reject or request regeneration of individual sections. Changes and approval states should be retained. Regenerating one section should not unexpectedly overwrite unrelated approved sections.

### Stage 7 — Final checks and export

The engine checks manuscript completeness, internal consistency, citations, references, tables and figures. Export and journal-formatting capabilities can be introduced after the core assembly workflow is reliable.

## 6. Reusable article templates

The engine should support reusable templates rather than assume every project is a scoping review.

Initial template types may include:

| Article type | Typical manuscript components |
| --- | --- |
| Original empirical research | Abstract, Introduction, Methods, Results, Discussion, Conclusion |
| Scoping review | Abstract, Introduction, Methods, Results, Discussion, Conclusion; scoping-review reporting materials |
| Systematic review | Abstract, Introduction, Methods, Results, Discussion, Conclusion; systematic-review reporting materials |
| Narrative review | Abstract, Introduction, thematic synthesis, Discussion, Conclusion |
| Research protocol | Abstract, Background, Objectives, Methods, Ethics and dissemination |
| Case study | Abstract, Background, Case presentation, Analysis or intervention, Discussion, Conclusion |

These are starting structures, not rigid rules. Researchers must be able to adapt sections to the requirements of their target journal and discipline. Templates should define section metadata and guidance, not impose content that the source materials cannot support.

## 7. Research Materials and Tables

A dedicated part of Manuscript Assemblage should organise research materials and manuscript tables. Depending on article type, this may include:

- Information sources and literature/database search register.
- Search strategies, search dates, filters and retrieved-record counts.
- Eligibility criteria and frameworks such as PCC or PICO.
- Study-selection and screening reconciliation.
- Characteristics of included studies.
- Evidence extraction and synthesis tables.
- Reference-verification tables.
- Reporting-flow information and figures, where applicable.

Every table should be linked to its underlying records where possible. Researchers should be able to review and correct table content without losing its connection to the source data.

The engine must distinguish between:

- Verified information.
- Researcher-entered information that has not yet been independently verified.
- AI-generated suggestions.
- Missing information.
- Conflicting or provisional information.

**No fabricated research details:** the engine must never invent database searches, search dates, query strings, result counts, screening decisions, study characteristics, sample sizes, statistical results, citations or references. Missing details must be shown as missing and routed for researcher action.

## 8. Manuscript and source versioning

Each assembly should retain a record of the source-module state used to produce it. A manuscript version should be identifiable and reproducible from its recorded source snapshot and assembly configuration.

At minimum, the design should account for:

- Project identifier.
- Manuscript identifier and version.
- Article type and selected template version.
- Source-module snapshot or source record/version references.
- Manuscript sections and their content.
- Section review and approval states.
- Creation and update timestamps.
- Relevant validation warnings and unresolved issues.

The exact storage schema and snapshot strategy are to be established during technical design.

When source modules change, the system should indicate that the manuscript may be out of date and allow the researcher to assemble a new version. It should not silently rewrite an already approved manuscript.

## 9. Project 001: first implementation and validation case

Project 001 will be the first real project used to validate the engine:

**Trauma Exposure, Resilience, and Post-Traumatic Stress Disorder Among Internally Displaced Persons in North-East Nigeria: A Scoping Review.**

The project already has populated Literature and Evidence, Study Screening, Reference and Citation, and Research Design and Methodology modules. An earlier AI-generated manuscript, **Project_001_Manuscript_Optimized.docx**, is also available as an existing draft to assess and reconcile with the live project materials.

The first assembly should:

1. Read the four populated modules.
2. Inspect the existing manuscript as a draft, not as unquestioned ground truth.
3. Map its sections and tables against the live module records.
4. Identify content supported by current project records.
5. Identify content requiring further searches, source verification or researcher input.
6. Reconcile differences between the earlier manuscript's 15 candidate records and the later imported Screening Log's 18 study records.
7. Avoid treating candidate-list counts as final database-search or PRISMA flow counts.
8. Generate a source-linked manuscript draft and a clear list of unresolved issues.

The 15-versus-18 difference must be investigated record by record. The engine must not automatically discard, add or overwrite records to force the counts to match.

Project 001 is a validation case, not a template that limits the engine to scoping reviews.

## 10. Proposed development phases

### Phase 1 — Manuscript Assemblage Foundation

- Define the manuscript data model and lifecycle.
- Define article-type and template configuration.
- Define source-module integration contracts.
- Define source snapshots and versioning.
- Define manuscript sections, tables, figures and references.
- Define validation and traceability requirements.

### Phase 2 — Staging backend integration

- Implement manuscript-specific backend services and API endpoints.
- Read the existing project modules through their correct storage paths.
- Add source mapping, validation and reconciliation.
- Persist manuscript drafts, section states and version metadata.
- Add automated tests for module integration and data integrity.

### Phase 3 — Staging frontend workflow

- Add Manuscript Assemblage to the existing Research Workspace.
- Provide article-type selection and source-readiness overview.
- Display validation warnings and missing information.
- Provide a unified section editor and table review workflow.
- Support researcher approval and controlled regeneration.

### Phase 4 — Project 001 validation

- Connect the four populated modules.
- Reconcile the existing manuscript with live project records.
- Test section drafting and table generation.
- Verify citations and source traceability.
- Test edits, approvals, source changes and new manuscript versions.
- Record defects and improve reusable templates.

### Phase 5 — Export and journal readiness

- Add DOCX and PDF export.
- Add configurable journal formatting.
- Add final manuscript quality and completeness checks.
- Evaluate additional article types and researcher workflows.

### Phase 6 — Production rollout

Production deployment should happen only after staging tests and researcher acceptance, with an explicit production rollout decision.

## 11. Initial acceptance criteria

The foundation should not be considered complete until:

- A researcher can create or open a manuscript within an existing project.
- The engine can retrieve the four initial source modules correctly, including Study Screening's separate storage.
- The researcher can select an article type and use an appropriate reusable structure.
- The engine can report missing, conflicting and provisional source information before drafting.
- Manuscript sections and tables can be mapped to source records.
- Generated content does not invent unsupported research details.
- Editing manuscript content does not mutate source-module records.
- Researchers can review and approve sections independently.
- A manuscript version retains the source state used to create it.
- Changes in source modules do not silently overwrite an existing manuscript.
- Automated tests cover the core integration and data-integrity behaviour.
- Project 001 can be used to validate the workflow in staging.

## 12. Development and deployment policy

All implementation begins in a feature branch from the current main branch. Backend and frontend changes are deployed to staging or a Vercel preview for testing. Project 001 is used for initial validation.

No production resources, production data or production deployment should be changed as part of staging development. Production rollout requires successful staging validation and explicit approval.

## 13. Out of scope for the initial foundation

The first milestone is the reusable assembly foundation. It does not need to deliver every future capability immediately.

The following can be developed in later phases:

- Full journal-specific formatting for many publishers.
- Advanced reference-manager integrations.
- Automated discovery and retrieval of full-text articles.
- Advanced statistical analysis or meta-analysis.
- Direct journal submission.
- Automatic claims of research validity or publication readiness.

The engine must remain an authoring and research-organisation aid. It must not claim to certify research quality, guarantee publication, or replace researcher judgement.

---

**Product definition:** Onyitech Research-to-Manuscript Engine connects structured research modules and transforms their verified, researcher-reviewed contents into a unified, traceable and editable scholarly manuscript.
