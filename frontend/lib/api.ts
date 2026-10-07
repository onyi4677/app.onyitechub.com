const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type Project = {
  id: string;
  title: string;
  question: string;
  discipline: string;
  status: string;
  modules?: Record<string, unknown>;
};

export type ResearchModule = {
  name: string;
  description: string;
  status: string;
};

export async function createProject(input: Omit<Project, "id" | "status" | "modules">) {
  const response = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Unable to create project.");
  return response.json() as Promise<{ id: string; project: Project }>;
}

export async function getProject(id: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("Project not found.");
  return response.json() as Promise<{ project: Project }>;
}

export async function getModules() {
  const response = await fetch(`${API_URL}/api/modules`);
  if (!response.ok) throw new Error("Unable to load research modules.");
  return response.json() as Promise<Record<string, ResearchModule>>;
}

export async function getProjectModule(id: string, moduleKey: string) {
  const response = await fetch(
    `${API_URL}/api/projects/${encodeURIComponent(id)}/modules/${encodeURIComponent(moduleKey)}`
  );
  if (!response.ok) return null;
  return response.json() as Promise<{ module: string; content: Record<string, unknown> }>;
}

export async function saveProjectModule(id: string, moduleKey: string, content: Record<string, unknown>) {
  const response = await fetch(
    `${API_URL}/api/projects/${encodeURIComponent(id)}/modules/${encodeURIComponent(moduleKey)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!response.ok) throw new Error("Unable to save research module.");
  return response.json();
}

export async function analyzeIdea(text: string) {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error("Analysis request failed.");
  return response.json() as Promise<{
    summary: string;
    word_count: number;
    suggestions: string[];
  }>;
}
