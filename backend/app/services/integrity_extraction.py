"""Owner-scoped extraction and deterministic review for uploaded manuscripts."""
from __future__ import annotations

import hashlib
import io
import zipfile
from datetime import datetime, timezone
from typing import Any

from docx import Document
from pypdf import PdfReader

from app.services.integrity_checks import run_deterministic_checks
from app.services.integrity_submissions import (
    SubmissionNotFoundError,
    SubmissionValidationError,
    _public_submission,
    _resources,
)

MAX_EXTRACTED_CHARS = 1_000_000
MAX_DOCX_ENTRIES = 5_000
MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_PDF_PAGES = 500


def _extract_docx(payload: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_DOCX_ENTRIES:
                raise SubmissionValidationError("The DOCX contains too many embedded files.")
            total_uncompressed = sum(info.file_size for info in infos)
            if total_uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES:
                raise SubmissionValidationError("The DOCX expands beyond the permitted processing size.")
            if any(info.file_size > 0 and info.file_size / max(info.compress_size, 1) > 100 for info in infos):
                raise SubmissionValidationError("The DOCX archive has an unsafe compression ratio.")
            names = set(archive.namelist())
            if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                raise SubmissionValidationError("The uploaded file is not a valid DOCX document.")
            if archive.testzip() is not None:
                raise SubmissionValidationError("The DOCX archive is damaged.")
        document = Document(io.BytesIO(payload))
    except SubmissionValidationError:
        raise
    except Exception as exc:
        raise SubmissionValidationError("The DOCX document could not be read.") from exc

    parts: list[str] = []
    for paragraph in document.paragraphs:
        if paragraph.text.strip():
            parts.append(paragraph.text)
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    extracted = "\n".join(parts).strip()
    if len(extracted) > MAX_EXTRACTED_CHARS:
        raise SubmissionValidationError("The extracted manuscript exceeds the 1-million-character processing limit.")
    return extracted


def _extract_pdf(payload: bytes) -> str:
    if not payload.startswith(b"%PDF-"):
        raise SubmissionValidationError("The uploaded file is not a valid PDF document.")
    try:
        reader = PdfReader(io.BytesIO(payload), strict=True)
        if reader.is_encrypted:
            raise SubmissionValidationError("Password-protected PDFs are not supported yet.")
        if len(reader.pages) > MAX_PDF_PAGES:
            raise SubmissionValidationError("The PDF exceeds the 500-page processing limit.")
        parts: list[str] = []
        total_chars = 0
        for page in reader.pages:
            page_text = page.extract_text() or ""
            total_chars += len(page_text)
            if total_chars > MAX_EXTRACTED_CHARS:
                raise SubmissionValidationError("The extracted manuscript exceeds the 1-million-character processing limit.")
            parts.append(page_text)
    except SubmissionValidationError:
        raise
    except Exception as exc:
        raise SubmissionValidationError("The PDF document could not be read. It may be damaged or unsupported.") from exc
    return "\n".join(parts).strip()


def extract_and_check_submission(owner_sub: str, submission_id: str) -> dict[str, Any]:
    s3, table, bucket = _resources()
    response = table.get_item(
        Key={"owner_sub": owner_sub, "submission_id": submission_id},
        ConsistentRead=True,
    )
    item = response.get("Item")
    if not item:
        raise SubmissionNotFoundError()
    if item.get("status") not in {"uploaded", "extraction_completed"}:
        raise SubmissionValidationError("Upload the manuscript successfully before extracting its text.")
    if item.get("status") == "extraction_completed" and item.get("deterministic_report"):
        return {
            "submission": _public_submission(item),
            "report": item["deterministic_report"],
            "extraction": item.get("extraction", {}),
            "already_processed": True,
        }

    try:
        obj = s3.get_object(Bucket=bucket, Key=item["object_key"])
        payload = obj["Body"].read()
    except Exception as exc:
        raise SubmissionValidationError("The stored manuscript could not be retrieved.") from exc

    if len(payload) != int(item["expected_size_bytes"]) or len(payload) > 15 * 1024 * 1024:
        raise SubmissionValidationError("The stored manuscript size does not match the submission record.")

    if item["content_type"] == "application/pdf":
        extracted_text = _extract_pdf(payload)
    elif item["content_type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        if not payload.startswith(b"PK"):
            raise SubmissionValidationError("The uploaded file is not a valid DOCX archive.")
        extracted_text = _extract_docx(payload)
    else:
        raise SubmissionValidationError("This manuscript file type is not supported.")

    if not extracted_text:
        report = run_deterministic_checks("")
        extraction_status = "no_readable_text"
    else:
        report = run_deterministic_checks(extracted_text)
        extraction_status = "text_extracted"

    text_key = f"submissions/{owner_sub}/{submission_id}/derived/extracted.txt"
    s3.put_object(
        Bucket=bucket,
        Key=text_key,
        Body=extracted_text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
        ServerSideEncryption="AES256",
    )
    content_sha256 = hashlib.sha256(payload).hexdigest()
    extraction = {
        "status": extraction_status,
        "word_count": report.get("word_count", 0),
        "character_count": report.get("character_count", 0),
        "sha256": content_sha256,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
    }
    table.update_item(
        Key={"owner_sub": owner_sub, "submission_id": submission_id},
        UpdateExpression="SET #status = :status, extracted_key = :text_key, extraction = :extraction, deterministic_report = :report, updated_at = :updated",
        ConditionExpression="#status IN (:uploaded, :completed)",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "extraction_completed",
            ":uploaded": "uploaded",
            ":completed": "extraction_completed",
            ":text_key": text_key,
            ":extraction": extraction,
            ":report": report,
            ":updated": extraction["extracted_at"],
        },
    )
    item["status"] = "extraction_completed"
    item["updated_at"] = extraction["extracted_at"]
    return {
        "submission": _public_submission(item),
        "report": report,
        "extraction": extraction,
        "already_processed": False,
    }
