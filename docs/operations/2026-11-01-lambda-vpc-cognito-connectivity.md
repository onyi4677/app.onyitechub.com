# Incident record: Research API Lambda network connectivity

**Date resolved:** 1 November 2026  
**Service:** Onyitech Research Workspace  
**AWS region:** `us-east-1`  
**Lambda:** `onyitech-research-api`  
**API:** `api.onyitechub.com`

## Summary

The production Research Workspace dashboard failed to load projects after the Cognito authentication and project-ownership changes in PR #20. The dashboard showed a request failure and zero projects/modules. The `GET /api/projects` request returned HTTP 500, while `GET /api/modules` continued to return HTTP 200.

The Lambda was attached to a VPC using two private subnets. Their shared route table had a DynamoDB gateway-endpoint route but no general outbound internet route. The Lambda security group allowed outbound traffic, but a security-group egress rule cannot provide a missing network route.

The Cognito JWT verification code uses the public Cognito user-pool JWKS URL:

```text
https://cognito-idp.us-east-1.amazonaws.com/us-east-1_70B0J8Dwx/.well-known/jwks.json
```

The Lambda could not reliably reach this public endpoint from its VPC network configuration. The resulting request invocations timed out. Removing the Lambda's VPC attachment restored its default outbound connectivity. Immediately afterward, the production dashboard loaded successfully.

This is the operational diagnosis supported by the configuration evidence and successful remediation. The exact stalled network call was not independently instrumented during the incident, so the JWKS fetch is identified as the likely cause rather than a directly captured stack trace.

## User-visible impact

- Dashboard displayed a request failure and no projects.
- `GET /api/projects` returned HTTP 500.
- `GET /api/modules` continued to work.
- CloudWatch showed repeated Lambda invocations timing out at the configured 15-second timeout. Other invocations completed normally.
- The DynamoDB table continued to contain four project records during investigation.

## Relevant infrastructure before remediation

### Lambda VPC configuration

- VPC: `vpc-0dd3246b7d8d7b0df`
- Subnet: `subnet-04950ab5bbc285911` (us-east-1a)
- Subnet: `subnet-05293da25939dd0ee` (us-east-1b)
- Security group: `sg-0cd7be753de3a9e66` (`onyitech-lambda-sg`)
- Shared route table: `rtb-0244c23d145605fc8`

### Route table

The route table contained:

| Destination | Target | Meaning |
|---|---|---|
| `172.31.0.0/16` | `local` | VPC-local traffic |
| `pl-02cd2c6b` | `vpce-0a2179029826cfd82` | DynamoDB service prefix list through a gateway endpoint |

There was no `0.0.0.0/0` route to a NAT gateway or internet gateway.

### Security group

The security group had no inbound rules and one outbound rule allowing all traffic to `0.0.0.0/0`. Outbound filtering was therefore not the missing piece; the route table had no general internet path.

### DynamoDB endpoint

The existing endpoint was available and correctly identified as:

- Endpoint: `vpce-0a2179029826cfd82`
- Service: `com.amazonaws.us-east-1.dynamodb`
- Type: Gateway
- Route table association: `rtb-0244c23d145605fc8`

This endpoint provided the DynamoDB route. It did not provide connectivity to Cognito's public JWKS URL.

### Cognito

- User pool: `us-east-1_70B0J8Dwx`
- Issuer type: Original
- Service-owned prefix domain configured
- Token signing key URL: the public JWKS URL shown above

The backend validates bearer tokens using Cognito signing keys. The presence of a Cognito managed-login domain does not make the public JWKS endpoint reachable from a private subnet without an appropriate network path.

## Remediation performed

On 1 November 2026, the VPC attachment was removed from the Lambda:

1. Opened Lambda `onyitech-research-api`.
2. Navigated to **Configuration → VPC → Edit**.
3. Selected **None** for VPC.
4. Saved the configuration.
5. AWS confirmed the update and displayed **No VPC configuration**.

No NAT gateway was created. No DynamoDB table, project item, Cognito user pool, Lambda application code, or project ownership record was intentionally changed as part of this network remediation.

## Verification after remediation

The user refreshed the production dashboard and confirmed:

- 4 existing projects loaded.
- All 12 research modules were available.
- Project 001 and its saved work were accessible.
- The previous dashboard request failure disappeared.

The user also tested two newly created accounts. Each account showed:

- 0 projects
- 12 research modules

This is consistent with the intended product model:

- The research-module catalogue is shared and available to authenticated users.
- Projects are user-owned and must be isolated by Cognito subject (`sub`).
- A new account should not see another user's projects.
- A new account can see the shared 12-module catalogue without having created a project.

The account email addresses are deliberately not recorded in this repository document.

## Current operational state

| Component | Current state |
|---|---|
| Lambda `onyitech-research-api` | Not attached to a VPC |
| Cognito authentication | Dashboard access verified after remediation |
| DynamoDB table `onyitech-research-projects` | Retained; existing projects accessible |
| DynamoDB gateway endpoint | Retained; no longer required by this Lambda while it remains outside the VPC |
| NAT gateway | None created; not needed for the current Lambda network configuration |
| Research modules | 12 available to tested accounts |
| Project visibility | User-scoped; new test accounts saw no existing projects |

## Important architectural implications

1. **Do not reattach this Lambda to the private VPC without planning outbound connectivity.** If it needs public AWS endpoints such as Cognito JWKS while VPC-attached, provide a suitable outbound path (for example, NAT) or redesign token verification at the API Gateway layer and validate the full request flow.
2. **Do not assume a public subnet alone gives a VPC-attached Lambda internet access.** Lambda ENIs do not automatically receive public IP addresses.
3. **The current non-VPC Lambda can reach DynamoDB through its regional service endpoint**, subject to its existing IAM permissions. The VPC gateway endpoint is not used by this Lambda while it is outside the VPC.
4. **The Lambda is still invoked through its configured API Gateway triggers.** Removing VPC attachment does not, by itself, make the function publicly invokable outside its configured invocation permissions.
5. If N-ATLaS or another private VPC resource is needed again, revisit the network architecture before reconnecting the Lambda. Do not restore the old VPC attachment without also restoring a verified route to every required external endpoint.
6. Keep project ownership enforcement in place. Shared module definitions must not be confused with project-specific data.

## Suggested regression checks

After future authentication, networking, or deployment changes, verify:

- An existing owner can sign in and list their own projects.
- A newly registered user sees the shared 12-module catalogue.
- A newly registered user sees zero projects until they create one.
- A user cannot read, update, or delete another user's project by guessing its ID.
- `GET /api/modules` and `GET /api/projects` both complete successfully.
- Lambda logs show completed invocations rather than repeated timeouts.

## Related implementation

- Cognito token verification: `backend/app/auth.py`
- API routes and project ownership checks: `backend/app/api/routes.py`
- DynamoDB resource configuration: `backend/app/db.py`
- Authentication and ownership changes: PR #20

This document records the observed incident, the AWS configuration inspected, the remediation, and the post-change tests. It does not authorize future VPC, IAM, Cognito, or DynamoDB changes.
