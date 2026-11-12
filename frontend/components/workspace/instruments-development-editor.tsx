"use client";

import { useEffect, useState } from "react";
import { getProjectModule, saveProjectModule } from "../../lib/api";

type InstrumentItem = {
  item_id: string;
  prompt: string;
  response_type: "short_text" | "long_text" | "single_choice" | "multiple_choice" | "dropdown" | "number" | "date" | "likert_5";
  required: boolean;
  options: string[];
  help_text: string;
};

type InstrumentForm = {
  research_pathway: "primary_data" | "secondary_data";
  instrument_title: string;
  instrument_type: string;
  purpose: string;
  target_population: string;
  research_context: string;
  administration_mode: string;
  consent_plan: string;
  provenance: "established" | "researcher_developed" | "ai_assisted";
  provenance_details: string;
  status: string;
  instrument_instructions: string;
  instrument_items: InstrumentItem[];
};

const emptyForm = (): InstrumentForm => ({
  research_pathway: "primary_data",
  instrument_title: "",
  instrument_type: "questionnaire",
  purpose: "",
  target_population: "",
  research_context: "",
  administration_mode: "self_administered",
  consent_plan: "",
  provenance: "researcher_developed",
  provenance_details: "",
  status: "draft",
  instrument_instructions: "",
  instrument_items: [],
});

const instrumentTypes = [
  ["questionnaire", "Questionnaire"],
  ["interview_guide", "Interview guide"],
  ["focus_group_guide", "Focus-group discussion guide"],
  ["observation_checklist", "Observation checklist"],
  ["document_extraction", "Document / evidence extraction form"],
  ["experimental_form", "Experimental data form"],
  ["other", "Other researcher-defined instrument"],
];

const responseTypes: Array<[InstrumentItem["response_type"], string]> = [
  ["short_text", "Short text"],
  ["long_text", "Long text"],
  ["single_choice", "Single choice"],
  ["multiple_choice", "Multiple choice"],
  ["dropdown", "Dropdown"],
  ["number", "Number"],
  ["date", "Date"],
  ["likert_5", "5-point Likert response"],
];

function normalizeItems(value: unknown): InstrumentItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item, index) => ({
      item_id: typeof item.item_id === "string" && item.item_id ? item.item_id : `item-${index + 1}`,
      prompt: typeof item.prompt === "string" ? item.prompt : "",
      response_type: responseTypes.some(([type]) => type === item.response_type)
        ? item.response_type as InstrumentItem["response_type"] : "short_text",
      required: item.required === true,
      options: Array.isArray(item.options) ? item.options.filter((option): option is string => typeof option === "string") : [],
      help_text: typeof item.help_text === "string" ? item.help_text : "",
    }));
}

function normalize(data: Record<string, unknown>, pathway: InstrumentForm["research_pathway"]): InstrumentForm {
  const base = emptyForm();
  return {
    ...base,
    research_pathway: pathway,
    instrument_title: typeof data.instrument_title === "string" ? data.instrument_title : "",
    instrument_type: typeof data.instrument_type === "string" ? data.instrument_type : (pathway === "secondary_data" ? "document_extraction" : base.instrument_type),
    purpose: typeof data.purpose === "string" ? data.purpose : "",
    target_population: typeof data.target_population === "string" ? data.target_population : "",
    research_context: typeof data.research_context === "string" ? data.research_context : "",
    administration_mode: typeof data.administration_mode === "string" ? data.administration_mode : (pathway === "secondary_data" ? "document_review" : base.administration_mode),
    consent_plan: typeof data.consent_plan === "string" ? data.consent_plan : "",
    provenance: data.provenance === "established" || data.provenance === "ai_assisted" ? data.provenance : "researcher_developed",
    provenance_details: typeof data.provenance_details === "string" ? data.provenance_details : "",
    status: typeof data.status === "string" ? data.status : "draft",
    instrument_instructions: typeof data.instrument_instructions === "string" ? data.instrument_instructions : "",
    instrument_items: normalizeItems(data.instrument_items),
  };
}

