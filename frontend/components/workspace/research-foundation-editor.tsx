"use client";

import { useEffect, useState } from "react";
import type { Project } from "../../lib/types";
import { getProjectModule, saveProjectModule } from "../../lib/api";

type Variable = {
  name: string;
  role: string;
  operational_definition: string;
  measurement: string;
};

type Foundation = {
  title: string;
  aim: string;
  objectives: string[];
  research_questions: string[];
  hypotheses: string[];
  variables: Variable[];
  conceptual_framework: { description: string };
  evidence_gap: string;
  status: string;
};

const blankVariable = (): Variable => ({
  name: "",
  role: "independent",
  operational_definition: "",
  measurement: "",
});

function normalize(data: Record<string, unknown>, project: Project): Foundation {
  const variables = Array.isArray(data.variables) ? data.variables : [];
  return {
    title: String(data.title || project.title || ""),
    aim: String(data.aim || ""),
    objectives: Array.isArray(data.objectives) && data.objectives.length ? data.objectives.map(String) : [""],
    research_questions: Array.isArray(data.research_questions) && data.research_questions.length ? data.research_questions.map(String) : [project.question || ""],
    hypotheses: Array.isArray(data.hypotheses) ? data.hypotheses.map(String) : [""],
    variables: variables.length ? variables.map((v: any) => ({...blankVariable(), ...v})) : [blankVariable()],
    conceptual_framework: { description: String((data.conceptual_framework as any)?.description || "") },
    evidence_gap: String(data.evidence_gap || ""),
    status: String(data.status || "draft"),
  };
}

