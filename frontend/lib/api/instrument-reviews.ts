import { apiRequest } from "./client";

export type InstrumentReviewInvitation = {
  invitation_id: string;
  reviewer_name: string;
  reviewer_email: string;
  version_number: number;
  created_at: string;
  expires_at: string;
  status: "pending" | "submitted" | "revoked";
  submitted_at?: string;
  submission?: {
    reviewer_name: string;
    reviewer_email: string;
    reviewer_role: string;
    expertise: string;
    review_date: string;
    comments: string;
    recommendation: "accept" | "revise" | "reject";
    item_ratings: Record<string, { clarity: number; relevance: number; coverage: number; comments?: string }>;
    submitted_at: string;
  };
};

export async function createInstrumentReviewInvitation(
  projectId: string,
  input: { pathway: string; version_id: string; reviewer_name: string; reviewer_email: string; expires_in_days: number },
) {
  return apiRequest<{
    invitation_id: string; token: string; review_url_path: string;
    reviewer_name: string; reviewer_email: string; version_number: number; expires_at: string; status: string;
  }>(`/api/projects/${encodeURIComponent(projectId)}/instrument-review-invitations`, {
    method: "POST", body: JSON.stringify(input),
  });
}

export async function listInstrumentReviewInvitations(projectId: string) {
  return apiRequest<{ invitations: InstrumentReviewInvitation[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/instrument-review-invitations`,
  );
}

export async function revokeInstrumentReviewInvitation(projectId: string, invitationId: string) {
  return apiRequest<{ status: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/instrument-review-invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" },
  );
}
