"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "../../components/nav";
import { analyzeIdea, getProject, Project } from "../../lib/api";

export default function AnalyzePage() {
  const [text, setText] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof analyzeIdea>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const projectId = new URLSearchParams(window.location.search).get("project");
    if (!projectId) return;

    getProject(projectId)
      .then(({ project: loadedProject }) => {
        setProject(loadedProject);
        setText(loadedProject.question);
      })
      .catch(() => setError("The project could not be loaded."));
  }, []);

  async function handleAnalyze() {
    if (!text.trim()) {
      setError("Enter a research idea before running analysis.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      setResult(await analyzeIdea(text.trim()));
    } catch {
      setError("Analysis failed. Check that the API is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Nav />
      <main className="container page">
        <div className="pagehead">
          <div>
            <div className="eyebrow">AI analysis</div>
            <h2>Analyze a research idea</h2>
            <p className="muted">
              Prototype analysis — the backend currently uses deterministic rules; no external AI credentials are required.
            </p>
          </div>
        </div>

        <div className="card form">
          {project && (
            <div className="notice">
              Analyzing project: <strong>{project.title}</strong>
            </div>
          )}

          <label htmlFor="idea">Research idea</label>
          <textarea
            id="idea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste a research idea, abstract, or problem statement..."
          />

          {error && <div className="notice">{error}</div>}

          <div className="actions">
            <button className="button primary" onClick={handleAnalyze} disabled={loading}>
              {loading ? "Analyzing..." : "Analyze idea"}
            </button>
            <Link className="button" href={project ? `/projects/${project.id}` : "/dashboard"}>
              Back
            </Link>
          </div>

          {result && (
            <div className="notice">
              <strong>{result.summary}</strong>
              <p>Word count: {result.word_count}</p>
              <ul>{result.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}