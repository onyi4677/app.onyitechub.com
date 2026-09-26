"use client";
import { useState } from "react";
import Link from "next/link";
import Nav from "../../components/nav";

export default function AnalyzePage() {
  const [text,setText]=useState(""); const [result,setResult]=useState<string[]|null>(null);
  function analyze(){if(!text.trim())return;setResult(["Define the target population and study setting.","Convert the central idea into one measurable research question.","Identify key variables and the proposed study design."]);}
  return <div><Nav/><main className="container page"><div className="pagehead"><div><div className="eyebrow">AI analysis</div><h2>Analyze a research idea</h2><p className="muted">Prototype analysis — no external AI credentials are required.</p></div></div>
    <div className="card form"><label htmlFor="idea">Research idea</label><textarea id="idea" value={text} onChange={e=>setText(e.target.value)} placeholder="Paste a research idea, abstract, or problem statement..."/>
      <div className="actions"><button className="button primary" onClick={analyze}>Analyze idea</button><Link className="button" href="/dashboard">Back to dashboard</Link></div>
      {result&&<div className="notice"><strong>Prototype analysis completed.</strong><ul>{result.map(x=><li key={x}>{x}</li>)}</ul></div>}
    </div>
  </main></div>;
}
