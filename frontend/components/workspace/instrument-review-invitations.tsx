"use client";

import { useEffect, useState } from "react";
import {
  createInstrumentReviewInvitation, listInstrumentReviewInvitations, revokeInstrumentReviewInvitation,
  type InstrumentReviewInvitation,
} from "../../lib/api/instrument-reviews";

type ImportedReview = {
  reviewer_name: string; reviewer_role: string; expertise: string; review_date: string;
  comments: string; recommendation: string;
  item_ratings: Record<string, { clarity: number; relevance: number; coverage: number; comments?: string }>;
};

export default function InstrumentReviewInvitations({
  projectId, pathway, versionId, versionNumber, onImport,
}: {
  projectId: string; pathway: string; versionId: string; versionNumber: number;
  onImport: (review: ImportedReview) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [expiry, setExpiry] = useState(14);
  const [invitations, setInvitations] = useState<InstrumentReviewInvitation[]>([]);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const result = await listInstrumentReviewInvitations(projectId);
    setInvitations(result.invitations.filter((entry) => entry.version_number === versionNumber));
  }

  useEffect(() => { refresh().catch((err) => setError(err instanceof Error ? err.message : "Could not load invitations.")); }, [projectId, versionNumber]);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage(""); setLink("");
    try {
      const result = await createInstrumentReviewInvitation(projectId, {
        pathway, version_id: versionId, reviewer_name: name, reviewer_email: email, expires_in_days: expiry,
      });
      setLink(`${window.location.origin}${result.review_url_path}#${result.token}`);
      setMessage("Invitation created. Copy the link and send it privately to the named reviewer.");
      setName(""); setEmail("");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create invitation."); }
    finally { setBusy(false); }
  }

  async function revoke(invitationId: string) {
    setBusy(true); setError(""); setMessage("");
    try { await revokeInstrumentReviewInvitation(projectId, invitationId); await refresh(); setMessage("Pending invitation revoked."); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not revoke invitation."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card editor-section">
      <h4>Secure external expert review</h4>
      <p className="muted">Invite a reviewer without sharing your Onyitech password. Each link is restricted to Version {versionNumber}, expires after the selected period and can be submitted once. The reviewer email is checked against the invitation, but the address itself is not independently email-verified. Onyitech does not send the email automatically; copy the link and send it privately.</p>
      <form onSubmit={create}>
        <label>Reviewer name<input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Reviewer email address<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Invitation validity
          <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            <option value={7}>7 days</option><option value={14}>14 days</option><option value={21}>21 days</option><option value={30}>30 days</option>
          </select>
        </label>
        <button className="button primary" type="submit" disabled={busy || !versionId}>{busy ? "Working…" : "Create reviewer invitation"}</button>
      </form>
      {link && <div className="notice">
        <strong>Invitation link — shown only now</strong>
        <p style={{ overflowWrap: "anywhere" }}>{link}</p>
        <button className="button" type="button" onClick={() => navigator.clipboard.writeText(link).then(() => setMessage("Invitation link copied."))}>Copy invitation link</button>
      </div>}
      {invitations.length > 0 && <div>
        <strong>Invitations for Version {versionNumber}</strong>
        {invitations.map((entry) => (
          <div className="card editor-section" key={entry.invitation_id}>
            <strong>{entry.reviewer_name}</strong>
            <p className="muted">{entry.reviewer_email} · {entry.status} · Expires {new Date(entry.expires_at).toLocaleString()}</p>
            {entry.status === "pending" && <button className="button" type="button" disabled={busy} onClick={() => revoke(entry.invitation_id)}>Revoke invitation</button>}
            {entry.status === "submitted" && entry.submission && <button className="button" type="button" onClick={() => onImport({
              reviewer_name: entry.submission!.reviewer_name,
              reviewer_role: entry.submission!.reviewer_role,
              expertise: entry.submission!.expertise,
              review_date: entry.submission!.review_date,
              comments: entry.submission!.comments,
              recommendation: entry.submission!.recommendation,
              item_ratings: Object.fromEntries(Object.entries(entry.submission!.item_ratings).map(([id, rating]) => [id, { ...rating, comments: rating.comments || "" }])),
            })}>Import submitted review into validation record</button>}
          </div>
        ))}
      </div>}
      {error && <p className="notice">{error}</p>}
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
