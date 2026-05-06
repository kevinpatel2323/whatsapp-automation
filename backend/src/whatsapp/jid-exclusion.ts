/**
 * Test whether a counterparty JID matches a user-supplied pattern
 * (digits with optional +/spaces, or a full JID, or a bare user id including LID).
 */
function userPart(jid: string): string {
  return (jid.split("@")[0] ?? "").trim();
}

/**
 * @param counterpartyJid — e.g. 91...@s.whatsapp.net or LID@lid
 * @param pattern — e.g. "+91 98...", "9198...", "98...@s.whatsapp.net", or "lid@lid" segment
 */
export function jidMatchesExclusionPattern(counterpartyJid: string, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) {
    return false;
  }
  const tUser = userPart(counterpartyJid);
  if (!tUser) {
    return false;
  }

  if (p.includes("@")) {
    const a = counterpartyJid.toLowerCase();
    const b = p.toLowerCase();
    if (a === b) {
      return true;
    }
    if (tUser === userPart(p).toLowerCase()) {
      return true;
    }
  }

  const pDigits = p.replace(/\D/g, "");
  const tDigits = tUser.replace(/\D/g, "");
  if (pDigits.length > 0 && tDigits.length > 0) {
    if (pDigits === tDigits) {
      return true;
    }
    if (pDigits.length >= 8 && tDigits.length >= 8) {
      if (tDigits.endsWith(pDigits) || pDigits.endsWith(tDigits)) {
        return true;
      }
    }
  }

  return tUser.toLowerCase() === p.toLowerCase();
}

export type ReplyExclusionEntry = { name: string; value: string };

export function isCounterpartyExcluded(
  counterpartyJid: string,
  exclusions: ReplyExclusionEntry[] | null | undefined,
): boolean {
  if (!exclusions?.length) {
    return false;
  }
  for (const e of exclusions) {
    if (jidMatchesExclusionPattern(counterpartyJid, e.value)) {
      return true;
    }
  }
  return false;
}
