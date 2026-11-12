"use client";

import { useEffect, useMemo, useState } from "react";
import InstrumentReviewInvitations from "./instrument-review-invitations";

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

function reviewText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return reviewText(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character] || character);
}

function escapeRtf(value) {
  let output = "";
  for (const character of reviewText(value)) {
    if (character === "\\") output += "\\\\";
    else if (character === "{") output += "\\{";
    else if (character === "}") output += "\\}";
    else if (character === "\n") output += "\\line ";
    else {
      const code = character.codePointAt(0) || 0;
      if (code >= 32 && code <= 126) output += character;
      else if (code <= 65535) output += "\\u" + (code > 32767 ? code - 65536 : code) + "?";
      else {
        const adjusted = code - 65536;
        const high = 55296 + (adjusted >> 10);
        const low = 56320 + (adjusted & 1023);
        output += "\\u" + (high > 32767 ? high - 65536 : high) + "?\\u" + (low > 32767 ? low - 65536 : low) + "?";
      }
    }
  }
  return output;
}

function htmlItemsForOne(item, index) {
  const options = Array.isArray(item.options) ? item.options.map(option => "<li>" + escapeHtml(option) + "</li>").join("") : "";
  return "<article class=\"item\"><h3>" + (index + 1) + ". " + escapeHtml(item.prompt) + "</h3>" +
    "<p><strong>Response format:</strong> " + escapeHtml(item.response_type) + (item.required === true ? " · Required" : "") + "</p>" +
    (options ? "<p><strong>Response options:</strong></p><ul>" + options + "</ul>" : "") +
    (reviewText(item.help_text) ? "<p><strong>Help text:</strong> " + escapeHtml(item.help_text) + "</p>" : "") +
    "<table><thead><tr><th>Criterion</th><th>1</th><th>2</th><th>3</th><th>4</th></tr></thead><tbody>" +
    ["Clarity","Relevance","Coverage"].map(criterion => "<tr><td>" + criterion + "</td><td>☐</td><td>☐</td><td>☐</td><td>☐</td></tr>").join("") +
    "</tbody></table><p><strong>Item-specific comments / suggested revision:</strong></p><div class=\"writing-space\"></div></article>";
}

