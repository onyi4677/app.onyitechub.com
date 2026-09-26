const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type Project = {
  id: string;
  title: string;
  question: string;
  discipline: string;
  status: string;
};

export async function createProject(input: Omit<Project, "id" | "status">) {
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
