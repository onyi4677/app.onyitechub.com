import Link from "next/link";

export default function Nav() {
  return <nav className="nav">
    <Link href="/" className="brand">Onyitech <span>Research Workspace</span></Link>
    <div className="navlinks">
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/projects/new">New project</Link>
      <Link href="/analyze">Analyze</Link>
    </div>
  </nav>;
}
