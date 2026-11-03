"use client";

import { useCallback, useEffect, useState } from "react";
import Nav from "../../components/nav";
import {
  completeIntegritySubmission,
  createIntegritySubmission,
  deleteIntegritySubmission,
  listIntegritySubmissions,
  uploadIntegrityFile,
  type IntegritySubmission,
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

export default function ResearchIntegrityPage() {
  const [submissions, setSubmissions] = useState<IntegritySubmission[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
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

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
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
      setFile(null);
      setPermissionConfirmed(false);
      setNotice("Manuscript uploaded securely. Text extraction and assessment will be enabled in the next stage.");
      await refresh();
    } catch (err) {
      if (submissionId) {
        try {
          await deleteIntegritySubmission(submissionId);
        } catch {
          // Keep the original upload error visible; a pending record can be cleaned up later.
        }
      }
      setError(err instanceof Error ? err.message : "The manuscript could not be uploaded.");
    } finally {
      setUploading(false);
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
          <strong>Current stage: secure submission</strong>
          Upload and owner-scoped storage are being prepared. Text extraction, AI-assisted assessment, report generation and similarity comparison are not yet available.
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
            {submissions.map((item) => (
              <div className="listitem integrity-submission" key={item.submission_id}>
                <div>
                  <strong>{item.file_name}</strong>
                  <div className="muted">{formatSize(item.size_bytes)} · Uploaded {formatDate(item.created_at)}</div>
                  <div className="integrity-status">{item.status.replaceAll("_", " ")}</div>
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
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
