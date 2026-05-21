import type { Account } from "@/lib/types";
import { apiBase } from "@/lib/api";

function api(): string {
  return `${apiBase()}/api`;
}

export async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch(`${api()}/accounts`);
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts;
}

export async function fetchTemplates(accountId: string) {
  const res = await fetch(`${api()}/accounts/${accountId}/templates`);
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
  return (await res.json()) as { templates: import("@/lib/types").MessageTemplate[] };
}

export async function syncTemplates(accountId: string) {
  const res = await fetch(`${api()}/accounts/${accountId}/templates/sync`, { method: "POST" });
  if (!res.ok) throw new Error(`Template sync failed: ${res.status}`);
  return (await res.json()) as { synced: number; templates: import("@/lib/types").MessageTemplate[] };
}

export type AddWabaAccountInput = {
  displayName: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
  phoneE164?: string;
};

export async function addWabaAccount(input: AddWabaAccountInput) {
  const res = await fetch(`${api()}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "waba", ...input }),
  });
  const data = await res.json() as { id?: string; error?: string; webhookUrl?: string; status?: string };
  if (!res.ok) throw new Error(data.error ?? `Create failed: ${res.status}`);
  return data as { id: string; webhookUrl: string; status: string };
}

export async function removeAccount(accountId: string) {
  const res = await fetch(`${api()}/accounts/${accountId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Remove failed: ${res.status}`);
}

export async function fetchWebhookConfig(accountId: string) {
  const res = await fetch(`${api()}/accounts/${accountId}/webhook-config`);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return (await res.json()) as { webhookUrl: string; webhookVerifyToken: string };
}

export async function connectAccount(accountId: string) {
  const res = await fetch(`${api()}/accounts/${accountId}/connect`, { method: "POST" });
  if (!res.ok) throw new Error(`Connect failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; state?: string; error?: string };
}

export async function logoutAccount(accountId: string) {
  const res = await fetch(`${api()}/accounts/${accountId}/logout`, { method: "POST" });
  if (!res.ok) throw new Error(`Logout failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; error?: string };
}

/** Status badge color for an account status */
export function statusColor(status: Account["status"]): string {
  switch (status) {
    case "open": return "bg-green-500";
    case "connecting": return "bg-yellow-400";
    case "close": return "bg-red-500";
    default: return "bg-gray-400";
  }
}

/** Short label for account type */
export function typeLabel(type: Account["type"]): string {
  return type === "waba" ? "WABA" : "Baileys";
}
