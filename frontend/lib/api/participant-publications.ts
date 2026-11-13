import { apiRequest } from "./client";

export type PilotResponse = { response_id: string; question_count: number; submitted_at: string; elapsed_seconds: number; is_test: true; answers: Record<string, unknown> };
export type PilotPublication = { publication_id: string; version_id: string; version_number: number; status: "test_open" | "closed"; created_at: string; response_count: number; responses: PilotResponse[] };

export function createParticipantPublication(projectId: string, versionId: string) {
  return apiRequest<{ publication_id: string; token: string; public_url_path: string; version_number: number; status: string; mode: string }>(
    \`/api/projects/\${encodeURIComponent(projectId)}/participant-publications\`,
    { method: "POST", body: JSON.stringify({ version_id: versionId }) },
  );
}
export function listParticipantPublications(projectId: string) {
  return apiRequest<{ publications: PilotPublication[] }>(\`/api/projects/\${encodeURIComponent(projectId)}/participant-publications\`);
}
export function closeParticipantPublication(projectId: string, id: string) {
  return apiRequest<{ status: string }>(\`/api/projects/\${encodeURIComponent(projectId)}/participant-publications/\${encodeURIComponent(id)}/close\`, { method: "POST" });
}
const base = () => (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\\/$/, "");
export async function getPublicParticipantQuestionnaire(token: string) {
  const response = await fetch(\`\${base()}/api/public/participant-publications/\${encodeURIComponent(token)}\`, { cache: "no-store" });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || "Pilot unavailable."); }
  return response.json();
}
export async function submitPublicParticipantQuestionnaire(input: Record<string, unknown>) {
  const response = await fetch(\`\${base()}/api/public/participant-publications/submit\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || "Unable to submit."); }
  return response.json();
}
