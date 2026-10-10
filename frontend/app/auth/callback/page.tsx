"use client";

import { useEffect, useState } from "react";
import { completeLogin } from "../../../lib/auth";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing secure sign-in...");

  useEffect(() => {
    let active = true;
    completeLogin()
      .then(() => {
        if (active) window.location.replace("/dashboard");
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Sign-in could not be completed.");
      });
    return () => { active = false; };
  }, []);

  return <main className="container page"><div className="card form"><h1>Signing you in</h1><p className="muted">{message}</p><a className="button" href="/login">Return to login</a></div></main>;
}
