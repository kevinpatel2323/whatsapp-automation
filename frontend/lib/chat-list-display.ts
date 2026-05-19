import type { ChatRow } from "@/lib/types";
import { formatWhatsAppPhoneJid, isLidWhatsAppJid } from "@/lib/whatsapp-display";

function jidLower(jid: string): string {
  return jid.trim().toLowerCase();
}

/** True when `name` is redundant with `phoneDisplay` (same digits or same string). */
export function displayNameRedundantWithPhone(name: string, phoneDisplay: string): boolean {
  const n = name.trim().toLowerCase();
  const p = phoneDisplay.trim().toLowerCase();
  if (!n || !p) return false;
  if (n === p) return true;
  const digitsName = n.replace(/\D/g, "");
  const digitsPhone = p.replace(/\D/g, "");
  if (digitsPhone.length >= 8 && digitsName.length >= 8) {
    if (digitsName === digitsPhone) return true;
    if (digitsName.includes(digitsPhone) || digitsPhone.includes(digitsName)) return true;
  }
  return false;
}

function defaultLabelForJidSuffix(jid: string): string {
  const j = jidLower(jid);
  if (j.endsWith("@newsletter")) return "Newsletter";
  if (j === "status@broadcast") return "Status";
  if (j.endsWith("@broadcast")) return "Broadcast";
  if (isLidWhatsAppJid(jid)) return "WhatsApp contact";
  if (j.endsWith("@g.us")) return "Group chat";
  return "Chat";
}

/**
 * Primary sidebar title for a chat row. Avoids raw numeric `@newsletter` / `@lid` JIDs when `name` is missing.
 */
export function chatListTitle(c: Pick<ChatRow, "jid" | "name" | "isGroup">): string {
  const jid = c.jid.trim();
  const j = jidLower(jid);
  const name = c.name?.trim() || null;

  if (c.isGroup || j.endsWith("@g.us")) {
    return name || defaultLabelForJidSuffix(jid);
  }

  const phone = formatWhatsAppPhoneJid(jid);
  if (phone) {
    if (name && !displayNameRedundantWithPhone(name, phone)) {
      return `${name} · ${phone}`;
    }
    return phone;
  }

  if (j.endsWith("@newsletter")) {
    return name || "Newsletter";
  }

  if (j === "status@broadcast") {
    return name || "Status";
  }

  if (j.endsWith("@broadcast")) {
    return name || "Broadcast";
  }

  if (isLidWhatsAppJid(jid)) {
    return name || "WhatsApp contact";
  }

  if (name) return name;

  return defaultLabelForJidSuffix(jid);
}
