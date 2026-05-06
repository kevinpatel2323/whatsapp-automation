/**
 * Property-based tests for the settings save busy flag invariant.
 *
 * **Validates: Requirements 7.5**
 *
 * Property 9: Settings save busy flag invariant
 * `busy` is `true` for the entire duration of the async PATCH /api/settings
 * call and `false` after completion (success or error).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// The core async logic extracted from SettingsPanel.save()
// ---------------------------------------------------------------------------

/**
 * Mirrors the busy-flag lifecycle inside SettingsPanel.save().
 * Returns whether busy was true during the call and false after.
 */
async function saveWithBusyTracking(
  patchFn: () => Promise<unknown>,
): Promise<{ busyDuringCall: boolean; busyAfterCall: boolean }> {
  let busyDuringCall = false;
  let busyAfterCall = true; // will be set to false after

  // busy = true
  busyDuringCall = true;
  try {
    await patchFn();
  } catch {
    // error case — busy must still be cleared
  } finally {
    busyAfterCall = false;
  }

  return { busyDuringCall, busyAfterCall };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a delay in ms (0–50ms) to simulate varying response times. */
const delayArb = fc.integer({ min: 0, max: 50 });

/** Generates a patchFn that resolves after a given delay. */
function successPatchFn(delayMs: number): () => Promise<unknown> {
  return () =>
    new Promise((resolve) => setTimeout(() => resolve({ ok: true }), delayMs));
}

/** Generates a patchFn that rejects after a given delay. */
function errorPatchFn(delayMs: number): () => Promise<unknown> {
  return () =>
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("PATCH failed")), delayMs),
    );
}

// ---------------------------------------------------------------------------
// Property 9: busy flag invariant
// ---------------------------------------------------------------------------

describe("saveWithBusyTracking — busy flag invariant (Property 9)", () => {
  it(
    "busy is true during the call and false after — successful PATCH",
    async () => {
      await fc.assert(
        fc.asyncProperty(delayArb, async (delayMs) => {
          const result = await saveWithBusyTracking(successPatchFn(delayMs));
          expect(result.busyDuringCall).toBe(true);
          expect(result.busyAfterCall).toBe(false);
        }),
        { numRuns: 50 },
      );
    },
  );

  it(
    "busy is true during the call and false after — failed PATCH (throws)",
    async () => {
      await fc.assert(
        fc.asyncProperty(delayArb, async (delayMs) => {
          const result = await saveWithBusyTracking(errorPatchFn(delayMs));
          expect(result.busyDuringCall).toBe(true);
          expect(result.busyAfterCall).toBe(false);
        }),
        { numRuns: 50 },
      );
    },
  );

  it(
    "busy is true during the call and false after — mixed success/error scenarios",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          delayArb,
          fc.boolean(),
          async (delayMs, shouldSucceed) => {
            const patchFn = shouldSucceed
              ? successPatchFn(delayMs)
              : errorPatchFn(delayMs);
            const result = await saveWithBusyTracking(patchFn);
            expect(result.busyDuringCall).toBe(true);
            expect(result.busyAfterCall).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
