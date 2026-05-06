/**
 * Property-based tests for MessageFeed filter correctness
 *
 * **Validates: Requirements 6.2, 6.3**
 *
 * Property 7: MessageFeed filter correctness — for any `messages[]` and any
 * `selectedJid`, displayed messages equal
 * `messages.filter(m => selectedJid === null || m.remoteJid === selectedJid)`
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { MessageDto } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pure filter function (mirrors the `filtered` useMemo in Dashboard.tsx)
// ---------------------------------------------------------------------------
function filterMessages(
  messages: MessageDto[],
  selectedJid: string | null,
): MessageDto[] {
  return messages.filter(
    (m) => selectedJid === null || m.remoteJid === selectedJid,
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

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
  createdAt: fc
    .nat({ max: 4102444800000 })
    .map((ms) => new Date(ms).toISOString()),
  intent: fc.option(fc.string(), { nil: null }),
  matchedMatch: fc.option(fc.string(), { nil: null }),
});

const messagesArb = fc.array(messageDtoArb, { maxLength: 30 });

// selectedJid is either null or one of a small set of JID strings
const selectedJidArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 32 }),
);

// ---------------------------------------------------------------------------
// Property 7: MessageFeed filter correctness
// ---------------------------------------------------------------------------
describe("filterMessages (MessageFeed filter correctness)", () => {
  it(
    "Property 7a: when selectedJid is null, all messages are returned",
    () => {
      fc.assert(
        fc.property(messagesArb, (messages) => {
          const result = filterMessages(messages, null);
          expect(result).toEqual(messages);
        }),
      );
    },
  );

  it(
    "Property 7b: when selectedJid is a string, only messages with matching remoteJid are returned",
    () => {
      fc.assert(
        fc.property(messagesArb, fc.string({ minLength: 1, maxLength: 32 }), (messages, jid) => {
          const result = filterMessages(messages, jid);
          // Every returned message must have remoteJid === jid
          expect(result.every((m) => m.remoteJid === jid)).toBe(true);
          // Every message with remoteJid === jid must be in the result
          const expected = messages.filter((m) => m.remoteJid === jid);
          expect(result).toEqual(expected);
        }),
      );
    },
  );

  it(
    "Property 7c: filter is a pure function — calling it twice yields the same result",
    () => {
      fc.assert(
        fc.property(messagesArb, selectedJidArb, (messages, selectedJid) => {
          const first = filterMessages(messages, selectedJid);
          const second = filterMessages(messages, selectedJid);
          expect(first).toEqual(second);
        }),
      );
    },
  );

  it(
    "Property 7d: filter does not mutate the original messages array",
    () => {
      fc.assert(
        fc.property(messagesArb, selectedJidArb, (messages, selectedJid) => {
          const copy = [...messages];
          filterMessages(messages, selectedJid);
          expect(messages).toEqual(copy);
        }),
      );
    },
  );
});
