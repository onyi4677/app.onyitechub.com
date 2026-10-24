"use client";

import { useEffect, useState } from "react";
import { getProjectModule, saveProjectModule } from "../../lib/api";

type MethodologyForm = {
  review_design: string;
  methodological_framework: string;
  review_question: string;
  pcc_population: string;
  pcc_concept: string;
  pcc_context: string;
  setting: string;
  eligibility_criteria: string;
  information_sources: string;
  search_strategy: string;
  selection_process: string;
  data_charting: string;
  synthesis_plan: string;
  ethics_and_dissemination: string;
  limitations: string;
  full_methodology_draft: string;
  status: string;
};

const fields: { key: keyof Omit<MethodologyForm, "status">; label: string; hint: string; rows: number }[] = [
  { key: "review_design", label: "Review design", hint: "State that this is a scoping review and briefly explain why the design fits the review aim.", rows: 3 },
  { key: "methodological_framework", label: "Methodological framework and reporting", hint: "For example, JBI scoping review methodology and PRISMA-ScR reporting.", rows: 3 },
  { key: "review_question", label: "Review question and objectives", hint: "Paste the main review question and the review objectives.", rows: 5 },
  { key: "pcc_population", label: "PCC — Population", hint: "Define eligible internally displaced persons, age groups, and mixed-population rules.", rows: 4 },
  { key: "pcc_concept", label: "PCC — Concept", hint: "Define trauma exposure, PTSD, resilience, and directly related psychosocial factors.", rows: 4 },
  { key: "pcc_context", label: "PCC — Context", hint: "Adamawa, Bauchi, Borno, Gombe, Taraba, and Yobe States, Nigeria.", rows: 4 },
  { key: "setting", label: "Review setting and geographical scope", hint: "Describe camps, host communities, temporary settlements, and other IDP settings in the six states.", rows: 4 },
  { key: "eligibility_criteria", label: "Inclusion and exclusion criteria", hint: "Include the 2020-to-final-search-date window, English-only restriction, eligible populations, concepts, settings, and evidence types.", rows: 8 },
  { key: "information_sources", label: "Information sources and databases", hint: "List databases, grey-literature sources, websites, and reference-list searching planned. Mark access that is not yet confirmed.", rows: 5 },
  { key: "search_strategy", label: "Search strategy", hint: "Record database-specific search strings, date searched, limits, and number of records retrieved. Do not enter results until the searches have actually been run.", rows: 7 },
  { key: "selection_process", label: "Study selection and screening", hint: "Describe deduplication, title/abstract screening, full-text assessment, reviewer arrangements, and recording exclusion reasons.", rows: 5 },
  { key: "data_charting", label: "Data charting / extraction", hint: "Specify the fields to collect: citation, year, state, population, design, setting, trauma, PTSD, resilience, measures, and key findings.", rows: 6 },
  { key: "synthesis_plan", label: "Evidence mapping and synthesis", hint: "Plan descriptive mapping and thematic synthesis. Do not call it a meta-analysis unless a separate quantitative synthesis is justified.", rows: 5 },
  { key: "ethics_and_dissemination", label: "Ethics and dissemination", hint: "Explain that the review uses existing sources and confirm any institutional ethics or exemption requirements, plus planned dissemination.", rows: 4 },
  { key: "limitations", label: "Anticipated limitations", hint: "Consider English-only sources, the 2020 date restriction, database coverage, and uneven evidence across states.", rows: 4 },
  { key: "full_methodology_draft", label: "Full methodology draft", hint: "Paste your complete methodology draft here if you want to keep a continuous version alongside the structured fields.", rows: 12 },
];

const emptyForm = (): MethodologyForm => ({
  review_design: "",
  methodological_framework: "",
  review_question: "",
  pcc_population: "",
  pcc_concept: "",
  pcc_context: "",
  setting: "",
  eligibility_criteria: "",
  information_sources: "",
  search_strategy: "",
  selection_process: "",
  data_charting: "",
  synthesis_plan: "",
  ethics_and_dissemination: "",
  limitations: "",
  full_methodology_draft: "",
  status: "draft",
});

function normalize(data: Record<string, unknown>): MethodologyForm {
  const base = emptyForm();
  const next = { ...base };
  (Object.keys(base) as (keyof MethodologyForm)[]).forEach((key) => {
    if (typeof data[key] === "string") next[key] = data[key] as string;
  });
  return next;
}