export default function ResearchFoundationEditor({ project, projectId }: { project: Project; projectId: string }) {
  const [form, setForm] = useState<Foundation>(() => normalize({}, project));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    getProjectModule(projectId, "research_foundation")
      .then((result) => setForm(normalize(result.content || {}, project)))
      .catch(() => setMessage("Could not load the saved foundation."))
      .finally(() => setLoading(false));
  }, [projectId, project]);

  const update = (key: keyof Foundation, value: any) => setForm((current) => ({ ...current, [key]: value }));

  const updateList = (key: "objectives" | "research_questions" | "hypotheses", index: number, value: string) =>
    setForm((current) => ({ ...current, [key]: current[key].map((item, i) => i === index ? value : item) }));

  const addList = (key: "objectives" | "research_questions" | "hypotheses") =>
    setForm((current) => ({ ...current, [key]: [...current[key], ""] }));

  const removeList = (key: "objectives" | "research_questions" | "hypotheses", index: number) =>
    setForm((current) => ({ ...current, [key]: current[key].filter((_, i) => i !== index) }));

  const validate = () => {
    const next: string[] = [];
    const nextWarnings: string[] = [];
    if (!form.title.trim()) next.push("Research title is required.");
    if (!form.aim.trim()) next.push("Research aim is required.");
    if (!form.objectives.some(Boolean)) next.push("Add at least one research objective.");
    if (!form.research_questions.some(Boolean)) next.push("Add at least one research question.");
    if (!form.variables.some((v) => v.name.trim())) next.push("Add at least one research variable.");
    form.variables.forEach((v, i) => {
      if (v.name.trim() && !v.operational_definition.trim()) next.push("Variable " + (i + 1) + " needs an operational definition.");
    });
    const objectiveCount = form.objectives.filter((x) => x.trim()).length;
    const questionCount = form.research_questions.filter((x) => x.trim()).length;
    if (objectiveCount !== questionCount) {
      nextWarnings.push("The number of objectives and research questions differs. Review their one-to-one alignment.");
    }
    if (form.hypotheses.some((x) => x.trim()) && form.hypotheses.filter((x) => x.trim()).length > objectiveCount) {
      nextWarnings.push("You have more hypotheses than objectives. Confirm that each hypothesis is justified by the study objectives.");
    }
    if (!form.conceptual_framework.description.trim()) {
      nextWarnings.push("A conceptual framework has not yet been described.");
    }
    setErrors(next);
    setWarnings(nextWarnings);
    return next.length === 0;
  };

  async function save(status = "in_progress") {
    if (!validate()) return;
    setSaving(true); setMessage("");
    try {
      const result = await saveProjectModule(projectId, "research_foundation", { ...form, status });
      setForm(normalize(result.content, project));
      setMessage("Research foundation saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally { setSaving(false); }
  }

  if (loading) return <div className="card module-workspace"><p>Loading Research Foundation...</p></div>;

  return (
    <div className="module-editor">
      <div className="card editor-section">
        <div className="eyebrow">Study identity</div>
        <label>Research title<input value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
        <label>Research aim<textarea rows={3} value={form.aim} onChange={(e) => update("aim", e.target.value)} placeholder="State what the study intends to achieve." /></label>
      </div>

      {(["objectives", "research_questions", "hypotheses"] as const).map((key) => (
        <div className="card editor-section" key={key}>
          <div className="eyebrow">{key === "objectives" ? "Research objectives" : key === "research_questions" ? "Research questions" : "Hypotheses"}</div>
          {form[key].map((item, index) => (
            <div className="repeat-row" key={index}>
              <textarea rows={2} value={item} onChange={(e) => updateList(key, index, e.target.value)} />
              <button type="button" className="button secondary" onClick={() => removeList(key, index)}>Remove</button>
            </div>
          ))}
          <button type="button" className="button secondary" onClick={() => addList(key)}>+ Add</button>
        </div>
      ))}

      <div className="card editor-section">
        <div className="eyebrow">Variables</div>
        {form.variables.map((variable, index) => (
          <div className="variable-card" key={index}>
            <label>Variable name<input value={variable.name} onChange={(e) => update("variables", form.variables.map((v, i) => i === index ? {...v, name: e.target.value} : v))} /></label>
            <label>Role<select value={variable.role} onChange={(e) => update("variables", form.variables.map((v, i) => i === index ? {...v, role: e.target.value} : v))}><option>independent</option><option>dependent</option><option>moderator</option><option>covariate</option></select></label>
            <label>Operational definition<textarea rows={2} value={variable.operational_definition} onChange={(e) => update("variables", form.variables.map((v, i) => i === index ? {...v, operational_definition: e.target.value} : v))} /></label>
            <label>Measurement / scale / instrument<input value={variable.measurement} onChange={(e) => update("variables", form.variables.map((v, i) => i === index ? {...v, measurement: e.target.value} : v))} /></label>
            <button type="button" className="button secondary" onClick={() => update("variables", form.variables.filter((_, i) => i !== index))}>Remove variable</button>
          </div>
        ))}
        <button type="button" className="button secondary" onClick={() => update("variables", [...form.variables, blankVariable()])}>+ Add variable</button>
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Conceptual framework</div>
        <textarea rows={5} value={form.conceptual_framework.description} onChange={(e) => update("conceptual_framework", { description: e.target.value })} placeholder="Describe the proposed relationships among the study variables. A visual builder can be added later." />
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Evidence gap</div>
        <textarea rows={4} value={form.evidence_gap} onChange={(e) => update("evidence_gap", e.target.value)} placeholder="This will be populated from verified Literature & Evidence. Do not invent a research gap." />
        <p className="muted">The Literature & Evidence module will become the source of truth for this field.</p>
      </div>

      {warnings.length > 0 && <div className="notice warning"><strong>Review before proceeding</strong>{warnings.map((e) => <div key={e}>{e}</div>)}</div>}
      {errors.length > 0 && <div className="notice">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
      {message && <div className="notice">{message}</div>}
      <div className="editor-actions">
        <button className="button" type="button" disabled={saving} onClick={() => save("in_progress")}>{saving ? "Saving..." : "Save foundation"}</button>
        <button className="button secondary" type="button" disabled={saving} onClick={() => save("review_required")}>Save for review</button>
        <button className="button secondary" type="button" disabled={saving} onClick={() => save("complete")}>Mark foundation complete</button>
      </div>
    </div>
  );
}
