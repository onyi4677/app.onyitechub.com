"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import Nav from "../../../components/nav";
import { createProject } from "../../../lib/api";

export default function NewProject() {
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [discipline, setDiscipline] = useState("psychology");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!title.trim() || !question.trim()) {
      setError("Please enter a project title and research idea.");
      return;
    }

    setSaving(true);
    try {
      const result = await createProject({
        title: title.trim(),
        question: question.trim(),
        discipline,
      });
      window.location.href = `/projects/${result.id}`;
    } catch {
      setError("Could not create the project. Check that the API is running.");
      setSaving(false);
    }
  }

  return (
    <div>
      <Nav />
      <main className="container page">
        <div className="pagehead">
          <div>
            <div className="eyebrow">Projects</div>
            <h2>Create a research project</h2>
            <p className="muted">Capture the core of an idea before analysis begins.</p>
          </div>
        </div>

        <form className="card form" onSubmit={handleSubmit}>
          <label htmlFor="title">Project title</label>
          <input id="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Digital mental health adoption among university students" />

          <label htmlFor="question">Research question or idea</label>
          <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Describe what you want to investigate..." />

          <label htmlFor="discipline">Discipline</label>
          <select id="discipline" value={discipline} onChange={(event) => setDiscipline(event.target.value)}>
            <option value="psychology">Psychology</option>
            <option value="education">Education</option>
            <option value="social-sciences">Social Sciences</option>
            <option value="health">Health Sciences</option>
            <option value="other">Other</option>
          </select>

          {error && <div className="notice">{error}</div>}

          <div className="actions">
            <button className="button primary" type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create project"}
            </button>
            <Link className="button" href="/dashboard">Cancel</Link>
          </div>

          <div className="notice">
            Prototype storage is currently in backend memory. DynamoDB will replace this layer later.
          </div>
        </form>
      </main>
    </div>
  );
}