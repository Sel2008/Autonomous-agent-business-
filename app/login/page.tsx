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
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, padding: 28, border: "1px solid #ddd", borderRadius: 16, background: "white" }}>
        <div style={{ fontSize: 12, letterSpacing: 1.5, fontWeight: 700, opacity: 0.65 }}>OWNER CONTROL</div>
        <h1 style={{ marginBottom: 8 }}>Autonomous Business Agent</h1>
        <p style={{ marginTop: 0, opacity: 0.7 }}>Sign in to access the operational dashboard.</p>
        <label style={{ display: "block", marginTop: 24, fontWeight: 600 }}>
          Owner password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            style={{ display: "block", width: "100%", marginTop: 8, padding: 12, border: "1px solid #bbb", borderRadius: 10, boxSizing: "border-box" }}
          />
        </label>
        {error && <p style={{ color: "#b42318", marginBottom: 0 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 20, padding: 12, border: 0, borderRadius: 10, fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>Loading…</main>}>
      <LoginForm />
    </Suspense>
  );
}
