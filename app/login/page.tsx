"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Login failed.");
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#080d18" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, padding: 32, border: "1px solid #24324a", borderRadius: 18, background: "#111a2e", color: "#e2e8f0", boxShadow: "0 20px 60px rgba(0,0,0,.28)" }}>
        <div style={{ fontSize: 12, letterSpacing: 1.5, fontWeight: 700, color: "#93c5fd", marginBottom: 8 }}>OWNER CONTROL</div>
        <h1 style={{ margin: "0 0 8px", color: "#f8fafc", fontSize: 32, lineHeight: 1.15 }}>Autonomous Business Agent</h1>
        <p style={{ margin: 0, color: "#aab6cc", lineHeight: 1.55 }}>Sign in to access the operational dashboard.</p>
        <label style={{ display: "block", marginTop: 24, fontWeight: 600, color: "#e2e8f0" }}>
          Owner password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            style={{ display: "block", width: "100%", marginTop: 8, padding: 12, border: "1px solid #475569", borderRadius: 10, boxSizing: "border-box", background: "#0d1628", color: "#f8fafc", outline: "none" }}
          />
        </label>
        {error && <p style={{ color: "#fca5a5", marginBottom: 0 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 20, padding: 12, border: 0, borderRadius: 10, background: "#2563eb", color: "#fff", fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ marginTop: 18, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>Secure access • Owner only</div>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#080d18", color: "#cbd5e1" }}>Loading…</main>}>
      <LoginForm />
    </Suspense>
  );
}
