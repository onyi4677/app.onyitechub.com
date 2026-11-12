"use client";

import { useEffect, useMemo, useState } from "react";
import { createProjectLiteratureSource, getProjectModule, getProjectResearchSources, saveProjectModule, type CanonicalResearchSource } from "../../lib/api/modules";
import StudyScreeningExcelImport from "./study-screening-excel-import";
import type { ScreeningWorkbook } from "./study-screening-xlsx";

type TADecision = "not_screened" | "include" | "exclude" | "maybe";
type FTDecision = "not_assessed" | "include" | "exclude" | "not_retrieved";
type ReviewType = "scoping" | "systematic";
type Event = { stage: string; decision: string; reason: string; at: string };
type RecordItem = {
  screening_id: string; source_id: string; title_snapshot: string; citation_snapshot: string; protocol_snapshot: string;
  title_abstract_decision: TADecision; title_abstract_reason: string;
  full_text_decision: FTDecision; full_text_reason: string; retrieval_attempts: string[];
  notes: string; decision_history: Event[]; created_at: string; updated_at: string;
  imported_metadata?: Record<string, string>;
};
type SearchProvenance = { source: string; searched_at: string; query: string; records_found: number | null; notes: string };
type ScreeningData = {
  review_type: ReviewType;
  protocol_version: string;
  duplicates_removed: number;
  search_provenance: SearchProvenance[];
  records: RecordItem[];
  evidence_extractions: Record<string, string>[];
  source_verifications: Record<string, string>[];
  import_batches: { filename: string; imported_at: string; screening_rows: number; evidence_rows: number; verification_rows: number; skipped_duplicates: number }[];
  updated_at?: string;
};
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
    created_at: r.created_at || stamp(), updated_at: r.updated_at || r.created_at || stamp(), imported_metadata: r.imported_metadata && typeof r.imported_metadata === "object" ? r.imported_metadata : undefined };
}

