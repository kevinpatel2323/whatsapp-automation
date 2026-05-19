import { describe, expect, it } from "vitest";
import { chatListTitle, displayNameRedundantWithPhone } from "@/lib/chat-list-display";
import type { ChatRow } from "@/lib/types";

function row(p: Partial<ChatRow> & { jid: string }): Pick<ChatRow, "jid" | "name" | "isGroup"> {
  return {
    jid: p.jid,
    name: p.name ?? null,
    isGroup: p.isGroup ?? p.jid.endsWith("@g.us"),
  };
}

describe("displayNameRedundantWithPhone", () => {
  it("detects same formatted phone", () => {
    expect(displayNameRedundantWithPhone("+919876543210", "+919876543210")).toBe(true);
  });

  it("detects digit-only name matching phone", () => {
    expect(displayNameRedundantWithPhone("9876543210", "+919876543210")).toBe(true);
  });

  it("returns false for distinct person name", () => {
    expect(displayNameRedundantWithPhone("Hari Venkat", "+919876543210")).toBe(false);
  });
});

describe("chatListTitle", () => {
  it("uses Newsletter label when name missing for @newsletter", () => {
    expect(
      chatListTitle(
        row({ jid: "120363168033477807@newsletter", name: null, isGroup: false }),
      ),
    ).toBe("Newsletter");
  });

  it("uses stored name for newsletter when present", () => {
    expect(
      chatListTitle(
        row({
          jid: "120363168033477807@newsletter",
          name: "Tamil Nadu Updates",
          isGroup: false,
        }),
      ),
    ).toBe("Tamil Nadu Updates");
  });

  it("shows group subject when present", () => {
    expect(
      chatListTitle(
        row({
          jid: "123@g.us",
          name: "IPL Fanzone West",
          isGroup: true,
        }),
      ),
    ).toBe("IPL Fanzone West");
  });

  it("shows Group chat when group has no name", () => {
    expect(chatListTitle(row({ jid: "123@g.us", name: null, isGroup: true }))).toBe("Group chat");
  });

  it("formats phone DM with name and phone", () => {
    expect(
      chatListTitle(
        row({
          jid: "919876543210@s.whatsapp.net",
          name: "Hari",
          isGroup: false,
        }),
      ),
    ).toBe("Hari · +919876543210");
  });

  it("formats phone-only DM", () => {
    expect(
      chatListTitle(row({ jid: "919876543210@s.whatsapp.net", name: null, isGroup: false })),
    ).toBe("+919876543210");
  });

  it("hides raw LID when no name", () => {
    expect(
      chatListTitle(
        row({
          jid: "123456789012345@lid",
          name: null,
          isGroup: false,
        }),
      ),
    ).toBe("WhatsApp contact");
  });

  it("uses name for LID when present", () => {
    expect(
      chatListTitle(
        row({
          jid: "123456789012345@lid",
          name: "Shop",
          isGroup: false,
        }),
      ),
    ).toBe("Shop");
  });

  it("labels status@broadcast", () => {
    expect(chatListTitle(row({ jid: "status@broadcast", name: null, isGroup: false }))).toBe(
      "Status",
    );
  });
});
