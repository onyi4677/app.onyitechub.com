"use client";

import { useEffect, useState } from "react";
import { beginLogin, getAccessToken } from "../../lib/auth";

export default function LoginPage() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getAccessToken()) window.location.replace("/dashboard");
  }, []);

  async function handleLogin() {
    setWorking(true);
    setError("");
    try {
      await beginLogin();
    } catch {
      setError("Could not start sign-in. Please refresh and try again.");
      setWorking(false);
    }
  }

  return (
    <main className="container page">
      <section className="card form" style={{ maxWidth: 520, margin: "8vh auto" }}>
        <div className="eyebrow">Onyitech JournalHub</div>
        <h1>Onyitech Research Workspace</h1>
        <p className="muted">Sign in with the email address invited to the beta test.</p>
        <p className="muted">Access is invitation-only. If you do not have an account, contact the workspace administrator.</p>
        {error && <div className="notice">{error}</div>}
        <button className="button primary" onClick={handleLogin} disabled={working}>
          {working ? "Opening secure sign-in..." : "Sign in securely"}
        </button>
      </section>
    </main>
  );
}
