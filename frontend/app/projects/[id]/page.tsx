"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Nav from "../../../components/nav";
import { getProject, Project } from "../../../lib/api";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    getProject(id)
      .then((result) => setProject(result.project))
      .catch(() => setError("Project could not be loaded. Check that the API is running."));
  }, [id]);

  return (
    <div>
      <Nav />
      <main className="container page">
        {error ? (
          <div className="notice">{error}</div>
        ) : !project ? (
          <div className="notice">Loading project...</div>
        ) : (
          <>
            <div className="pagehead">
              <div>
                <div className="eyebrow">Project / {project.id.slice(0, 8)}</div>
                <h2>{project.title}</h2>
                <p className="muted">{project.discipline} · {project.status}</p>
              </div>
              <Link className="button primary" href={`/analyze?project=${project.id}`}>
                Run analysis
              </Link>
            </div>

            <div className="grid">
              <div className="card">
                <div className="muted">Research question / idea</div>
                <h3>Core research problem</h3>
                <p>{project.question}</p>
              </div>

              <div className="card">
                <div className="muted">Manuscript</div>
                <h3>Build the evidence base</h3>
                <p>Future versions will support manuscript files and structured sections.</p>
              </div>

              <div className="card">
                <div className="muted">Analysis</div>
                <h3>Prototype ready</h3>
                <p>The analysis service is separated from the UI so an AI provider can be added later.</p>
              </div>
            </div>

            <div className="notice">Project ID: {project.id}</div>
          </>
        )}
      </main>
    </div>
  );
}