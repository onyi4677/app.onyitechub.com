"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Nav from "../../../../../components/nav";
import WorkspaceSidebar from "../../../../../components/workspace/workspace-sidebar";
import ResearchFoundationEditor from "../../../../../components/workspace/research-foundation-editor";
import { getModules, getProject, getProjectModule, ResearchModule } from "../../../../../lib/api";
import type { Project } from "../../../../../lib/types";

export default function ModulePage() {
  const params = useParams<{ id: string; module: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [modules, setModules] = useState<Record<string, ResearchModule>>({});
  const [moduleData, setModuleData] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState("");
  const module = params.module;

  useEffect(() => {
    if (!params.id) return;
    Promise.all([getProject(params.id), getModules(), getProjectModule(params.id, module)])
      .then(([projectResult, moduleResult, contentResult]) => {
        setProject(projectResult.project);
        setModules(moduleResult);
        setModuleData({ [module]: contentResult.content });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Module could not be loaded."));
  }, [params.id, module]);

  if (error) return <><Nav /><main className="container page"><div className="notice">{error}</div></main></>;
  if (!project || !modules[module]) return <><Nav /><main className="container page"><div className="notice">Loading research module...</div></main></>;

  const definition = modules[module];

  return (
    <div>
      <Nav />
      <main className="container page">
        <div className="workspace-layout">
          <WorkspaceSidebar projectId={project.id} modules={modules} activeModule={module} moduleData={moduleData} />
          <section className="workspace-main">
            <div className="pagehead">
              <div>
                <div className="eyebrow">{project.title}</div>
                <h2>{definition.name}</h2>
                <p className="muted">{definition.description}</p>
              </div>
              <Link className="button" href={`/projects/${project.id}`}>Workspace overview</Link>
            </div>
            {module === "research_foundation" ? (
              <ResearchFoundationEditor project={project} projectId={project.id} />
            ) : (
            <div className="card module-workspace">
              <div className="module-placeholder">
                <div className="eyebrow">{definition.status === "active" ? "Research module" : "Planned module"}</div>
                <h3>{definition.status === "active" ? "Ready for structured research work" : "Module architecture prepared"}</h3>
                <p>
                  {definition.status === "active"
                    ? "This module is connected to the research project backend. The structured editor and validation workflow will be built here."
                    : "The module is registered in the research workflow and will become available as its backend capability is implemented."}
                </p>
                {Object.keys(moduleData[module] || {}).length > 0 && (
                  <div className="notice">Existing project data is available in this module.</div>
                )}
              </div>
            </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
