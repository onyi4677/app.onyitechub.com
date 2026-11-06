import { apiRequest } from "./client";

export type IntegrityAiReviewStatus =
  | "not_started"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "not_supported";

export type IntegrityAiFinding = {
  category: string;
  severity: "low" | "moderate" | "high";
  location: string;
  excerpt: string;
  explanation: string;
  recommendation: string;
  confidence: "low" | "moderate" | "high";
};

export type IntegrityAiReport = {
  summary: string;
  document_type: string;
  academic_level: string;
  findings: IntegrityAiFinding[];
  limitations: string[];
  model_id: string;
  reviewed_at: string;
};

export type IntegritySubmission = {
  submission_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  status: "pending_upload" | "uploaded" | "extraction_completed" | "assessing" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  ai_review_status?: IntegrityAiReviewStatus;
  ai_review_updated_at?: string;
  ai_review_message?: string;
  ai_report?: IntegrityAiReport;
};

type UploadPolicy = {
  url: string;
  fields: Record<string, string>;
};

type CreateSubmissionResponse = {
  submission: IntegritySubmission;
  upload: UploadPolicy;
  upload_expires_in_seconds: number;
};

export async function listIntegritySubmissions() {
  return apiRequest<{ submissions: IntegritySubmission[] }>("/api/integrity/submissions");
}

export async function createIntegritySubmission(input: {
  file_name: string;
  content_type: string;
  size_bytes: number;
  permission_confirmed: boolean;
}) {
  return apiRequest<CreateSubmissionResponse>("/api/integrity/submissions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadIntegrityFile(policy: UploadPolicy, file: File) {
  const form = new FormData();
  Object.entries(policy.fields).forEach(([key, value]) => form.append(key, value));
  form.append("file", file);

  const response = await fetch(policy.url, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error("The secure file upload did not complete. Please try again.");
  }
}

export async function completeIntegritySubmission(submissionId: string) {
  return apiRequest<{ submission: IntegritySubmission }>(
    `/api/integrity/submissions/${encodeURIComponent(submissionId)}/complete`,
    { method: "POST" }
  );
}

export async function deleteIntegritySubmission(submissionId: string) {
  return apiRequest<void>(
    `/api/integrity/submissions/${encodeURIComponent(submissionId)}`,
    { method: "DELETE" }
  );
}

export type IntegrityFinding = {
  rule_id: string;
  severity: "critical" | "major" | "minor" | "info";
  title: string;
  detail: string;
  source: "deterministic";
  requires_human_verification: boolean;
  evidence?: string;
};

export type IntegrityDocumentType = {
  key: "empirical_research" | "review_paper" | "seminar_paper" | "unknown";
  label: string;
  confidence: "high" | "medium" | "low";
  basis: string;
};

export type IntegrityExtractionResult = {
  submission: IntegritySubmission;
  report: {
    status: string;
    word_count: number;
    character_count: number;
    detected_sections: string[];
    document_type?: IntegrityDocumentType;
    assessment_notes?: string[];
    citation_pattern_count?: number;
    doi_pattern_count?: number;
    findings: IntegrityFinding[];
    limitations: string[];
  };
  extraction: {
    status: string;
    word_count: number;
    character_count: number;
    sha256: string;
    extracted_at: string;
  };
  already_processed: boolean;
};

export async function extractIntegritySubmission(submissionId: string) {
  return apiRequest<IntegrityExtractionResult>(
    `/api/integrity/submissions/${encodeURIComponent(submissionId)}/extract`,
    { method: "POST" }
  );
}

export async function queueIntegrityAiReview(submissionId: string) {
  return apiRequest<{
    submission_id: string;
    ai_review_status: "queued";
    message: string;
  }>(
    `/api/integrity/submissions/${encodeURIComponent(submissionId)}/ai-review`,
    { method: "POST" }
  );
}

export async function getIntegritySubmission(submissionId: string) {
  return apiRequest<{ submission: IntegritySubmission }>(
    `/api/integrity/submissions/${encodeURIComponent(submissionId)}`
  );
}
