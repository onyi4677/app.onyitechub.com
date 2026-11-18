"use client";

import { useEffect, useState } from "react";
import { closeResearchPublication, createResearchPublication, exportResearchPublication, listResearchPublications, ResearchPublication } from "../../lib/api/participant-publications";

type Version = { version_id: string; version_number: number; snapshot: { instrument_title?: string; instrument_items?: unknown[] } };

export default function ResearchPublicationWorkflow({ projectId, versions }: { projectId: string; versions: Version[] }) {
  const [selected, setSelected] = useState("");
  const [records, setRecords] = useState<ResearchPublication[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [ethicsCommittee, setEthicsCommittee] = useState("");
  const [approvalReference, setApprovalReference] = useState("");
  const [approvalDate, setApprovalDate] = useState("");
  const [information, setInformation] = useState("");
  const [consent, setConsent] = useState("");
  const [eligibility, setEligibility] = useState("I confirm that I am aged 18–35 and currently reside in Anambra State, Nigeria.");
  const [withdrawal, setWithdrawal] = useState("");
  const [consentVersion, setConsentVersion] = useState("1.0");

  async function refresh() {
    const result = await listResearchPublications(projectId);
    setRecords(result.publications || []);
  }
  useEffect(() => {
    let live = true;
    listResearchPublications(projectId).then(result => { if (live) setRecords(result.publications || []); })
      .catch(e => { if (live) setError(e.message || "Research collection dashboard unavailable."); });
    return () => { live = false; };
  }, [projectId]);

  async function publish() {
    setBusy(true); setError(""); setLink("");
    try {
      const result = await createResearchPublication(projectId, {
        version_id: selected,
        ethics_committee: ethicsCommittee,
        approval_reference: approvalReference,
        approval_date: approvalDate,
        participant_information: information,
        consent_text: consent,
        eligibility_text: eligibility,
        withdrawal_text: withdrawal,
        consent_version: consentVersion,
      });
      const url = window.location.origin + result.public_url_path;
      setLink(url);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the research link.");
    } finally { setBusy(false); }
  }

  async function close(id: string) {
    setBusy(true); setError("");
    try { await closeResearchPublication(projectId, id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not close the research link."); }
    finally { setBusy(false); }
  }

  async function exportCsv(id: string) {
    setBusy(true); setError("");
    try {
      const blob = await exportResearchPublication(projectId, id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "onyitech-research-responses.csv"; anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not export responses."); }
    finally { setBusy(false); }
  }

  return <section className="card editor-section">
    <div className="eyebrow">Research data collection · separate from technical pilot</div>
    <h3>Research participant collection</h3>
    <p className="muted">Create a participant link from a saved, immutable instrument version. Research responses are stored separately from technical-pilot test submissions.</p>
    <label>Saved primary-data instrument version
      <select value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">Choose a saved version</option>
        {versions.map(v => <option key={v.version_id} value={v.version_id}>Version {v.version_number} — {v.snapshot?.instrument_title || "Untitled"} ({v.snapshot?.instrument_items?.length || 0} questions)</option>)}
      </select>
    </label>
    <h4>Study approval record</h4>
    <p className="muted">These fields may remain blank while approval is pending and during staging tests. Enter only the actual approval details when they have been issued.</p>
    <label>Ethics committee / approving institution<input value={ethicsCommittee} onChange={e => setEthicsCommittee(e.target.value)} maxLength={300} /></label>
    <label>Approval reference / protocol number<input value={approvalReference} onChange={e => setApprovalReference(e.target.value)} maxLength={200} /></label>
    <label>Approval date<input type="date" value={approvalDate} onChange={e => setApprovalDate(e.target.value)} /></label>
    <h4>Participant-facing documents</h4>
    <label>Participant information sheet (paste approved text)
      <textarea rows={8} value={information} onChange={e => setInformation(e.target.value)} maxLength={20000} placeholder="Paste the participant information sheet exactly as approved." />
    </label>
    <label>Informed consent statement (paste approved text)
      <textarea rows={5} value={consent} onChange={e => setConsent(e.target.value)} maxLength={5000} placeholder="Paste the consent statement exactly as approved." />
    </label>
    <label>Eligibility statement
      <textarea rows={2} value={eligibility} onChange={e => setEligibility(e.target.value)} maxLength={2000} />
    </label>
    <label>Withdrawal information (use the approved wording)
      <textarea rows={3} value={withdrawal} onChange={e => setWithdrawal(e.target.value)} maxLength={3000} placeholder="Explain the withdrawal process and any limits stated in the approved information sheet." />
    </label>
    <label>Consent document version<input value={consentVersion} onChange={e => setConsentVersion(e.target.value)} maxLength={100} /></label>
    <p className="muted">The system records the approval details and a hash of the participant-information and consent text shown to each participant. It does not generate or certify ethics approval.</p>
    <button className="button primary" type="button" disabled={busy || !selected || information.trim().length < 100 || consent.trim().length < 30 || eligibility.trim().length < 20 || withdrawal.trim().length < 20 || !consentVersion.trim()} onClick={publish}>{busy ? "Working..." : "Create research collection link"}</button>
    {link && <div className="notice"><strong>Research participant link</strong><p><a href={link} target="_blank" rel="noreferrer">{link}</a></p><button className="button" type="button" onClick={() => navigator.clipboard.writeText(link)}>Copy link</button></div>}
    {error && <div className="notice" role="alert">{error}</div>}
    <h4>Research collection records</h4>
    {records.length === 0 ? <p className="muted">No research collection links have been created.</p> : records.map(record => <div className="card editor-section" key={record.publication_id}>
      <div className="editor-actions"><strong>Version {record.version_number} · {record.response_count} research responses</strong><span className="eyebrow">RESEARCH DATA</span></div>
      <p className="muted">{[record.ethics_committee, record.approval_reference, record.approval_date].filter(Boolean).join(" · ") || "Approval details not entered"}</p>
      <p className="muted">Consent version {record.consent_version} · {record.status} · Created {new Date(record.created_at).toLocaleString()}</p>
      <div className="editor-actions">
        <button className="button" type="button" disabled={busy || record.response_count === 0} onClick={() => exportCsv(record.publication_id)}>Export research responses (CSV)</button>
        {record.status === "research_open" && <button className="button" type="button" disabled={busy} onClick={() => close(record.publication_id)}>Close collection</button>}
      </div>
    </div>)}
  </section>;
}
