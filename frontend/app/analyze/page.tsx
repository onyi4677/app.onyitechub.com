"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "../../components/nav";
import { analyzeIdea, chatWithNatlas, getProject, Project } from "../../lib/api";

export default function AnalyzePage() {
  const [text, setText] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof analyzeIdea>> | null>(null);
  const [natlasAnswer, setNatlasAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [natlasLoading, setNatlasLoading] = useState(false);

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
    setNatlasAnswer("");
    setLoading(true);
    try {
      setResult(await analyzeIdea(text.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed. Check that the API is running.");
    } finally {
      setLoading(false);
    }
  }

  async function handleNatlas() {
    if (!text.trim()) {
      setError("Enter a research question or idea before using N-ATLaS.");
      return;
    }

    setError("");
    setResult(null);
    setNatlasAnswer("");
    setNatlasLoading(true);
    try {
      const response = await chatWithNatlas(text.trim());
      setNatlasAnswer(response.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "N-ATLaS could not respond. Please try again.");
    } finally {
      setNatlasLoading(false);
    }
  }

  return (
    <div>
      <Nav />
      <main className="container page">
        <div className="pagehead">
          <div>
            <div className="eyebrow">Research AI</div>
            <h2>Analyze a research idea</h2>
            <p className="muted">
              Use the prototype analysis or ask N-ATLaS to help explore a research question. Review AI-generated responses critically before using them in academic work.
            </p>
          </div>
        </div>

        <div className="card form">
          {project && (
            <div className="notice">
              Analyzing project: <strong>{project.title}</strong>
            </div>
          )}

          <label htmlFor="idea">Research question or idea</label>
          <textarea
            id="idea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Enter a research question, idea, abstract, or problem statement..."
            maxLength={5000}
          />
          <p className="muted">{text.length}/5000 characters</p>

          {error && <div className="notice" role="alert">{error}</div>}

          <div className="actions">
            <button className="button primary" onClick={handleNatlas} disabled={natlasLoading || loading}>
              {natlasLoading ? "N-ATLaS is responding..." : "Generate with N-ATLaS"}
            </button>
            <button className="button" onClick={handleAnalyze} disabled={loading || natlasLoading}>
              {loading ? "Analyzing..." : "Run prototype analysis"}
            </button>
            <Link className="button" href={project ? `/projects/${project.id}` : "/dashboard"}>
              Back
            </Link>
          </div>

          {natlasAnswer && (
            <section className="notice" aria-live="polite">
              <strong>N-ATLaS response</strong>
              <p>{natlasAnswer}</p>
              <p className="muted">AI-generated research assistance. Verify facts and references independently.</p>
            </section>
          )}

          {result && (
            <div className="notice" aria-live="polite">
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
