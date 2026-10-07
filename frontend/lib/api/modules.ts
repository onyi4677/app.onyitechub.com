import { apiRequest } from "./client";
import type { ResearchModule } from "../types";

export async function getModules() {
  return apiRequest<Record<string, ResearchModule>>("/api/modules");
}

export async function getProjectModule(id: string, moduleKey: string) {
  return apiRequest<{ module: string; content: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(id)}/modules/${encodeURIComponent(moduleKey)}`
  );
}

export async function saveProjectModule(id: string, moduleKey: string, content: Record<string, unknown>) {
  return apiRequest<{ status: string; module: string; content: Record<string, unknown> }>(
    `/api/projects/${encodeURIComponent(id)}/modules/${encodeURIComponent(moduleKey)}`,
    { method: "PUT", body: JSON.stringify({ content }) }
  );
}
