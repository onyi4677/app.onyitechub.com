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
- The API returns HTTP 410 when a new upload-completion or extraction transaction is attempted after the processing window has closed. A previously saved deterministic report remains readable and repeat extraction returns that saved report without needing the manuscript.

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
- **24-hour transaction retention policy:** each submission records an absolute `expires_at` timestamp 24 hours after creation. The `cleanup_at` timestamp is set five minutes earlier as a safety buffer for the one-minute scheduled cleanup interval. The researcher or editor must finish the assessment within this processing window; new completion/extraction operations are rejected once cleanup becomes due.
- **Retain the result:** keep the compact deterministic report and minimum submission metadata in DynamoDB so the frontend can continue displaying the result and submission history after manuscript content expires. Do not retain the full manuscript or extracted text in the report record.
- **Automated cleanup:** the existing API Lambda dispatches a dedicated EventBridge scheduled event every minute. It queries only pending cleanup records through the `cleanup-index` GSI, deletes the original S3 object and derived extracted-text object, then removes the cleanup-index keys while retaining the DynamoDB report and metadata. Abandoned uploads are included because their records enter the cleanup index when created.
- **Retry behavior:** if either S3 deletion or the DynamoDB completion update fails, the cleanup-index keys remain, so the next scheduled invocation retries. Deleting S3 objects is idempotent. The extraction save uses a conditional update against the cleanup state; if cleanup wins a race, the newly written extracted object is deleted rather than orphaned.
- **Timing caveat:** EventBridge and Lambda are managed asynchronous services, so invocation and deletion are not a hard real-time guarantee to the exact second. The five-minute safety buffer is intended to complete deletion before the 24-hour expiry. Monitor scheduled invocations and cleanup failures before external launch.
- **Required DynamoDB index:** add a GSI named `cleanup-index` with partition key `cleanup_status` (String), sort key `cleanup_at` (Number), and an `INCLUDE` projection containing only `object_key`, `extracted_key`, and `status` (the table keys and index keys are included automatically). This avoids copying report data into the index. The index contains only submissions awaiting cleanup; successful cleanup removes both index-key attributes while preserving the report record.
- **Required schedule:** deploy `infra/research-integrity-cleanup-schedule.yaml` as a separate CloudFormation stack after the updated Lambda code is deployed. It invokes the existing `onyitech-research-api` function every minute. Do not create a second API Lambda.
- Verify that expired originals and extracted-text objects are absent from S3 while the report and submission history remain readable in the frontend before external launch.

## IAM permissions to add only after code review

Lambda execution role will need narrowly scoped:
- `s3:PutObject`, `s3:GetObject` (also covers `HeadObject`), and `s3:DeleteObject` on the dedicated object prefix. These cover presigned upload authorization, reading originals, writing derived extracted text, and deleting both objects.
- DynamoDB `PutItem`, `GetItem`, `Query`, `UpdateItem`, and `DeleteItem` on the dedicated table.
- In addition, grant `dynamodb:Query` on the dedicated GSI ARN `arn:aws:dynamodb:us-east-1:530751149539:table/onyitech-integrity-submissions/index/cleanup-index`. Querying a GSI requires the index ARN in the IAM resource list; table-only Query permission is insufficient.

Do not attach Lambda to a VPC or create NAT Gateway for this feature.


## Provisioning the cleanup index

The existing table is on-demand. Add the cleanup GSI once before enabling the scheduled rule:

```bash
aws dynamodb update-table \
  --table-name onyitech-integrity-submissions \
  --attribute-definitions AttributeName=cleanup_status,AttributeType=S AttributeName=cleanup_at,AttributeType=N \
  --global-secondary-index-updates '[{"Create":{"IndexName":"cleanup-index","KeySchema":[{"AttributeName":"cleanup_status","KeyType":"HASH"},{"AttributeName":"cleanup_at","KeyType":"RANGE"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["object_key","extracted_key","status"]}}}]' \
  --no-cli-pager
```

Wait until the table and the new GSI report `ACTIVE` before deploying the cleanup schedule. The index update adds a small on-demand index storage/write cost; it avoids repeatedly scanning every retained report record.

Deploy the schedule stack only after the updated Lambda package is deployed:

```bash
aws cloudformation deploy \
  --template-file infra/research-integrity-cleanup-schedule.yaml \
  --stack-name onyitech-research-integrity-cleanup-schedule \
  --no-cli-pager
```

The template adds only the one-minute EventBridge rule and permission for that rule to invoke the existing Lambda. It does not create another Lambda, bucket, or DynamoDB table.