function newItem(): InstrumentItem {
  return {
    item_id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    prompt: "",
    response_type: "short_text",
    required: false,
    options: [],
    help_text: "",
  };
}

export default function InstrumentsDevelopmentEditor({ projectId }: { projectId: string }) {
  const [activePathway, setActivePathway] = useState<InstrumentForm["research_pathway"]>("primary_data");
  const [forms, setForms] = useState<Record<InstrumentForm["research_pathway"], InstrumentForm>>({
    primary_data: emptyForm(),
    secondary_data: { ...emptyForm(), research_pathway: "secondary_data", instrument_type: "document_extraction" },
  });
  const form = forms[activePathway];
  const [existingData, setExistingData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getProjectModule(projectId, "instruments")
      .then(({ content }) => {
        if (!active) return;
        const saved = content && typeof content === "object" ? content : {};
        setExistingData(saved);
        const storedPathways = saved.pathways && typeof saved.pathways === "object"
          ? saved.pathways as Record<string, unknown> : {};
        const legacyPathway = saved.research_pathway === "secondary_data" ? "secondary_data" : "primary_data";
        const primarySaved = storedPathways.primary_data && typeof storedPathways.primary_data === "object"
          ? storedPathways.primary_data as Record<string, unknown> : legacyPathway === "primary_data" ? saved : {};
        const secondarySaved = storedPathways.secondary_data && typeof storedPathways.secondary_data === "object"
          ? storedPathways.secondary_data as Record<string, unknown> : legacyPathway === "secondary_data" ? saved : {};
        setForms({
          primary_data: normalize(primarySaved, "primary_data"),
          secondary_data: normalize(secondarySaved, "secondary_data"),
        });
        setActivePathway(legacyPathway);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load Instruments & Data Collection.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  function update<K extends keyof InstrumentForm>(key: K, value: InstrumentForm[K]) {
    setForms((current) => ({ ...current, [activePathway]: { ...current[activePathway], [key]: value } }));
    setMessage("");
    setError("");
  }

  function updateItem(itemId: string, patch: Partial<InstrumentItem>) {
    update("instrument_items", form.instrument_items.map((item) => item.item_id === itemId ? { ...item, ...patch } : item));
  }

  function changePathway(nextPathway: InstrumentForm["research_pathway"]) {
    setActivePathway(nextPathway);
    setMessage("");
    setError("");
  }

  async function save(status = "in_progress") {
    if (!form.instrument_title.trim() || !form.purpose.trim()) {
      setError("Enter an instrument title and its research purpose before saving.");
      return;
    }
    const incomplete = form.instrument_items.find((item) => !item.prompt.trim());
    if (incomplete) {
      setError("Complete or remove every blank instrument item before saving.");
      return;
    }
    const choiceItem = form.instrument_items.find((item) =>
      ["single_choice", "multiple_choice", "dropdown"].includes(item.response_type) &&
      item.options.filter((option) => option.trim()).length < 2
    );
    if (choiceItem) {
      setError("Choice questions need at least two non-empty response options.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const pathwayForm = { ...form, research_pathway: activePathway, status, schema_version: 2 };
      const nextForms = { ...forms, [activePathway]: pathwayForm };
      const pathways = {
        ...(existingData.pathways && typeof existingData.pathways === "object"
          ? existingData.pathways as Record<string, unknown> : {}),
        [activePathway]: pathwayForm,
      };
      const payload = { ...existingData, ...pathwayForm, research_pathway: activePathway, pathways, schema_version: 2 };
      const result = await saveProjectModule(projectId, "instruments", payload);
      const saved = result.content && typeof result.content === "object" ? result.content : payload;
      setExistingData(saved);
      setForms(nextForms);
      setMessage("Instrument plan and structured items saved. Refresh the page to verify that they reload.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card module-workspace"><p>Loading Instruments &amp; Data Collection...</p></div>;

  return (
    <div className="module-editor">
      <div className="card editor-section">
        <div className="eyebrow">Milestone 1 · Instrument Development</div>
        <h3>Develop a research instrument</h3>
        <p className="muted">Plan the instrument and build its structured items. Saving here does not publish a survey, collect respondent data or certify validity.</p>
        <label>Research pathway
          <select value={activePathway} onChange={(e) => changePathway(e.target.value as InstrumentForm["research_pathway"])}>
            <option value="primary_data">Primary data — collecting information from participants or observations</option>
            <option value="secondary_data">Secondary data — extracting information from existing documents, studies or datasets</option>
          </select>
        </label>
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Instrument identity</div>
        <label>Instrument title
          <input value={form.instrument_title} onChange={(e) => update("instrument_title", e.target.value)} placeholder={form.research_pathway === "secondary_data" ? "e.g. Evidence extraction form for included studies" : "e.g. Participant questionnaire on resilience"} />
        </label>
        <label>Instrument type
          <select value={form.instrument_type} onChange={(e) => update("instrument_type", e.target.value)}>
            {instrumentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Research purpose
          <textarea rows={4} value={form.purpose} onChange={(e) => update("purpose", e.target.value)} placeholder="Explain what information this instrument is intended to collect and how it relates to the study objectives or review questions." />
        </label>
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Population and context</div>
        {form.research_pathway === "primary_data" ? (
          <>
            <label>Target population
              <textarea rows={3} value={form.target_population} onChange={(e) => update("target_population", e.target.value)} placeholder="Define intended participants, eligibility characteristics and relevant groups." />
            </label>
            <label>Research setting and context
              <textarea rows={3} value={form.research_context} onChange={(e) => update("research_context", e.target.value)} placeholder="Describe the study location, setting and contextual boundaries." />
            </label>
            <label>Administration method
              <select value={form.administration_mode} onChange={(e) => update("administration_mode", e.target.value)}>
                <option value="self_administered">Self-administered</option>
                <option value="interviewer_administered">Interviewer-administered</option>
                <option value="online">Online / digital</option>
                <option value="observation">Researcher observation</option>
                <option value="mixed">Mixed methods</option>
                <option value="other">Other / to be specified</option>
              </select>
            </label>
            <label>Consent plan
              <textarea rows={4} value={form.consent_plan} onChange={(e) => update("consent_plan", e.target.value)} placeholder="Describe participant information, consent, withdrawal and confidentiality arrangements. Do not collect participant details here." />
            </label>
          </>
        ) : (
          <>
            <label>Evidence / document population
              <textarea rows={3} value={form.target_population} onChange={(e) => update("target_population", e.target.value)} placeholder="Define eligible documents, studies, reports or datasets." />
            </label>
            <label>Review context and boundaries
              <textarea rows={3} value={form.research_context} onChange={(e) => update("research_context", e.target.value)} placeholder="Specify concepts, settings, dates, languages or other extraction boundaries." />
            </label>
            <label>Extraction method
              <select value={form.administration_mode} onChange={(e) => update("administration_mode", e.target.value)}>
                <option value="document_review">Structured document review</option>
                <option value="independent_extraction">Independent reviewer extraction</option>
                <option value="duplicate_extraction">Duplicate / paired extraction</option>
                <option value="dataset_review">Existing dataset extraction</option>
                <option value="other">Other / to be specified</option>
              </select>
            </label>
            <label>Ethics, permissions and data-handling notes
              <textarea rows={4} value={form.consent_plan} onChange={(e) => update("consent_plan", e.target.value)} placeholder="Record source permissions, confidentiality, ethics review or exemption checks, and restricted-data handling." />
            </label>
          </>
        )}
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Structured instrument content</div>
        <h3>Instructions and questions / items</h3>
        <label>Instructions shown before the instrument
          <textarea rows={3} value={form.instrument_instructions} onChange={(e) => update("instrument_instructions", e.target.value)} placeholder="Explain how the instrument should be completed, including any relevant reference period or response guidance." />
        </label>
        {form.instrument_items.length === 0 && <p className="muted">No questions or extraction items have been added yet.</p>}
        {form.instrument_items.map((item, index) => (
          <div className="card editor-section" key={item.item_id}>
            <div className="editor-actions">
              <strong>Item {index + 1}</strong>
              <button className="button" type="button" onClick={() => update("instrument_items", form.instrument_items.filter((entry) => entry.item_id !== item.item_id))}>Remove item</button>
            </div>
            <label>Question / extraction prompt
              <textarea rows={3} value={item.prompt} onChange={(e) => updateItem(item.item_id, { prompt: e.target.value })} placeholder="Write one clear question or data-extraction field." />
            </label>
            <label>Response format
              <select value={item.response_type} onChange={(e) => updateItem(item.item_id, { response_type: e.target.value as InstrumentItem["response_type"] })}>
                {responseTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {["single_choice", "multiple_choice", "dropdown"].includes(item.response_type) && (
              <label>Response options (one per line; provide at least two)
                <textarea rows={4} value={item.options.join("\n")} onChange={(e) => updateItem(item.item_id, { options: e.target.value.split("\n").map((option) => option.trim()).filter(Boolean) })} placeholder={"Strongly disagree\nDisagree\nNeither agree nor disagree\nAgree\nStrongly agree"} />
              </label>
            )}
            {item.response_type === "likert_5" && <p className="muted">The response scale is stored as a five-point Likert format. Define the exact anchors in the instrument instructions before validation.</p>}
            <label>Help text (optional)
              <input value={item.help_text} onChange={(e) => updateItem(item.item_id, { help_text: e.target.value })} placeholder="Clarify terms or the response period, if needed." />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={item.required} onChange={(e) => updateItem(item.item_id, { required: e.target.checked })} />
              Response required
            </label>
          </div>
        ))}
        <div className="editor-actions">
          <button className="button" type="button" onClick={() => update("instrument_items", [...form.instrument_items, newItem()])}>Add question / item</button>
        </div>
        <p className="muted">This first builder stores structured instrument items in the existing project module. Section grouping, validation workflows and online respondent delivery will follow in later milestones.</p>
      </div>

      <div className="card editor-section">
        <div className="eyebrow">Instrument provenance</div>
        <label>How was this instrument developed?
          <select value={form.provenance} onChange={(e) => update("provenance", e.target.value as InstrumentForm["provenance"])}>
            <option value="established">Established / standardised instrument</option>
            <option value="researcher_developed">Researcher-developed instrument</option>
            <option value="ai_assisted">AI-assisted draft requiring researcher review</option>
          </select>
        </label>
        <label>Source, licence, development or review notes
          <textarea rows={4} value={form.provenance_details} onChange={(e) => update("provenance_details", e.target.value)} placeholder="For established instruments, record source and permission/licence details. For researcher-developed or AI-assisted instruments, document development and review." />
        </label>
        <p className="muted">An instrument is not validated merely because it is established, AI-generated or reviewed in this workspace. Validation evidence will be recorded separately.</p>
      </div>

      {error && <div className="notice">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <div className="editor-actions">
        <button className="button primary" type="button" disabled={saving} onClick={() => save("in_progress")}>{saving ? "Saving..." : "Save instrument"}</button>
        <button className="button" type="button" disabled={saving} onClick={() => save("review_required")}>Save for review</button>
        <button className="button" type="button" disabled={saving} onClick={() => save("complete")}>Mark development complete</button>
      </div>
      <p className="muted">Existing planning records and both research pathways are preserved. Save and refresh to confirm that the structured content reloads.</p>
    </div>
  );
}
