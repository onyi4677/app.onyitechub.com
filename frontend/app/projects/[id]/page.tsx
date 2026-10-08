"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Nav from "../../../components/nav";
import ModuleCard from "../../../components/workspace/module-card";
import { getModules, getProject, getProjectModule } from "../../../lib/api";
import type { Project, ResearchModule } from "../../../lib/types";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [modules, setModules] = useState<Record<string, ResearchModule>>({});
  const [moduleData, setModuleData] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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

  return (
    <div><Nav /><main className="container page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Research Project / {project.id.slice(0, 8)}</div>
          <h2>{project.title}</h2>
          <p className="muted">{project.discipline} · {project.status}</p>
        </div>
        <Link className="button primary" href={`/analyze?project=${project.id}`}>Run analysis</Link>
      </div>

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
