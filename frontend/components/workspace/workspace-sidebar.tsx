"use client";

import Link from "next/link";
import type { ResearchModule } from "../../lib/types";

type Props = {
  projectId: string;
  modules: Record<string, ResearchModule>;
  activeModule?: string;
  moduleData: Record<string, Record<string, unknown>>;
};

export default function WorkspaceSidebar({ projectId, modules, activeModule, moduleData }: Props) {
  return (
    <aside className="workspace-sidebar">
      <div className="sidebar-label">Project workspace</div>
      {Object.entries(modules).map(([key, module]) => {
        const hasContent = Object.keys(moduleData[key] || {}).length > 0;
        return (
          <Link
            key={key}
            href={`/projects/${projectId}/modules/${key}`}
            className={`module-link ${activeModule === key ? "active" : ""}`}
          >
            <span>{hasContent ? "✓" : module.status === "active" ? "○" : "·"}</span>
            <span>{module.name}</span>
          </Link>
        );
      })}
    </aside>
  );
}
