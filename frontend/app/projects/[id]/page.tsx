"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Nav from "../../../components/nav";
import { getModules, getProject, getProjectModule, Project, ResearchModule } from "../../../lib/api";

const preferredOrder = ["research_foundation","literature_evidence","references_citations","methodology","instruments","data","analysis","prediction","manuscript","integrity","journal"];

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [modules, setModules] = useState<Record<string, ResearchModule>>({});
  const [moduleData, setModuleData] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState("");
  const [loadingModules, setLoadingModules] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([getProject(id), getModules()])
      .then(async ([projectResult, moduleResult]) => {
        setProject(projectResult.project);
        setModules(moduleResult);
        const active = preferredOrder.filter((key) => moduleResult[key]?.status === "active");
        const entries = await Promise.all(active.map(async (key) => {
          const result = await getProjectModule(id, key);
          return [key, result?.content || {}] as const;
        }));
        setModuleData(Object.fromEntries(entries));
      })
      .catch(() => setError("Project could not be loaded. Check the deployed API configuration."))
      .finally(() => setLoadingModules(false));
  }, [id]);

  return (
    <div>
      <Nav />
      <main className="container page">
        {error ? <div className="notice">{error}</div> : !project ? <div className="notice">Loading project...</div> : (
          <>
            <div className="pagehead">
              <div>
                <div className="eyebrow">Research Project / {project.id.slice(0, 8)}</div>
                <h2>{project.title}</h2>
                <p className="muted">{project.discipline} · {project.status}</p>
              </div>
              <Link className="button primary" href={`/analyze?project=${project.id}`}>Run analysis</Link>
            </div>
            <div className="card"><div className="muted">Research question</div><h3>Core research problem</h3><p>{project.question}</p></div>
            <section className="pagehead" style={{ marginTop: 28 }}><div><div className="eyebrow">Workspace</div><h3>Research modules</h3><p className="muted">Build the study as a connected research record, not as a single AI-generated document.</p></div></section>
            <div className="grid">
              {preferredOrder.filter((key) => modules[key]).map((key) => {
                const module = modules[key];
                const hasContent = Object.keys(moduleData[key] || {}).length > 0;
                return <div className="card" key={key}><div className="muted">{module.status === "active" ? "Active module" : "Planned module"}</div><h3>{module.name}</h3><p>{module.description}</p><div className="muted" style={{ marginTop: 12 }}>{hasContent ? "Project data present" : module.status === "active" ? "Ready to build" : "Coming next"}</div></div>;
              })}
            </div>
            {loadingModules && <div className="notice">Loading research workspace...</div>}
            <div className="notice">Project ID: {project.id}</div>
          </>
        )}
      </main>
    </div>
  );
}