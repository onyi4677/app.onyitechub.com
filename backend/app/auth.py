import os
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

REGION = os.getenv("COGNITO_REGION", "us-east-1")
USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "us-east-1_70B0J8Dwx")
APP_CLIENT_ID = os.getenv("COGNITO_APP_CLIENT_ID", "1j3af1c5pitgj7c6r5k484jbiv")
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}"
JWKS_URL = f"{ISSUER}/.well-known/jwks.json"

_bearer = HTTPBearer(auto_error=False)


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(JWKS_URL, cache_keys=True)


def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Please sign in to continue.")

    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            issuer=ISSUER,
            options={"verify_aud": False},
        )
        if claims.get("token_use") != "access":
            raise HTTPException(status_code=401, detail="A valid access token is required.")
        if claims.get("client_id") != APP_CLIENT_ID:
            raise HTTPException(status_code=401, detail="This sign-in token is not valid for this application.")
        if not claims.get("sub"):
            raise HTTPException(status_code=401, detail="The sign-in token is missing its user identifier.")
        return {"sub": claims["sub"], "username": claims.get("username", "")}
    except HTTPException:
        raise
    except (jwt.PyJWTError, Exception) as exc:
        raise HTTPException(status_code=401, detail="Your session is invalid or has expired. Please sign in again.") from exc
