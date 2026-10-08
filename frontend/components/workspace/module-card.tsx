import Link from "next/link";
import type { ResearchModule } from "../../lib/types";

type Props = {
  projectId: string;
  moduleKey: string;
  module: ResearchModule;
  hasContent: boolean;
};

export default function ModuleCard({ projectId, moduleKey, module, hasContent }: Props) {
  const href = `/projects/${projectId}/modules/${moduleKey}`;
  return (
    <Link className="card module-card" href={href}>
      <div className="module-status">{module.status === "active" ? "Active module" : "Planned module"}</div>
      <h3>{module.name}</h3>
      <p>{module.description}</p>
      <div className="muted module-state">
        {hasContent ? "Project data present" : module.status === "active" ? "Ready to build" : "Coming next"}
      </div>
    </Link>
  );
}
