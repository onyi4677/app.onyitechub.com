import Link from "next/link";
import Nav from "../../components/nav";

export default function Dashboard() {
  return <div><Nav/><main className="container page">
    <div className="pagehead"><div><div className="eyebrow">Workspace</div><h2>Dashboard</h2><p className="muted">Your research projects and analysis workflow.</p></div><Link className="button primary" href="/projects/new">New project</Link></div>
    <div className="statrow">
      <div className="card stat"><span className="muted">Projects</span><strong>1</strong></div>
      <div className="card stat"><span className="muted">Analyses</span><strong>0</strong></div>
      <div className="card stat"><span className="muted">Storage</span><strong>0 MB</strong></div>
    </div>
    <h2 style={{marginTop:42}}>Recent projects</h2>
    <Link className="listitem" href="/projects/demo-1"><div><strong>Research Workspace Demo</strong><div className="muted">Today</div></div><span className="badge">Prototype</span></Link>
  </main></div>;
}
