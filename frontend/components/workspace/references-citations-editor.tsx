"use client";

import { useEffect, useMemo, useState } from "react";
import { getProjectModule, saveProjectModule } from "../../lib/api/modules";
import { apiRequest } from "../../lib/api/client";
import { getLiteratureWorkspace } from "../../lib/api/literature";

type ReferenceRecord = {
  reference_id: string;
  authors: string[];
  year: number | null;
  title: string;
  source_type: string;
  journal_or_book?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  doi?: string | null;
  url?: string | null;
  abstract?: string | null;
  keywords: string[];
};

type CitationRecord = {
  citation_id: string;
  reference_ids: string[];
  text: string;
  citation_form: string;
  location?: string | null;
  page?: string | null;
};

type Workspace = {
  references: ReferenceRecord[];
  in_text_citations: CitationRecord[];
  citation_style: string;
  integrity_report?: Record<string, unknown>;
};

const emptyReference = () => ({
  authors: "",
  year: "",
  title: "",
  source_type: "journal_article",
  journal_or_book: "",
  volume: "",
  issue: "",
  pages: "",
  publisher: "",
  doi: "",
  url: "",
  abstract: "",
  keywords: "",
});

const styles = ["APA 7", "Vancouver", "Harvard", "MLA", "Chicago"];

function normaliseWorkspace(value: Record<string, unknown> = {}): Workspace {
  return {
    references: Array.isArray(value.references) ? value.references as ReferenceRecord[] : [],
    in_text_citations: Array.isArray(value.in_text_citations) ? value.in_text_citations as CitationRecord[] : [],
    citation_style: typeof value.citation_style === "string" ? value.citation_style : "APA 7",
    integrity_report: value.integrity_report as Record<string, unknown> | undefined,
  };
}

function referenceLabel(reference: ReferenceRecord) {
  const author = reference.authors?.[0] || "Author unknown";
  const etAl = (reference.authors?.length || 0) > 1 ? " et al." : "";
  return `${author}${etAl} (${reference.year ?? "n.d."}) — ${reference.title}`;
}

