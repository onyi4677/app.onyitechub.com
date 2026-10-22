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
  const [editingReferenceId, setEditingReferenceId] = useState<string | null>(null);
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

  const sortedReferences = useMemo(() => {
    const references = [...workspace.references];
    const style = workspace.citation_style.trim().toLowerCase();

    // Vancouver references are numbered by first citation appearance.
    if (style === "vancouver") {
      const citationOrder = new Map<string, number>();
      workspace.in_text_citations.forEach((citation) => {
        citation.reference_ids.forEach((id) => {
          if (!citationOrder.has(id)) citationOrder.set(id, citationOrder.size);
        });
      });
      return references.sort((a, b) => {
        const aOrder = citationOrder.get(a.reference_id);
        const bOrder = citationOrder.get(b.reference_id);
        if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
        if (aOrder !== undefined) return -1;
        if (bOrder !== undefined) return 1;
        return workspace.references.findIndex((ref) => ref.reference_id === a.reference_id)
          - workspace.references.findIndex((ref) => ref.reference_id === b.reference_id);
      });
    }

    // Author-date and other alphabetically ordered bibliography styles.
    const firstAuthorKey = (reference: ReferenceRecord) => {
      const firstAuthor = (reference.authors?.[0] || "").trim();
      // Prefer a surname when metadata is entered as "Surname, Given names".
      return firstAuthor.includes(",")
        ? firstAuthor.split(",")[0].trim().toLocaleLowerCase()
        : firstAuthor.toLocaleLowerCase();
    };
    return references.sort((a, b) => {
      const authorComparison = firstAuthorKey(a).localeCompare(firstAuthorKey(b));
      if (authorComparison !== 0) return authorComparison;
      const yearA = a.year ?? Number.MAX_SAFE_INTEGER;
      const yearB = b.year ?? Number.MAX_SAFE_INTEGER;
      if (yearA !== yearB) return yearA - yearB;
      return a.title.localeCompare(b.title);
    });
  }, [workspace.references, workspace.in_text_citations, workspace.citation_style]);

  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, ReferenceRecord[]>();
    for (const ref of workspace.references) {
      const rawDoi = (ref.doi || "").trim().toLowerCase()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
        .replace(/^doi:\s*/i, "");
      const key = rawDoi || (ref.title || "").trim().toLowerCase();
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(ref);
      groups.set(key, group);
    }
    return Array.from(groups.entries())
      .filter(([, references]) => references.length > 1)
      .map(([key, references]) => ({ key, references }));
  }, [workspace.references]);

  const duplicateCount = useMemo(
    () => duplicateGroups.reduce((count, group) => count + group.references.length - 1, 0),
    [duplicateGroups],
  );

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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the reference library.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function startEditingReference(reference: ReferenceRecord) {
    setForm({
      authors: (reference.authors || []).join("; "),
      year: reference.year == null ? "" : String(reference.year),
      title: reference.title || "",
      source_type: reference.source_type || "journal_article",
      journal_or_book: reference.journal_or_book || "",
      volume: reference.volume || "",
      issue: reference.issue || "",
      pages: reference.pages || "",
      publisher: reference.publisher || "",
      doi: reference.doi || "",
      url: reference.url || "",
      abstract: reference.abstract || "",
      keywords: (reference.keywords || []).join(", "),
    });
    setEditingReferenceId(reference.reference_id);
    setMessage("Editing existing reference. Save to update this record without changing its ID or citation links.");
    setError("");
  }

  function cancelReferenceEdit() {
    setForm(emptyReference());
    setEditingReferenceId(null);
    setMessage("Reference editing cancelled.");
  }

  async function deleteReference(reference: ReferenceRecord) {
    if (saving) return;

    const linkedCitations = workspace.in_text_citations.filter((citation) =>
      (citation.reference_ids || []).includes(reference.reference_id),
    );
    const warning = linkedCitations.length
      ? ` This reference is linked to ${linkedCitations.length} citation mapping(s); those mapping records and their text will be preserved, but this reference will be removed from their linked-reference lists.`
      : "";

    const confirmed = window.confirm(
      `Delete the reference "${reference.title}"? This cannot be undone.${warning}`,
    );
    if (!confirmed) return;

    const nextWorkspace: Workspace = {
      ...workspace,
      references: workspace.references.filter((item) => item.reference_id !== reference.reference_id),
      in_text_citations: workspace.in_text_citations.map((citation) => ({
        ...citation,
        reference_ids: (citation.reference_ids || []).filter((id) => id !== reference.reference_id),
      })),
    };

    const saved = await saveWorkspace(nextWorkspace);
    if (saved !== false) {
      if (editingReferenceId === reference.reference_id) {
        setForm(emptyReference());
        setEditingReferenceId(null);
      }
      setSelectedReferenceIds((current) => current.filter((id) => id !== reference.reference_id));
      setMessage(
        linkedCitations.length
          ? `Reference deleted. Preserved ${linkedCitations.length} citation mapping(s) and removed their links to this reference.`
          : "Reference deleted.",
      );
    }
  }

  async function addReference(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;
    const authors = form.authors.split(/\n|;/).map((part) => part.trim()).filter(Boolean);
    const nextReference: ReferenceRecord = {
      reference_id: editingReferenceId || crypto.randomUUID(),
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
    const references = editingReferenceId
      ? workspace.references.map((reference) => reference.reference_id === editingReferenceId ? nextReference : reference)
      : [...workspace.references, nextReference];
    const saved = await saveWorkspace({ ...workspace, references });
    if (saved !== false) {
      setForm(emptyReference());
      setEditingReferenceId(null);
    }
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
          <h4>{editingReferenceId ? "Edit reference" : "Add a reference"}</h4>
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
          <div className="form-row">
            <button className="button primary" type="submit" disabled={saving}>{saving ? "Saving..." : editingReferenceId ? "Save reference changes" : "Add reference"}</button>
            {editingReferenceId && <button className="button" type="button" onClick={cancelReferenceEdit} disabled={saving}>Cancel edit</button>}
          </div>
        </form>

        <div className="divider" />
        <div className="pagehead"><div><h4>Saved references ({workspace.references.length})</h4><p className="muted">Potential duplicates: {duplicateCount}. Matching DOI or title values are grouped below for review; no records are changed automatically.</p></div></div>
        {duplicateGroups.length > 0 && (
          <section className="notice" aria-label="Potential duplicate reference groups">
            <strong>Review potential duplicates</strong>
            {duplicateGroups.map((group) => (
              <div className="reference-item" key={group.key}>
                <p className="muted">{group.references[0].doi ? `Matching DOI: ${group.references[0].doi}` : "Matching title (no DOI supplied)"}</p>
                {group.references.map((reference) => (
                  <div key={reference.reference_id}>
                    <strong>{reference.title}</strong>
                    <p>{reference.authors.join("; ")}{reference.year ? ` (${reference.year})` : ""}</p>
                    {reference.doi && <p className="muted">DOI: {reference.doi}</p>}
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}
        {workspace.references.length === 0 ? <p className="muted">No references yet. Add one above or import existing Literature & Evidence sources.</p> : (
          <div className="reference-list">{sortedReferences.map((reference, index) => (
            <article className="reference-item" key={reference.reference_id}>
              <strong>{reference.title}</strong>
              <p>{reference.authors.join("; ")}{reference.year ? ` (${reference.year})` : ""}</p>
              <p className="muted">{[reference.journal_or_book, reference.volume ? `Vol. ${reference.volume}` : "", reference.issue ? `Issue ${reference.issue}` : "", reference.pages ? `pp. ${reference.pages}` : ""].filter(Boolean).join(", ")}</p>
              {reference.doi && <p><a href={reference.doi.startsWith("http") ? reference.doi : `https://doi.org/${reference.doi.replace(/^doi:\s*/i, "")}`} target="_blank" rel="noreferrer">DOI: {reference.doi}</a></p>}
              {reference.url && <p><a href={reference.url} target="_blank" rel="noreferrer">Open source</a></p>}
              <div className="form-row">
                <button className="button" type="button" disabled={saving} onClick={() => startEditingReference(reference)}>Edit reference</button>
                <button className="button" type="button" disabled={saving} onClick={() => deleteReference(reference)}>Delete reference</button>
              </div>
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
