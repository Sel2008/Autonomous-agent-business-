const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

export function supabaseConfigured() {
  return Boolean(url && key);
}

export async function supabaseRequest(path: string, init: RequestInit = {}) {
  if (!url || !key) throw new Error("Supabase is not configured");

  const response = await fetch(url + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${detail}`);
  }

  return response.json();
}
