import { apiRequest } from "./client";

export async function analyzeIdea(text: string) {
  return apiRequest<{ summary: string; word_count: number; suggestions: string[] }>("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function chatWithNatlas(message: string) {
  return apiRequest<{ status: string; model: string; answer: string }>("/api/natlas/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
