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
  getProject,
} from "../../../../lib/api";
import type {
  ManuscriptSourceCollection,
  ManuscriptWorkspace,
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
            <p className="muted">The version is linked to the reviewed source snapshot. Section drafting and researcher approval are the next development stage; no manuscript text or findings have been generated at this step.</p>
          </section>
        )}
      </main>
    </div>
  );
}
