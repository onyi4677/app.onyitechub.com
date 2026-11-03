# Standalone manuscript submission storage contract

This stage adds the authenticated submission lifecycle only. It does not create AWS resources or enable assessment/model calls.

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
- `DELETE /api/integrity/submissions/{id}`: deletes the owner's object and metadata.

## Limits and safeguards

- Only PDF and DOCX MIME/extension pairs are accepted.
- Maximum declared and policy-enforced upload size: 15 MiB.
- Presigned POST expires after 5 minutes and enforces content type and content-length range.
- S3 object keys use the authenticated Cognito subject and a random submission UUID, not the supplied filename.
- DynamoDB partition key is the authenticated Cognito subject; all reads, updates and deletes use both owner and submission ID. Other users' IDs resolve as 404.
- No manuscript text, token, prompt, or presigned URL is logged or persisted in DynamoDB.
- This stage does not yet inspect file signatures or parse DOCX/PDF. Those checks must occur before extraction/assessment.
- No automatic retention period is configured until the product retention policy is agreed. External launch remains blocked until retention and deletion expectations are finalized.

## IAM permissions to add only after code review

Lambda execution role will need narrowly scoped:
- `s3:PutObject` is not needed for browser uploads via presigned POST, but `s3:GetObject`, `s3:HeadObject` (covered by `s3:GetObject`), and `s3:DeleteObject` are needed for completion/deletion; the presign operation also requires signing permission context for the requested operation. Validate exact IAM action requirements in deployment testing.
- DynamoDB `PutItem`, `GetItem`, `Query`, `UpdateItem`, and `DeleteItem` on the dedicated table.

Do not attach Lambda to a VPC or create NAT Gateway for this feature.
