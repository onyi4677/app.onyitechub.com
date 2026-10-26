"use client";

import { useEffect, useMemo, useState } from "react";
import { getProjectModule, getProjectResearchSources, saveProjectModule, type CanonicalResearchSource } from "../../lib/api/modules";

type TADecision = "not_screened" | "include" | "exclude" | "maybe";
type FTDecision = "not_assessed" | "include" | "exclude" | "not_retrieved";
type Event = { stage: string; decision: string; reason: string; at: string };
type RecordItem = {
  screening_id: string; source_id: string; title_snapshot: string; citation_snapshot: string; protocol_snapshot: string;
  title_abstract_decision: TADecision; title_abstract_reason: string;
  full_text_decision: FTDecision; full_text_reason: string; retrieval_attempts: string[];
  notes: string; decision_history: Event[]; created_at: string; updated_at: string;
};
type ScreeningData = { records: RecordItem[]; protocol_version: string; updated_at?: string };
const stamp = () => new Date().toISOString();
const makeId = () => "screen-" + Date.now() + "-" + Math.random().toString(36).slice(2);
const reasons: Record<string, string> = {
  wrong_population: "Wrong population", wrong_concept: "Wrong concept", wrong_context: "Outside six-state context",
  wrong_date: "Outside publication date range", wrong_language: "Not English", ineligible_design: "Ineligible publication type/design",
  duplicate: "Duplicate report/record", insufficient_methods: "Insufficient methodological information",
  full_text_unavailable: "Full text unavailable after reasonable attempts", other: "Other (explain in notes)",
};
function normalize(value: unknown): RecordItem | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<RecordItem>;
  if (!r.screening_id || !r.source_id) return null;
  return { screening_id: r.screening_id, source_id: r.source_id, title_snapshot: r.title_snapshot || "",
    citation_snapshot: r.citation_snapshot || "", protocol_snapshot: r.protocol_snapshot || "", title_abstract_decision: r.title_abstract_decision || "not_screened",
    title_abstract_reason: r.title_abstract_reason || "", full_text_decision: r.full_text_decision || "not_assessed",
    full_text_reason: r.full_text_reason || "", retrieval_attempts: Array.isArray(r.retrieval_attempts) ? r.retrieval_attempts : [],
    notes: r.notes || "", decision_history: Array.isArray(r.decision_history) ? r.decision_history : [],
    created_at: r.created_at || stamp(), updated_at: r.updated_at || r.created_at || stamp() };
}

