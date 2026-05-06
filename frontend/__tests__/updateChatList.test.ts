/**
 * Property-based tests for `updateChatList`
 *
 * Validates: Requirements 2.3, 2.4, 2.5
 */
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { updateChatList } from "@/components/Dashboard";
import type { ChatRow, MessageDto } from "@/lib/types";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid MessageDto with all required fields. */
const messageDtoArb: fc.Arbitrary<MessageDto> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 32 }),
  remoteJid: fc.string({ minLength: 1, maxLength: 32 }),
  fromMe: fc.boolean(),
  participant: fc.option(fc.string(), { nil: null }),
  remoteJidAlt: fc.option(fc.string(), { nil: null }),
  participantAlt: fc.option(fc.string(), { nil: null }),
  pushName: fc.option(fc.string(), { nil: null }),
  messageType: fc.constantFrom("text", "image", "audio", "video", "document"),
  body: fc.option(fc.string(), { nil: null }),
  messageTimestampMs: fc.nat().map(String),
  createdAt: fc.nat({ max: 4102444800000 }).map((ms) => new Date(ms).toISOString()),
  intent: fc.option(fc.string(), { nil: null }),
  matchedMatch: fc.option(fc.string(), { nil: null }),
});

/** Generates a valid ChatRow. */
const chatRowArb: fc.Arbitrary<ChatRow> = fc.record({
  jid: fc.string({ minLength: 1, maxLength: 32 }),
  name: fc.option(fc.string(), { nil: null }),
  isGroup: fc.boolean(),
  lastMessageAt: fc.option(
    fc.nat({ max: 4102444800000 }).map((ms) => new Date(ms).toISOString()),
    { nil: null },
  ),
  unreadCount: fc.nat({ max: 100 }),
  updatedAt: fc.nat({ max: 4102444800000 }).map((ms) => new Date(ms).toISOString()),
  lastMessageBody: fc.option(fc.string(), { nil: null }),
  lastMessageType: fc.option(fc.string(), { nil: null }),
  lastMessageFromMe: fc.option(fc.boolean(), { nil: null }),
  lastSenderName: fc.option(fc.string(), { nil: null }),
});

/** Generates an array of ChatRow with unique jids. */
const uniqueChatRowsArb: fc.Arbitrary<ChatRow[]> = fc
  .array(chatRowArb, { maxLength: 20 })
  .map((rows) => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.jid)) return false;
      seen.add(r.jid);
      return true;
    });
  });

// ---------------------------------------------------------------------------
// Property 4: Chat list optimistic update — no network request
//
// `updateChatList` is a pure function: no fetch calls, no input mutation,
// returns a new array reference.
//
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------
describe("updateChatList", () => {
  it(
    "Property 4: is a pure function — no fetch, no mutation, new array reference",
    () => {
      fc.assert(
        fc.property(uniqueChatRowsArb, messageDtoArb, (chats, msg) => {
          // Spy on global fetch to ensure it is never called
          const fetchSpy = vi.spyOn(globalThis, "fetch");

          // Snapshot input references and contents before the call
          const inputRef = chats;
          const inputSnapshot = chats.map((r) => ({ ...r }));

          const result = updateChatList(chats, msg);

          // 1. fetch must not have been called
          expect(fetchSpy).not.toHaveBeenCalled();

          // 2. Input array must not be mutated (same contents)
          expect(chats).toEqual(inputSnapshot);

          // 3. Result must be a new array reference (not the same object)
          expect(result).not.toBe(inputRef);

          fetchSpy.mockRestore();
        }),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 5: Chat list bump to top
  //
  // For any chats[] and any MessageDto, the row whose jid matches
  // msg.remoteJid is at index 0 of the result.
  //
  // Validates: Requirements 2.4, 2.5
  // ---------------------------------------------------------------------------
  it(
    "Property 5: the chat row matching msg.remoteJid is always at index 0",
    () => {
      fc.assert(
        fc.property(uniqueChatRowsArb, messageDtoArb, (chats, msg) => {
          const result = updateChatList(chats, msg);

          expect(result.length).toBeGreaterThan(0);
          expect(result[0]!.jid).toBe(msg.remoteJid);
        }),
      );
    },
  );
});