export default function ResearchDesignMethodologyEditor({
  projectId,
  moduleKey,
}: {
  projectId: string;
  moduleKey: string;
}) {
  const [form, setForm] = useState<MethodologyForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [screeningCounts, setScreeningCounts] = useState<{ records: number; screened: number; excluded: number; assessed: number; included: number; unresolved: number } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getProjectModule(projectId, moduleKey), getProjectModule(projectId, "study_screening")])
      .then(([result, screening]) => {
        if (!active) return;
        setForm(normalize(result.content || {}));
        const records = Array.isArray(screening.content?.records) ? screening.content.records as Record<string, unknown>[] : [];
        setScreeningCounts({
          records: records.length,
          screened: records.filter((r) => r.title_abstract_decision !== "not_screened").length,
          excluded: records.filter((r) => r.title_abstract_decision === "exclude").length,
          assessed: records.filter((r) => r.full_text_decision === "include" || r.full_text_decision === "exclude").length,
          included: records.filter((r) => r.full_text_decision === "include").length,
          unresolved: records.filter((r) => r.title_abstract_decision === "not_screened" || r.title_abstract_decision === "maybe" || (r.title_abstract_decision !== "exclude" && r.full_text_decision === "not_assessed")).length,
        });
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load the methodology module.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [projectId, moduleKey]);

  function update(key: keyof MethodologyForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  async function save(status: string) {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const result = await saveProjectModule(projectId, moduleKey, { ...form, status });
      setForm(normalize(result.content || { ...form, status }));
      setMessage(status === "complete" ? "Methodology marked complete and saved." : status === "review_required" ? "Methodology saved for review." : "Methodology saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card module-workspace"><p>Loading Research Design &amp; Methodology...</p></div>;

  return (
    <div className="module-editor">
      <div className="card editor-section">
        <div className="eyebrow">Scoping review workflow</div>
        <h3>Research Design &amp; Methodology</h3>
        <p className="muted">Use this workspace to draft and save the review protocol. This project maps existing literature; it is not a primary study recruiting participants.</p>
        <p className="muted">Geographical scope: Adamawa, Bauchi, Borno, Gombe, Taraba, and Yobe States. Provisional publication window: 1 January 2020 to the final search date. Language: English.</p>
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Linked screening outputs</div>
        <h3>Study-selection progress</h3>
        {screeningCounts && screeningCounts.records > 0 ? (
          <>
            <div className="statrow">
              <div className="stat"><span className="muted">Records in screening log</span><strong>{screeningCounts.records}</strong></div>
              <div className="stat"><span className="muted">Title/abstract screened</span><strong>{screeningCounts.screened}</strong></div>
              <div className="stat"><span className="muted">Full-text assessed</span><strong>{screeningCounts.assessed}</strong></div>
              <div className="stat"><span className="muted">Included reports</span><strong>{screeningCounts.included}</strong></div>
              <div className="stat"><span className="muted">Unresolved</span><strong>{screeningCounts.unresolved}</strong></div>
            </div>
            <p className="muted">These values are read from Study Screening, not manually re-entered. Treat the selection totals as provisional until unresolved records and search provenance are addressed.</p>
          </>
        ) : <p className="muted">No screening records are linked yet. Add source records and record screening decisions in the Study Screening module; the counts will appear here automatically.</p>}
      </div>

      {fields.map((field) => (
        <div className="card editor-section" key={field.key}>
          <div className="eyebrow">{field.label}</div>
          <label>
            {field.label}
            <textarea
              rows={field.rows}
              value={form[field.key]}
              onChange={(event) => update(field.key, event.target.value)}
              placeholder={field.hint}
            />
          </label>
          <p className="muted">{field.hint}</p>
        </div>
      ))}

      {error && <div className="notice">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <div className="editor-actions">
        <button className="button" type="button" disabled={saving} onClick={() => save("in_progress")}>{saving ? "Saving..." : "Save methodology"}</button>
        <button className="button secondary" type="button" disabled={saving} onClick={() => save("review_required")}>Save for review</button>
        <button className="button secondary" type="button" disabled={saving} onClick={() => save("complete")}>Mark complete</button>
      </div>
      <p className="muted">Save before leaving this page. After saving, refresh the page to confirm that the content reloads from the backend.</p>
    </div>
  );
}