export default function StudyScreeningEditor({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<CanonicalResearchSource[]>([]);
  const [methodology, setMethodology] = useState<Record<string, unknown>>({});
  const [data, setData] = useState<ScreeningData>({ records: [], protocol_version: "1" });
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getProjectResearchSources(projectId), getProjectModule(projectId, "methodology")])
      .then(([registry, method]) => {
        if (!active) return;
        setSources(registry.sources || []);
        setMethodology(method.content || {});
        const raw = (method.content?.study_screening && typeof method.content.study_screening === "object" ? method.content.study_screening : {}) as Record<string, unknown>;
        setData({ records: Array.isArray(raw.records) ? raw.records.map(normalize).filter((r): r is RecordItem => Boolean(r)) : [],
          protocol_version: typeof raw.protocol_version === "string" ? raw.protocol_version : "1",
          updated_at: typeof raw.updated_at === "string" ? raw.updated_at : undefined });
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load screening records."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const linkedIds = useMemo(() => new Set(data.records.map((r) => r.source_id)), [data.records]);
  const counts = useMemo(() => {
    const r = data.records;
    return {
      identified: r.length,
      titleScreened: r.filter((x) => x.title_abstract_decision !== "not_screened").length,
      titleExcluded: r.filter((x) => x.title_abstract_decision === "exclude").length,
      sought: r.filter((x) => ["include", "maybe"].includes(x.title_abstract_decision) || x.full_text_decision !== "not_assessed").length,
      notRetrieved: r.filter((x) => x.full_text_decision === "not_retrieved").length,
      assessed: r.filter((x) => ["include", "exclude"].includes(x.full_text_decision)).length,
      fullExcluded: r.filter((x) => x.full_text_decision === "exclude").length,
      included: r.filter((x) => x.full_text_decision === "include").length,
      unresolved: r.filter((x) => x.title_abstract_decision === "not_screened" || x.title_abstract_decision === "maybe" || (x.title_abstract_decision !== "exclude" && x.full_text_decision === "not_assessed")).length,
    };
  }, [data.records]);

  function addSource() {
    const source = sources.find((s) => s.canonical_source_id === selected);
    if (!source || linkedIds.has(source.canonical_source_id)) return;
    const timestamp = stamp();
    const citation = [source.authors?.join(", "), source.year, source.title, source.journal_or_publisher, source.doi ? "DOI: " + source.doi : ""].filter(Boolean).join(". ");
    setData((current) => ({ ...current, records: [...current.records, {
      screening_id: makeId(), source_id: source.canonical_source_id, title_snapshot: source.title, citation_snapshot: citation,
      protocol_snapshot: [methodology.review_question, methodology.pcc_population, methodology.pcc_concept, methodology.pcc_context, methodology.eligibility_criteria].filter(Boolean).map(String).join("\n\n"),
      title_abstract_decision: "not_screened", title_abstract_reason: "", full_text_decision: "not_assessed",
      full_text_reason: "", retrieval_attempts: [], notes: "", decision_history: [], created_at: timestamp, updated_at: timestamp,
    }] }));
    setSelected(""); setMessage("");
  }

  function updateRecord(recordId: string, patch: Partial<RecordItem>) {
    setData((current) => ({ ...current, records: current.records.map((record) => {
      if (record.screening_id !== recordId) return record;
      const history = [...record.decision_history];
      if (patch.title_abstract_decision && patch.title_abstract_decision !== record.title_abstract_decision)
        history.push({ stage: "title_abstract", decision: patch.title_abstract_decision, reason: patch.title_abstract_reason ?? record.title_abstract_reason, at: stamp() });
      if (patch.full_text_decision && patch.full_text_decision !== record.full_text_decision)
        history.push({ stage: "full_text", decision: patch.full_text_decision, reason: patch.full_text_reason ?? record.full_text_reason, at: stamp() });
      if (patch.title_abstract_reason !== undefined && patch.title_abstract_reason !== record.title_abstract_reason && !patch.title_abstract_decision)
        history.push({ stage: "title_abstract", decision: record.title_abstract_decision, reason: patch.title_abstract_reason, at: stamp() });
      if (patch.full_text_reason !== undefined && patch.full_text_reason !== record.full_text_reason && !patch.full_text_decision)
        history.push({ stage: "full_text", decision: record.full_text_decision, reason: patch.full_text_reason, at: stamp() });
      return { ...record, ...patch, decision_history: history, updated_at: stamp() };
    }) }));
    setMessage("");
  }

  async function save() {
    const invalid = data.records.find((r) => (r.title_abstract_decision === "exclude" && !r.title_abstract_reason.trim()) || (r.full_text_decision === "exclude" && !r.full_text_reason.trim()));
    if (invalid) { setError("Choose an exclusion reason for: " + invalid.title_snapshot); return; }
    if (data.records.some((r) => r.full_text_decision === "not_retrieved" && r.retrieval_attempts.length === 0)) {
      setError("Record at least one full-text retrieval attempt for each paper marked not retrieved."); return;
    }
    const savedAt = stamp(); setSaving(true); setError(""); setMessage("");
    try {
      await saveProjectModule(projectId, "methodology", { study_screening: { ...data, updated_at: savedAt } });
      setData((current) => ({ ...current, updated_at: savedAt }));
      setMessage("Screening log saved. Counts are calculated from current decisions.");
    } catch (err) { setError(err instanceof Error ? err.message : "Screening log could not be saved."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="card module-workspace"><p>Loading Study Screening…</p></div>;

  return <div className="module-editor">
    <section className="card editor-section">
      <div className="eyebrow">Protocol-linked workflow</div><h3>Study Screening</h3>
      <p className="muted">Screen records from the unified project source registry. A work present in References &amp; Citations and Literature &amp; Evidence appears once, with existing evidence links preserved.</p>
      <div className="notice">
        <strong>Eligibility protocol summary</strong>
        <p><b>Population:</b> {String(methodology.pcc_population || "Not entered in Research Design & Methodology yet.")}</p>
        <p><b>Concept:</b> {String(methodology.pcc_concept || "Not entered in Research Design & Methodology yet.")}</p>
        <p><b>Context:</b> {String(methodology.pcc_context || "Not entered in Research Design & Methodology yet.")}</p>
        <p><b>Eligibility criteria:</b> {String(methodology.eligibility_criteria || "Add approved criteria in Research Design & Methodology.")}</p>
        <p className="muted">Protocol snapshot version: {data.protocol_version}. Existing decisions are not automatically rewritten when methodology text changes.</p>
      </div>
    </section>
    <section className="card editor-section">
      <div className="eyebrow">Reuse existing source records</div><h3>Add a record to screening</h3>
      {sources.length === 0 ? <p className="muted">No sources found. Add a work in References &amp; Citations or Literature &amp; Evidence first.</p> : <div className="form-grid">
        <label>Existing project source<select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Choose a source…</option>
          {sources.filter((s) => !linkedIds.has(s.canonical_source_id)).map((s) => <option key={s.canonical_source_id} value={s.canonical_source_id}>{s.year || "Year n/r"} — {s.title}{s.reference_ids.length && s.literature_source_ids.length ? " · linked across modules" : s.reference_ids.length ? " · reference library" : ""}</option>)}
        </select></label>
        <div style={{ display: "flex", alignItems: "end" }}><button className="button" type="button" disabled={!selected} onClick={addSource}>Add to screening</button></div>
      </div>}
    </section>
    <section className="card editor-section">
      <div className="eyebrow">Calculated summary · provisional while unresolved</div>
      <div className="statrow">
        <div className="stat"><span className="muted">Records linked</span><strong>{counts.identified}</strong></div>
        <div className="stat"><span className="muted">Title/abstract screened</span><strong>{counts.titleScreened}</strong></div>
        <div className="stat"><span className="muted">First-stage exclusions</span><strong>{counts.titleExcluded}</strong></div>
        <div className="stat"><span className="muted">Reports sought</span><strong>{counts.sought}</strong></div>
        <div className="stat"><span className="muted">Not retrieved</span><strong>{counts.notRetrieved}</strong></div>
        <div className="stat"><span className="muted">Full-text assessed</span><strong>{counts.assessed}</strong></div>
        <div className="stat"><span className="muted">Full-text exclusions</span><strong>{counts.fullExcluded}</strong></div>
        <div className="stat"><span className="muted">Included reports</span><strong>{counts.included}</strong></div>
        <div className="stat"><span className="muted">Unresolved</span><strong>{counts.unresolved}</strong></div>
      </div>
      <p className="muted">Counts cover only records entered here. Database searches, duplicate removal and distinct study-vs-report grouping are not yet recorded in this initial version.</p>
    </section>
    {data.records.map((record) => <section className="card editor-section" key={record.screening_id}>
      <div className="eyebrow">Screening record · {record.screening_id.slice(0, 8)}</div><h3>{record.title_snapshot}</h3><p className="muted">{record.citation_snapshot}</p>
      {record.protocol_snapshot && <details><summary>Eligibility protocol snapshot at record creation</summary><p>{record.protocol_snapshot}</p></details>}
      <label>Title/abstract decision<select value={record.title_abstract_decision} onChange={(e) => updateRecord(record.screening_id, { title_abstract_decision: e.target.value as TADecision })}>
        <option value="not_screened">Not screened</option><option value="include">Advance to full text</option><option value="maybe">Maybe / retrieve for assessment</option><option value="exclude">Exclude at title/abstract</option>
      </select></label>
      {record.title_abstract_decision === "exclude" && <label>Title/abstract exclusion reason<select value={record.title_abstract_reason} onChange={(e) => updateRecord(record.screening_id, { title_abstract_reason: e.target.value })}>
        <option value="">Choose reason…</option>{["wrong_population","wrong_concept","wrong_context","wrong_date","wrong_language","ineligible_design","duplicate","other"].map((r) => <option key={r} value={r}>{reasons[r]}</option>)}
      </select></label>}
      <label>Full-text decision<select value={record.full_text_decision} onChange={(e) => updateRecord(record.screening_id, { full_text_decision: e.target.value as FTDecision })}>
        <option value="not_assessed">Not yet assessed</option><option value="include">Include after full-text assessment</option><option value="exclude">Exclude after full-text assessment</option><option value="not_retrieved">Full text not retrieved</option>
      </select></label>
      {record.full_text_decision === "exclude" && <label>Full-text exclusion reason<select value={record.full_text_reason} onChange={(e) => updateRecord(record.screening_id, { full_text_reason: e.target.value })}>
        <option value="">Choose reason…</option>{["wrong_population","wrong_concept","wrong_context","wrong_date","wrong_language","ineligible_design","duplicate","insufficient_methods","other"].map((r) => <option key={r} value={r}>{reasons[r]}</option>)}
      </select></label>}
      {record.full_text_decision === "not_retrieved" && <div className="notice warning"><strong>Not included as a fully assessed study</strong>Record reasonable retrieval attempts below. Abstract-only details must remain distinct from verified full-text evidence.</div>}
      <label>Full-text retrieval attempts (one per line)<textarea rows={3} value={record.retrieval_attempts.join("\n")} onChange={(e) => updateRecord(record.screening_id, { retrieval_attempts: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean) })} placeholder="e.g. Checked repository; searched for an author manuscript; contacted author…" /></label>
      <label>Reviewer notes<textarea rows={3} value={record.notes} onChange={(e) => updateRecord(record.screening_id, { notes: e.target.value })} placeholder="Record rationale, uncertainty, or follow-up. Do not infer missing findings." /></label>
      {record.decision_history.length > 0 && <details><summary>Decision history ({record.decision_history.length})</summary><ul>{record.decision_history.map((event, i) => <li key={i}>{event.stage.replace("_", "/")} · {event.decision} · {event.reason || "No reason recorded"} · {event.at}</li>)}</ul></details>}
    </section>)}
    {error && <div className="notice warning">{error}</div>}{message && <div className="notice">{message}</div>}
    <div className="editor-actions"><button className="button primary" type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save screening log"}</button></div>
    <p className="muted">Decision history is stored with the record. Reviewer identity and immutable server-side audit events are not yet implemented, so this initial version is a working project log rather than a regulated audit trail.</p>
  </div>;
}
