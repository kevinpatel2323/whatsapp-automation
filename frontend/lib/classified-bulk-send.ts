import type { ClassifiedMessageDto } from "@/lib/types";

export function classifiedRowKey(
  item: Pick<ClassifiedMessageDto, "remoteJid" | "messageId" | "fromMe">,
): string {
  return `${item.remoteJid}|${item.messageId}|${String(item.fromMe)}`;
}

/** DM / LID JID for private reply (group → participant; 1:1 → remote). */
export function replyPrivatelyJid(item: ClassifiedMessageDto): string {
  const inGroup = item.remoteJid.endsWith("@g.us");
  const p = item.senderParticipant?.trim();
  if (inGroup && p) return p;
  return item.remoteJid;
}

export type ClassifiedBulkSendTarget = {
  jid: string;
  quotedGroupMessage?: { remoteJid: string; messageId: string; fromMe: boolean };
};

export function classifiedBulkTargetFromItem(item: ClassifiedMessageDto): ClassifiedBulkSendTarget {
  const jid = replyPrivatelyJid(item);
  const isGroupCard = item.remoteJid.endsWith("@g.us") && Boolean(item.senderParticipant?.trim());
  if (!isGroupCard) return { jid };
  return {
    jid,
    quotedGroupMessage: {
      remoteJid: item.remoteJid,
      messageId: item.messageId,
      fromMe: Boolean(item.fromMe),
    },
  };
}
