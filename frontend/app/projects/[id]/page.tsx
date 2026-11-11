"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Nav from "../../../components/nav";
import ModuleCard from "../../../components/workspace/module-card";
import { getModules, getProject, getProjectModule, updateProject } from "../../../lib/api";
import type { Project, ResearchModule } from "../../../lib/types";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [modules, setModules] = useState<Record<string, ResearchModule>>({});
  const [moduleData, setModuleData] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [disciplineDraft, setDisciplineDraft] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([getProject(id), getModules()])
      .then(async ([projectResult, moduleResult]) => {
        setProject(projectResult.project);
        setModules(moduleResult);
        const entries = await Promise.all(
          Object.entries(moduleResult)
            .filter(([, definition]) => definition.status === "active")
            .map(async ([key]) => {
              try {
                const result = await getProjectModule(id, key);
                return [key, result.content] as const;
              } catch {
                return [key, {}] as const;
              }
            })
        );
        setModuleData(Object.fromEntries(entries));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Project could not be loaded."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <><Nav /><main className="container page"><div className="notice">Loading research workspace...</div></main></>;
  if (error || !project) return <><Nav /><main className="container page"><div className="notice">{error || "Project not found."}</div></main></>;

  const moduleEntries = Object.entries(modules);

  function beginEditing() {
    if (!project) return;
    setTitleDraft(project.title);
    setQuestionDraft(project.question);
    setDisciplineDraft(project.discipline);
    setSaveError("");
    setSaveMessage("");
    setEditing(true);
  }

  async function handleProjectUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");
    setSaveMessage("");
    if (!titleDraft.trim() || !questionDraft.trim() || !disciplineDraft.trim()) {
      setSaveError("Please complete the title, research question and discipline.");
      return;
    }
    setSaving(true);
    try {
      const result = await updateProject(id, {
        title: titleDraft.trim(),
        question: questionDraft.trim(),
        discipline: disciplineDraft.trim(),
      });
      setProject(result.project);
      setEditing(false);
      setSaveMessage("Project details updated successfully.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not update project details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div><Nav /><main className="container page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Research Project / {project.id.slice(0, 8)}</div>
          <h2>{project.title}</h2>
          <p className="muted">{project.discipline} · {project.status}</p>
        </div>
        <div className="actions">
          <button className="button" type="button" onClick={beginEditing}>Edit project details</button>
          <Link className="button primary" href={`/analyze?project=${project.id}`}>Run analysis</Link>
        </div>
      </div>

      {saveMessage && <div className="notice">{saveMessage}</div>}
      {editing && (
        <form className="card form" onSubmit={handleProjectUpdate}>
          <h3>Edit project details</h3>
          <label htmlFor="edit-project-title">Project title</label>
          <input id="edit-project-title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={200} required />
          <label htmlFor="edit-project-question">Research question or core research idea</label>
          <textarea id="edit-project-question" value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} maxLength={100000} required />
          <label htmlFor="edit-project-discipline">Discipline</label>
          <input id="edit-project-discipline" value={disciplineDraft} onChange={(event) => setDisciplineDraft(event.target.value)} maxLength={100} required />
          {saveError && <div className="notice">{saveError}</div>}
          <div className="actions">
            <button className="button primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
            <button className="button" type="button" onClick={() => { setEditing(false); setSaveError(""); }}>Cancel</button>
          </div>
          <p className="muted">Your project ID and saved research modules will be preserved.</p>
        </form>
      )}
      <div className="card">
        <div className="muted">Research question</div>
        <h3>Core research problem</h3>
        <p>{project.question}</p>
      </div>

      <section className="pagehead" style={{ marginTop: 36 }}>
        <div><div className="eyebrow">Workspace</div><h3>Research lifecycle</h3><p className="muted">Develop the study as connected research records. Each module has its own workspace and backend persistence.</p></div>
      </section>

      <div className="grid">
        {moduleEntries.map(([key, module]) => (
          <ModuleCard key={key} projectId={project.id} moduleKey={key} module={module} hasContent={Object.keys(moduleData[key] || {}).length > 0} />
        ))}
      </div>

      <div className="notice">Project ID: {project.id}</div>
    </main></div>
  );
}
