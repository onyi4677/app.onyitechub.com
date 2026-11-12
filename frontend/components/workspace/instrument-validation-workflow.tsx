"use client";

import { useEffect, useMemo, useState } from "react";

type Pathway = "primary_data" | "secondary_data";
type InstrumentVersion = {
  version_id: string;
  version_number: number;
  created_at: string;
  snapshot: Record<string, unknown>;
};
type ReviewEntry = {
  reviewer_name: string;
  reviewer_role: string;
  expertise: string;
  review_date: string;
  comments: string;
  recommendation: string;
  item_ratings: Record<string, { clarity: number; relevance: number; coverage: number; comments: string }>;
};
type ValidationRecord = {
  validation_id: string;
  version_id: string;
  version_number: number;
  pathway: Pathway;
  created_at: string;
  status: "draft" | "review_pending" | "revisions_required" | "pilot_pending" | "validated";
  expert_reviews: ReviewEntry[];
  pilot_sample_size: string;
  pilot_method: string;
  pilot_findings: string;
  revisions_made: string;
  reliability_method: string;
  reliability_result: string;
  reliability_sample_size: string;
  reliability_notes: string;
  second_reviewer: string;
  agreement_method: string;
  agreement_result: string;
  disagreement_resolution: string;
  decision_rationale: string;
  decision_date: string;
};

const emptyReview = (itemIds: string[] = []): ReviewEntry => ({
  reviewer_name: "", reviewer_role: "", expertise: "", review_date: "",
  comments: "", recommendation: "revise",
  item_ratings: Object.fromEntries(itemIds.map((id) => [id, { clarity: 0, relevance: 0, coverage: 0, comments: "" }])),
});

function newValidation(version: InstrumentVersion, pathway: Pathway): ValidationRecord {
  return {
    validation_id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `validation-${Date.now()}`,
    version_id: version.version_id,
    version_number: version.version_number,
    pathway,
    created_at: new Date().toISOString(),
    status: "draft",
    expert_reviews: [],
    pilot_sample_size: "",
    pilot_method: "",
    pilot_findings: "",
    revisions_made: "",
    reliability_method: "",
    reliability_result: "",
    reliability_sample_size: "",
    reliability_notes: "",
    second_reviewer: "",
    agreement_method: "",
    agreement_result: "",
    disagreement_resolution: "",
    decision_rationale: "",
    decision_date: "",
  };
}

