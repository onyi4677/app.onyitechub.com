"use client";

import { useEffect, useState } from "react";
import { beginLogin, hasSession } from "../../lib/auth";

export default function LoginPage() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (hasSession()) window.location.replace("/dashboard");
  }, []);

  async function handleLogin() {
    setWorking(true);
    setError("");
    try {
      await beginLogin();
    } catch {
      setError("Could not open secure sign-in. Please refresh and try again.");
      setWorking(false);
    }
  }

  return (
    <main className="container page">
      <section className="card form" style={{ maxWidth: 520, margin: "8vh auto" }}>
        <div className="eyebrow">Onyitech JournalHub</div>
        <h1>Onyitech Research Workspace</h1>
        <p className="muted">Sign in securely with your email address, or create a new researcher account.</p>
        <p className="muted">New to the workspace? Choose <strong>Create an account</strong> on the secure sign-in page. Cognito will guide you through email verification.</p>
        {error && <div className="notice" role="alert">{error}</div>}
        <button className="button primary" onClick={handleLogin} disabled={working}>
          {working ? "Opening secure sign-in..." : "Continue with email"}
        </button>
      </section>
    </main>
  );
}
