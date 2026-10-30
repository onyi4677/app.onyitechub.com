"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api/client";

type Decision = "pending" | "include" | "exclude" | "uncertain";
type RecordItem = {
  record_id: string; title: string; authors: string[]; year?: number | null;
  doi?: string | null; url?: string | null; abstract?: string | null;
  source_database?: string | null; duplicate_status?: string; duplicate_of?: string | null;
  title_abstract_decision: Decision; title_abstract_reason?: string;
  full_text_status?: string; full_text_decision?: Decision;
  full_text_exclusion_reason?: string; full_text_url?: string;
  reviewer_decisions?: { reviewer: string; stage: string; decision: string; reason: string; decided_at: string }[];
  adjudication?: { reviewer: string; decision: string; reason: string } | null;
  notes?: string;
};
type SearchLog = { database: string; platform: string; search_date: string; strategy: string; records_retrieved: number | ""; notes: string };
type Workspace = {
  review_type: "scoping" | "systematic"; review_title: string; protocol_url: string;
  reporting_guideline: string; population: string; concept: string; context: string;
  inclusion_criteria: string; exclusion_criteria: string; reviewers: string;
  search_logs: SearchLog[]; records: RecordItem[]; workflow_status: string;
};
const empty: Workspace = {
  review_type: "scoping", review_title: "", protocol_url: "", reporting_guideline: "PRISMA-ScR",
  population: "", concept: "", context: "", inclusion_criteria: "", exclusion_criteria: "",
  reviewers: "", search_logs: [], records: [], workflow_status: "draft",
};
const blankLog = (): SearchLog => ({ database: "", platform: "", search_date: "", strategy: "", records_retrieved: "", notes: "" });
const blankRecord = (): RecordItem => ({ record_id: crypto.randomUUID(), title: "", authors: [], title_abstract_decision: "pending", full_text_status: "not_assessed", reviewer_decisions: [] });

function parseCsvLine(line: string): string[] {
  const values: string[] = []; let current = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"' && quoted) { current += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { values.push(current.trim()); current = ""; }
    else current += ch;
  }
  values.push(current.trim()); return values;
}