export default function InstrumentValidationWorkflow({
  pathway, versions, records, onSave,
}: {
  pathway: Pathway;
  versions: InstrumentVersion[];
  records: ValidationRecord[];
  onSave: (next: ValidationRecord[]) => Promise<void>;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [draft, setDraft] = useState<ValidationRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedVersion = useMemo(
    () => versions.find((version) => version.version_id === selectedVersionId) ?? versions[versions.length - 1],
    [versions, selectedVersionId],
  );
  const savedRecord = records.find((record) => record.version_id === selectedVersion?.version_id);

  useEffect(() => {
    if (!selectedVersionId && versions.length) setSelectedVersionId(versions[versions.length - 1].version_id);
  }, [versions, selectedVersionId]);

  useEffect(() => {
    setDraft(savedRecord ?? null);
  }, [savedRecord?.validation_id, selectedVersion?.version_id]);

  function update<K extends keyof ValidationRecord>(key: K, value: ValidationRecord[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setNotice("");
    setError("");
  }

  function addReviewer() {
    if (!draft || !selectedVersion) return;
    const items = Array.isArray(selectedVersion.snapshot.instrument_items)
      ? selectedVersion.snapshot.instrument_items as Array<Record<string, unknown>> : [];
    update("expert_reviews", [...draft.expert_reviews, emptyReview(items.map((item, index) =>
      typeof item.item_id === "string" ? item.item_id : "item-" + (index + 1)
    ))]);
  }

  function updateReviewer(index: number, patch: Partial<ReviewEntry>) {
    if (!draft) return;
    update("expert_reviews", draft.expert_reviews.map((review, i) => i === index ? { ...review, ...patch } : review));
  }

  async function saveRecord(nextStatus?: ValidationRecord["status"]) {
    if (!draft || !selectedVersion) return;
    const candidate = { ...draft, status: nextStatus ?? draft.status };
    if (candidate.status === "validated") {
      const hasExpertReview = candidate.expert_reviews.some((review) =>
        review.reviewer_name.trim() && review.reviewer_role.trim() && review.expertise.trim() &&
        review.review_date && review.comments.trim() && review.recommendation
      );
      const snapshotItems = Array.isArray(selectedVersion.snapshot.instrument_items)
        ? selectedVersion.snapshot.instrument_items as Array<Record<string, unknown>> : [];
      const hasItemRatings = snapshotItems.length > 0 && snapshotItems.every((item, index) => {
        const itemId = typeof item.item_id === "string" ? item.item_id : "item-" + (index + 1);
        return candidate.expert_reviews.some((review) => (review.item_ratings?.[itemId]?.relevance ?? 0) > 0);
      });
      const hasPilotEvidence = Number(candidate.pilot_sample_size) > 0 && candidate.pilot_method.trim() && candidate.pilot_findings.trim();
      const hasMethodSpecificEvidence = pathway === "primary_data"
        ? (candidate.reliability_method.trim() && candidate.reliability_result.trim()) || candidate.reliability_notes.trim()
        : (candidate.second_reviewer.trim() && candidate.agreement_method.trim() && candidate.agreement_result.trim()) || candidate.disagreement_resolution.trim();
      if (!hasExpertReview || !hasItemRatings || !hasPilotEvidence || !hasMethodSpecificEvidence || !candidate.decision_rationale.trim() || !candidate.decision_date) {
        setError(pathway === "primary_data"
          ? "Before recording a validated outcome, add a complete expert review, relevance ratings for every item, pilot sample size and findings, reliability evidence (or an explanation), and a dated decision rationale."
          : "Before recording a validated outcome, add a complete expert review, relevance ratings for every extraction field, a pilot extraction sample and findings, reviewer-agreement evidence (or an explanation), and a dated decision rationale.");
        return;
      }
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = [...records.filter((record) => record.version_id !== candidate.version_id), candidate];
      await onSave(next);
      setDraft(candidate);
      setNotice("Validation record saved for instrument version " + candidate.version_number + ".");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save validation record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card editor-section">
      <div className="eyebrow">Milestone 2 · Instrument Validation</div>
      <h3>Validation evidence and decision</h3>
      <p className="muted">Validation records are linked to an immutable saved instrument version. Editing and saving the instrument creates a new version; it does not rewrite this version's validation history.</p>
      {versions.length === 0 ? (
        <div className="notice">Save the instrument first. A version snapshot will then appear here for validation.</div>
      ) : (
        <>
          <label>Instrument version under validation
            <select value={selectedVersion?.version_id ?? ""} onChange={(event) => setSelectedVersionId(event.target.value)}>
              {versions.map((version) => (
                <option key={version.version_id} value={version.version_id}>
                  Version {version.version_number} · {new Date(version.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {selectedVersion && (
            <div className="notice">
              <strong>Version {selectedVersion.version_number} snapshot:</strong> {String(selectedVersion.snapshot.instrument_title ?? "Untitled instrument")} · {Array.isArray(selectedVersion.snapshot.instrument_items) ? selectedVersion.snapshot.instrument_items.length : 0} items
            </div>
          )}
          {!draft && selectedVersion && (
            <button className="button" type="button" onClick={() => setDraft(newValidation(selectedVersion, pathway))}>
              Start validation for version {selectedVersion.version_number}
            </button>
          )}
          {draft && selectedVersion && draft.version_id === selectedVersion.version_id && (
            <>
              <label>Validation status
                <select value={draft.status} onChange={(event) => update("status", event.target.value as ValidationRecord["status"])}>
                  <option value="draft">Draft</option>
                  <option value="review_pending">Review pending</option>
                  <option value="revisions_required">Revisions required</option>
                  <option value="pilot_pending">Pilot pending</option>
                  <option value="validated">Validated — evidence and decision recorded</option>
                </select>
              </label>

              <div className="card editor-section">
                <h4>Expert review</h4>
                <p className="muted">Record each reviewer's role, relevant expertise, date, comments and recommendation. Expert review supports content/face assessment; it is not, by itself, empirical reliability evidence.</p>
                {draft.expert_reviews.map((review, index) => (
                  <div className="card editor-section" key={index}>
                    <strong>Reviewer {index + 1}</strong>
                    <label>Reviewer name or secure reference
                      <input value={review.reviewer_name} onChange={(event) => updateReviewer(index, { reviewer_name: event.target.value })} />
                    </label>
                    <label>Role / qualification
                      <input value={review.reviewer_role} onChange={(event) => updateReviewer(index, { reviewer_role: event.target.value })} />
                    </label>
                    <label>Relevant expertise
                      <input value={review.expertise} onChange={(event) => updateReviewer(index, { expertise: event.target.value })} />
                    </label>
                    <label>Review date
                      <input type="date" value={review.review_date} onChange={(event) => updateReviewer(index, { review_date: event.target.value })} />
                    </label>
                    <label>Comments and item-level recommendations
                      <textarea rows={3} value={review.comments} onChange={(event) => updateReviewer(index, { comments: event.target.value })} />
                    </label>
                    <label>Recommendation
                      <select value={review.recommendation} onChange={(event) => updateReviewer(index, { recommendation: event.target.value })}>
                        <option value="accept">Accept</option>
                        <option value="revise">Revise</option>
                        <option value="reject">Do not accept</option>
                      </select>
                    </label>
                    <div className="editor-section">
                      <strong>Item-level assessment · 4-point rating scale</strong>
                      <p className="muted">Rate each item for clarity, relevance and coverage: 1 = not adequate, 2 = needs major revision, 3 = adequate, 4 = highly adequate. Leave unrated if the reviewer has not assessed that item.</p>
                      {(Array.isArray(selectedVersion.snapshot.instrument_items) ? selectedVersion.snapshot.instrument_items as Array<Record<string, unknown>> : []).map((item, itemIndex) => {
                        const itemId = typeof item.item_id === "string" ? item.item_id : "item-" + (itemIndex + 1);
                        const rating = review.item_ratings?.[itemId] ?? { clarity: 0, relevance: 0, coverage: 0, comments: "" };
                        return (
                          <div className="card editor-section" key={itemId}>
                            <strong>{itemIndex + 1}. {String(item.prompt ?? "Untitled item")}</strong>
                            {(["clarity", "relevance", "coverage"] as const).map((criterion) => (
                              <label key={criterion}>{criterion.charAt(0).toUpperCase() + criterion.slice(1)}
                                <select value={rating[criterion]} onChange={(event) => updateReviewer(index, {
                                  item_ratings: {
                                    ...review.item_ratings,
                                    [itemId]: { ...rating, [criterion]: Number(event.target.value) },
                                  },
                                })}>
                                  <option value={0}>Not rated</option>
                                  <option value={1}>1 — Not adequate</option>
                                  <option value={2}>2 — Major revision needed</option>
                                  <option value={3}>3 — Adequate</option>
                                  <option value={4}>4 — Highly adequate</option>
                                </select>
                              </label>
                            ))}
                            <label>Item-specific comment
                              <textarea rows={2} value={rating.comments} onChange={(event) => updateReviewer(index, {
                                item_ratings: {
                                  ...review.item_ratings,
                                  [itemId]: { ...rating, comments: event.target.value },
                                },
                              })} />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    <button className="button" type="button" onClick={() => update("expert_reviews", draft.expert_reviews.filter((_, i) => i !== index))}>Remove reviewer</button>
                  </div>
                ))}
                <button className="button" type="button" onClick={addReviewer}>Add expert reviewer</button>
                {(() => {
                  const items = Array.isArray(selectedVersion.snapshot.instrument_items)
                    ? selectedVersion.snapshot.instrument_items as Array<Record<string, unknown>> : [];
                  const itemCvi = items.map((item, itemIndex) => {
                    const itemId = typeof item.item_id === "string" ? item.item_id : "item-" + (itemIndex + 1);
                    const ratings = draft.expert_reviews
                      .map((review) => review.item_ratings?.[itemId]?.relevance ?? 0)
                      .filter((rating) => rating > 0);
                    return { itemId, prompt: String(item.prompt ?? "Untitled item"), ratings, cvi: ratings.length ? ratings.filter((rating) => rating >= 3).length / ratings.length : null };
                  });
                  const available = itemCvi.filter((item) => item.cvi !== null);
                  const scaleAverage = available.length ? available.reduce((sum, item) => sum + (item.cvi ?? 0), 0) / available.length : null;
                  return (
                    <div className="notice">
                      <strong>Content validity summary (4-point relevance ratings)</strong>
                      <p className="muted">I-CVI is the proportion of submitted relevance ratings of 3 or 4 for an item. S-CVI/Ave is the mean I-CVI across items with ratings. These are descriptive calculations; interpret them using a declared method and the number of reviewers, not as an automatic pass/fail.</p>
                      {itemCvi.map((item) => <p key={item.itemId}>{item.prompt}: {item.cvi === null ? "Not yet rated" : item.cvi.toFixed(2) + " (I-CVI; n=" + item.ratings.length + ")"}</p>)}
                      <strong>S-CVI/Ave: {scaleAverage === null ? "Not yet available" : scaleAverage.toFixed(2)}</strong>
                    </div>
                  );
                })()}
              </div>

              <div className="card editor-section">
                <h4>{pathway === "primary_data" ? "Pilot testing" : "Pilot extraction"}</h4>
                <label>{pathway === "primary_data" ? "Pilot participant sample size" : "Number of studies / documents pilot-extracted"}
                  <input type="number" min="0" value={draft.pilot_sample_size} onChange={(event) => update("pilot_sample_size", event.target.value)} />
                </label>
                <label>{pathway === "primary_data" ? "Pilot administration method" : "Pilot extraction procedure"}
                  <textarea rows={2} value={draft.pilot_method} onChange={(event) => update("pilot_method", event.target.value)} />
                </label>
                <label>Findings, clarity issues and observed problems
                  <textarea rows={4} value={draft.pilot_findings} onChange={(event) => update("pilot_findings", event.target.value)} />
                </label>
                <label>Revisions made following the pilot
                  <textarea rows={3} value={draft.revisions_made} onChange={(event) => update("revisions_made", event.target.value)} />
                </label>
              </div>

              {pathway === "primary_data" ? (
                <div className="card editor-section">
                  <h4>Reliability and measurement evidence</h4>
                  <p className="muted">Enter statistics only when calculated from eligible pilot or study data. Do not invent a coefficient. For established scales, follow the authorised scoring instructions and report each relevant subscale appropriately.</p>
                  <label>Method / statistic (e.g. Cronbach's alpha, McDonald's omega, test–retest)
                    <input value={draft.reliability_method} onChange={(event) => update("reliability_method", event.target.value)} />
                  </label>
                  <label>Observed result
                    <input value={draft.reliability_result} onChange={(event) => update("reliability_result", event.target.value)} placeholder="Enter the calculated value and relevant subscale" />
                  </label>
                  <label>Eligible sample size
                    <input type="number" min="0" value={draft.reliability_sample_size} onChange={(event) => update("reliability_sample_size", event.target.value)} />
                  </label>
                  <label>Item set, reverse scoring, missing-data policy or reason evidence is not applicable
                    <textarea rows={3} value={draft.reliability_notes} onChange={(event) => update("reliability_notes", event.target.value)} />
                  </label>
                </div>
              ) : (
                <div className="card editor-section">
                  <h4>Independent extraction and reviewer agreement</h4>
                  <p className="muted">A second reviewer can independently extract a subset of eligible studies. Record the actual agreement method/result and how disagreements were resolved. This is not participant-scale internal consistency.</p>
                  <label>Second reviewer name or secure reference
                    <input value={draft.second_reviewer} onChange={(event) => update("second_reviewer", event.target.value)} />
                  </label>
                  <label>Agreement method (e.g. percentage agreement, kappa)
                    <input value={draft.agreement_method} onChange={(event) => update("agreement_method", event.target.value)} />
                  </label>
                  <label>Observed agreement result
                    <input value={draft.agreement_result} onChange={(event) => update("agreement_result", event.target.value)} />
                  </label>
                  <label>Disagreement resolution or reason independent agreement was not applicable
                    <textarea rows={3} value={draft.disagreement_resolution} onChange={(event) => update("disagreement_resolution", event.target.value)} />
                  </label>
                </div>
              )}

              <div className="card editor-section">
                <h4>Validation decision</h4>
                <label>Decision rationale and evidence summary
                  <textarea rows={4} value={draft.decision_rationale} onChange={(event) => update("decision_rationale", event.target.value)} placeholder="Summarise the evidence considered, limitations and reasons for the decision." />
                </label>
                <label>Decision date
                  <input type="date" value={draft.decision_date} onChange={(event) => update("decision_date", event.target.value)} />
                </label>
              </div>
              {error && <div className="notice">{error}</div>}
              {notice && <div className="notice">{notice}</div>}
              <div className="editor-actions">
                <button className="button primary" type="button" disabled={saving} onClick={() => saveRecord()}>{saving ? "Saving..." : "Save validation record"}</button>
                <button className="button" type="button" disabled={saving} onClick={() => saveRecord("validated")}>Record validated outcome</button>
              </div>
            </>
          )}
          {!draft && savedRecord && <p className="muted">A validation record already exists for this instrument version.</p>}
        </>
      )}
    </section>
  );
}
