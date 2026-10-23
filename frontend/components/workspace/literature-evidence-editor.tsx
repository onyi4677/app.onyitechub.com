"use client";

import { useEffect, useState } from "react";
import {
  addEvidenceItem,
  addLiteratureClaim,
  addLiteratureSource,
  getLiteratureWorkspace,
  saveLiteratureWorkspace,
  type LiteratureClaim,
  type LiteratureSource,
  type LiteratureSourceInput,
  type EvidenceItem,
} from "../../lib/api/literature";

function normaliseDoi(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\\s*/i, "")
    .replace(/[.\\s]+$/, "");
}

function normaliseText(value?: string | null) {
  return (value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type SourceIdentity = Pick<LiteratureSourceInput, "doi" | "title" | "year" | "authors">;

function sourceIdentityKey(item: SourceIdentity) {
  const doi = normaliseDoi(item.doi);
  if (doi) return `doi:${doi}`;
  const title = normaliseText(item.title);
  if (!title) return "";
  const year = item.year ?? "";
  const firstAuthor = normaliseText(item.authors?.find((author) => author.trim()));
  return `meta:${title}|${year}|${firstAuthor}`;
}

const emptySource = (): LiteratureSourceInput => ({
  authors: [""],
  year: new Date().getFullYear(),
  title: "",
  source_type: "journal_article",
  journal_or_publisher: "",
  volume: "",
  issue: "",
  pages: "",
  doi: "",
  url: "",
  abstract: "",
  keywords: [],
  verified: false,
});

const emptyEvidence = () => ({
  source_id: "",
  finding: "",
  population: "",
  setting: "",
  method: "",
  sample_size: null as number | null,
  limitations: [] as string[],
  notes: "",
});

const emptyClaim = () => ({
  text: "",
  evidence_ids: [] as string[],
  source_ids: [] as string[],
  confidence: "moderate",
});

export default function LiteratureEvidenceEditor({
  projectId,
}: {
  projectId: string;
}) {
  const [sources, setSources] = useState<LiteratureSource[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [claims, setClaims] = useState<LiteratureClaim[]>([]);
  const [synthesis, setSynthesis] = useState("");
  const [gap, setGap] = useState("");
  const [source, setSource] = useState<LiteratureSourceInput>(emptySource());
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [ev, setEv] = useState(emptyEvidence());
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [claim, setClaim] = useState(emptyClaim());
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const w = await getLiteratureWorkspace(projectId);

      setSources(w.sources);
      setEvidence(w.evidence_items);
      setClaims(w.claims);
      setSynthesis(w.synthesis);
      setGap(w.research_gap);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Could not load Literature & Evidence."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  function startEditingSource(item: LiteratureSource) {
    setSource({
      authors: item.authors?.length ? [...item.authors] : [""],
      year: item.year ?? null,
      title: item.title || "",
      source_type: item.source_type || "journal_article",
      journal_or_publisher: item.journal_or_publisher || "",
      volume: item.volume || "",
      issue: item.issue || "",
      pages: item.pages || "",
      doi: item.doi || "",
      url: item.url || "",
      abstract: item.abstract || "",
      keywords: [...(item.keywords || [])],
      verified: Boolean(item.verified),
    });
    setEditingSourceId(item.source_id);
    setMessage("Editing existing source. Save to update its metadata while preserving its source ID and linked evidence/claims.");
  }

  function cancelSourceEdit() {
    setSource(emptySource());
    setEditingSourceId(null);
    setMessage("Source editing cancelled.");
  }

  async function deleteSource(item: LiteratureSource) {
    if (saving) return;

    const linkedEvidence = evidence.filter((entry) => entry.source_id === item.source_id);
    const linkedEvidenceIds = new Set(linkedEvidence.map((entry) => entry.evidence_id));
    const linkedClaims = claims.filter(
      (entry) =>
        (entry.source_ids || []).includes(item.source_id) ||
        (entry.evidence_ids || []).some((id) => linkedEvidenceIds.has(id)),
    );

    if (linkedEvidence.length || linkedClaims.length) {
      const dependencies = [
        linkedEvidence.length ? `${linkedEvidence.length} evidence item(s)` : "",
        linkedClaims.length ? `${linkedClaims.length} claim(s)` : "",
      ].filter(Boolean).join(" and ");
      setMessage(`Cannot delete "${item.title}" because ${dependencies} depend on it. Reassign or remove those links first to preserve evidence provenance.`);
      return;
    }

    const confirmed = window.confirm(
      `Delete the literature source "${item.title}"? This cannot be undone. Only this source record will be removed.`,
    );
    if (!confirmed) return;

    const nextSources = sources.filter((entry) => entry.source_id !== item.source_id);
    setSaving(true);
    try {
      await saveLiteratureWorkspace(projectId, {
        sources: nextSources,
        evidence_items: evidence,
        claims,
        research_gap: gap,
        synthesis,
      });
      setSources(nextSources);
      if (editingSourceId === item.source_id) {
        setSource(emptySource());
        setEditingSourceId(null);
      }
      setMessage(`Source "${item.title}" deleted.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not delete source. No local changes were applied.");
    } finally {
      setSaving(false);
    }
  }

  async function addSource() {
    if (!source.title.trim()) {
      return setMessage("Source title is required.");
    }

    if (!source.authors.some((a) => a.trim())) {
      return setMessage("Add at least one author.");
    }

    setSaving(true);

    try {
      const sourceInput: LiteratureSourceInput = {
        ...source,
        authors: source.authors.map((author) => author.trim()).filter(Boolean),
        title: source.title.trim(),
        keywords: source.keywords.map((keyword) => keyword.trim()).filter(Boolean),
      };

      const identityKey = sourceIdentityKey(sourceInput);
      const duplicate = sources.find((item) =>
        item.source_id !== editingSourceId &&
        identityKey !== "" &&
        sourceIdentityKey(item) === identityKey
      );
      if (duplicate) {
        setMessage(`This work is already saved in Literature & Evidence as “${duplicate.title}”. Open that source to edit it instead of creating a duplicate.`);
        return;
      }

      if (editingSourceId) {
        const nextSources = sources.map((item) =>
          item.source_id === editingSourceId
            ? { ...item, ...sourceInput, source_id: item.source_id }
            : item
        );
        await saveLiteratureWorkspace(projectId, {
          sources: nextSources,
          evidence_items: evidence,
          claims,
          research_gap: gap,
          synthesis,
        });
        setSources(nextSources);
        setMessage("Source changes saved. Existing evidence and claim links were preserved.");
      } else {
        const r = await addLiteratureSource(projectId, sourceInput);
        setSources((x) => [...x, r.source]);
        setMessage("Source added. Verify it before using it as evidence.");
      }

      setSource(emptySource());
      setEditingSourceId(null);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not add source."
      );
    } finally {
      setSaving(false);
    }
  }

  async function addEv() {
    if (!ev.source_id) {
      return setMessage("Select the supporting source.");
    }

    if (!ev.finding.trim()) {
      return setMessage("Evidence finding is required.");
    }

    setSaving(true);

    try {
      const r = await addEvidenceItem(projectId, {
        ...ev,
        limitations: ev.limitations.filter(Boolean),
      });

      setEvidence((x) => [...x, r.evidence]);
      setEv(emptyEvidence());
      setMessage("Evidence item added.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not add evidence."
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditingEvidence(item: EvidenceItem) {
    setEv({
      source_id: item.source_id,
      finding: item.finding,
      population: item.population ?? "",
      setting: item.setting ?? "",
      method: item.method ?? "",
      sample_size: item.sample_size ?? null,
      limitations: item.limitations ?? [],
      notes: item.notes ?? "",
    });
    setEditingEvidenceId(item.evidence_id);
    setMessage("Editing existing evidence. Save changes to update this record.");
  }

  async function updateEvidence() {
    if (!editingEvidenceId) return;
    if (!ev.source_id) {
      return setMessage("Select the supporting source.");
    }
    if (!ev.finding.trim()) {
      return setMessage("Evidence finding is required.");
    }

    const nextEvidence = evidence.map((item) =>
      item.evidence_id === editingEvidenceId
        ? {
            ...item,
            ...ev,
            limitations: ev.limitations.filter(Boolean),
          }
        : item
    );

    setSaving(true);
    try {
      await saveLiteratureWorkspace(projectId, {
        sources,
        evidence_items: nextEvidence,
        claims,
        research_gap: gap,
        synthesis,
      });
      setEvidence(nextEvidence);
      setEv(emptyEvidence());
      setEditingEvidenceId(null);
      setMessage("Evidence changes saved. Existing source and claim links were preserved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not update evidence.");
    } finally {
      setSaving(false);
    }
  }

  function cancelEvidenceEdit() {
    setEv(emptyEvidence());
    setEditingEvidenceId(null);
    setMessage("Evidence editing cancelled.");
  }

  async function addClaim() {
    if (!claim.text.trim()) {
      return setMessage("Claim text is required.");
    }

    if (!claim.evidence_ids.length && !claim.source_ids.length) {
      return setMessage("Link the claim to evidence or a source.");
    }

    setSaving(true);

    try {
      const r = await addLiteratureClaim(projectId, claim);

      setClaims((x) => [...x, r.claim]);
      setClaim(emptyClaim());
      setMessage("Evidence-backed claim added.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not add claim."
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditingClaim(item: LiteratureClaim) {
    setClaim({
      text: item.text,
      evidence_ids: item.evidence_ids ?? [],
      source_ids: item.source_ids ?? [],
      confidence: item.confidence || "moderate",
    });
    setEditingClaimId(item.claim_id);
    setMessage("Editing existing claim. Save changes to update this record.");
  }

  async function updateClaim() {
    if (!editingClaimId) return;
    if (!claim.text.trim()) {
      return setMessage("Claim text is required.");
    }
    if (!claim.evidence_ids.length && !claim.source_ids.length) {
      return setMessage("Link the claim to evidence or a source.");
    }

    const nextClaims = claims.map((item) =>
      item.claim_id === editingClaimId
        ? { ...item, ...claim, claim_id: item.claim_id }
        : item
    );

    setSaving(true);
    try {
      await saveLiteratureWorkspace(projectId, {
        sources,
        evidence_items: evidence,
        claims: nextClaims,
        research_gap: gap,
        synthesis,
      });
      setClaims(nextClaims);
      setClaim(emptyClaim());
      setEditingClaimId(null);
      setMessage("Claim changes saved. Existing links and confidence were preserved unless changed.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not update claim.");
    } finally {
      setSaving(false);
    }
  }

  function cancelClaimEdit() {
    setClaim(emptyClaim());
    setEditingClaimId(null);
    setMessage("Claim editing cancelled.");
  }

  async function save() {
    setSaving(true);

    try {
      await saveLiteratureWorkspace(projectId, {
        sources,
        evidence_items: evidence,
        claims,
        research_gap: gap,
        synthesis,
      });

      setMessage("Synthesis and research gap saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card module-workspace">
        <p>Loading Literature & Evidence...</p>
      </div>
    );
  }

  return (
    <div className="module-editor literature-editor">
      <div className="notice">
        <strong>Evidence provenance</strong>
        <p>
          Source → verified evidence → claim → synthesis → research gap.
          Do not add invented sources, findings, quotations or study
          results.
        </p>
      </div>

      <div className="card editor-section">
        <div className="eyebrow">1. Literature sources</div>

        <label>
          Authors (one per line)
          <textarea
            rows={3}
            value={source.authors.join("\n")}
            onChange={(e) =>
              setSource({
                ...source,
                authors: e.target.value.split("\n"),
              })
            }
          />
        </label>

        <label>
          Title
          <input
            value={source.title}
            onChange={(e) =>
              setSource({
                ...source,
                title: e.target.value,
              })
            }
          />
        </label>

        <div className="form-grid">
          <label>
            Year
            <input
              type="number"
              value={source.year ?? ""}
              onChange={(e) =>
                setSource({
                  ...source,
                  year:
                    e.target.value === ""
                      ? null
                      : Number(e.target.value),
                })
              }
            />
          </label>

          <label>
            Source type
            <select
              value={source.source_type}
              onChange={(e) =>
                setSource({
                  ...source,
                  source_type: e.target.value,
                })
              }
            >
              <option value="journal_article">
                Journal article
              </option>
              <option value="book">Book</option>
              <option value="report">Report</option>
              <option value="thesis">
                Thesis/Dissertation
              </option>
              <option value="web">
                Web/Institutional source
              </option>
            </select>
          </label>
        </div>

        <label>
          Journal / publisher
          <input
            value={source.journal_or_publisher ?? ""}
            onChange={(e) =>
              setSource({
                ...source,
                journal_or_publisher: e.target.value,
              })
            }
          />
        </label>

        <div className="form-grid">
          <label>
            Volume
            <input
              value={source.volume ?? ""}
              onChange={(e) =>
                setSource({
                  ...source,
                  volume: e.target.value,
                })
              }
            />
          </label>

          <label>
            Issue
            <input
              value={source.issue ?? ""}
              onChange={(e) =>
                setSource({
                  ...source,
                  issue: e.target.value,
                })
              }
            />
          </label>

          <label>
            Pages
            <input
              value={source.pages ?? ""}
              onChange={(e) =>
                setSource({
                  ...source,
                  pages: e.target.value,
                })
              }
            />
          </label>
        </div>

        <label>
          DOI
          <input
            value={source.doi ?? ""}
            onChange={(e) =>
              setSource({
                ...source,
                doi: e.target.value,
              })
            }
          />
        </label>

        <label>
          URL
          <input
            value={source.url ?? ""}
            onChange={(e) =>
              setSource({
                ...source,
                url: e.target.value,
              })
            }
          />
        </label>

        <label>
          Abstract
          <textarea
            rows={5}
            value={source.abstract ?? ""}
            onChange={(e) =>
              setSource({
                ...source,
                abstract: e.target.value,
              })
            }
          />
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={source.verified}
            onChange={(e) =>
              setSource({
                ...source,
                verified: e.target.checked,
              })
            }
          />{" "}
          I have verified this source and its metadata.
        </label>

        <div className="button-row">
          <button
            className="button"
            type="button"
            disabled={saving}
            onClick={addSource}
          >
            {saving ? "Saving..." : editingSourceId ? "Save source changes" : "Add source"}
          </button>
          {editingSourceId && (
            <button
              className="button button-secondary"
              type="button"
              disabled={saving}
              onClick={cancelSourceEdit}
            >
              Cancel edit
            </button>
          )}
        </div>
      </div>

      {sources.length > 0 && (
        <div className="card editor-section">
          <div className="eyebrow">Saved literature sources ({sources.length})</div>
          <p className="muted">Edit metadata without creating a new source record. Linked evidence and claims remain attached to the same source ID.</p>
          {sources.map((item) => (
            <div className="notice" key={item.source_id}>
              <strong>{item.title}</strong>
              <p>{item.authors.join("; ")} ({item.year ?? "n.d."})</p>
              <p className="muted">{[item.journal_or_publisher, item.volume ? `Vol. ${item.volume}` : "", item.issue ? `Issue ${item.issue}` : "", item.pages ? `pp. ${item.pages}` : ""].filter(Boolean).join(", ")}</p>
              {item.doi && <p className="muted">DOI: {item.doi}</p>}
              <p className="muted">Verification: {item.verified ? "Verified" : "Not yet verified"}</p>
              <div className="form-row">
                <button className="button button-secondary" type="button" disabled={saving} onClick={() => startEditingSource(item)}>Edit source</button>
                <button className="button button-secondary" type="button" disabled={saving} onClick={() => deleteSource(item)}>Delete source</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card editor-section">
        <div className="eyebrow">2. Evidence extraction</div>

        <label>
          Source
          <select
            value={ev.source_id}
            onChange={(e) =>
              setEv({
                ...ev,
                source_id: e.target.value,
              })
            }
          >
            <option value="">Select a source</option>

            {sources.map((s) => (
              <option key={s.source_id} value={s.source_id}>
                {s.authors.join(", ")} ({s.year ?? "n.d."}) —{" "}
                {s.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          Finding / result
          <textarea
            rows={5}
            value={ev.finding}
            onChange={(e) =>
              setEv({
                ...ev,
                finding: e.target.value,
              })
            }
            placeholder="Record what the source actually reports."
          />
        </label>

        <div className="form-grid">
          <label>
            Population
            <input
              value={ev.population}
              onChange={(e) =>
                setEv({
                  ...ev,
                  population: e.target.value,
                })
              }
            />
          </label>

          <label>
            Setting
            <input
              value={ev.setting}
              onChange={(e) =>
                setEv({
                  ...ev,
                  setting: e.target.value,
                })
              }
            />
          </label>

          <label>
            Sample size
            <input
              type="number"
              value={ev.sample_size ?? ""}
              onChange={(e) =>
                setEv({
                  ...ev,
                  sample_size:
                    e.target.value === ""
                      ? null
                      : Number(e.target.value),
                })
              }
            />
          </label>
        </div>

        <label>
          Method
          <input
            value={ev.method}
            onChange={(e) =>
              setEv({
                ...ev,
                method: e.target.value,
              })
            }
          />
        </label>

        <label>
          Limitations
          <textarea
            rows={3}
            value={ev.limitations.join("\n")}
            onChange={(e) =>
              setEv({
                ...ev,
                limitations: e.target.value.split("\n"),
              })
            }
          />
        </label>

        <div className="button-row">
          <button
            className="button"
            type="button"
            disabled={saving}
            onClick={editingEvidenceId ? updateEvidence : addEv}
          >
            {saving
              ? "Saving..."
              : editingEvidenceId
                ? "Save evidence changes"
                : "Add evidence"}
          </button>
          {editingEvidenceId && (
            <button
              className="button button-secondary"
              type="button"
              disabled={saving}
              onClick={cancelEvidenceEdit}
            >
              Cancel edit
            </button>
          )}
        </div>

        {evidence.length > 0 && (
          <div className="evidence-list">
            <h3>Saved evidence items</h3>
            {evidence.map((item, index) => {
              const linkedSource = sources.find(
                (s) => s.source_id === item.source_id
              );
              return (
                <div className="notice" key={item.evidence_id}>
                  <strong>Evidence Item {index + 1}</strong>
                  <p>{item.finding}</p>
                  <p className="muted">
                    Source: {linkedSource?.title ?? "Source not found"}
                  </p>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => startEditingEvidence(item)}
                  >
                    Edit evidence
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card editor-section">
        <div className="eyebrow">3. Evidence-backed claims</div>

        <label>
          Claim
          <textarea
            rows={4}
            value={claim.text}
            onChange={(e) =>
              setClaim({
                ...claim,
                text: e.target.value,
              })
            }
            placeholder="State a claim directly supported by the selected evidence."
          />
        </label>

        <label>
          Evidence
          <select
            multiple
            value={claim.evidence_ids}
            onChange={(e) =>
              setClaim({
                ...claim,
                evidence_ids: Array.from(
                  e.target.selectedOptions,
                  (o) => o.value
                ),
              })
            }
          >
            {evidence.map((item) => (
              <option
                key={item.evidence_id}
                value={item.evidence_id}
              >
                {item.finding.slice(0, 120)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Literature source (optional; select one or more)
          <select
            multiple
            value={claim.source_ids}
            onChange={(e) =>
              setClaim({
                ...claim,
                source_ids: Array.from(
                  e.target.selectedOptions,
                  (o) => o.value
                ),
              })
            }
          >
            {sources.map((s) => (
              <option key={s.source_id} value={s.source_id}>
                {s.authors.join(", ")} ({s.year ?? "n.d."}) — {s.title}
              </option>
            ))}
          </select>
          <span className="muted">
            Use this when the claim is supported directly by a source. You can also select an evidence item above.
          </span>
        </label>

        <label>
          Confidence
          <select
            value={claim.confidence || ""}
            onChange={(e) =>
              setClaim({
                ...claim,
                confidence: e.target.value,
              })
            }
          >
            <option value="high">High</option>
            <option value="moderate">Moderate</option>
            <option value="low">Low</option>
          </select>
        </label>

        <div className="button-row">
          <button
            className="button"
            type="button"
            disabled={saving}
            onClick={editingClaimId ? updateClaim : addClaim}
          >
            {saving
              ? "Saving..."
              : editingClaimId
                ? "Save claim changes"
                : "Add claim"}
          </button>
          {editingClaimId && (
            <button
              className="button button-secondary"
              type="button"
              disabled={saving}
              onClick={cancelClaimEdit}
            >
              Cancel edit
            </button>
          )}
        </div>

        {claims.length > 0 && (
          <div className="evidence-list">
            <h3>Saved evidence-backed claims</h3>
            {claims.map((item, index) => {
              const linkedSources = sources.filter((s) =>
                (item.source_ids ?? []).includes(s.source_id)
              );
              const linkedEvidence = evidence.filter((evItem) =>
                (item.evidence_ids ?? []).includes(evItem.evidence_id)
              );
              return (
                <div className="notice" key={item.claim_id}>
                  <strong>Claim {index + 1}</strong>
                  <p>{item.text}</p>
                  <p className="muted">
                    Confidence: {item.confidence || "moderate"}
                  </p>
                  {linkedSources.length > 0 && (
                    <p className="muted">
                      Sources: {linkedSources.map((s) => s.title).join("; ")}
                    </p>
                  )}
                  {linkedEvidence.length > 0 && (
                    <p className="muted">
                      Evidence: {linkedEvidence.map((evItem) => evItem.finding.slice(0, 120)).join("; ")}
                    </p>
                  )}
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => startEditingClaim(item)}
                  >
                    Edit claim
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card editor-section">
        <div className="eyebrow">
          4. Synthesis & research gap
        </div>

        <label>
          Evidence synthesis
          <textarea
            rows={7}
            value={synthesis}
            onChange={(e) => setSynthesis(e.target.value)}
            placeholder="Synthesize patterns, agreements, contradictions, populations, methods and limitations."
          />
        </label>

        <label>
          Research gap
          <textarea
            rows={6}
            value={gap}
            onChange={(e) => setGap(e.target.value)}
            placeholder="State only a gap supported by the accumulated evidence."
          />
        </label>

        <button
          className="button"
          type="button"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving..." : "Save synthesis & gap"}
        </button>
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Evidence map</div>

        <div className="statrow">
          <div className="stat">
            <span>Sources</span>
            <strong>{sources.length}</strong>
          </div>

          <div className="stat">
            <span>Evidence items</span>
            <strong>{evidence.length}</strong>
          </div>

          <div className="stat">
            <span>Claims</span>
            <strong>{claims.length}</strong>
          </div>
        </div>

        {sources.length > 0 && (
          <div className="notice">
            Verified sources:{" "}
            {sources.filter((s) => s.verified).length} /{" "}
            {sources.length}.
          </div>
        )}
      </div>

      {message && <div className="notice">{message}</div>}
    </div>
  );
}