function buildReviewerDocument(version, pathway) {
  const snapshot = version.snapshot;
  const sections = Array.isArray(snapshot.instrument_sections) ? snapshot.instrument_sections : [];
  const items = Array.isArray(snapshot.instrument_items) ? snapshot.instrument_items : [];
  const title = reviewText(snapshot.instrument_title) || "Research instrument";
  const ratingGuide = "Rate each criterion from 1 to 4: 1 = Not adequate; 2 = Needs major revision; 3 = Adequate; 4 = Highly adequate.";
  const sectionItems = sections.map(section => {
    const matching = items.map((item,index) => ({item,index})).filter(entry => String(entry.item.section_id || "") === String(section.section_id || ""));
    return "<h2>" + escapeHtml(section.title) + "</h2>" +
      (reviewText(section.description) ? "<p>" + escapeHtml(section.description) + "</p>" : "") +
      matching.map(entry => htmlItemsForOne(entry.item,entry.index)).join("");
  }).join("");
  const unassigned = items.map((item,index) => ({item,index})).filter(entry =>
    !sections.some(section => String(section.section_id || "") === String(entry.item.section_id || ""))
  );
  const html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Expert Content Validation - " + escapeHtml(title) + "</title>" +
    "<style>body{font-family:Arial,sans-serif;color:#171717;line-height:1.45;margin:32px;font-size:11pt}" +
    "h1{font-size:19pt;margin-bottom:5px}h2{font-size:14pt;margin-top:24px;border-bottom:1px solid #777;padding-bottom:4px}" +
    "h3{font-size:12pt;margin-bottom:6px}.field{margin:12px 0}.line{display:inline-block;border-bottom:1px solid #555;min-width:220px;height:20px}" +
    ".item{page-break-inside:avoid;border:1px solid #bbb;padding:14px;margin:18px 0}table{border-collapse:collapse;width:100%;margin:10px 0}" +
    "th,td{border:1px solid #777;padding:7px;text-align:center}td:first-child,th:first-child{text-align:left}" +
    ".writing-space{height:54px;border-bottom:1px solid #aaa}.large-space{height:90px;border-bottom:1px solid #aaa}" +
    "@media print{body{margin:18mm}.item{break-inside:avoid}}</style></head><body>" +
    "<h1>Expert Review and Content Validation Form</h1><p><strong>Research instrument:</strong> " + escapeHtml(title) + "</p>" +
    "<p><strong>Instrument version:</strong> " + version.version_number + " &nbsp; | &nbsp; <strong>Pathway:</strong> " + (pathway === "primary_data" ? "Primary data" : "Secondary data") + "</p>" +
    "<p><strong>Purpose:</strong> " + escapeHtml(snapshot.purpose) + "</p>" +
    "<p><strong>Target population / evidence population:</strong> " + escapeHtml(snapshot.target_population) + "</p>" +
    "<p><strong>Research context:</strong> " + escapeHtml(snapshot.research_context) + "</p>" +
    "<h2>Part A — Reviewer information</h2>" +
    ["Reviewer full name","Academic / professional qualification","Institution / affiliation","Area of expertise","Email address","Date of review"].map(label => "<p class=\"field\"><strong>" + label + ":</strong> <span class=\"line\"></span></p>").join("") +
    "<h2>Part B — Instructions</h2><p>Review the instrument as a whole and assess every item for clarity, relevance to the study purpose, and coverage of the construct or information required. Mark one rating for each criterion. Use the comments space to identify ambiguous wording, missing content, duplication, response-option problems, or recommended revisions.</p>" +
    "<p><strong>" + ratingGuide + "</strong></p>" +
    (reviewText(snapshot.instrument_instructions) ? "<p><strong>Instrument instructions:</strong> " + escapeHtml(snapshot.instrument_instructions) + "</p>" : "") +
    "<h2>Part C — Item-by-item assessment</h2>" + sectionItems +
    (unassigned.length ? "<h2>Unassigned items</h2>" + unassigned.map(entry => htmlItemsForOne(entry.item,entry.index)).join("") : "") +
    "<h2>Part D — Overall assessment</h2><p>Overall recommendation (select one):</p>" +
    "<p>☐ Accept as presented &nbsp;&nbsp; ☐ Accept with minor revisions &nbsp;&nbsp; ☐ Major revisions required &nbsp;&nbsp; ☐ Not suitable in its present form</p>" +
    "<p><strong>Strengths of the instrument:</strong></p><div class=\"large-space\"></div>" +
    "<p><strong>Important omissions or concerns:</strong></p><div class=\"large-space\"></div>" +
    "<p><strong>General recommendations:</strong></p><div class=\"large-space\"></div>" +
    "<p class=\"field\"><strong>Reviewer signature:</strong> <span class=\"line\"></span> &nbsp; <strong>Date:</strong> <span class=\"line\"></span></p>" +
    "<p>This form records expert content review. It does not by itself establish empirical reliability, construct validity, or final scientific validation.</p></body></html>";
  const lines = [
    "EXPERT REVIEW AND CONTENT VALIDATION FORM",
    "Research instrument: " + title,
    "Instrument version: " + version.version_number + " | Pathway: " + (pathway === "primary_data" ? "Primary data" : "Secondary data"),
    "Purpose: " + reviewText(snapshot.purpose),
    "Target population / evidence population: " + reviewText(snapshot.target_population),
    "Research context: " + reviewText(snapshot.research_context),
    "",
    "PART A — REVIEWER INFORMATION",
    "Reviewer full name: ______________________________________________",
    "Academic / professional qualification: ______________________________",
    "Institution / affiliation: __________________________________________",
    "Area of expertise: ________________________________________________",
    "Email address: __________________________ Date of review: ___________",
    "",
    "PART B — INSTRUCTIONS",
    "Assess every item for clarity, relevance and coverage. Mark one rating for each criterion and use the comments space for suggested changes.",
    ratingGuide,
    reviewText(snapshot.instrument_instructions) ? "Instrument instructions: " + reviewText(snapshot.instrument_instructions) : "",
    "",
    "PART C — ITEM-BY-ITEM ASSESSMENT"
  ];
  items.forEach((item,index) => {
    const section = sections.find(entry => String(entry.section_id || "") === String(item.section_id || ""));
    lines.push("", section ? reviewText(section.title) : "Unassigned items", (index + 1) + ". " + reviewText(item.prompt),
      "Response format: " + reviewText(item.response_type) + (item.required === true ? " | Required" : ""));
    if (Array.isArray(item.options) && item.options.length) lines.push("Response options: " + item.options.join("; "));
    if (reviewText(item.help_text)) lines.push("Help text: " + reviewText(item.help_text));
    lines.push("Clarity: 1 ___ 2 ___ 3 ___ 4 ___","Relevance: 1 ___ 2 ___ 3 ___ 4 ___",
      "Coverage: 1 ___ 2 ___ 3 ___ 4 ___","Item-specific comments / suggested revision:",
      "________________________________________________________________","________________________________________________________________");
  });
  lines.push("", "PART D — OVERALL ASSESSMENT",
    "Overall recommendation: [ ] Accept  [ ] Minor revisions  [ ] Major revisions  [ ] Not suitable",
    "Strengths of the instrument:","________________________________________________________________","________________________________________________________________",
    "Important omissions or concerns:","________________________________________________________________","________________________________________________________________",
    "General recommendations:","________________________________________________________________","________________________________________________________________",
    "Reviewer signature: ______________________________ Date: ___________","",
    "This form records expert content review. It does not by itself establish empirical reliability, construct validity, or final scientific validation.");
  const rtf = "{\\rtf1\\ansi\\deff0\\uc1{\\fonttbl{\\f0 Arial;}}\\viewkind4\\f0\\fs22 " +
    lines.map(line => escapeRtf(line) + "\\par").join(" ") + "}";
  return {html,rtf};
}

