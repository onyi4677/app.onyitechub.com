"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Nav from "../../components/nav";
import {
  completeIntegritySubmission,
  createIntegritySubmission,
  extractIntegritySubmission,
  deleteIntegritySubmission,
  getIntegritySubmission,
  listIntegritySubmissions,
  queueIntegrityAiReview,
  uploadIntegrityFile,
  type IntegritySubmission,
  type IntegrityExtractionResult,
} from "../../lib/api/integrity";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 15 * 1024 * 1024;

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAiStatus(value?: string) {
  return (value || "not_started").replaceAll("_", " ");
}

export default function ResearchIntegrityPage() {
  const [submissions, setSubmissions] = useState<IntegritySubmission[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [checkingId, setCheckingId] = useState("");
  const [aiReviewingId, setAiReviewingId] = useState("");
  const [aiRefreshingId, setAiRefreshingId] = useState("");
  const [reports, setReports] = useState<Record<string, IntegrityExtractionResult>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const result = await listIntegritySubmissions();
    setSubmissions(result.submissions);
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load manuscript submissions."))
      .finally(() => setLoading(false));
  }, [refresh]);

  function selectFile(nextFile: File | null) {
    setError("");
    setNotice("");
    if (!nextFile) {
      setFile(null);
      return;
    }
    const lower = nextFile.name.toLowerCase();
    const validExtension = lower.endsWith(".pdf") || lower.endsWith(".docx");
    if (!validExtension) {
      setFile(null);
      setError("Choose a PDF or DOCX manuscript.");
      return;
    }
    if (nextFile.size < 1 || nextFile.size > MAX_BYTES) {
      setFile(null);
      setError("The manuscript must be between 1 byte and 15 MB.");
      return;
    }
    setFile(nextFile);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !permissionConfirmed || uploading) return;

    setUploading(true);
    setError("");
    setNotice("");
    let submissionId = "";
    try {
      const contentType = file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : DOCX_TYPE;
      const created = await createIntegritySubmission({
        file_name: file.name,
        content_type: contentType,
        size_bytes: file.size,
        permission_confirmed: true,
      });
      submissionId = created.submission.submission_id;
      await uploadIntegrityFile(created.upload, file);
      await completeIntegritySubmission(submissionId);
    } catch (err) {
      if (submissionId) {
        try {
          await deleteIntegritySubmission(submissionId);
        } catch {
          // Keep the original upload error visible; a pending record can be cleaned up later.
        }
      }
      setError(err instanceof Error ? err.message : "The manuscript could not be uploaded.");
      setUploading(false);
      return;
    }

    setFile(null);
    setPermissionConfirmed(false);
    setNotice("Manuscript uploaded securely. Run the initial document checks before requesting an AI review.");
    setUploading(false);
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload succeeded, but the submission list could not be refreshed.");
    }
  }

  async function handleExtract(submissionId: string) {
    if (checkingId) return;
    setCheckingId(submissionId);
    setError("");
    setNotice("");
    try {
      const result = await extractIntegritySubmission(submissionId);
      setReports((current) => ({ ...current, [submissionId]: result }));
      setSubmissions((current) => current.map((item) => item.submission_id === submissionId ? result.submission : item));
      setNotice(result.already_processed ? "Loaded the saved deterministic check report." : "Text extraction and deterministic checks completed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to extract and check this manuscript.");
    } finally {
      setCheckingId("");
    }
  }

  async function handleRunAiReview(submissionId: string) {
    if (aiReviewingId || aiRefreshingId || deletingId) return;
    setAiReviewingId(submissionId);
    setError("");
    setNotice("");
    try {
      const result = await queueIntegrityAiReview(submissionId);
      setSubmissions((current) => current.map((item) =>
        item.submission_id === submissionId
          ? { ...item, ai_review_status: result.ai_review_status, ai_review_message: undefined }
          : item
      ));
      setNotice("AI review queued successfully. Use Refresh AI status to check when the report is ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start the AI manuscript review.");
    } finally {
      setAiReviewingId("");
    }
  }

  async function handleRefreshAiStatus(submissionId: string) {
    if (aiRefreshingId || aiReviewingId || deletingId) return;
    setAiRefreshingId(submissionId);
    setError("");
    setNotice("");
    try {
      const result = await getIntegritySubmission(submissionId);
      setSubmissions((current) => current.map((item) =>
        item.submission_id === submissionId ? result.submission : item
      ));
      const status = result.submission.ai_review_status || "not_started";
      setNotice(status === "completed"
        ? "AI manuscript review completed. The report is displayed below."
        : `AI review status: ${formatAiStatus(status)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh the AI review status.");
    } finally {
      setAiRefreshingId("");
    }
  }

  async function handleDelete(submissionId: string) {
    if (deletingId) return;
    setDeletingId(submissionId);
    setError("");
    setNotice("");
    try {
      await deleteIntegritySubmission(submissionId);
      setSubmissions((current) => current.filter((item) => item.submission_id !== submissionId));
      setReports((current) => { const next = { ...current }; delete next[submissionId]; return next; });
      setNotice("Submission and stored manuscript deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete this submission.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div>
      <Nav />
      <main className="container page integrity-page">
        <div className="pagehead">
          <div>
            <div className="eyebrow">Standalone manuscript service</div>
            <h2>Research Integrity &amp; Quality</h2>
            <p className="muted">Submit a manuscript for structured quality and integrity checks without creating a research project.</p>
          </div>
        </div>

        <div className="notice warning">
          <strong>AI-assisted manuscript review — staging preview</strong>
          Run the initial rule-based checks, then request a separate AI academic review. Similarity comparison and downloadable reports are not yet available. AI findings are advisory and require human verification.
        </div>

        <section className="card integrity-upload">
          <h3>Submit a manuscript</h3>
          <p className="muted">PDF or DOCX only. Maximum file size: 15 MB.</p>
          <form onSubmit={handleUpload}>
            <label htmlFor="integrity-file">Manuscript file</label>
            <input
              id="integrity-file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => selectFile(event.target.files?.[0] || null)}
              disabled={uploading}
            />
            {file && <p className="muted">{file.name} · {formatSize(file.size)}</p>}
            <label className="integrity-consent">
              <input
                type="checkbox"
                checked={permissionConfirmed}
                onChange={(event) => setPermissionConfirmed(event.target.checked)}
                disabled={uploading}
              />
              <span>I confirm that I have permission to submit this manuscript for assessment.</span>
            </label>
            <button className="button primary" type="submit" disabled={!file || !permissionConfirmed || uploading}>
              {uploading ? "Uploading securely..." : "Upload manuscript"}
            </button>
          </form>
        </section>

        {error && <div className="notice integrity-error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        <section className="integrity-submissions">
          <div className="pagehead">
            <div>
              <h3>Your submissions</h3>
              <p className="muted">Only submissions belonging to your signed-in account are shown.</p>
            </div>
          </div>
          {loading && <div className="notice">Loading submissions...</div>}
          {!loading && !error && submissions.length === 0 && <div className="notice">No manuscripts submitted yet.</div>}
          <div className="list">
            {submissions.map((item) => {
              const report = reports[item.submission_id]?.report;
              const documentType = report?.document_type;
              const aiStatus = item.ai_review_status || "not_started";
              const aiReport = item.ai_report;
              const citationReport = report?.citation_verification;
              const citationSummary = citationReport?.summary && typeof citationReport.summary === "object" ? citationReport.summary : undefined;
              const aiCitation = aiReport?.citation_verification;

              return (
                <div className="listitem integrity-submission" key={item.submission_id}>
                  <div>
                    <strong>{item.file_name}</strong>
                    <div className="muted">{formatSize(item.size_bytes)} · Uploaded {formatDate(item.created_at)}</div>
                    <div className="integrity-status">{item.status.replaceAll("_", " ")}</div>
                    {(item.status === "uploaded" || item.status === "extraction_completed") && (
                      <button className="button primary integrity-check-button" type="button" onClick={() => handleExtract(item.submission_id)} disabled={Boolean(checkingId) || Boolean(deletingId)}>
                        {checkingId === item.submission_id ? "Checking manuscript..." : reports[item.submission_id] ? "Refresh checks" : item.status === "extraction_completed" ? "View saved checks" : "Run document checks"}
                      </button>
                    )}
                    {report && (
                      <div className="integrity-report">
                        <strong>Initial document report</strong>
                        <p className="muted">{report.word_count.toLocaleString()} words · {report.detected_sections.length} detected sections · {report.findings.length} findings</p>
                        {documentType && (
                          <div className="integrity-classification">
                            <strong>Detected document type: {documentType.label}</strong>
                            <p className="muted">Classification confidence: {documentType.confidence}. This is an automated, rule-based classification and should be confirmed by a human reviewer.</p>
                            <p>{documentType.basis}</p>
                          </div>
                        )}
                        {report.assessment_notes?.map((note, index) => (
                          <p className="muted" key={`assessment-note-${index}`}>{note}</p>
                        ))}
                        {citationReport && (
                          <div className="integrity-classification">
                            <strong>Citation and reference matching</strong>
                            {citationSummary ? (
                              <p className="muted">
                                {citationSummary.matched_citation_count ?? 0} matched · {citationSummary.unmatched_citation_count ?? 0} unmatched citations · {citationSummary.uncited_reference_count ?? 0} uncited references
                              </p>
                            ) : <p className="muted">Citation matching could not be assessed from the extracted text.</p>}
                            {citationReport.findings?.map((finding, index) => (
                              <div className="integrity-finding" key={`citation-finding-${finding.rule_id}-${index}`}>
                                <strong>{finding.rule_id.replaceAll(".", " ")}</strong>
                                <span className="integrity-severity">{finding.severity}</span>
                                <p>{finding.detail}</p>
                                {finding.citation && <blockquote>{finding.citation}</blockquote>}
                                {finding.reference && <blockquote>{finding.reference}</blockquote>}
                              </div>
                            ))}
                            {(!citationReport.findings || citationReport.findings.length === 0) && (
                              <p>No unmatched citations or uncited references were detected by the initial author–year check.</p>
                            )}
                            {citationReport.limitations?.map((limitation, index) => (
                              <p className="muted" key={`citation-limit-${index}`}>{limitation}</p>
                            ))}
                          </div>
                        )}
                        {report.findings.map((finding, index) => (
                          <div className="integrity-finding" key={finding.rule_id + index}>
                            <strong>{finding.title}</strong>
                            <span className="integrity-severity">{finding.severity}</span>
                            <p>{finding.detail}</p>
                            {finding.evidence && <blockquote>{finding.evidence}</blockquote>}
                          </div>
                        ))}
                        {report.findings.length === 0 && <p>No deterministic flags were raised. This is not a certification of manuscript quality.</p>}
                        <p className="muted">These checks are preliminary and require human review. They do not detect plagiarism or verify DOI registration.</p>
                      </div>
                    )}

                    {item.status === "extraction_completed" && (
                      <div className="integrity-ai-review">
                        <div className="integrity-status">AI review: {formatAiStatus(aiStatus)}</div>
                        {aiStatus === "not_started" && (
                          <button
                            className="button primary integrity-check-button"
                            type="button"
                            onClick={() => handleRunAiReview(item.submission_id)}
                            disabled={Boolean(aiReviewingId) || Boolean(aiRefreshingId) || Boolean(deletingId)}
                          >
                            {aiReviewingId === item.submission_id ? "Queueing AI review..." : "Run AI manuscript review"}
                          </button>
                        )}
                        {(aiStatus === "queued" || aiStatus === "processing") && (
                          <button
                            className="button integrity-check-button"
                            type="button"
                            onClick={() => handleRefreshAiStatus(item.submission_id)}
                            disabled={Boolean(aiRefreshingId) || Boolean(aiReviewingId) || Boolean(deletingId)}
                          >
                            {aiRefreshingId === item.submission_id ? "Refreshing..." : "Refresh AI status"}
                          </button>
                        )}
                        {(aiStatus === "failed" || aiStatus === "not_supported") && (
                          <p className="muted">{item.ai_review_message || "This AI review attempt could not be completed."}</p>
                        )}
                        {aiReport && (
                          <div className="integrity-report">
                            <strong>AI-assisted academic review</strong>
                            <p className="muted">Document type: {aiReport.document_type} · Academic level: {aiReport.academic_level}</p>
                            <p>{aiReport.summary}</p>
                            {aiCitation && (
                              <div className="integrity-classification">
                                <strong>External DOI registry and URL checks</strong>
                                <p className="muted">
                                  {aiCitation.doi_checks?.length || 0} DOI records checked against Crossref and, when not found there, DataCite.
                                </p>
                                <p className="muted">
                                  {aiCitation.doi_checks?.length || 0} DOI records checked · {aiCitation.url_checks?.length || 0} reference URLs checked · {(aiCitation.url_checks || []).filter((check) => check.status === "inaccessible").length} URLs returned HTTP errors.
                                </p>
                                {aiCitation.doi_checks?.map((check, index) => (
                                  <div className="integrity-finding" key={`doi-check-${index}`}>
                                    <strong>{check.doi}</strong>
                                    <span className="integrity-severity">{check.metadata_comparison?.replaceAll("_", " ") || "not verified"}</span>
                                    <p className="muted">
                                      Registry: {check.registry_result?.registry || "unknown"} · Record status: {check.registry_result?.status || "unavailable"}
                                    </p>
                                    {check.registry_result?.title && <p>{check.registry_result.title}</p>}
                                    {check.registry_result?.year && <p className="muted">Registry publication year: {check.registry_result.year}</p>}
                                  </div>
                                ))}
                                {aiCitation.url_checks?.map((check, index) => (
                                  <div className="integrity-finding" key={`url-check-${index}`}>
                                    <strong>{check.url}</strong>
                                    <span className="integrity-severity">{check.status?.replaceAll("_", " ") || "not verified"}</span>
                                    <p className="muted">
                                      {check.http_status ? `HTTP ${check.http_status}` : "No HTTP response"}{check.final_url && check.final_url !== check.url ? ` · Redirected to ${check.final_url}` : ""}
                                    </p>
                                    {check.reason && <p className="muted">{check.reason}</p>}
                                  </div>
                                ))}
                                {aiCitation.limitations?.map((limitation, index) => (
                                  <p className="muted" key={`ai-citation-limit-${index}`}>{limitation}</p>
                                ))}
                              </div>
                            )}
                            <strong>Review findings ({aiReport.findings.length})</strong>
                            {aiReport.findings.map((finding, index) => (
                              <div className="integrity-finding" key={`ai-finding-${index}`}>
                                <strong>{finding.category} · {finding.severity}</strong>
                                {finding.location && <p className="muted">{finding.location}</p>}
                                {finding.excerpt && <blockquote>{finding.excerpt}</blockquote>}
                                <p>{finding.explanation}</p>
                                {finding.recommendation && <p><strong>Recommendation:</strong> {finding.recommendation}</p>}
                                <p className="muted">Confidence: {finding.confidence}. Verify this observation against the manuscript.</p>
                              </div>
                            ))}
                            {aiReport.findings.length === 0 && <p>No specific AI findings were returned. Review the summary and limitations carefully.</p>}
                            {aiReport.limitations.length > 0 && (
                              <>
                                <strong>Review limitations</strong>
                                <ul>{aiReport.limitations.map((limitation, index) => <li key={`ai-limitation-${index}`}>{limitation}</li>)}</ul>
                              </>
                            )}
                            <p className="muted">Reviewed {formatDate(aiReport.reviewed_at)}. Model-assisted assessment with limited DOI registry checks; not a plagiarism check, complete source-authenticity check, misconduct determination or guarantee of publication.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="button"
                    type="button"
                    onClick={() => handleDelete(item.submission_id)}
                    disabled={Boolean(deletingId)}
                  >
                    {deletingId === item.submission_id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
