import { apiRequest } from "./client";
import type { Project } from "../types";

export async function listProjects() {
  return apiRequest<{ projects: Project[] }>("/api/projects");
}

export async function createProject(input: Omit<Project, "id" | "status" | "modules">) {
  return apiRequest<{ id: string; status: string; project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getProject(id: string) {
  return apiRequest<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
}
