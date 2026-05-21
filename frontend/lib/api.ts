/**
 * REST + Socket.io base URL. Set `NEXT_PUBLIC_BACKEND_URL` when the UI is not
 * served from the same host as the API (e.g. phone on LAN → `http://192.168.x.x:4100`).
 */
export function apiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:4100";
}

export async function getJson<T>(path: string): Promise<T> {
  const u = new URL(path, apiBase() + "/");
  const r = await fetch(u.toString(), { cache: "no-store" });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return (await r.json()) as T;
}

export async function postJson<T>(path: string, body?: object): Promise<T> {
  const u = new URL(path, apiBase() + "/");
  const r = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return (await r.json()) as T;
}

export async function patchJson<T>(path: string, body: object): Promise<T> {
  const u = new URL(path, apiBase() + "/");
  const r = await fetch(u.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return (await r.json()) as T;
}
