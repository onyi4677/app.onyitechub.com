import { getAccessToken } from "../auth";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = "Request failed.";
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {}
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.assign("/login");
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}
