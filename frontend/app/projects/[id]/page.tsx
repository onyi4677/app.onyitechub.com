import Link from "next/link";
import Nav from "../../../components/nav";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div><Nav/><main className="container page">
    <div className="pagehead"><div><div className="eyebrow">Project / {id}</div><h2>Research Workspace Demo</h2><p className="muted">Develop the research idea before manuscript production.</p></div><Link className="button primary" href="/analyze">Run analysis</Link></div>
    <div className="grid"><div className="card"><div className="muted">Research question</div><h3>Define the problem clearly</h3><p>Add the research question, objectives, population, and context here.</p></div><div className="card"><div className="muted">Manuscript</div><h3>Build the evidence base</h3><p>Future versions will support manuscript files and structured sections.</p></div><div className="card"><div className="muted">Analysis</div><h3>Prototype ready</h3><p>The analysis service is separated from the UI so an AI provider can be added later.</p></div></div>
    <div className="notice">Project ID: {id}</div>
  </main></div>;
}
