"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Nav from "../../components/nav";
import { listProjects } from "../../lib/api";
import type { Project } from "../../lib/types";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listProjects()
      .then(({ projects: result }) => setProjects(result))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load projects."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div><Nav /><main className="container page">
      <div className="pagehead">
        <div><div className="eyebrow">Research Workspace</div><h2>Dashboard</h2><p className="muted">Manage research projects and follow their development across the research lifecycle.</p></div>
        <Link className="button primary" href="/projects/new">New project</Link>
      </div>

      <div className="statrow">
        <div className="card stat"><span className="muted">Projects</span><strong>{projects.length}</strong></div>
        <div className="card stat"><span className="muted">Research modules</span><strong>11</strong></div>
        <div className="card stat"><span className="muted">Workspace</span><strong>Research-ready</strong></div>
      </div>

      <div className="pagehead" style={{ marginTop: 42 }}>
        <div><h3>Research projects</h3><p className="muted">Your projects are stored through the production research API.</p></div>
      </div>

      {error && <div className="notice">{error}</div>}
      {loading && <div className="notice">Loading research projects...</div>}
      {!loading && !error && projects.length === 0 && <div className="notice">No research projects yet. Create the first one to begin.</div>}

      <div className="list">
        {projects.map((project) => (
          <Link className="listitem" href={`/projects/${project.id}`} key={project.id}>
            <div>
              <strong>{project.title}</strong>
              <div className="muted">{project.discipline} · {project.status}</div>
            </div>
            <span className="badge">Open workspace</span>
          </Link>
        ))}
      </div>
    </main></div>
  );
}
