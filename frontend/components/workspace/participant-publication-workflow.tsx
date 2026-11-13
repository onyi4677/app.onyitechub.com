"use client";

import { useEffect, useState } from "react";
import { closeParticipantPublication, createParticipantPublication, listParticipantPublications, PilotPublication } from "../../lib/api/participant-publications";

type Version = { version_id: string; version_number: number; snapshot: { instrument_title?: string; instrument_items?: unknown[] } };

function exportCsv(p: PilotPublication) {
  const ids = Array.from(new Set(p.responses.flatMap(r => Object.keys(r.answers || {}))));
  const q = (v: unknown) => '"' + String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""') + '"';
  const csv = [["test_data", "submitted_at", "elapsed_seconds", ...ids], ...p.responses.map(r => ["TRUE", r.submitted_at, r.elapsed_seconds, ...ids.map(id => r.answers[id])])].map(row => row.map(q).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = "onyitech-technical-pilot-test-data.csv"; a.click(); URL.revokeObjectURL(url);
}

export default function ParticipantPublicationWorkflow({ projectId, versions }: { projectId: string; versions: Version[] }) {
  const [selected, setSelected] = useState(""); const [records, setRecords] = useState<PilotPublication[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [link, setLink] = useState("");
  async function refresh() { const result = await listParticipantPublications(projectId); setRecords(result.publications || []); }
  useEffect(() => { let live = true; listParticipantPublications(projectId).then(r => { if (live) setRecords(r.publications || []); }).catch(e => { if (live) setError(e.message || "Dashboard unavailable."); }); return () => { live = false; }; }, [projectId]);
  async function publish() { setBusy(true); setError(""); try { const r = await createParticipantPublication(projectId, selected); const url = window.location.origin + r.public_url_path; setLink(url); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not publish."); } finally { setBusy(false); } }
  async function close(id: string) { setBusy(true); try { await closeParticipantPublication(projectId, id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not close."); } finally { setBusy(false); } }
  return <section className="card editor-section">
    <div className="eyebrow">Technical pilot · test data only</div><h3>Public questionnaire pilot</h3>
    <p className="muted">Create a no-account test link from an immutable primary-data instrument version. Test submissions are stored separately and labelled TEST; this does not open real research recruitment.</p>
    <label>Saved instrument version<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a saved version</option>{versions.map(v => <option key={v.version_id} value={v.version_id}>Version {v.version_number} — {v.snapshot?.instrument_title || "Untitled"} ({v.snapshot?.instrument_items?.length || 0} questions)</option>)}</select></label>
    <button className="button primary" disabled={!selected || busy} onClick={publish} type="button">{busy ? "Working..." : "Create technical pilot link"}</button>
    {link && <div className="notice"><strong>Public test link</strong><p><a href={link} target="_blank" rel="noreferrer">{link}</a></p><button className="button" type="button" onClick={() => navigator.clipboard.writeText(link)}>Copy link</button></div>}
    {error && <div className="notice">{error}</div>}
    <h4>Saved test submissions</h4>
    {records.length === 0 ? <p className="muted">No test submissions yet.</p> : records.map(p => <div className="card editor-section" key={p.publication_id}>
      <div className="editor-actions"><strong>Version {p.version_number} · {p.response_count} test responses</strong><span className="eyebrow">TEST DATA</span></div>
      <p className="muted">Created {new Date(p.created_at).toLocaleString()} · {p.status}</p>
      {p.response_count > 0 && <button className="button" type="button" onClick={() => exportCsv(p)}>Export test responses (CSV)</button>}
      {p.status === "test_open" && <button className="button" type="button" disabled={busy} onClick={() => close(p.publication_id)}>Close pilot link</button>}
      {p.responses.map(r => <details key={r.response_id}><summary>Test response · {new Date(r.submitted_at).toLocaleString()} · {r.question_count} questions</summary><dl>{Object.entries(r.answers).map(([id, answer]) => <div key={id}><dt>{id}</dt><dd>{Array.isArray(answer) ? answer.join(", ") : String(answer ?? "")}</dd></div>)}</dl></details>)}
    </div>)}
  </section>;
}