export default function ScreeningEditor({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Workspace>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [csv, setCsv] = useState("");
  const [newRecord, setNewRecord] = useState({ title: "", authors: "", year: "", doi: "", url: "", abstract: "", source_database: "" });
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});
  const [reviewerName, setReviewerName] = useState("Reviewer 1");
  const [adjudicatorName, setAdjudicatorName] = useState("Adjudicator");

  useEffect(() => {
    apiRequest<{content: Workspace}>(`/api/projects/${encodeURIComponent(projectId)}/modules/screening`)
      .then((r) => setData({ ...empty, ...(r.content || {}), records: r.content?.records || [], search_logs: r.content?.search_logs || [] }))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load screening workspace."))
      .finally(() => setLoading(false));
  }, [projectId]);

  const update = (key: keyof Workspace, value: unknown) => setData((old) => ({ ...old, [key]: value }));
  const guideline = data.review_type === "scoping" ? "PRISMA-ScR" : "PRISMA 2020";

  const counts = useMemo(() => {
    const records = data.records;
    const identified = data.search_logs.reduce((sum, log) => sum + (Number(log.records_retrieved) || 0), 0);
    const deduped = records.filter((r) => r.duplicate_status === "confirmed_duplicate").length;
    const unique = records.filter((r) => r.duplicate_status !== "confirmed_duplicate");
    const titleScreened = unique.filter((r) => r.title_abstract_decision !== "pending").length;
    const titleExcluded = unique.filter((r) => r.title_abstract_decision === "exclude").length;
    const reportsSought = unique.filter((r) => r.title_abstract_decision === "include").length;
    const reportsRetrieved = unique.filter((r) => r.title_abstract_decision === "include" && r.full_text_status === "retrieved").length;
    const fullAssessed = unique.filter((r) => r.full_text_decision === "include" || r.full_text_decision === "exclude").length;
    const fullExcluded = unique.filter((r) => r.full_text_decision === "exclude").length;
    const included = unique.filter((r) => r.full_text_decision === "include").length;
    return { identified, deduped, unique: unique.length, titleScreened, titleExcluded, reportsSought, reportsRetrieved, fullAssessed, fullExcluded, included, awaiting: unique.filter((r) => r.title_abstract_decision === "uncertain" || r.title_abstract_decision === "pending").length };
  }, [data.records, data.search_logs]);

  async function save(next = data) {
    setSaving(true); setMessage(""); setError("");
    try {
      await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/screening`, { method: "PUT", body: JSON.stringify({ content: { ...next, reporting_guideline: next.review_type === "scoping" ? "PRISMA-ScR" : "PRISMA 2020" } }) });
      setData({ ...next, reporting_guideline: next.review_type === "scoping" ? "PRISMA-ScR" : "PRISMA 2020" });
      setMessage("Screening workspace saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  function importCsv() {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) { setError("Paste a CSV header row and at least one record."); return; }
    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const get = (row: string[], names: string[]) => { const i = headers.findIndex((h) => names.includes(h)); return i >= 0 ? row[i] || "" : ""; };
    const additions = lines.slice(1).map((line) => {
      const row = parseCsvLine(line);
      return { ...blankRecord(), title: get(row, ["title", "article title"]), authors: get(row, ["authors", "author"]).split(/[;|]/).map((x) => x.trim()).filter(Boolean), year: Number(get(row, ["year"])) || null, doi: get(row, ["doi"]), url: get(row, ["url", "link"]), abstract: get(row, ["abstract"]), source_database: get(row, ["database", "source", "source_database"]) };
    }).filter((r) => r.title.trim());
    if (!additions.length) { setError("No rows with a title were found. Check that your CSV has a title column."); return; }
    const flagged = additions.map((record) => { const duplicate = data.records.find((existing) => (record.doi && existing.doi?.toLowerCase() === record.doi.toLowerCase()) || existing.title.trim().toLowerCase() === record.title.trim().toLowerCase()); return duplicate ? { ...record, duplicate_status: "possible_duplicate", duplicate_of: duplicate.record_id } : record; });
    update("records", [...data.records, ...flagged]);
    setCsv(""); setMessage(`Imported ${additions.length} record(s) into the workspace. Possible duplicates will be flagged when you save and review.`);
  }

  function addManualRecord() {
    if (!newRecord.title.trim()) { setError("A record title is required."); return; }
    const record = { ...blankRecord(), title: newRecord.title.trim(), authors: newRecord.authors.split(/[;|]/).map((x) => x.trim()).filter(Boolean), year: Number(newRecord.year) || null, doi: newRecord.doi.trim(), url: newRecord.url.trim(), abstract: newRecord.abstract.trim(), source_database: newRecord.source_database.trim() };
    const possible = data.records.some((r) => (record.doi && r.doi?.toLowerCase() === record.doi.toLowerCase()) || r.title.trim().toLowerCase() === record.title.toLowerCase());
    record.duplicate_status = possible ? "possible_duplicate" : "unique_unreviewed";
    update("records", [...data.records, record]); setNewRecord({ title: "", authors: "", year: "", doi: "", url: "", abstract: "", source_database: "" });
  }

  function decide(recordId: string, stage: "title_abstract" | "full_text", decision: Decision) {
    const reason = reasonDraft[`${recordId}:${stage}`] || "";
    if (decision === "exclude" && !reason.trim()) { setError("Record an exclusion reason before excluding a study."); return; }
    const records = data.records.map((r) => {
      if (r.record_id !== recordId) return r;
      const decisions = [...(r.reviewer_decisions || []), { reviewer: reviewerName.trim() || "Reviewer", stage, decision, reason, decided_at: new Date().toISOString() }];
      const sameStage = decisions.filter((item) => item.stage === stage);
      const distinct = [...new Set(sameStage.map((item) => item.decision))];
      const consensus = distinct.length === 1 ? distinct[0] as Decision : "uncertain";
      return stage === "title_abstract"
        ? { ...r, reviewer_decisions: decisions, title_abstract_decision: consensus, title_abstract_reason: decision === "exclude" ? reason : r.title_abstract_reason }
        : { ...r, reviewer_decisions: decisions, full_text_decision: consensus, full_text_exclusion_reason: decision === "exclude" ? reason : r.full_text_exclusion_reason };
    });
    update("records", records); setError("");
  }

  function adjudicate(recordId: string, stage: "title_abstract" | "full_text", decision: "include" | "exclude") {
    const reason = reasonDraft[`${recordId}:${stage}:adjudication`] || "";
    if (!reason.trim()) { setError("Record the adjudication rationale before resolving a disagreement."); return; }
    update("records", data.records.map((r) => {
      if (r.record_id !== recordId) return r;
      const adjudication = { reviewer: adjudicatorName.trim() || "Adjudicator", stage, decision, reason, decided_at: new Date().toISOString() };
      return stage === "title_abstract" ? { ...r, title_abstract_decision: decision, adjudication } : { ...r, full_text_decision: decision, adjudication };
    }));
    setError("");
  }

  function patchRecord(recordId: string, patch: Partial<RecordItem>) {
    update("records", data.records.map((r) => r.record_id === recordId ? { ...r, ...patch } : r));
  }

  const visible = data.records.filter((r) => filter === "all" || (filter === "pending" ? r.title_abstract_decision === "pending" : filter === "included" ? r.full_text_decision === "include" : filter === "excluded" ? r.title_abstract_decision === "exclude" || r.full_text_decision === "exclude" : r.duplicate_status === "possible_duplicate" || r.duplicate_status === "confirmed_duplicate"));

  if (loading) return <div className="card"><p>Loading Study Screening &amp; PRISMA...</p></div>;

  return <div className="module-editor">
    <div className="card editor-section">
      <div className="eyebrow">Review protocol</div><h3>Configure your review</h3>
      <label>Review type<select value={data.review_type} onChange={(e) => update("review_type", e.target.value as Workspace["review_type"])}><option value="scoping">Scoping review</option><option value="systematic">Systematic review</option></select></label>
      <p className="muted">Reporting pathway: <strong>{guideline}</strong>. Changing review type updates the reporting framework; it does not alter existing records or screening decisions.</p>
      <label>Review title<input value={data.review_title} onChange={(e) => update("review_title", e.target.value)} /></label>
      <label>Protocol registration URL (if applicable)<input value={data.protocol_url} onChange={(e) => update("protocol_url", e.target.value)} placeholder="Optional; do not enter a registration that has not been completed." /></label>
      <div className="form-grid">
        <label>Population<textarea rows={3} value={data.population} onChange={(e) => update("population", e.target.value)} /></label>
        <label>Concept<textarea rows={3} value={data.concept} onChange={(e) => update("concept", e.target.value)} /></label>
        <label>Context<textarea rows={3} value={data.context} onChange={(e) => update("context", e.target.value)} /></label>
      </div>
      <label>Inclusion criteria<textarea rows={4} value={data.inclusion_criteria} onChange={(e) => update("inclusion_criteria", e.target.value)} /></label>
      <label>Exclusion criteria<textarea rows={4} value={data.exclusion_criteria} onChange={(e) => update("exclusion_criteria", e.target.value)} /></label>
      <label>Reviewers and roles<input value={data.reviewers} onChange={(e) => update("reviewers", e.target.value)} placeholder="Record reviewer names/roles and how disagreements will be resolved." /></label>
      <div className="form-grid"><label>Current reviewer<input value={reviewerName} onChange={(e)=>setReviewerName(e.target.value)} /></label><label>Adjudicator<input value={adjudicatorName} onChange={(e)=>setAdjudicatorName(e.target.value)} /></label></div>
    </div>

    <div className="card editor-section">
      <div className="eyebrow">Search history</div><h3>Information sources and search logs</h3>
      <p className="muted">Enter counts only after a search has actually been run. The flow summary below uses these logged counts and your recorded decisions; it does not invent missing search history.</p>
      {data.search_logs.map((log, i) => <div className="variable-card" key={i}>
        <label>Database / source<input value={log.database} onChange={(e) => update("search_logs", data.search_logs.map((x,j)=>i===j?{...x,database:e.target.value}:x))} /></label>
        <label>Platform / interface<input value={log.platform} onChange={(e) => update("search_logs", data.search_logs.map((x,j)=>i===j?{...x,platform:e.target.value}:x))} /></label>
        <label>Date searched<input type="date" value={log.search_date} onChange={(e) => update("search_logs", data.search_logs.map((x,j)=>i===j?{...x,search_date:e.target.value}:x))} /></label>
        <label>Records retrieved<input type="number" min="0" value={log.records_retrieved} onChange={(e) => update("search_logs", data.search_logs.map((x,j)=>i===j?{...x,records_retrieved:e.target.value===""?"":Number(e.target.value)}:x))} /></label>
        <label>Search strategy<textarea rows={3} value={log.strategy} onChange={(e) => update("search_logs", data.search_logs.map((x,j)=>i===j?{...x,strategy:e.target.value}:x))} /></label>
        <label>Notes<textarea rows={2} value={log.notes} onChange={(e) => update("search_logs", data.search_logs.map((x,j)=>i===j?{...x,notes:e.target.value}:x))} /></label>
        <button className="button" type="button" onClick={() => update("search_logs", data.search_logs.filter((_,j)=>j!==i))}>Remove search log</button>
      </div>)}
      <button className="button" type="button" onClick={() => update("search_logs", [...data.search_logs, blankLog()])}>+ Add information source</button>
    </div>

    <div className="card editor-section">
      <div className="eyebrow">Record intake</div><h3>Import records using CSV</h3>
      <p className="muted">Accepted column headings include title, authors, year, doi, url/link, abstract, and database/source. CSV import adds records to the existing list; it does not replace it.</p>
      <textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'title,authors,year,doi,abstract,database\nExample study,"Smith; Jones",2024,10.xxxx/example,Abstract text,Scopus'} />
      <button className="button" type="button" onClick={importCsv}>Import CSV rows</button>
      <h3 style={{marginTop:24}}>Add a record manually</h3>
      <label>Title<input value={newRecord.title} onChange={(e)=>setNewRecord({...newRecord,title:e.target.value})}/></label>
      <div className="form-grid">
        <label>Authors<input value={newRecord.authors} onChange={(e)=>setNewRecord({...newRecord,authors:e.target.value})} placeholder="Separate with semicolons"/></label>
        <label>Year<input type="number" value={newRecord.year} onChange={(e)=>setNewRecord({...newRecord,year:e.target.value})}/></label>
        <label>DOI<input value={newRecord.doi} onChange={(e)=>setNewRecord({...newRecord,doi:e.target.value})}/></label>
        <label>URL<input value={newRecord.url} onChange={(e)=>setNewRecord({...newRecord,url:e.target.value})}/></label>
        <label>Database<input value={newRecord.source_database} onChange={(e)=>setNewRecord({...newRecord,source_database:e.target.value})}/></label>
      </div>
      <label>Abstract<textarea rows={3} value={newRecord.abstract} onChange={(e)=>setNewRecord({...newRecord,abstract:e.target.value})}/></label>
      <button className="button" type="button" onClick={addManualRecord}>Add record</button>
    </div>

    <div className="card editor-section">
      <div className="eyebrow">PRISMA flow summary</div><h3>Counts from recorded data</h3>
      <div className="statrow">
        {Object.entries({ "Records identified": counts.identified, "Records in workspace": data.records.length, "Confirmed duplicates": counts.deduped, "Records screened": counts.titleScreened, "Title/abstract exclusions": counts.titleExcluded, "Reports sought": counts.reportsSought, "Full texts retrieved": counts.reportsRetrieved, "Full texts assessed": counts.fullAssessed, "Full-text exclusions": counts.fullExcluded, "Studies included": counts.included, "Pending / uncertain": counts.awaiting }).map(([label,value])=><div className="card stat" key={label}><span className="muted">{label}</span><strong>{value}</strong></div>)}
      </div>
      <p className="muted">These are live workspace counts, not a finalized PRISMA diagram. Records identified are derived from search logs; workspace totals can differ until all imported records are accounted for. Confirm duplicate status and full-text retrieval before reporting final flow numbers.</p>
    </div>

    <div className="card editor-section">
      <div className="pagehead"><div><div className="eyebrow">Screening decisions</div><h3>Study records ({visible.length} shown / {data.records.length} total)</h3></div>
        <select value={filter} onChange={(e)=>setFilter(e.target.value)}><option value="all">All records</option><option value="pending">Pending title/abstract</option><option value="included">Included at full text</option><option value="excluded">Excluded</option><option value="duplicates">Possible / confirmed duplicates</option></select>
      </div>
      {visible.map((record) => <div className="card editor-section" key={record.record_id}>
        <div className="eyebrow">{record.source_database || "Source not recorded"} · {record.year || "Year not recorded"} · {record.record_id.slice(0,8)}</div>
        <h3>{record.title}</h3><p className="muted">{record.authors.join("; ")} {record.doi ? "· DOI: "+record.doi : ""}</p>
        {record.abstract && <p>{record.abstract}</p>}
        {record.duplicate_status?.includes("duplicate") && <div className="notice warning">Possible duplicate. Compare bibliographic details before confirming. The record has not been deleted.</div>}
        {record.duplicate_status === "possible_duplicate" && <div className="editor-actions">
          <button className="button" type="button" onClick={()=>patchRecord(record.record_id,{duplicate_status:"confirmed_duplicate"})}>Confirm duplicate</button>
          <button className="button" type="button" onClick={()=>patchRecord(record.record_id,{duplicate_status:"not_duplicate",duplicate_of:null})}>Not a duplicate</button>
        </div>}
        <label>Title / abstract exclusion reason (required to exclude)<input value={reasonDraft[record.record_id+":title_abstract"] || record.title_abstract_reason || ""} onChange={(e)=>setReasonDraft({...reasonDraft,[record.record_id+":title_abstract"]:e.target.value})}/></label>
        <div className="editor-actions">
          {(["include","exclude","uncertain"] as Decision[]).map((decision)=><button key={decision} className="button" type="button" onClick={()=>decide(record.record_id,"title_abstract",decision)}>{decision==="include"?"Include":decision==="exclude"?"Exclude":"Uncertain"}</button>)}
          <span className="badge">Title/abstract consensus: {record.title_abstract_decision}</span>
        </div>
        {record.title_abstract_decision === "include" && <>
          <label>Full-text URL<input value={record.full_text_url || ""} onChange={(e)=>patchRecord(record.record_id,{full_text_url:e.target.value})}/></label>
          <label>Full-text retrieval status<select value={record.full_text_status || "not_assessed"} onChange={(e)=>patchRecord(record.record_id,{full_text_status:e.target.value})}><option value="not_assessed">Not assessed</option><option value="retrieved">Retrieved</option><option value="not_retrieved">Not retrieved</option></select></label>
          <label>Full-text exclusion reason (required to exclude)<input value={reasonDraft[record.record_id+":full_text"] || record.full_text_exclusion_reason || ""} onChange={(e)=>setReasonDraft({...reasonDraft,[record.record_id+":full_text"]:e.target.value})}/></label>
          <div className="editor-actions">
            {(["include","exclude","uncertain"] as Decision[]).map((decision)=><button key={decision} className="button" type="button" onClick={()=>decide(record.record_id,"full_text",decision)}>{decision==="include"?"Include study":decision==="exclude"?"Exclude at full text":"Defer"}</button>)}
            <span className="badge">Full-text consensus: {record.full_text_decision || "pending"}</span>
          </div>
        </>}
        <label>Screening notes<textarea rows={2} value={record.notes || ""} onChange={(e)=>patchRecord(record.record_id,{notes:e.target.value})}/></label>
      </div>)}
      {visible.length === 0 && <div className="notice">No records match this filter.</div>}
    </div>

    {error && <div className="notice warning">{error}</div>}{message && <div className="notice">{message}</div>}
    <div className="editor-actions">
      <button className="button primary" type="button" disabled={saving} onClick={()=>save()}>{saving?"Saving...":"Save screening workspace"}</button>
    </div>
  </div>;
}
