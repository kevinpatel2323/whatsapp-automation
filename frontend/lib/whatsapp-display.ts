/**
 * Human-readable WhatsApp / Baileys JID helpers for UI (avoid surfacing raw LIDs).
 */

const PHONE_SUFFIX = "@s.whatsapp.net";

export function isLidWhatsAppJid(jid: string | null | undefined): boolean {
  if (!jid?.trim()) return false;
  return jid.trim().toLowerCase().endsWith("@lid");
}

/** E.164-style display from `digits@s.whatsapp.net` (adds leading +). */
export function formatWhatsAppPhoneJid(jid: string | null | undefined): string | null {
  if (!jid?.trim()) return null;
  const j = jid.trim();
  if (!j.toLowerCase().endsWith(PHONE_SUFFIX)) return null;
  const user = j.slice(0, j.length - PHONE_SUFFIX.length);
  if (!/^\d{5,20}$/.test(user)) return null;
  return `+${user}`;
}

/** Digits from `user` in `digits@s.whatsapp.net`, or null if not a phone JID. */
export function phoneUserDigitsFromWhatsAppJid(jid: string | null | undefined): string | null {
  if (!jid?.trim()) return null;
  const j = jid.trim();
  if (!j.toLowerCase().endsWith(PHONE_SUFFIX)) return null;
  const user = j.slice(0, j.length - PHONE_SUFFIX.length);
  if (!/^\d{5,20}$/.test(user)) return null;
  return user;
}

/** True when `label` already shows the same number (avoid duplicate header lines). */
export function displayLabelAlreadyShowsPhoneDigits(
  label: string | null | undefined,
  phoneDigits: string,
): boolean {
  if (!label?.trim() || !phoneDigits) return false;
  const compact = label.replace(/\D/g, "");
  if (compact.includes(phoneDigits)) return true;
  const tail = phoneDigits.slice(-Math.min(phoneDigits.length, 12));
  return tail.length >= 7 && compact.includes(tail);
}

/**
 * Short JID for UI: never returns truncated `@lid` strings; prefers phone for `@s.whatsapp.net`.
 */
export function shortJidForUi(jid: string | null | undefined): string | null {
  if (!jid?.trim()) return null;
  const j = jid.trim();
  if (isLidWhatsAppJid(j)) return null;
  const phone = formatWhatsAppPhoneJid(j);
  if (phone) return phone;
  if (j.length < 22) return j;
  return `${j.slice(0, 10)}…${j.slice(-8)}`;
}

export function classifiedSenderPhoneDisplay(item: {
  senderParticipant?: string | null;
  senderParticipantAlt?: string | null;
}): string | null {
  const a = formatWhatsAppPhoneJid(item.senderParticipant);
  if (a) return a;
  return formatWhatsAppPhoneJid(item.senderParticipantAlt ?? null);
}

export function messageBubbleSenderLabel(m: {
  pushName?: string | null;
  participant?: string | null;
  participantAlt?: string | null;
}): string {
  const name = m.pushName?.trim();
  if (name) return name;
  const phone =
    formatWhatsAppPhoneJid(m.participant) ?? formatWhatsAppPhoneJid(m.participantAlt ?? null);
  if (phone) return phone;
  const sj = shortJidForUi(m.participant ?? null);
  if (sj) return sj;
  return "Member";
}
