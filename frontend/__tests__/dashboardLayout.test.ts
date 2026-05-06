/**
 * Property-based tests for Dashboard responsive layout breakpoints
 *
 * **Validates: Requirements 10.1, 10.3**
 *
 * Since we cannot render in a real browser, these tests perform static
 * analysis of the Tailwind class strings in the Dashboard component source
 * to verify that the correct responsive breakpoint classes are present and
 * encode the expected single-column / two-panel behavior.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Read Dashboard source once — all tests operate on this string
// ---------------------------------------------------------------------------

const dashboardSource = fs.readFileSync(
  path.resolve(__dirname, "../components/Dashboard.tsx"),
  "utf-8",
);

// Tailwind breakpoint thresholds (px)
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;

// ---------------------------------------------------------------------------
// Static structural assertions
// ---------------------------------------------------------------------------

describe("Dashboard layout — static class analysis", () => {
  it("contains grid-cols-1 (single-column default for w < 640px)", () => {
    expect(dashboardSource).toContain("grid-cols-1");
  });

  it("contains sm:grid-cols-[280px_1fr] (two-panel at sm breakpoint)", () => {
    expect(dashboardSource).toContain("sm:grid-cols-[280px_1fr]");
  });

  it("contains lg:grid-cols-[320px_1fr] (wider two-panel at lg breakpoint)", () => {
    expect(dashboardSource).toContain("lg:grid-cols-[320px_1fr]");
  });
});

// ---------------------------------------------------------------------------
// Property 8: Responsive layout breakpoints
//
// For any viewport width w:
//   - w < 640  → single-column layout (no sm:/lg: prefix applies)
//   - w >= 1024 → two-panel layout (lg: prefix applies)
//
// We model this by extracting the grid class string from the source and
// verifying the Tailwind prefix semantics hold for generated widths.
//
// **Validates: Requirements 10.1, 10.3**
// ---------------------------------------------------------------------------

/**
 * Simulate which grid-cols class is "active" for a given viewport width,
 * following Tailwind's mobile-first breakpoint logic:
 *   - default (no prefix) applies at all widths
 *   - sm: applies at w >= 640
 *   - lg: applies at w >= 1024
 * The last matching class wins (CSS cascade order).
 */
function resolveGridCols(classString: string, viewportWidth: number): string {
  // Extract all grid-cols-* tokens in source order
  const tokens = classString.match(/(?:(?:sm|md|lg|xl|2xl):)?grid-cols-\S+/g) ?? [];

  let active = "";
  for (const token of tokens) {
    if (token.startsWith("lg:") && viewportWidth >= LG_BREAKPOINT) {
      active = token.replace("lg:", "");
    } else if (token.startsWith("sm:") && viewportWidth >= SM_BREAKPOINT) {
      active = token.replace("sm:", "");
    } else if (!token.includes(":")) {
      // No prefix — applies at all widths (mobile-first default)
      active = token;
    }
  }
  return active;
}

// Extract the main grid class string from the Dashboard source.
// We look for the <main> element's className which contains the grid classes.
function extractMainGridClasses(source: string): string {
  const match = source.match(/className="([^"]*grid-cols[^"]*)"/);
  return match ? match[1] : "";
}

describe("Property 8: Responsive layout breakpoints", () => {
  const gridClasses = extractMainGridClasses(dashboardSource);

  it("grid class string is found in Dashboard source", () => {
    expect(gridClasses).toBeTruthy();
    expect(gridClasses).toContain("grid-cols-1");
  });

  it(
    "Property 8a: for any w < 640, active grid class is single-column (grid-cols-1)",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: SM_BREAKPOINT - 1 }),
          (width) => {
            const active = resolveGridCols(gridClasses, width);
            expect(active).toBe("grid-cols-1");
          },
        ),
      );
    },
  );

  it(
    "Property 8b: for any w >= 1024, active grid class is two-panel (lg:grid-cols-[320px_1fr])",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: LG_BREAKPOINT, max: 7680 }),
          (width) => {
            const active = resolveGridCols(gridClasses, width);
            expect(active).toBe("grid-cols-[320px_1fr]");
          },
        ),
      );
    },
  );

  it(
    "Property 8c: for any w in [640, 1023], active grid class is sm two-panel (sm:grid-cols-[280px_1fr])",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: SM_BREAKPOINT, max: LG_BREAKPOINT - 1 }),
          (width) => {
            const active = resolveGridCols(gridClasses, width);
            expect(active).toBe("grid-cols-[280px_1fr]");
          },
        ),
      );
    },
  );
});
