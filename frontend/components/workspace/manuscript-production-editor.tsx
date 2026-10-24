"use client";

import { useEffect, useMemo, useState } from "react";
import { getProjectModule, saveProjectModule } from "../../lib/api/modules";

type ScreeningRecord = { source_id: string; title_snapshot: string; citation_snapshot: string; full_text_decision: string; title_abstract_decision: string };
type ScreeningCounts = { identified: number; titleScreened: number; titleExcluded: number; sought: number; notRetrieved: number; assessed: number; fullExcluded: number; included: number; unresolved: number };
function summarize(records: ScreeningRecord[]): ScreeningCounts {
  return {
    identified: records.length,
    titleScreened: records.filter((r) => r.title_abstract_decision !== "not_screened").length,
    titleExcluded: records.filter((r) => r.title_abstract_decision === "exclude").length,
    sought: records.filter((r) => ["include", "maybe"].includes(r.title_abstract_decision) || r.full_text_decision !== "not_assessed").length,
    notRetrieved: records.filter((r) => r.full_text_decision === "not_retrieved").length,
    assessed: records.filter((r) => ["include", "exclude"].includes(r.full_text_decision)).length,
    fullExcluded: records.filter((r) => r.full_text_decision === "exclude").length,
    included: records.filter((r) => r.full_text_decision === "include").length,
    unresolved: records.filter((r) => r.title_abstract_decision === "not_screened" || r.title_abstract_decision === "maybe" || r.full_text_decision === "not_assessed").length,
  };
}
function makeNarrative(c: ScreeningCounts) {
  return "The screening log currently contains " + c.identified + " linked records. " + c.titleScreened +
    " records have a title/abstract decision, and " + c.titleExcluded + " were excluded at that stage. Full-text reports were sought for " +
    c.sought + " records; " + c.notRetrieved + " reports are marked as not retrieved. " + c.assessed +
    " reports have a recorded full-text eligibility decision, including " + c.fullExcluded + " full-text exclusions. " +
    c.included + " reports are currently marked as included. " +
    "These counts describe only records entered in the Onyitech Study Screening log; they are provisional while " + c.unresolved +
    " records remain unresolved and do not by themselves establish that every planned database was searched.";
}

export default function ManuscriptProductionEditor({ projectId }: { projectId: string }) {
  const [records, setRecords] = useState<ScreeningRecord[]>([]);
  const [savedDraft, setSavedDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getProjectModule(projectId, "study_screening"), getProjectModule(projectId, "manuscript")])
      .then(([screening, manuscript]) => {
        if (!active) return;
        const raw = screening.content || {};
        setRecords(Array.isArray(raw.records) ? raw.records as ScreeningRecord[] : []);
        const manuscriptData = manuscript.content || {};
        setSavedDraft(typeof manuscriptData.study_selection_narrative === "string" ? manuscriptData.study_selection_narrative : "");
        setNotes(typeof manuscriptData.manuscript_notes === "string" ? manuscriptData.manuscript_notes : "");
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load manuscript inputs."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const counts = useMemo(() => summarize(records), [records]);
  const generatedNarrative = useMemo(() => makeNarrative(counts), [counts]);
  const included = records.filter((r) => r.full_text_decision === "include");

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      await saveProjectModule(projectId, "manuscript", {
        study_selection_narrative: savedDraft || generatedNarrative,
        manuscript_notes: notes,
        screening_snapshot: counts,
        updated_at: new Date().toISOString(),
      });
      if (!savedDraft) setSavedDraft(generatedNarrative);
      setMessage("Manuscript inputs saved. The selection narrative is editable and reflects the current screening snapshot.");
    } catch (err) { setError(err instanceof Error ? err.message : "Manuscript inputs could not be saved."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="card module-workspace"><p>Loading manuscript inputs…</p></div>;

  return <div className="module-editor">
    <section className="card editor-section">
      <div className="eyebrow">Connected research outputs</div><h3>Manuscript Production</h3>
      <p className="muted">This first implementation connects the screening log to a manuscript-ready study-selection draft. It does not invent results, findings, citations, or database searches.</p>
      <div className="statrow">
        <div className="stat"><span className="muted">Linked records</span><strong>{counts.identified}</strong></div>
        <div className="stat"><span className="muted">Full-text reports assessed</span><strong>{counts.assessed}</strong></div>
        <div className="stat"><span className="muted">Currently included</span><strong>{counts.included}</strong></div>
      </div>
    </section>
    <section className="card editor-section">
      <div className="eyebrow">Methods · study selection</div><h3>Editable selection narrative</h3>
      <p className="muted">Generated from current screening decisions. Review and edit it before including it in a manuscript; the text limits its claims to records entered in this workspace.</p>
      <textarea rows={8} value={savedDraft || generatedNarrative} onChange={(e) => setSavedDraft(e.target.value)} />
      <button className="button" type="button" onClick={() => setSavedDraft(generatedNarrative)}>Refresh from screening counts</button>
    </section>
    <section className="card editor-section">
      <div className="eyebrow">Included-study set</div><h3>Reports currently marked included ({included.length})</h3>
      {included.length === 0 ? <p className="muted">No reports are currently marked included after full-text assessment.</p> :
        <ul>{included.map((r, i) => <li key={r.source_id || i}><strong>{r.title_snapshot}</strong><br /><span className="muted">{r.citation_snapshot}</span></li>)}</ul>}
    </section>
    <section className="card editor-section">
      <div className="eyebrow">Manuscript workspace</div><h3>Author notes and next sections</h3>
      <label>Draft notes<textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add verified methods details, extraction notes, or manuscript tasks. Keep claims linked to verified evidence." /></label>
    </section>
    {error && <div className="notice warning">{error}</div>}{message && <div className="notice">{message}</div>}
    <div className="editor-actions"><button className="button primary" disabled={saving} type="button" onClick={save}>{saving ? "Saving…" : "Save manuscript inputs"}</button></div>
    <p className="muted">The included-study list is derived from final screening decisions. Full evidence synthesis and complete manuscript section generation remain separate work.</p>
  </div>;
}
