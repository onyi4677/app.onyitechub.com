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

export type CanonicalResearchSource = {
  source_id: string;
  canonical_source_id: string;
  aliases: string[];
  literature_source_ids: string[];
  reference_ids: string[];
  authors: string[];
  year: number | null;
  title: string;
  source_type: string;
  journal_or_publisher?: string | null;
  journal_or_book?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  doi?: string | null;
  url?: string | null;
  abstract?: string | null;
  keywords: string[];
  verified: boolean;
  identity_key: string;
};

export async function getProjectResearchSources(id: string) {
  return apiRequest<{ sources: CanonicalResearchSource[]; count: number }>(
    `/api/projects/${encodeURIComponent(id)}/research-sources`
  );
}