export default function ReferencesCitationsEditor({ projectId }: { projectId: string }) {
  const [workspace, setWorkspace] = useState<Workspace>({ references: [], in_text_citations: [], citation_style: "APA 7" });
  const [form, setForm] = useState(emptyReference());
  const [citationText, setCitationText] = useState("");
  const [citationForm, setCitationForm] = useState("");
  const [citationLocation, setCitationLocation] = useState("");
  const [citationPage, setCitationPage] = useState("");
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [integrity, setIntegrity] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    getProjectModule(projectId, "references_citations")
      .then((result) => setWorkspace(normaliseWorkspace(result.content)))
      .catch((err) => setError(err instanceof Error ? err.message : "References could not be loaded."))
      .finally(() => setLoading(false));
  }, [projectId]);

  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    let count = 0;
    for (const ref of workspace.references) {
      const key = (ref.doi || ref.title || "").trim().toLowerCase();
      if (key && seen.has(key)) count += 1;
      if (key) seen.add(key);
    }
    return count;
  }, [workspace.references]);

  function updateForm(key: keyof ReturnType<typeof emptyReference>, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveWorkspace(next: Workspace = workspace) {
    setSaving(true);
    setError("");
    try {
      await saveProjectModule(projectId, "references_citations", next as unknown as Record<string, unknown>);
      setWorkspace(next);
      setMessage("References and citations saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the reference library.");
    } finally {
      setSaving(false);
    }
  }

  async function addReference(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;
    const authors = form.authors.split(/\n|;/).map((part) => part.trim()).filter(Boolean);
    const nextReference: ReferenceRecord = {
      reference_id: crypto.randomUUID(),
      authors,
      year: form.year.trim() ? Number(form.year) : null,
      title: form.title.trim(),
      source_type: form.source_type,
      journal_or_book: form.journal_or_book.trim() || null,
      volume: form.volume.trim() || null,
      issue: form.issue.trim() || null,
      pages: form.pages.trim() || null,
      publisher: form.publisher.trim() || null,
      doi: form.doi.trim() || null,
      url: form.url.trim() || null,
      abstract: form.abstract.trim() || null,
      keywords: form.keywords.split(",").map((part) => part.trim()).filter(Boolean),
    };
    const next = { ...workspace, references: [...workspace.references, nextReference] };
    await saveWorkspace(next);
    setForm(emptyReference());
  }

  async function importLiteratureSources() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const literature = await getLiteratureWorkspace(projectId);
      const existingKeys = new Set(workspace.references.map((ref) => (ref.doi || ref.title).trim().toLowerCase()));
      const additions: ReferenceRecord[] = literature.sources
        .filter((source) => {
          const key = (source.doi || source.title).trim().toLowerCase();
          return key && !existingKeys.has(key);
        })
        .map((source) => ({
          reference_id: source.source_id,
          authors: source.authors || [],
          year: source.year ?? null,
          title: source.title,
          source_type: source.source_type || "journal_article",
          journal_or_book: source.journal_or_publisher ?? null,
          volume: source.volume ?? null,
          issue: source.issue ?? null,
          pages: source.pages ?? null,
          publisher: null,
          doi: source.doi ?? null,
          url: source.url ?? null,
          abstract: source.abstract ?? null,
          keywords: source.keywords || [],
        }));
      const next = { ...workspace, references: [...workspace.references, ...additions] };
      await saveWorkspace(next);
      setMessage(additions.length ? `Imported ${additions.length} literature source(s).` : "No new literature sources to import; existing titles/DOIs were matched.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import literature sources.");
    } finally {
      setBusy(false);
    }
  }

  async function addCitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!citationText.trim() || !citationForm.trim() || selectedReferenceIds.length === 0) return;
    const item: CitationRecord = {
      citation_id: crypto.randomUUID(),
      reference_ids: selectedReferenceIds,
      text: citationText.trim(),
      citation_form: citationForm.trim(),
      location: citationLocation.trim() || null,
      page: citationPage.trim() || null,
    };
    const next = { ...workspace, in_text_citations: [...workspace.in_text_citations, item] };
    await saveWorkspace(next);
    setCitationText("");
    setCitationForm("");
    setCitationLocation("");
    setCitationPage("");
    setSelectedReferenceIds([]);
  }

  async function runIntegrityCheck() {
    setBusy(true);
    setError("");
    try {
      const report = await apiRequest<Record<string, unknown>>(`/api/projects/${encodeURIComponent(projectId)}/citation-integrity`);
      setIntegrity(report);
      setMessage("Citation integrity check complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Citation integrity check failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="card"><p className="muted">Loading reference library...</p></div>;

  return (
    <div className="module-workspace">
      {error && <div className="notice" role="alert">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}

      <section className="card">
        <div className="pagehead">
          <div><div className="eyebrow">Bibliography management</div><h3>Reference library</h3><p className="muted">Store verified source metadata once and reuse it in citations for this project.</p></div>
          <button className="button" type="button" onClick={importLiteratureSources} disabled={busy}>{busy ? "Working..." : "Import literature sources"}</button>
        </div>
        <div className="form-row">
          <label className="field-label" htmlFor="citation-style">Citation style</label>
          <select id="citation-style" className="input" value={workspace.citation_style} onChange={(event) => setWorkspace((current) => ({ ...current, citation_style: event.target.value }))}>
            {styles.map((style) => <option key={style} value={style}>{style}</option>)}
          </select>
          <button className="button primary" type="button" onClick={() => saveWorkspace()} disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
        </div>

        <form onSubmit={addReference} className="stack-form">
          <h4>Add a reference</h4>
          <label className="field-label">Author(s) <span className="muted">— separate authors with semicolons or new lines</span>
            <textarea className="input" rows={2} value={form.authors} onChange={(e) => updateForm("authors", e.target.value)} placeholder="Kaiser, B. N.; Ticao, C." />
          </label>
          <div className="form-grid">
            <label className="field-label">Year<input className="input" type="number" min="1000" max="2100" value={form.year} onChange={(e) => updateForm("year", e.target.value)} /></label>
            <label className="field-label">Source type<select className="input" value={form.source_type} onChange={(e) => updateForm("source_type", e.target.value)}><option value="journal_article">Journal article</option><option value="book">Book</option><option value="book_chapter">Book chapter</option><option value="report">Report</option><option value="thesis">Thesis/dissertation</option><option value="conference_paper">Conference paper</option><option value="webpage">Web page</option><option value="other">Other</option></select></label>
          </div>
          <label className="field-label">Title *<input className="input" required value={form.title} onChange={(e) => updateForm("title", e.target.value)} /></label>
          <label className="field-label">Journal or book<input className="input" value={form.journal_or_book} onChange={(e) => updateForm("journal_or_book", e.target.value)} /></label>
          <div className="form-grid">
            <label className="field-label">Volume<input className="input" value={form.volume} onChange={(e) => updateForm("volume", e.target.value)} /></label>
            <label className="field-label">Issue<input className="input" value={form.issue} onChange={(e) => updateForm("issue", e.target.value)} /></label>
            <label className="field-label">Pages<input className="input" value={form.pages} onChange={(e) => updateForm("pages", e.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label className="field-label">Publisher<input className="input" value={form.publisher} onChange={(e) => updateForm("publisher", e.target.value)} /></label>
            <label className="field-label">DOI<input className="input" value={form.doi} onChange={(e) => updateForm("doi", e.target.value)} placeholder="10.xxxx/xxxxx" /></label>
          </div>
          <label className="field-label">URL<input className="input" type="url" value={form.url} onChange={(e) => updateForm("url", e.target.value)} /></label>
          <label className="field-label">Abstract or notes<textarea className="input" rows={3} value={form.abstract} onChange={(e) => updateForm("abstract", e.target.value)} /></label>
          <label className="field-label">Keywords <span className="muted">— comma-separated</span><input className="input" value={form.keywords} onChange={(e) => updateForm("keywords", e.target.value)} /></label>
          <button className="button primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Add reference"}</button>
        </form>

        <div className="divider" />
        <div className="pagehead"><div><h4>Saved references ({workspace.references.length})</h4><p className="muted">Potential duplicates: {duplicateCount}. Confirm metadata before manuscript submission.</p></div></div>
        {workspace.references.length === 0 ? <p className="muted">No references yet. Add one above or import existing Literature & Evidence sources.</p> : (
          <div className="reference-list">{workspace.references.map((reference) => (
            <article className="reference-item" key={reference.reference_id}>
              <strong>{reference.title}</strong>
              <p>{reference.authors.join("; ")}{reference.year ? ` (${reference.year})` : ""}</p>
              <p className="muted">{[reference.journal_or_book, reference.volume ? `Vol. ${reference.volume}` : "", reference.issue ? `Issue ${reference.issue}` : "", reference.pages ? `pp. ${reference.pages}` : ""].filter(Boolean).join(", ")}</p>
              {reference.doi && <p><a href={reference.doi.startsWith("http") ? reference.doi : `https://doi.org/${reference.doi.replace(/^doi:\s*/i, "")}`} target="_blank" rel="noreferrer">DOI: {reference.doi}</a></p>}
              {reference.url && <p><a href={reference.url} target="_blank" rel="noreferrer">Open source</a></p>}
            </article>
          ))}</div>
        )}
      </section>

      <section className="card">
        <div className="eyebrow">Citation mapping</div><h3>In-text citations</h3>
        <p className="muted">Record the citation marker and the manuscript text/location where it is used. This module maps citations; it does not yet insert them into a rich-text manuscript editor.</p>
        <form onSubmit={addCitation} className="stack-form">
          <label className="field-label">References for this citation
            <select className="input" multiple size={Math.min(5, Math.max(2, workspace.references.length))} value={selectedReferenceIds} onChange={(e) => setSelectedReferenceIds(Array.from(e.target.selectedOptions, (option) => option.value))}>
              {workspace.references.map((reference) => <option key={reference.reference_id} value={reference.reference_id}>{referenceLabel(reference)}</option>)}
            </select>
          </label>
          <label className="field-label">Citation text or manuscript excerpt *<textarea className="input" rows={2} required value={citationText} onChange={(e) => setCitationText(e.target.value)} placeholder="Example: Conflict exposure is associated with substantial psychosocial needs..." /></label>
          <label className="field-label">In-text citation form *<input className="input" required value={citationForm} onChange={(e) => setCitationForm(e.target.value)} placeholder="(Kaiser et al., 2020)" /></label>
          <div className="form-grid">
            <label className="field-label">Manuscript section/location<input className="input" value={citationLocation} onChange={(e) => setCitationLocation(e.target.value)} placeholder="Introduction, paragraph 2" /></label>
            <label className="field-label">Page (if applicable)<input className="input" value={citationPage} onChange={(e) => setCitationPage(e.target.value)} /></label>
          </div>
          <button className="button primary" type="submit" disabled={saving || workspace.references.length === 0}>Save citation mapping</button>
        </form>
        <div className="divider" />
        <h4>Mapped citations ({workspace.in_text_citations.length})</h4>
        {workspace.in_text_citations.length === 0 ? <p className="muted">No in-text citations mapped yet.</p> : workspace.in_text_citations.map((citation) => (
          <article className="reference-item" key={citation.citation_id}>
            <strong>{citation.citation_form}</strong>
            <p>{citation.text}</p>
            <p className="muted">{citation.location || "No section specified"}{citation.page ? ` · p. ${citation.page}` : ""}</p>
            <p className="muted">{citation.reference_ids.map((id) => workspace.references.find((ref) => ref.reference_id === id)?.title || "Reference not found").join("; ")}</p>
          </article>
        ))}
      </section>

      <section className="card">
        <div className="pagehead"><div><div className="eyebrow">Quality control</div><h3>Citation integrity</h3><p className="muted">Check for duplicate records, citations without references, and references that have not been cited.</p></div><button className="button" type="button" onClick={runIntegrityCheck} disabled={busy}>{busy ? "Checking..." : "Run integrity check"}</button></div>
        {integrity && <div className="notice">
          <strong>Status: {String(integrity.status || "checked")}</strong>
          <p>References: {String(integrity.reference_count ?? 0)} · Citation mappings: {String(integrity.citation_count ?? 0)}</p>
          <p>Uncited references: {Array.isArray(integrity.uncited_references) ? integrity.uncited_references.length : 0} · Duplicate records: {Array.isArray(integrity.duplicate_references) ? integrity.duplicate_references.length : 0} · Unresolved citation links: {Array.isArray(integrity.orphan_citations) ? integrity.orphan_citations.length : 0}</p>
        </div>}
      </section>
    </div>
  );
}
