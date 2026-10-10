const COGNITO_DOMAIN = "https://us-east-170b0j8dwx.auth.us-east-1.amazoncognito.com";
const CLIENT_ID = "1j3af1c5pitgj7c6r5k484jbiv";
const CALLBACK_URL = "https://app.onyitechub.com/auth/callback";
const LOGOUT_URL = "https://app.onyitechub.com/login";

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

function base64Url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function beginLogin(): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(24);
  const challenge = base64Url(await sha256(verifier));
  sessionStorage.setItem("onyi_oidc_verifier", verifier);
  sessionStorage.setItem("onyi_oidc_state", state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "openid email",
    redirect_uri: CALLBACK_URL,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  window.location.assign(`${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`);
}

export async function completeLogin(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const expectedState = sessionStorage.getItem("onyi_oidc_state");
  const verifier = sessionStorage.getItem("onyi_oidc_verifier");

  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    throw new Error("The sign-in response could not be verified. Please return to the login page and try again.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: CALLBACK_URL,
    code_verifier: verifier,
  });
  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error("Cognito could not complete sign-in. Please return to the login page and try again.");
  }

  const tokens = await response.json() as { access_token?: string; id_token?: string; expires_in?: number; token_type?: string };
  if (!tokens.access_token) throw new Error("Cognito did not return an access token.");
  sessionStorage.setItem("onyi_access_token", tokens.access_token);
  if (tokens.id_token) sessionStorage.setItem("onyi_id_token", tokens.id_token);
  sessionStorage.setItem("onyi_token_expiry", String(Date.now() + (tokens.expires_in ?? 3600) * 1000));
  sessionStorage.removeItem("onyi_oidc_state");
  sessionStorage.removeItem("onyi_oidc_verifier");
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = sessionStorage.getItem("onyi_access_token");
  const expiry = Number(sessionStorage.getItem("onyi_token_expiry") || "0");
  if (!token || !expiry || Date.now() >= expiry) {
    clearSession();
    return null;
  }
  return token;
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  ["onyi_access_token", "onyi_id_token", "onyi_token_expiry", "onyi_oidc_state", "onyi_oidc_verifier"].forEach((key) => sessionStorage.removeItem(key));
}

export function signOut(): void {
  clearSession();
  const params = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: LOGOUT_URL });
  window.location.assign(`${COGNITO_DOMAIN}/logout?${params.toString()}`);
}
