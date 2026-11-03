# Standalone manuscript submission storage contract

This stage adds the authenticated submission lifecycle, first frontend upload page, bounded PDF/DOCX text extraction, and deterministic checks. It does not create AWS resources or enable AI model calls.

## Required AWS resources (provision later, after review)

- Private S3 bucket in `us-east-1`, Block Public Access enabled, default encryption enabled.
- DynamoDB table in `us-east-1` with partition key `owner_sub` (String) and sort key `submission_id` (String); on-demand capacity.
- Lambda environment variables:
  - `INTEGRITY_SUBMISSIONS_BUCKET`: exact private bucket name.
  - `INTEGRITY_SUBMISSIONS_TABLE`: exact table name.
  - `AWS_REGION` or `AWS_DEFAULT_REGION`: `us-east-1`.

The feature remains unavailable and returns HTTP 503 until both resource variables are configured.

## API lifecycle

- `POST /api/integrity/submissions`: authenticated, requires permission confirmation, accepts PDF/DOCX metadata and returns a short-lived S3 presigned POST policy.
- Browser posts the returned form fields plus the file directly to S3; file body never passes through Lambda.
- `POST /api/integrity/submissions/{id}/complete`: verifies the S3 object exists and its actual size/type match the declared values.
- `GET /api/integrity/submissions` and `GET /api/integrity/submissions/{id}`: owner-scoped metadata.
- `POST /api/integrity/submissions/{id}/extract`: downloads the owner's uploaded file inside the backend, validates the PDF/DOCX container, extracts text, stores extracted text as a private S3 object, and saves a compact deterministic report in the owner's DynamoDB record. Repeated requests return the saved report.
- `DELETE /api/integrity/submissions/{id}`: deletes the original object, derived extracted text (if present), and metadata.

## S3 browser-upload CORS

Configure S3 CORS with the exact production frontend origin `https://app.onyitechub.com`, allowed method `POST`, and allowed headers `*` for the browser multipart form. Add the exact Vercel preview origin only when testing a known preview; do not use wildcard origins. No response headers need to be exposed. The browser sends the presigned form directly to S3 and does not send Cognito credentials to S3.

## Limits and safeguards

- Only PDF and DOCX MIME/extension pairs are accepted.
- Maximum declared and policy-enforced upload size: 15 MiB.
- Presigned POST expires after 5 minutes and enforces content type and content-length range.
- S3 object keys use the authenticated Cognito subject and a random submission UUID, not the supplied filename.
- DynamoDB partition key is the authenticated Cognito subject; all reads, updates and deletes use both owner and submission ID. Other users' IDs resolve as 404.
- No manuscript text, token, prompt, or presigned URL is logged or persisted in DynamoDB.
- PDF signature and DOCX ZIP structure are checked before parsing. DOCX archive entries, uncompressed size, compression ratio, PDF page count, and extracted character count are bounded.
- Password-protected PDFs, scanned-PDF OCR, images embedded in DOCX, and alternative document formats are not supported in this stage. A scan without a text layer produces a no-readable-text result.
- Extracted text is stored only in private S3; DynamoDB stores a compact report and extraction metadata, not the full manuscript text.
- Deleting a submission also deletes its derived extracted-text object.
- **24-hour transaction retention policy:** the original manuscript and derived extracted-text object are temporary processing data. They must be deleted no later than 24 hours after the submission transaction begins (the successful upload/creation timestamp recorded for the submission). The researcher or editor must complete the review transaction within that window.
- **Retain the result:** keep the compact deterministic report and the minimum submission metadata in DynamoDB so the frontend can continue displaying the result and submission history after the manuscript content has expired. Do not retain the full manuscript or extracted text in the report record.
- **Cleanup requirement (not yet implemented):** an automated cleanup process must use the submission's explicit expiry timestamp and delete the original and derived S3 objects by the 24-hour deadline, including abandoned or incomplete uploads. It must leave the compact report and display metadata intact. A one-day S3 lifecycle rule alone is not an exact 24-hour guarantee. Verify cleanup and frontend result display after expiry before external launch.

## IAM permissions to add only after code review

Lambda execution role will need narrowly scoped:
- `s3:PutObject`, `s3:GetObject` (also covers `HeadObject`), and `s3:DeleteObject` on the dedicated object prefix. These cover presigned upload authorization, reading originals, writing derived extracted text, and deleting both objects.
- DynamoDB `PutItem`, `GetItem`, `Query`, `UpdateItem`, and `DeleteItem` on the dedicated table.

Do not attach Lambda to a VPC or create NAT Gateway for this feature.
