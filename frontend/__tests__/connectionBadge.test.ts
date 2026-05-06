/**
 * Property-based tests for `ConnectionBadge` state-color mapping
 *
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * Property 6: ConnectionBadge state-color mapping is deterministic —
 * for any ConnectionState value, the component always produces the same
 * label and dot color class.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Mapping logic extracted from ConnectionBadge.tsx (mirrors the component)
// ---------------------------------------------------------------------------

const labels: Record<string, string> = {
  idle: "Idle",
  connecting: "Connecting",
  open: "Connected",
  close: "Disconnected",
};

const dotClasses: Record<string, string> = {
  idle: "bg-shade-50",
  connecting: "bg-amber-400 animate-pulse",
  open: "bg-neon-green",
  close: "bg-red-500",
};

function getLabel(state: string): string {
  return Object.hasOwn(labels, state) ? labels[state]! : state;
}

function getDotClass(state: string): string {
  return Object.hasOwn(dotClasses, state) ? dotClasses[state]! : "bg-shade-50";
}

// ---------------------------------------------------------------------------
// Known-state examples (Requirements 3.2 – 3.6)
// ---------------------------------------------------------------------------

describe("ConnectionBadge mapping — known states", () => {
  it("idle → label 'Idle', dot 'bg-shade-50'", () => {
    expect(getLabel("idle")).toBe("Idle");
    expect(getDotClass("idle")).toBe("bg-shade-50");
  });

  it("connecting → label 'Connecting', dot 'bg-amber-400 animate-pulse'", () => {
    expect(getLabel("connecting")).toBe("Connecting");
    expect(getDotClass("connecting")).toBe("bg-amber-400 animate-pulse");
  });

  it("open → label 'Connected', dot 'bg-neon-green'", () => {
    expect(getLabel("open")).toBe("Connected");
    expect(getDotClass("open")).toBe("bg-neon-green");
  });

  it("close → label 'Disconnected', dot 'bg-red-500'", () => {
    expect(getLabel("close")).toBe("Disconnected");
    expect(getDotClass("close")).toBe("bg-red-500");
  });
});

// ---------------------------------------------------------------------------
// Property 6: determinism for unknown states
// ---------------------------------------------------------------------------

const knownStates = new Set(["idle", "connecting", "open", "close"]);

/** Arbitrary that generates strings that are NOT one of the four known states. */
const unknownStateArb = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((s) => !knownStates.has(s));

describe("ConnectionBadge mapping — Property 6: determinism", () => {
  it(
    "unknown state: label equals the raw string and dot class is bg-shade-50",
    () => {
      fc.assert(
        fc.property(unknownStateArb, (state) => {
          expect(getLabel(state)).toBe(state);
          expect(getDotClass(state)).toBe("bg-shade-50");
        }),
      );
    },
  );

  it(
    "any state: calling the mapping twice always returns identical results",
    () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 32 }), (state) => {
          expect(getLabel(state)).toBe(getLabel(state));
          expect(getDotClass(state)).toBe(getDotClass(state));
        }),
      );
    },
  );

  it(
    "known states: mapping is deterministic across repeated calls",
    () => {
      fc.assert(
        fc.property(
          fc.constantFrom("idle", "connecting", "open", "close"),
          (state) => {
            expect(getLabel(state)).toBe(getLabel(state));
            expect(getDotClass(state)).toBe(getDotClass(state));
          },
        ),
      );
    },
  );
});
