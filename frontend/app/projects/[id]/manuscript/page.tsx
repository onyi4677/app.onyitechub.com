"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Nav from "../../../../components/nav";
import {
  collectManuscriptSources,
  createManuscriptVersion,
  createManuscriptWorkspace,
  getManuscriptWorkspace,
  getCurrentManuscript,
  saveManuscriptSection,
  getProject,
} from "../../../../lib/api";
import type {
  ManuscriptSourceCollection,
  ManuscriptWorkspace,
  ManuscriptSection,
  CurrentManuscript,
  Project,
} from "../../../../lib/api";

export default function ManuscriptDevelopmentPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [workspace, setWorkspace] = useState<ManuscriptWorkspace | null>(null);
  const [title, setTitle] = useState("");
  const [collection, setCollection] = useState<ManuscriptSourceCollection | null>(null);
  const [version, setVersion] = useState<{ version_id: string; version_number: number; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [currentManuscript, setCurrentManuscript] = useState<CurrentManuscript | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [sectionDraft, setSectionDraft] = useState<ManuscriptSection | null>(null);
  const [sectionSaving, setSectionSaving] = useState(false);
  const [sectionMessage, setSectionMessage] = useState("");
  const [sectionError, setSectionError] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getProject(id),
      getManuscriptWorkspace(id).catch(() => null),
    ])
      .then(([projectResult, workspaceResult]) => {
        setProject(projectResult.project);
        setTitle(projectResult.project.title);
        setWorkspace(workspaceResult);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load manuscript development."))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleCreateWorkspace() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await createManuscriptWorkspace(id, title.trim(), "scoping_review");
      setWorkspace(result);
      setMessage("Scoping review manuscript workspace created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create manuscript workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCollectSources() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await collectManuscriptSources(id);
      setCollection(result);
      setVersion(null);
      setMessage("Research source snapshot collected. Original research modules were read only.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to collect research sources.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenVersion() {
    setBusy(true);
    setSectionError("");
    setSectionMessage("");
    try {
      const result = await getCurrentManuscript(id);
      if (!result.version) {
        throw new Error("There is no manuscript version to open yet.");
      }
      const defaults: ManuscriptSection[] = [
        { section_id: "title-page", title: "Title page", order: 0, content: "", status: "empty" },
        { section_id: "abstract", title: "Abstract", order: 1, content: "", status: "empty" },
        { section_id: "introduction", title: "Introduction", order: 2, content: "", status: "empty" },
        { section_id: "methods", title: "Methods", order: 3, content: "", status: "empty" },
        { section_id: "results", title: "Results", order: 4, content: "", status: "empty" },
        { section_id: "discussion", title: "Discussion", order: 5, content: "", status: "empty" },
        { section_id: "limitations", title: "Limitations", order: 6, content: "", status: "empty" },
        { section_id: "conclusion", title: "Conclusion", order: 7, content: "", status: "empty" },
        { section_id: "references", title: "References", order: 8, content: "", status: "empty" },
      ];
      const savedById = new Map<string, ManuscriptSection>();
      result.sections.forEach((section) => savedById.set(section.section_id, section));
      const sections = defaults.map((section) => savedById.get(section.section_id) || section);
      for (const saved of result.sections) {
        if (!sections.some((section) => section.section_id === saved.section_id)) sections.push(saved);
      }
      const loaded = { ...result, sections };
      setCurrentManuscript(loaded);
      const first = sections[0];
      setSelectedSectionId(first.section_id);
      setSectionDraft(first);
      setSectionMessage("Version opened. Empty sections are placeholders and have not been drafted.");
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Unable to open manuscript version.");
    } finally {
      setBusy(false);
    }
  }

  function chooseSection(sectionId: string) {
    if (!currentManuscript) return;
    const section = currentManuscript.sections.find((item) => item.section_id === sectionId);
    if (section) {
      setSelectedSectionId(sectionId);
      setSectionDraft({ ...section });
      setSectionMessage("");
      setSectionError("");
    }
  }

  async function handleSaveSection() {
    if (!currentManuscript?.version || !sectionDraft) return;
    setSectionSaving(true);
    setSectionError("");
    setSectionMessage("");
    try {
      const saved = await saveManuscriptSection(id, currentManuscript.version.version_id, sectionDraft);
      setCurrentManuscript((previous) => previous ? {
        ...previous,
        sections: previous.sections.map((item) => item.section_id === saved.section_id ? saved : item),
      } : previous);
      setSectionDraft(saved);
      setSectionMessage("Section saved.");
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : "Unable to save section.");
    } finally {
      setSectionSaving(false);
    }
  }

  async function handleCreateVersion() {
    if (!collection) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await createManuscriptVersion(id, collection.source_snapshot_id, "scoping-review", 1);
      setVersion(result);
      setMessage(`Manuscript version ${result.version_number} created from this source snapshot.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create manuscript version.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <><Nav /><main className="container page"><div className="notice">Loading manuscript workspace...</div></main></>;
  if (!project) return <><Nav /><main className="container page"><div className="notice">{error || "Project not found."}</div></main></>;

  return (
    <div>
      <Nav />
      <main className="container page">
        <div className="pagehead">
          <div>
            <div className="eyebrow">Research Project / Manuscript Development</div>
            <h2>{project.title}</h2>
            <p className="muted">Build one manuscript from the connected research modules. Source records remain unchanged.</p>
          </div>
          <Link className="button" href={`/projects/${id}`}>Back to project</Link>
        </div>

        {error && <div className="notice">{error}</div>}
        {message && <div className="notice">{message}</div>}

        <section className="card form">
          <h3>1. Manuscript workspace</h3>
          {workspace ? (
            <>
              <p><strong>Workspace:</strong> {workspace.title}</p>
              <p><strong>Article type:</strong> Scoping review</p>
              <p className="muted">Temporary workspace expiry: {workspace.expires_at_iso ? new Date(workspace.expires_at_iso).toLocaleString() : "Not available"}</p>
            </>
          ) : (
            <>
              <p className="muted">Create a temporary manuscript workspace for this project. This first workflow is configured for Project 001's scoping review.</p>
              <label htmlFor="manuscript-title">Manuscript title</label>
              <input id="manuscript-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} />
              <div className="actions">
                <button className="button primary" type="button" onClick={handleCreateWorkspace} disabled={busy || !title.trim()}>
                  {busy ? "Creating..." : "Create scoping review workspace"}
                </button>
              </div>
            </>
          )}
        </section>

        {workspace && (
          <section className="card form">
            <h3>2. Collect research sources</h3>
            <p className="muted">The collector reads Research Foundation, Literature and Evidence, Study Screening, Reference and Citation, Research Design and Methodology, and Instruments. It creates a separate snapshot and does not edit the source modules.</p>
            <button className="button primary" type="button" onClick={handleCollectSources} disabled={busy}>
              {busy ? "Working..." : "Collect research sources"}
            </button>
          </section>
        )}

        {collection && (
          <section className="card form">
            <h3>3. Review source snapshot</h3>
            <p><strong>Snapshot ID:</strong> {collection.source_snapshot_id}</p>
            <p><strong>Captured:</strong> {new Date(collection.captured_at).toLocaleString()}</p>
            <p><strong>Canonical bibliography sources:</strong> {collection.canonical_source_count}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Research module</th><th>Status</th><th>Record counts</th></tr></thead>
                <tbody>
                  {Object.entries(collection.modules).map(([key, summary]) => (
                    <tr key={key}>
                      <td>{key.replaceAll("_", " ")}</td>
                      <td>{summary.status}</td>
                      <td>{Object.entries(summary.record_counts || {}).map(([field, count]) => `${field}: ${count}`).join(" · ") || "No list records reported"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">This is a source inventory, not a claim that all records are verified or eligible for inclusion.</p>
            <button className="button primary" type="button" onClick={handleCreateVersion} disabled={busy}>
              {busy ? "Creating..." : "Create first manuscript version"}
            </button>
          </section>
        )}

        {version && (
          <section className="card form">
            <h3>4. Manuscript version created</h3>
            <p><strong>Version:</strong> {version.version_number}</p>
            <p><strong>Status:</strong> {version.status}</p>
            <p><strong>Version ID:</strong> {version.version_id}</p>
            <p className="muted">The version is linked to the reviewed source snapshot. It contains no generated manuscript text yet.</p>
            <button className="button primary" type="button" onClick={handleOpenVersion} disabled={busy}>
              {busy ? "Opening..." : "Open manuscript version"}
            </button>
          </section>
        )}

        {workspace?.current_version_id && !version && (
          <section className="card form">
            <h3>4. Current manuscript version</h3>
            <p className="muted">A saved version already exists in this workspace. Open it to continue editing.</p>
            <button className="button primary" type="button" onClick={handleOpenVersion} disabled={busy}>
              {busy ? "Opening..." : "Open manuscript version"}
            </button>
          </section>
        )}

        {currentManuscript?.version && sectionDraft && (
          <section className="card form">
            <h3>5. Manuscript editor — version {currentManuscript.version.version_number}</h3>
            <p><strong>Version status:</strong> {currentManuscript.version.status}</p>
            <p><strong>Linked source snapshot:</strong> {currentManuscript.version.source_snapshot_id}</p>
            <p className="muted">Choose a section, edit its text and save it independently. No AI-generated text is inserted. Use the linked research modules and snapshot as evidence; mark gaps rather than inventing information.</p>
            <div className="grid" style={{ gridTemplateColumns: "minmax(190px, 0.8fr) minmax(0, 2fr)", gap: 20 }}>
              <div>
                <h4>Sections</h4>
                <div className="stack">
                  {currentManuscript.sections.map((section) => (
                    <button
                      key={section.section_id}
                      type="button"
                      className={selectedSectionId === section.section_id ? "button primary" : "button"}
                      onClick={() => chooseSection(section.section_id)}
                    >
                      {section.title} · {section.status.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="manuscript-section-title">Section title</label>
                <input
                  id="manuscript-section-title"
                  value={sectionDraft.title}
                  onChange={(event) => setSectionDraft({ ...sectionDraft, title: event.target.value })}
                  maxLength={300}
                />
                <label htmlFor="manuscript-section-content">Section text</label>
                <textarea
                  id="manuscript-section-content"
                  value={sectionDraft.content}
                  onChange={(event) => setSectionDraft({ ...sectionDraft, content: event.target.value })}
                  rows={18}
                  maxLength={250000}
                  placeholder="Write or paste researcher-reviewed content here. Do not enter unsupported findings or references."
                />
                <label htmlFor="manuscript-section-status">Review status</label>
                <select
                  id="manuscript-section-status"
                  value={sectionDraft.status}
                  onChange={(event) => setSectionDraft({ ...sectionDraft, status: event.target.value as ManuscriptSection["status"] })}
                >
                  <option value="empty">Empty</option>
                  <option value="needs_input">Needs input</option>
                  <option value="draft">Draft</option>
                  <option value="in_review">In review</option>
                  <option value="approved">Approved</option>
                </select>
                {sectionError && <div className="notice">{sectionError}</div>}
                {sectionMessage && <div className="notice">{sectionMessage}</div>}
                <div className="actions">
                  <button className="button primary" type="button" onClick={handleSaveSection} disabled={sectionSaving || !sectionDraft.title.trim()}>
                    {sectionSaving ? "Saving..." : "Save section"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
