"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

type Item = { item_id: string; section_id?: string; prompt: string; response_type?: string; options?: string[]; help_text?: string };
type Snapshot = { instrument_title?: string; instrument_instructions?: string; instrument_sections?: Array<{ section_id: string; title: string; description?: string }>; instrument_items?: Item[] };
type Access = { reviewer_name: string; reviewer_email: string; version_number: number; snapshot: Snapshot; expires_at: string };
type Rating = { clarity: number; relevance: number; coverage: number; comments: string };

export default function InstrumentReviewPage() {
  const [token, setToken] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [reviewerRole, setReviewerRole] = useState("");
  const [expertise, setExpertise] = useState("");
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().slice(0, 10));
  const [comments, setComments] = useState("");
  const [recommendation, setRecommendation] = useState<"accept" | "revise" | "reject">("revise");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const supplied = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!supplied) {
      setError("This review link is missing its invitation token. Please ask the project owner for a new link.");
      setLoading(false);
      return;
    }
    setToken(supplied);
    window.history.replaceState(null, "", window.location.pathname);
    fetch(`${API_URL}/api/public/instrument-review/access`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: supplied }),
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "This review invitation is unavailable.");
      setAccess(body);
      setReviewerName(body.reviewer_name || "");
      setReviewerEmail(body.reviewer_email || "");
      const items = Array.isArray(body.snapshot?.instrument_items) ? body.snapshot.instrument_items : [];
      setRatings(Object.fromEntries(items.map((item: Item) => [item.item_id, { clarity: 0, relevance: 0, coverage: 0, comments: "" }])));
    }).catch((err) => setError(err instanceof Error ? err.message : "Unable to open the invitation."))
      .finally(() => setLoading(false));
  }, []);

  const sections = useMemo(() => new Map<string, string>(
    (access?.snapshot.instrument_sections || []).map((section): [string, string] => [section.section_id, section.title])
  ), [access]);

  function updateRating(itemId: string, patch: Partial<Rating>) {
    setRatings((current) => ({ ...current, [itemId]: { ...current[itemId], ...patch } }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!access) return;
    const items = access.snapshot.instrument_items || [];
    if (items.some((item) => {
      const rating = ratings[item.item_id];
      return !rating || [rating.clarity, rating.relevance, rating.coverage].some((value) => value < 1 || value > 4);
    })) {
      setError("Please provide all three ratings for every question before submitting.");
      return;
    }
    setSaving(true); setError("");
    try {
      const response = await fetch(`${API_URL}/api/public/instrument-review/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, reviewer_name: reviewerName, reviewer_email: reviewerEmail, reviewer_role: reviewerRole,
          expertise, review_date: reviewDate, comments, recommendation, item_ratings: ratings,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Unable to submit the review.");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit the review.");
    } finally { setSaving(false); }
  }

  if (loading) return <main className="container"><section className="card"><p>Opening secure review invitation…</p></section></main>;
  if (submitted) return <main className="container"><section className="card"><h1>Review submitted</h1><p>Thank you. Your expert review has been submitted to the project owner. This invitation can no longer be used.</p></section></main>;
  if (error && !access) return <main className="container"><section className="card"><h1>Expert review invitation</h1><p className="notice">{error}</p></section></main>;
  if (!access) return null;

  const items = access.snapshot.instrument_items || [];
  return (
    <main className="container" style={{ maxWidth: 960, margin: "2rem auto", padding: "0 1rem" }}>
      <section className="card editor-section">
        <div className="eyebrow">Onyitech Research Workspace · Independent expert review</div>
        <h1>{access.snapshot.instrument_title || "Research instrument"}</h1>
        <p className="muted">Version {access.version_number}. This invitation provides read-only access to this instrument version only. Your ratings and comments will be sent to the project owner; you cannot edit the researcher's original instrument or access their account or other projects.</p>
        {access.snapshot.instrument_instructions && <p>{access.snapshot.instrument_instructions}</p>}
        <p className="muted">The invitation expires {new Date(access.expires_at).toLocaleString()}. Please complete the assessment in one session. The invitation can be submitted once.</p>
      </section>
      <form onSubmit={submit} className="card editor-section">
        <h2>Reviewer information</h2>
        <label>Full name<input required minLength={2} value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} /></label>
        <label>Invited email address<input required type="email" value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} /></label>
        <label>Academic / professional role and qualification<input required value={reviewerRole} onChange={(e) => setReviewerRole(e.target.value)} placeholder="e.g. Associate Professor, PhD Clinical Psychology" /></label>
        <label>Relevant area(s) of expertise<input required value={expertise} onChange={(e) => setExpertise(e.target.value)} /></label>
        <label>Date of review<input required type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} /></label>
        <h2>Item-by-item assessment</h2>
        <p className="muted">Rate each question for clarity, relevance and coverage. 1 = Not adequate; 2 = Needs major revision; 3 = Adequate; 4 = Highly adequate.</p>
        {items.map((item, index) => (
          <article className="card editor-section" key={item.item_id}>
            {item.section_id && <p className="muted">{sections.get(item.section_id) || "Instrument section"}</p>}
            <strong>{index + 1}. {item.prompt}</strong>
            {item.options?.length ? <p className="muted">Response options: {item.options.join(" · ")}</p> : null}
            {item.help_text && <p className="muted">{item.help_text}</p>}
            {(["clarity", "relevance", "coverage"] as const).map((criterion) => (
              <label key={criterion}>{criterion.charAt(0).toUpperCase() + criterion.slice(1)}
                <select required value={ratings[item.item_id]?.[criterion] || 0} onChange={(e) => updateRating(item.item_id, { [criterion]: Number(e.target.value) })}>
                  <option value={0}>Select a rating</option><option value={1}>1 — Not adequate</option><option value={2}>2 — Needs major revision</option><option value={3}>3 — Adequate</option><option value={4}>4 — Highly adequate</option>
                </select>
              </label>
            ))}
            <label>Item-specific comment<textarea rows={2} value={ratings[item.item_id]?.comments || ""} onChange={(e) => updateRating(item.item_id, { comments: e.target.value })} /></label>
          </article>
        ))}
        <h2>Overall assessment</h2>
        <label>Overall comments and recommendations<textarea required rows={5} value={comments} onChange={(e) => setComments(e.target.value)} /></label>
        <label>Recommendation<select value={recommendation} onChange={(e) => setRecommendation(e.target.value as typeof recommendation)}><option value="accept">Accept</option><option value="revise">Revise</option><option value="reject">Do not accept</option></select></label>
        {error && <p className="notice">{error}</p>}
        <button className="button primary" type="submit" disabled={saving}>{saving ? "Submitting review…" : "Submit expert review"}</button>
        <p className="muted">By submitting, you confirm that this is your independent assessment. The submission is final for this invitation.</p>
      </form>
    </main>
  );
}
