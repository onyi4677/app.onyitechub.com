"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getPublicParticipantQuestionnaire, submitPublicParticipantQuestionnaire } from "../../../lib/api/participant-publications";

type Item = { item_id: string; section_id: string; prompt: string; response_type: string; required: boolean; options: string[]; help_text?: string };
type FormData = { publication_id: string; instrument_title: string; purpose: string; target_population: string; instrument_instructions: string; instrument_sections: Array<{section_id:string;title:string;description?:string}>; instrument_items: Item[]; pilot_notice:string; consent_text:string; eligibility_text:string };

function browserId(id: string) {
  const key = "onyitech-pilot-" + id; let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID() + crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}

export default function ParticipantPage() {
  const { token } = useParams<{token:string}>();
  const [form, setForm] = useState<FormData | null>(null); const [error, setError] = useState("");
  const [consent, setConsent] = useState(false); const [eligible, setEligible] = useState(false);
  const [started, setStarted] = useState(false); const [startTime, setStartTime] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({}); const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => { let active=true; getPublicParticipantQuestionnaire(token).then(v=>{if(active)setForm(v)}).catch(e=>{if(active)setError(e.message)}); return ()=>{active=false}; }, [token]);
  const items = form?.instrument_items || [];
  const count = useMemo(()=>items.filter(i=>answers[i.item_id]!==undefined && answers[i.item_id]!=="" && (!Array.isArray(answers[i.item_id]) || (answers[i.item_id] as unknown[]).length>0)).length,[items,answers]);
  const set = (id:string,v:unknown)=>setAnswers(old=>({...old,[id]:v}));
  function question(item:Item,index:number) {
    const v=answers[item.item_id], m=/^likert_(5|6|7)$/.exec(item.response_type);
    const choices=m?Array.from({length:Number(m[1])},(_,i)=>String(i+1)):item.options||[];
    return <fieldset className="card editor-section" key={item.item_id}><legend><strong>{index+1}. {item.prompt}</strong>{item.required?" *":""}</legend>
      {item.help_text&&<p className="muted">{item.help_text}</p>}
      {(m||["single_choice","dropdown"].includes(item.response_type))&&choices.map(c=><label className="checkbox-label" key={c}><input type="radio" name={item.item_id} checked={String(v??"")===c} onChange={()=>set(item.item_id,m?Number(c):c)}/>{c}</label>)}
      {item.response_type==="multiple_choice"&&choices.map(c=><label className="checkbox-label" key={c}><input type="checkbox" checked={(Array.isArray(v)?v:[]).includes(c)} onChange={e=>set(item.item_id,e.target.checked?[...(Array.isArray(v)?v:[]),c]:(Array.isArray(v)?v:[]).filter(x=>x!==c))}/>{c}</label>)}
      {["short_text","long_text"].includes(item.response_type)&&(item.response_type==="long_text"?<textarea rows={4} maxLength={5000} value={String(v??"")} onChange={e=>set(item.item_id,e.target.value)}/>:<input maxLength={1000} value={String(v??"")} onChange={e=>set(item.item_id,e.target.value)}/>)}
      {item.response_type==="number"&&<input type="number" value={String(v??"")} onChange={e=>set(item.item_id,e.target.value===""?"":Number(e.target.value))}/>}
      {item.response_type==="date"&&<input type="date" value={String(v??"")} onChange={e=>set(item.item_id,e.target.value)}/>}
    </fieldset>;
  }
  async function submit() {
    const missing=items.find(i=>i.required&&(answers[i.item_id]===undefined||answers[i.item_id]===""||(Array.isArray(answers[i.item_id])&&!(answers[i.item_id] as unknown[]).length)));
    if(missing){setError("Please answer all required questions. Check: "+missing.prompt);return;}
    setBusy(true);setError("");
    try { await submitPublicParticipantQuestionnaire({token,browser_token:browserId(form!.publication_id),consent,eligible,answers,elapsed_seconds:Math.floor((Date.now()-startTime)/1000),website:trap});setDone(true); }
    catch(e){setError(e instanceof Error?e.message:"Unable to save response.");} finally{setBusy(false);}
  }
  if(error&&!form)return <main className="module-editor"><div className="card editor-section"><h2>Pilot unavailable</h2><p>{error}</p></div></main>;
  if(!form)return <main className="module-editor"><div className="card editor-section">Loading technical pilot…</div></main>;
  if(done)return <main className="module-editor"><div className="card editor-section"><h1>Thank you</h1><p>Your technical pilot response has been saved as test data. It will not be used as research data.</p></div></main>;
  return <main className="module-editor"><div className="card editor-section">
    <div className="eyebrow">ONYITECH · TECHNICAL PILOT · TEST DATA ONLY</div><h1>{form.instrument_title}</h1>
    <div className="notice">{form.pilot_notice}</div>{form.purpose&&<p>{form.purpose}</p>}{form.target_population&&<p className="muted">{form.target_population}</p>}
    {!started?<><h3>Before you begin</h3><p>{form.consent_text}</p><label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I agree to this technical test.</label><p>{form.eligibility_text}</p><label className="checkbox-label"><input type="checkbox" checked={eligible} onChange={e=>setEligible(e.target.checked)}/> I confirm that I meet the eligibility criteria.</label><button className="button primary" type="button" disabled={!consent||!eligible} onClick={()=>{setStarted(true);setStartTime(Date.now())}}>Continue to questionnaire</button></>:<>
      {form.instrument_instructions&&<p>{form.instrument_instructions}</p>}<p className="muted">Progress: {count} of {items.length} answered</p><progress max={items.length||1} value={count} style={{width:"100%"}}/>
      {form.instrument_sections.map(s=><section key={s.section_id}><h2>{s.title}</h2>{s.description&&<p className="muted">{s.description}</p>}{items.filter(i=>i.section_id===s.section_id).map(i=>question(i,items.indexOf(i)))}</section>)}
      {items.filter(i=>!form.instrument_sections.some(s=>s.section_id===i.section_id)).map(i=>question(i,items.indexOf(i)))}
      <div aria-hidden="true" style={{position:"absolute",left:"-10000px"}}><label>Leave blank<input tabIndex={-1} autoComplete="off" value={trap} onChange={e=>setTrap(e.target.value)}/></label></div>
      <button className="button primary" type="button" disabled={busy} onClick={submit}>{busy?"Saving…":"Submit technical pilot response"}</button>
    </>}
    {error&&<div className="notice" role="alert">{error}</div>}
    <p className="muted">No account or direct identifiers are requested. A first-party browser token discourages repeat submissions from the same browser, but cannot guarantee one response per person.</p>
  </div></main>;
}
