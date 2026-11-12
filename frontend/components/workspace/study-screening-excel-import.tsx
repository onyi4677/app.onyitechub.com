"use client";
import { useState } from "react";
import { mapScreeningWorkbook, readXlsx, type ScreeningWorkbook } from "./study-screening-xlsx";

export default function StudyScreeningExcelImport({ onImport }: { onImport: (data: ScreeningWorkbook, filename: string) => Promise<void> }) {
  const [preview, setPreview] = useState<ScreeningWorkbook | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function choose(file?: File) {
    setError(""); setDone(false); setPreview(null);
    if (!file) return;
    try {
      const sheets = await readXlsx(file);
      setPreview(mapScreeningWorkbook(sheets));
      setFilename(file.name);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not read this workbook."); }
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true); setError("");
    try { await onImport(preview, filename); setDone(true); setPreview(null); }
    catch (err) { setError(err instanceof Error ? err.message : "The workbook could not be imported."); }
    finally { setBusy(false); }
  }
  return <section className="card editor-section">
    <div className="eyebrow">Excel workbook import</div>
    <h3>Import an existing screening workbook</h3>
    <p className="muted">Upload the latest cumulative .xlsx workbook. The importer reads Screening Log, Evidence Extraction and Source Verification, previews their row counts, and preserves the source notes and cautions.</p>
    <label>Choose Excel workbook (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => choose(e.target.files?.[0])} /></label>
    <p className="muted">Maximum file size: 15 MB. Older daily workbooks are cumulative snapshots; import the latest one only to avoid repeating historical rows.</p>
    {error && <div className="notice warning" role="alert">{error}</div>}
    {done && <div className="notice" role="status">Workbook import saved to this project. Refresh the page to confirm the imported content remains available.</div>}
    {preview && <div className="notice">
      <strong>Workbook preview: {filename}</strong>
      <ul>
        <li>Screening Log: {preview.sheetCounts.screening} study records</li>
        <li>Evidence Extraction: {preview.sheetCounts.evidence} evidence entries</li>
        <li>Source Verification: {preview.sheetCounts.verification} verification entries</li>
      </ul>
      <p className="muted">Existing records are matched by DOI first and title second. Existing screening decisions are not overwritten. Unmatched study records are added as project sources; workbook decisions and explanatory text are retained as imported notes for review.</p>
      <button className="button primary" type="button" disabled={busy} onClick={confirm}>{busy ? "Importing…" : "Confirm import to this project"}</button>
      <button className="button secondary" type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
    </div>}
  </section>;
}
