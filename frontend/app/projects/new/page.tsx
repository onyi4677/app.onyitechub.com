import Link from "next/link";
import Nav from "../../../components/nav";

export default function NewProject() {
  return <div><Nav/><main className="container page">
    <div className="pagehead"><div><div className="eyebrow">Projects</div><h2>Create a research project</h2><p className="muted">Capture the core of an idea before analysis begins.</p></div></div>
    <form className="card form" action="/projects/demo-1">
      <label htmlFor="title">Project title</label><input id="title" name="title" placeholder="e.g. Digital mental health adoption among university students"/>
      <label htmlFor="question">Research question or idea</label><textarea id="question" name="question" placeholder="Describe what you want to investigate..."/>
      <label htmlFor="discipline">Discipline</label><select id="discipline" name="discipline" defaultValue="psychology"><option value="psychology">Psychology</option><option value="education">Education</option><option value="social-sciences">Social Sciences</option><option value="health">Health Sciences</option><option value="other">Other</option></select>
      <div className="actions"><button className="button primary" type="submit">Create project</button><Link className="button" href="/dashboard">Cancel</Link></div>
      <div className="notice">MVP note: persistence will be connected to the backend and DynamoDB in the next stage.</div>
    </form>
  </main></div>;
}
