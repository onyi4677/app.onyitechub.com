"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken, signOut } from "../lib/auth";

export default function Nav() {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      window.location.replace("/login");
      return;
    }
    setAuthenticated(true);
  }, []);

  return <nav className="nav">
    <Link href="/" className="brand">Onyitech <span>Research Workspace</span></Link>
    <div className="navlinks">
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/projects/new">New project</Link>
      <Link href="/analyze">Analyze</Link>
      {authenticated && <button className="button" type="button" onClick={signOut}>Sign out</button>}
    </div>
  </nav>;
}
