const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

export function supabaseConfigured() {
  return Boolean(url && key);
}

export async function supabaseRequest(path: string, init: RequestInit = {}) {
  if (!url || !key) throw new Error("Supabase is not configured");

  const baseUrl = url.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const response = await fetch(baseUrl + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${raw}`);
  }

  if (!raw.trim()) return null;

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Supabase returned an invalid JSON response.");
  }
}