export default function StudyScreeningEditor({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<CanonicalResearchSource[]>([]);
  const [methodology, setMethodology] = useState<Record<string, unknown>>({});
  const [data, setData] = useState<ScreeningData>({ review_type: "scoping", protocol_version: "1", duplicates_removed: 0, search_provenance: [], records: [], evidence_extractions: [], source_verifications: [], import_batches: [] });
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getProjectResearchSources(projectId), getProjectModule(projectId, "methodology"), getProjectModule(projectId, "study_screening")])
      .then(([registry, method, screening]) => {
        if (!active) return;
        setSources(registry.sources || []);
        setMethodology(method.content || {});
        const raw = (screening.content && typeof screening.content === "object" ? screening.content : {}) as Record<string, unknown>;
        setData({ review_type: raw.review_type === "systematic" ? "systematic" : "scoping",
          protocol_version: typeof raw.protocol_version === "string" ? raw.protocol_version : "1",
          duplicates_removed: typeof raw.duplicates_removed === "number" && raw.duplicates_removed >= 0 ? raw.duplicates_removed : 0,
          search_provenance: Array.isArray(raw.search_provenance) ? raw.search_provenance as SearchProvenance[] : [],
          records: Array.isArray(raw.records) ? raw.records.map(normalize).filter((r): r is RecordItem => Boolean(r)) : [],
          evidence_extractions: Array.isArray(raw.evidence_extractions) ? raw.evidence_extractions as Record<string, string>[] : [],
          source_verifications: Array.isArray(raw.source_verifications) ? raw.source_verifications as Record<string, string>[] : [],
          import_batches: Array.isArray(raw.import_batches) ? raw.import_batches as ScreeningData["import_batches"] : [],
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

  const normalizeIdentity = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const normalizeDoi = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "").replace(/[. ]+$/, "");
  function importedCitation(row: Record<string, string>) {
    const citation = row["Candidate study"] || "";
    const yearMatch = citation.match(/\((19|20)\d{2}[a-z]?\)/i);
    const year = yearMatch ? Number(yearMatch[0].replace(/[()a-z]/gi, "")) : null;
    const afterYear = yearMatch ? citation.slice(citation.indexOf(yearMatch[0]) + yearMatch[0].length).replace(/^\.\s*/, "") : citation;
    const title = (afterYear || citation).replace(/\.\s*$/, "").trim().slice(0, 1000);
    const authorText = yearMatch ? citation.slice(0, citation.indexOf(yearMatch[0])).replace(/[,.]\s*$/, "") : "";
    const authors = authorText.split(/,\s*(?=[A-Z][a-z-]+,)|,\s*&\s*/).map((part) => part.trim()).filter(Boolean);
    const doi = row.DOI || "";
    const urls = (row["Accessible article source"] || "").match(/https?:\/\/[^\s;]+/g) || [];
    return { title, year, authors, doi, url: urls[0] || "", citation };
  }

  async function importWorkbook(workbook: ScreeningWorkbook, filename: string) {
    setError(""); setMessage("");
    const registry = await getProjectResearchSources(projectId);
    const known = [...(registry.sources || [])];
    const nextRecords = [...data.records];
    const createdSources = new Map<string, string>();
    let skipped = 0;
    const timestamp = stamp();
    const sourceForRow = async (row: Record<string, string>) => {
      const citation = importedCitation(row);
      const doiKey = normalizeDoi(citation.doi);
      const titleKey = normalizeIdentity(citation.title);
      const found = known.find((source) => (doiKey && normalizeDoi(source.doi || "") === doiKey) ||
        (titleKey && normalizeIdentity(source.title) === titleKey));
      if (found) return { id: found.canonical_source_id };
      const localKey = doiKey ? "doi:" + doiKey : "title:" + titleKey;
      if (createdSources.has(localKey)) return { id: createdSources.get(localKey) as string };
      const created = await createProjectLiteratureSource(projectId, {
        authors: citation.authors, year: citation.year, title: citation.title || citation.citation,
        source_type: "journal_article", journal_or_publisher: row["Publication details"] || null,
        doi: citation.doi || null, url: citation.url || null,
        abstract: [row["Population / setting"], row["Study design / sample"]].filter(Boolean).join("\n\n"),
        verified: false,
      });
      const id = created.source.source_id || created.source.canonical_source_id;
      if (!id) throw new Error("A new source was created but no source ID was returned. Refresh the source registry before retrying.");
      createdSources.set(localKey, id);
      return { id };
    };

    for (const row of workbook.screening) {
      const citation = importedCitation(row);
      const doiKey = normalizeDoi(citation.doi);
      const titleKey = normalizeIdentity(citation.title);
      const { id: sourceId } = await sourceForRow(row);
      const alreadyLinked = nextRecords.some((record) => record.source_id === sourceId);
      const sameWork = nextRecords.some((record) => {
        const meta = record.imported_metadata || {};
        const existingDoi = normalizeDoi(meta.DOI || "");
        return (doiKey && existingDoi === doiKey) || (!doiKey && titleKey && normalizeIdentity(meta["Candidate study"] || record.title_snapshot) === titleKey);
      });
      if (alreadyLinked || sameWork) { skipped++; continue; }
      const status = (row["Decision status"] || "").trim().toLowerCase();
      const taDecision: TADecision = status.startsWith("exclude") ? "exclude" : status.includes("provisional") ? "maybe" : status.startsWith("include") ? "include" : "not_screened";
      const importedRecord: RecordItem = {
        screening_id: makeId(), source_id: sourceId, title_snapshot: citation.title || citation.citation,
        citation_snapshot: citation.citation, protocol_snapshot: [methodology.review_question, methodology.pcc_population, methodology.pcc_concept, methodology.pcc_context, methodology.eligibility_criteria].filter(Boolean).map(String).join("\n\n"),
        title_abstract_decision: taDecision, title_abstract_reason: taDecision === "exclude" ? "other" : "",
        full_text_decision: "not_assessed", full_text_reason: "", retrieval_attempts: [],
        notes: "Imported from " + filename + ". Original decision status and all workbook screening notes are retained in Imported workbook metadata.",
        imported_metadata: row, decision_history: [], created_at: timestamp, updated_at: timestamp,
      };
      nextRecords.push(importedRecord);
    }

    const evidenceKey = (row: Record<string, string>) => [row["Evidence domain"], row["Extracted evidence"], row["Source support / limitation"], row["Synthesis use"]].map(normalizeIdentity).join("|");
    const existingEvidence = new Set(data.evidence_extractions.map(evidenceKey));
    const evidence = [...data.evidence_extractions];
    for (const row of workbook.evidence) { const key = evidenceKey(row); if (!existingEvidence.has(key)) { evidence.push(row); existingEvidence.add(key); } }
    const verificationKey = (row: Record<string, string>) => [row.Source, row.URL, row["Access verification"], row.Caution].map(normalizeIdentity).join("|");
    const existingVerification = new Set(data.source_verifications.map(verificationKey));
    const verifications = [...data.source_verifications];
    for (const row of workbook.verification) { const key = verificationKey(row); if (!existingVerification.has(key)) { verifications.push(row); existingVerification.add(key); } }
    const batch = { filename, imported_at: timestamp, screening_rows: workbook.sheetCounts.screening, evidence_rows: workbook.sheetCounts.evidence, verification_rows: workbook.sheetCounts.verification, skipped_duplicates: skipped };
    const next: ScreeningData = {
      ...data, records: nextRecords, evidence_extractions: evidence, source_verifications: verifications,
      import_batches: [...data.import_batches, batch],
      search_provenance: [...data.search_provenance, { source: "Excel workbook import", searched_at: timestamp.slice(0, 10), query: filename, records_found: workbook.sheetCounts.screening, notes: "Imported as a cumulative workbook snapshot. " + skipped + " duplicate screening rows skipped." }],
      updated_at: timestamp,
    };
    await saveProjectModule(projectId, "study_screening", next as unknown as Record<string, unknown>);
    setData(next);
    const refreshed = await getProjectResearchSources(projectId);
    setSources(refreshed.sources || []);
    setMessage("Excel workbook imported and saved. " + (nextRecords.length - data.records.length) + " new screening records added; " + skipped + " duplicates skipped.");
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

  function updateSearch(index: number, patch: Partial<SearchProvenance>) {
    setData((current) => ({
      ...current,
      search_provenance: current.search_provenance.map((item, i) => i === index ? { ...item, ...patch } : item),
    }));
  }

  function addSearch() {
    setData((current) => ({
      ...current,
      search_provenance: [...current.search_provenance, { source: "", searched_at: "", query: "", records_found: null, notes: "" }],
    }));
  }

  function removeSearch(index: number) {
    setData((current) => ({
      ...current,
      search_provenance: current.search_provenance.filter((_, i) => i !== index),
    }));
  }

  async function save() {
    const invalid = data.records.find((r) => (r.title_abstract_decision === "exclude" && !r.title_abstract_reason.trim()) || (r.full_text_decision === "exclude" && !r.full_text_reason.trim()));
    if (invalid) { setError("Choose an exclusion reason for: " + invalid.title_snapshot); return; }
    if (data.records.some((r) => r.full_text_decision === "not_retrieved" && r.retrieval_attempts.length === 0)) {
      setError("Record at least one full-text retrieval attempt for each paper marked not retrieved."); return;
    }
    const savedAt = stamp(); setSaving(true); setError(""); setMessage("");
    try {
      await saveProjectModule(projectId, "study_screening", { ...data, updated_at: savedAt });
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
      <label>Review type<select value={data.review_type} onChange={(e) => setData((current) => ({ ...current, review_type: e.target.value as ReviewType }))}>
        <option value="scoping">Scoping review — PCC / evidence mapping</option>
        <option value="systematic">Systematic review — PICO/PECO / predefined eligibility</option>
      </select></label>
      <p className="muted">{data.review_type === "scoping" ? "Use broad PCC-based screening to map evidence, concepts, populations and contexts across eligible evidence types." : "Use predefined PICO/PECO and study-design rules. Keep inclusion decisions tied to the registered systematic-review protocol."}</p>
      <label>Protocol version<input value={data.protocol_version} onChange={(e) => setData((current) => ({ ...current, protocol_version: e.target.value }))} /></label>
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
      <div className="eyebrow">Search and import provenance</div><h3>Record where screening records came from</h3>
      <p className="muted">Record databases, websites, search dates, import batches and query details. Do not report a database search unless it is documented here.</p>
      <label>Duplicates removed before screening<input type="number" min="0" value={data.duplicates_removed} onChange={(e) => setData((current) => ({ ...current, duplicates_removed: Math.max(0, Number(e.target.value) || 0) }))} /></label>
      {data.search_provenance.map((item, index) => <div className="variable-card" key={index}>
        <label>Database / source<input value={item.source} onChange={(e) => updateSearch(index, { source: e.target.value })} placeholder="e.g. PubMed, Scopus, organisation website" /></label>
        <label>Date searched<input type="date" value={item.searched_at} onChange={(e) => updateSearch(index, { searched_at: e.target.value })} /></label>
        <label>Query or import batch<textarea rows={3} value={item.query} onChange={(e) => updateSearch(index, { query: e.target.value })} /></label>
        <label>Records found<input type="number" min="0" value={item.records_found ?? ""} onChange={(e) => updateSearch(index, { records_found: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label>Notes<textarea rows={2} value={item.notes} onChange={(e) => updateSearch(index, { notes: e.target.value })} /></label>
        <button type="button" className="button secondary" onClick={() => removeSearch(index)}>Remove search record</button>
      </div>)}
      <button type="button" className="button secondary" onClick={addSearch}>+ Add search / import record</button>
    </section>
    <StudyScreeningExcelImport onImport={importWorkbook} />
    {(data.evidence_extractions.length > 0 || data.source_verifications.length > 0 || data.import_batches.length > 0) && <section className="card editor-section">
      <div className="eyebrow">Imported workbook material</div><h3>Evidence extraction and source verification</h3>
      <p className="muted">These entries are stored in the Study Screening project module and remain available after refresh. They are retained as imported evidence notes; they do not automatically become verified findings or final inclusion decisions.</p>
      <details><summary>Evidence extraction ({data.evidence_extractions.length} entries)</summary>
        {data.evidence_extractions.map((item, index) => <div className="variable-card" key={index}>
          <strong>{item["Evidence domain"] || "Evidence item"}</strong><p>{item["Extracted evidence"]}</p>
          <p className="muted">Source support / limitation: {item["Source support / limitation"]}</p><p className="muted">Synthesis use: {item["Synthesis use"]}</p>
        </div>)}
      </details>
      <details><summary>Source verification ({data.source_verifications.length} entries)</summary>
        {data.source_verifications.map((item, index) => <div className="variable-card" key={index}>
          <strong>{item.Source || "Source"}</strong><p><a href={item.URL} target="_blank" rel="noreferrer">{item.URL}</a></p>
          <p>{item["Access verification"]}</p><p className="muted">Caution: {item.Caution}</p>
        </div>)}
      </details>
      <details><summary>Import history ({data.import_batches.length} batches)</summary><ul>{data.import_batches.map((batch, index) => <li key={index}>{batch.filename} · {batch.imported_at} · {batch.screening_rows} screening / {batch.evidence_rows} evidence / {batch.verification_rows} verification · {batch.skipped_duplicates} duplicate screening rows skipped</li>)}</ul></details>
    </section>}
    {data.records.some((record) => record.imported_metadata) && <section className="card editor-section">
      <div className="eyebrow">Original workbook fields</div><h3>Imported screening detail</h3>
      {data.records.filter((record) => record.imported_metadata).map((record) => <details key={record.screening_id}>
        <summary>{record.title_snapshot} · original status: {record.imported_metadata?.["Decision status"] || "not recorded"}</summary>
        {Object.entries(record.imported_metadata || {}).map(([key, value]) => <p key={key}><strong>{key}:</strong> {value || "Not recorded"}</p>)}
      </details>)}
    </section>}
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