function downloadReviewerWord(version, pathway) {
  const doc = buildReviewerDocument(version,pathway);
  const blob = new Blob([doc.rtf],{type:"application/rtf;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = "expert-content-validation-v" + version.version_number + ".rtf";
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function printReviewerPdf(version, pathway) {
  const doc = buildReviewerDocument(version,pathway);
  const printWindow = window.open("","_blank");
  if (!printWindow) {
    window.alert("Please allow pop-ups for this site, then select Print / Save PDF again.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(doc.html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
}

export default function InstrumentValidationWorkflow({
  projectId, pathway, versions, records, onSave,
}: {
  projectId: string;
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
  const sectionTitles = useMemo<Map<string, string>>(() => {
    const sections = Array.isArray(selectedVersion?.snapshot.instrument_sections)
      ? selectedVersion.snapshot.instrument_sections as Array<Record<string, unknown>>
      : [];

    return new Map<string, string>(
      sections.map((section, index): [string, string] => [
        String(section.section_id ?? ""),
        String(section.title ?? `Section ${index + 1}`),
      ])
    );
  }, [selectedVersion?.version_id]);

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

  function importSubmittedReview(review: ReviewEntry) {
    if (!selectedVersion) return;
    setDraft((current) => {
      const base = current ?? newValidation(selectedVersion, pathway);
      return { ...base, expert_reviews: [...base.expert_reviews, review] };
    });
    setNotice("Submitted expert review imported. Save the validation record to retain it.");
    setError("");
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
          {selectedVersion && (
            <div className="editor-actions">
              <button className="button" type="button" onClick={() => downloadReviewerWord(selectedVersion, pathway)}>
                Download reviewer form (Word-compatible .rtf)
              </button>
              <button className="button" type="button" onClick={() => printReviewerPdf(selectedVersion, pathway)}>
                Print / Save reviewer form as PDF
              </button>
            </div>
          )}
          {selectedVersion && (
            <InstrumentReviewInvitations
              projectId={projectId}
              pathway={pathway}
              versionId={selectedVersion.version_id}
              versionNumber={selectedVersion.version_number}
              onImport={importSubmittedReview}
            />
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
                            {item.section_id != null && sectionTitles.has(String(item.section_id)) && (
                              <p className="muted">{sectionTitles.get(String(item.section_id))}</p>
                            )}
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
                    const sectionTitle = item.section_id ? sectionTitles.get(String(item.section_id)) : undefined;
                    return { itemId, prompt: String(item.prompt ?? "Untitled item"), sectionTitle, ratings, cvi: ratings.length ? ratings.filter((rating) => rating >= 3).length / ratings.length : null };
                  });
                  const available = itemCvi.filter((item) => item.cvi !== null);
                  const scaleAverage = itemCvi.length > 0 && available.length === itemCvi.length
                    ? available.reduce((sum, item) => sum + (item.cvi ?? 0), 0) / available.length : null;
                  return (
                    <div className="notice">
                      <strong>Content validity summary (4-point relevance ratings)</strong>
                      <p className="muted">I-CVI is the proportion of submitted relevance ratings of 3 or 4 for an item. S-CVI/Ave is the mean I-CVI across items with ratings. These are descriptive calculations; interpret them using a declared method and the number of reviewers, not as an automatic pass/fail.</p>
                      {itemCvi.map((item) => <p key={item.itemId}>{item.sectionTitle ? item.sectionTitle + " — " : ""}{item.prompt}: {item.cvi === null ? "Not yet rated" : item.cvi.toFixed(2) + " (I-CVI; n=" + item.ratings.length + ")"}</p>)}
                      <strong>S-CVI/Ave: {scaleAverage === null ? "Not yet available — every item needs at least one relevance rating" : scaleAverage.toFixed(2)}</strong>
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
