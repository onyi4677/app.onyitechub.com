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


export async function importProjectBackup(id: string, file: File) {
  return apiRequest<{
    status: string;
    source_project_id: string;
    destination_project_id: string;
    modules_imported: string[];
    record_counts: Record<string, Record<string, number>>;
    checksums_verified: number;
  }>(
    `/api/projects/${encodeURIComponent(id)}/modules/backup/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: file,
    }
  );
}


export type ManuscriptWorkspace = {
  project_id: string;
  manuscript_id: string;
  title: string;
  article_type: string;
  status: string;
  created_at: number;
  expires_at_iso: string;
  current_version_id?: string;
};

export type ManuscriptSourceCollection = {
  source_snapshot_id: string;
  captured_at: string;
  snapshot_key: string;
  modules: Record<string, {
    status: string;
    record_counts: Record<string, number>;
    updated_at?: string | null;
  }>;
  canonical_source_count: number;
};

export async function createManuscriptWorkspace(
  id: string,
  title: string,
  articleType: string
) {
  return apiRequest<ManuscriptWorkspace>(
    `/api/projects/${encodeURIComponent(id)}/manuscript/workspace`,
    { method: "POST", body: JSON.stringify({ title, article_type: articleType }) }
  );
}

export async function getManuscriptWorkspace(id: string) {
  return apiRequest<ManuscriptWorkspace>(
    `/api/projects/${encodeURIComponent(id)}/manuscript/workspace`
  );
}

export async function collectManuscriptSources(id: string) {
  return apiRequest<ManuscriptSourceCollection>(
    `/api/projects/${encodeURIComponent(id)}/manuscript/sources/collect`,
    { method: "POST" }
  );
}

export type ManuscriptSourceSnapshot = {
  source_snapshot_id: string;
  snapshot_schema_version: number;
  project_id: string;
  project: { title?: string | null; question?: string | null; discipline?: string | null };
  captured_at: string;
  modules: Record<string, {
    status: string;
    record_counts: Record<string, number>;
    updated_at?: string | null;
    content: Record<string, unknown>;
  }>;
  canonical_sources: CanonicalResearchSource[];
};

export async function getManuscriptSourceSnapshot(id: string, snapshotId: string) {
  return apiRequest<ManuscriptSourceSnapshot>(
    `/api/projects/${encodeURIComponent(id)}/manuscript/sources/${encodeURIComponent(snapshotId)}`
  );
}

export async function createManuscriptVersion(
  id: string,
  snapshotId: string,
  templateId: string,
  templateVersion = 1
) {
  return apiRequest<{
    version_id: string;
    version_number: number;
    source_snapshot_id: string;
    template_id: string;
    status: string;
  }>(
    `/api/projects/${encodeURIComponent(id)}/manuscript/versions`,
    {
      method: "POST",
      body: JSON.stringify({
        source_snapshot_id: snapshotId,
        template_id: templateId,
        template_version: templateVersion,
      }),
    }
  );
}


export type ManuscriptSection = {
  section_id: string;
  title: string;
  order: number;
  content: string;
  status: "empty" | "needs_input" | "draft" | "in_review" | "approved";
  updated_at?: number;
};

export type CurrentManuscript = {
  workspace: ManuscriptWorkspace;
  version: {
    version_id: string;
    version_number: number;
    source_snapshot_id: string;
    template_id: string;
    template_version: number;
    status: string;
  } | null;
  sections: ManuscriptSection[];
};

export async function getCurrentManuscript(id: string) {
  return apiRequest<CurrentManuscript>(
    `/api/projects/${encodeURIComponent(id)}/manuscript/current`
  );
}

export async function saveManuscriptSection(
  id: string,
  versionId: string,
  section: ManuscriptSection
) {
  return apiRequest<ManuscriptSection>(
    `/api/projects/${encodeURIComponent(id)}/manuscript/versions/${encodeURIComponent(versionId)}/sections/${encodeURIComponent(section.section_id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        title: section.title,
        order: section.order,
        content: section.content,
        status: section.status,
      }),
    }
  );
}
