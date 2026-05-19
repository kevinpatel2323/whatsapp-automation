import { describe, expect, it } from "vitest";
import {
  classifiedBulkTargetFromItem,
  classifiedRowKey,
  replyPrivatelyJid,
} from "../lib/classified-bulk-send";
import type { ClassifiedMessageDto } from "../lib/types";

function baseItem(over: Partial<ClassifiedMessageDto>): ClassifiedMessageDto {
  return {
    messageId: "m1",
    remoteJid: "x@s.whatsapp.net",
    fromMe: false,
    intent: "buy",
    matchedMatch: null,
    isConfiguredMatch: false,
    matchDate: null,
    quantity: null,
    blocks: [],
    seats: [],
    sequenceRequired: null,
    sequenceNote: null,
    priceHints: [],
    extraInfo: [],
    rawSnippet: null,
    body: "hi",
    messageTimestampMs: "1",
    senderPushName: null,
    senderParticipant: null,
    senderParticipantAlt: null,
    groupJid: null,
    groupName: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("classified-bulk-send", () => {
  it("classifiedRowKey is stable", () => {
    const item = baseItem({ remoteJid: "g@g.us", messageId: "mid", fromMe: true });
    expect(classifiedRowKey(item)).toBe("g@g.us|mid|true");
  });

  it("replyPrivatelyJid uses participant in groups", () => {
    const item = baseItem({
      remoteJid: "grp@g.us",
      senderParticipant: "491234@s.whatsapp.net",
    });
    expect(replyPrivatelyJid(item)).toBe("491234@s.whatsapp.net");
  });

  it("classifiedBulkTargetFromItem adds quote for group cards", () => {
    const item = baseItem({
      remoteJid: "grp@g.us",
      messageId: "mid2",
      fromMe: false,
      senderParticipant: "491234@s.whatsapp.net",
    });
    expect(classifiedBulkTargetFromItem(item)).toEqual({
      jid: "491234@s.whatsapp.net",
      quotedGroupMessage: {
        remoteJid: "grp@g.us",
        messageId: "mid2",
        fromMe: false,
      },
    });
  });

  it("classifiedBulkTargetFromItem omits quote for direct chat", () => {
    const item = baseItem({
      remoteJid: "491234@s.whatsapp.net",
      senderParticipant: null,
    });
    expect(classifiedBulkTargetFromItem(item)).toEqual({ jid: "491234@s.whatsapp.net" });
  });
});
