import { apiBase } from "@/lib/api";

/**
 * Check whether a customer sent a message within the last 24 hours
 * (server-side check — client calls the backend which queries the DB).
 */
export async function checkWabaWindow(accountId: string, jid: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${apiBase()}/api/accounts/${encodeURIComponent(accountId)}/window?jid=${encodeURIComponent(jid)}`,
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { inWindow: boolean };
    return data.inWindow;
  } catch {
    return false;
  }
}
