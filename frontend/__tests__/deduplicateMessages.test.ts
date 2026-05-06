/**
 * Property-based tests for `deduplicateMessages`
 *
 * Validates: Requirements 2.1, 2.2
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { deduplicateMessages } from "@/components/Dashboard";
import type { MessageDto } from "@/lib/types";

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

/** Generates an array of MessageDto with unique msgKeys. */
const uniqueMessagesArb: fc.Arbitrary<MessageDto[]> = fc
  .array(messageDtoArb, { maxLength: 20 })
  .map((msgs) => {
    // Deduplicate by msgKey to ensure the array itself has no duplicates
    const seen = new Set<string>();
    return msgs.filter((m) => {
      const k = `${m.remoteJid}|${m.id}|${String(m.fromMe)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

// ---------------------------------------------------------------------------
// Property 2: Message deduplication — no duplicate prepend
//
// For any messages[] and any MessageDto, if msgKey(incoming) is already
// present in the array, the array length is unchanged.
//
// Validates: Requirements 2.1, 2.2
// ---------------------------------------------------------------------------
describe("deduplicateMessages", () => {
  it(
    "Property 2: does not change array length when incoming key already exists",
    () => {
      fc.assert(
        fc.property(
          // Generate a non-empty array of unique messages, then pick one as the duplicate
          fc
            .array(messageDtoArb, { minLength: 1, maxLength: 20 })
            .map((msgs) => {
              // Ensure unique keys within the array
              const seen = new Set<string>();
              const unique = msgs.filter((m) => {
                const k = `${m.remoteJid}|${m.id}|${String(m.fromMe)}`;
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
              });
              return unique;
            })
            .filter((msgs) => msgs.length > 0),
          fc.nat(),
          (messages, idx) => {
            // Pick an existing message as the "incoming" duplicate
            const duplicate = messages[idx % messages.length]!;
            const result = deduplicateMessages(messages, duplicate);
            expect(result.length).toBe(messages.length);
          },
        ),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 3: Message prepend — newest first
  //
  // For any messages[] and any MessageDto with a unique key, the incoming
  // message appears at index 0 of the resulting array.
  //
  // Validates: Requirements 2.1
  // ---------------------------------------------------------------------------
  it(
    "Property 3: prepends incoming message at index 0 when key is unique",
    () => {
      fc.assert(
        fc.property(
          uniqueMessagesArb,
          messageDtoArb,
          (messages, incoming) => {
            // Ensure the incoming message has a key not present in messages
            const existingKeys = new Set(
              messages.map((m) => `${m.remoteJid}|${m.id}|${String(m.fromMe)}`),
            );
            const incomingKey = `${incoming.remoteJid}|${incoming.id}|${String(incoming.fromMe)}`;

            // Skip if the generated incoming key happens to collide
            fc.pre(!existingKeys.has(incomingKey));

            const result = deduplicateMessages(messages, incoming);
            expect(result[0]).toBe(incoming);
          },
        ),
      );
    },
  );
});
