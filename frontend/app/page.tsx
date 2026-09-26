import Link from "next/link";
import Nav from "../components/nav";

export default function Home() {
  return <div><Nav/><main className="container">
    <section className="hero"><div className="eyebrow">Onyitech JournalHub Ltd</div>
      <h1>From research idea to a structured project.</h1>
      <p className="lead">A focused workspace for researchers to capture ideas, organize manuscripts, and prepare work for intelligent analysis.</p>
      <div className="actions"><Link className="button primary" href="/projects/new">Start a project</Link><Link className="button" href="/dashboard">Open dashboard</Link></div>
    </section>
    <section className="grid">
      <div className="card"><h2>Projects</h2><p>Keep research ideas, objectives, and manuscript work organized in one workspace.</p></div>
      <div className="card"><h2>Analysis</h2><p>Run a prototype analysis now, with a clean service boundary for future Bedrock integration.</p></div>
      <div className="card"><h2>Publishing</h2><p>Build toward workflows connecting research development with academic publishing infrastructure.</p></div>
    </section>
  </main></div>;
}
