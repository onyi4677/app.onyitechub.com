const COGNITO_DOMAIN = "https://us-east-170b0j8dwx.auth.us-east-1.amazoncognito.com";
const CLIENT_ID = "1j3af1c5pitgj7c6r5k484jbiv";

const KEYS = {
  verifier: "onyi_oidc_verifier",
  state: "onyi_oidc_state",
  access: "onyi_access_token",
  id: "onyi_id_token",
  refresh: "onyi_refresh_token",
  expiry: "onyi_token_expiry",
};

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

function getCallbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

export async function beginLogin(): Promise<void> {
  const callbackUrl = getCallbackUrl();
  const verifier = randomString(48);
  const state = randomString(24);
  const challenge = base64Url(await sha256(verifier));

  sessionStorage.setItem(KEYS.verifier, verifier);
  sessionStorage.setItem(KEYS.state, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "openid email",
    redirect_uri: callbackUrl,
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
  const expectedState = sessionStorage.getItem(KEYS.state);
  const verifier = sessionStorage.getItem(KEYS.verifier);

  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    throw new Error("The sign-in response could not be verified. Please return to the login page and try again.");
  }

  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: getCallbackUrl(),
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error("Cognito could not complete sign-in. Please return to the login page and try again.");
  }

  const tokens = await response.json() as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Cognito did not return the required session tokens. Please sign in again.");
  }

  sessionStorage.setItem(KEYS.access, tokens.access_token);
  if (tokens.id_token) sessionStorage.setItem(KEYS.id, tokens.id_token);
  sessionStorage.setItem(KEYS.refresh, tokens.refresh_token);
  sessionStorage.setItem(KEYS.expiry, String(Date.now() + (tokens.expires_in ?? 3600) * 1000));
  sessionStorage.removeItem(KEYS.state);
  sessionStorage.removeItem(KEYS.verifier);
}

export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const token = sessionStorage.getItem(KEYS.access);
  const expiry = Number(sessionStorage.getItem(KEYS.expiry) || "0");
  if (token && expiry > Date.now() + 60_000) return token;

  const refreshToken = sessionStorage.getItem(KEYS.refresh);
  if (!refreshToken) {
    clearSession();
    return null;
  }

  try {
    const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      clearSession();
      return null;
    }

    const refreshed = await response.json() as { access_token?: string; id_token?: string; expires_in?: number };
    if (!refreshed.access_token) {
      clearSession();
      return null;
    }
    sessionStorage.setItem(KEYS.access, refreshed.access_token);
    if (refreshed.id_token) sessionStorage.setItem(KEYS.id, refreshed.id_token);
    sessionStorage.setItem(KEYS.expiry, String(Date.now() + (refreshed.expires_in ?? 3600) * 1000));
    return refreshed.access_token;
  } catch {
    return null;
  }
}

export function hasSession(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(sessionStorage.getItem(KEYS.refresh) || sessionStorage.getItem(KEYS.access));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  Object.values(KEYS).forEach((key) => sessionStorage.removeItem(key));
}

export function signOut(): void {
  clearSession();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: `${window.location.origin}/login`,
  });
  window.location.assign(`${COGNITO_DOMAIN}/logout?${params.toString()}`);
}
