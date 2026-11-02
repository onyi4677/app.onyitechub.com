"use client";

import { useEffect, useState } from "react";
import { getProjectModule, saveProjectModule } from "../../lib/api";

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

function normalize(data: Record<string, unknown>): InstrumentForm {
  const base = emptyForm();
  return {
    ...base,
    research_pathway: data.research_pathway === "secondary_data" ? "secondary_data" : "primary_data",
    instrument_title: typeof data.instrument_title === "string" ? data.instrument_title : "",
    instrument_type: typeof data.instrument_type === "string" ? data.instrument_type : (data.research_pathway === "secondary_data" ? "document_extraction" : base.instrument_type),
    purpose: typeof data.purpose === "string" ? data.purpose : "",
    target_population: typeof data.target_population === "string" ? data.target_population : "",
    research_context: typeof data.research_context === "string" ? data.research_context : "",
    administration_mode: typeof data.administration_mode === "string" ? data.administration_mode : (data.research_pathway === "secondary_data" ? "document_review" : base.administration_mode),
    consent_plan: typeof data.consent_plan === "string" ? data.consent_plan : "",
    provenance: data.provenance === "established" || data.provenance === "ai_assisted" ? data.provenance : "researcher_developed",
    provenance_details: typeof data.provenance_details === "string" ? data.provenance_details : "",
    status: typeof data.status === "string" ? data.status : "draft",
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
          ? saved.pathways as Record<string, unknown>
          : {};
        const legacyPathway = saved.research_pathway === "secondary_data" ? "secondary_data" : "primary_data";
        const primarySaved = storedPathways.primary_data && typeof storedPathways.primary_data === "object"
          ? storedPathways.primary_data as Record<string, unknown>
          : legacyPathway === "primary_data" ? saved : {};
        const secondarySaved = storedPathways.secondary_data && typeof storedPathways.secondary_data === "object"
          ? storedPathways.secondary_data as Record<string, unknown>
          : legacyPathway === "secondary_data" ? saved : {};
        const nextForms = {
          primary_data: normalize({ ...primarySaved, research_pathway: "primary_data" }),
          secondary_data: normalize({ ...secondarySaved, research_pathway: "secondary_data" }),
        };
        setForms(nextForms);
        setActivePathway(legacyPathway);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load Instruments & Data Collection.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [projectId]);

  function update<K extends keyof InstrumentForm>(key: K, value: InstrumentForm[K]) {
    setForms((current) => ({
      ...current,
      [activePathway]: { ...current[activePathway], [key]: value },
    }));
    setMessage("");
    setError("");
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
    setSaving(true);
    setMessage("");
    setError("");
    try {
      // Keep unknown/legacy keys intact: this editor only owns the fields above.
      const pathwayForm = { ...form, research_pathway: activePathway, status };
      const nextForms = { ...forms, [activePathway]: pathwayForm };
      const pathways = {
        ...(existingData.pathways && typeof existingData.pathways === "object"
          ? existingData.pathways as Record<string, unknown>
          : {}),
        [activePathway]: pathwayForm,
      };
      // Keep legacy root-level fields aligned with the most recently saved pathway,
      // while storing each pathway independently to prevent one overwriting the other.
      const payload = { ...existingData, ...pathwayForm, research_pathway: activePathway, pathways };
      const result = await saveProjectModule(projectId, "instruments", payload);
      const saved = result.content && typeof result.content === "object" ? result.content : payload;
      setExistingData(saved);
      setForms(nextForms);
      setMessage("Instrument development plan saved. Refresh the page to verify that it reloads.");
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
        <h3>Plan a research instrument</h3>
        <p className="muted">Create the planning record for an instrument or structured extraction form. This foundation does not yet publish surveys, collect respondent data, or certify an instrument as validated.</p>
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
              <textarea rows={3} value={form.target_population} onChange={(e) => update("target_population", e.target.value)} placeholder="Define the intended participants, eligibility characteristics and relevant groups." />
            </label>
            <label>Research setting and context
              <textarea rows={3} value={form.research_context} onChange={(e) => update("research_context", e.target.value)} placeholder="Describe the study location, setting and relevant contextual boundaries." />
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
              <textarea rows={4} value={form.consent_plan} onChange={(e) => update("consent_plan", e.target.value)} placeholder="Describe how participants will receive study information, give consent, decline or withdraw, and how confidentiality will be protected. Do not collect participant details here." />
            </label>
          </>
        ) : (
          <>
            <label>Evidence / document population
              <textarea rows={3} value={form.target_population} onChange={(e) => update("target_population", e.target.value)} placeholder="Define the documents, studies, reports or datasets eligible for extraction." />
            </label>
            <label>Review context and boundaries
              <textarea rows={3} value={form.research_context} onChange={(e) => update("research_context", e.target.value)} placeholder="Specify the concepts, settings, dates, languages or other boundaries guiding extraction." />
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
              <textarea rows={4} value={form.consent_plan} onChange={(e) => update("consent_plan", e.target.value)} placeholder="Record relevant source permissions, confidentiality considerations, ethics review or exemption checks, and handling of restricted data." />
            </label>
          </>
        )}
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
          <textarea rows={4} value={form.provenance_details} onChange={(e) => update("provenance_details", e.target.value)} placeholder="For established instruments, record the source and permission/licence details. For researcher-developed or AI-assisted instruments, document how the draft will be reviewed." />
        </label>
        <p className="muted">An instrument is not considered validated merely because it is established, AI-generated or reviewed in this workspace. Validation evidence will be handled in a later milestone.</p>
      </div>

      {error && <div className="notice">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <div className="editor-actions">
        <button className="button primary" type="button" disabled={saving} onClick={() => save("in_progress")}>{saving ? "Saving..." : "Save instrument plan"}</button>
        <button className="button" type="button" disabled={saving} onClick={() => save("review_required")}>Save for review</button>
        <button className="button" type="button" disabled={saving} onClick={() => save("complete")}>Mark planning complete</button>
      </div>
      <p className="muted">Save, then refresh this page to confirm the record reloads. Existing module fields not managed by this editor are preserved.</p>
    </div>
  );
}
