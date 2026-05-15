/**
 * Rule-based extractors for ticket listing messages. Pure functions — no I/O.
 */

const MONTHS =
  "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";

/** Normalize for matching: lowercase, strip markdown/emoji noise, collapse spaces */
export function stripForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_#]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rawSnippet(body: string, maxLen = 200): string {
  const t = stripForMatch(body);
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

export function extractQuantity(s: string): number | null {
  const lower = stripForMatch(s);
  if (/\bsingle\b|\bone\b|\b1\s*tkt\b|\b1\s*ticket\b/i.test(lower)) {
    return 1;
  }
  const xMatch = lower.match(/\b(?:x|×)\s*(\d{1,3})\b/i);
  if (xMatch?.[1]) {
    const n = Number.parseInt(xMatch[1], 10);
    if (n >= 1 && n <= 999) return n;
  }
  const tktMatch = lower.match(/\b(\d{1,3})\s*(?:tkt|tix|ticket|tickets|tics|tic)\b/i);
  if (tktMatch?.[1]) {
    const n = Number.parseInt(tktMatch[1], 10);
    if (n >= 1 && n <= 999) return n;
  }
  const nx = lower.match(/\b(\d{1,3})\s*x\b/i);
  if (nx?.[1]) {
    const n = Number.parseInt(nx[1], 10);
    if (n >= 1 && n <= 999) return n;
  }
  return null;
}

const STAND_CORE =
  "(?:east|west|north\\s*east|north\\s*west|south|hill|och|mca|garware|divecha|sachin|sunil|vijay|rohit|gavaskar|dilip|puma|fanzone|fanpit|platinum|ga\\b|general|hospitality|lounge|corporate|premium|terrace|kmk|box\\s*office|north\\s*stand|south\\s*stand)";

const FLOOR_LEVEL =
  "(?:ground\\s*floor|ground|g\\s*f|1st|first|2nd|second|3rd|third|4th|fourth|\\d{1,2}\\s*(?:st|nd|rd|th)?\\s*floor|level\\s*\\d|lvl\\s*\\d|lv\\s*\\d|l\\s*\\d|stand)";

function titleCaseWords(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export function extractBlocks(s: string): string[] {
  const lower = stripForMatch(s);
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string) => {
    const t = titleCaseWords(stripForMatch(raw).replace(/\s+/g, " "));
    if (t.length < 3 || t.length > 120) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  // "West stand 3rd floor", "east first floor x 8"
  const reStandFloor = new RegExp(
    `(${STAND_CORE}(?:\\s+stand)?)\\s+(${FLOOR_LEVEL}|\\d{1,2}(?:st|nd|rd|th)?(?:\\s+floor)?)`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = reStandFloor.exec(lower)) !== null) {
    add(`${m[1]} ${m[2]}`);
  }

  // "P3 block 2", "block F", "M block"
  const reBlock = /\b(?:p\d+|block|[a-z])\s*block\s*\d+|\b([a-z])\s*block\b|\bblock\s*([a-z])\b/gi;
  while ((m = reBlock.exec(s)) !== null) {
    const frag = m[0].trim();
    if (frag.length >= 4 && frag.length <= 40) add(frag);
  }

  // Named levels: "Sachin L1", "Sunil lv 3", "Vijay level 2"
  const reNamedLevel = new RegExp(
    `\\b(sachin|sunil|vijay|rohit|gavaskar|dilip|garware|divecha|mca)\\s*(?:stand)?\\s*(?:l|lv|level)\\s*\\d{1,2}\\b`,
    "gi",
  );
  while ((m = reNamedLevel.exec(lower)) !== null) {
    add(m[0]);
  }

  // Category lines: GA, FANZONE, FANPIT, PLATINUM (standalone or with price)
  for (const cat of ["ga", "fanzone", "fanpit", "platinum", "hill a", "hill b", "hill c", "dc lounge"]) {
    const re = new RegExp(`\\b${cat.replace(/\s+/g, "\\s+")}(?:\\s*[-@x]|\\s+\\d|$)`, "i");
    if (re.test(lower)) {
      add(cat === "ga" ? "GA" : titleCaseWords(cat));
    }
  }

  return out.slice(0, 12);
}

/** Seat-like tokens: S-20, K-154,155, L1-415 */
export function extractSeats(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (t: string) => {
    const n = t.trim().toUpperCase().replace(/\s+/g, "");
    if (n.length < 2 || n.length > 32) return;
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  // L1-415, L2-123 style
  const reL = /\b(l\d{1,2})\s*[-–]\s*(\d{1,4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = reL.exec(s)) !== null) {
    add(`${m[1]}-${m[2]}`);
  }

  // Letter - digits (allow comma-separated run)
  const reRun = /\b([a-z])\s*[-–]\s*(\d{1,4}(?:\s*,\s*(?:[a-z]\s*[-–]\s*)?\d{1,4})*)\b/gi;
  while ((m = reRun.exec(s)) !== null) {
    const letter = m[1]!.toUpperCase();
    const rest = m[2]!;
    const nums = rest.split(/,/g).map((x) => x.trim().replace(/^[a-z]\s*[-–]\s*/i, ""));
    for (const num of nums) {
      const digits = num.match(/\d{1,4}/);
      if (digits) add(`${letter}-${digits[0]}`);
    }
  }

  // Range C-13..C-16 or C-13 to C-16
  const reRange = /\b([a-z])\s*[-–]\s*(\d{1,4})\s*(?:\.\.|to)\s*(?:[a-z]\s*[-–]\s*)?(\d{1,4})\b/gi;
  while ((m = reRange.exec(s)) !== null) {
    const L = m[1]!.toUpperCase();
    const a = Number.parseInt(m[2]!, 10);
    const b = Number.parseInt(m[3]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 20) {
      for (let i = a; i <= b; i++) add(`${L}-${i}`);
    }
  }

  return out.slice(0, 40);
}

export function extractSequence(s: string): { required: boolean | null; note: string | null } {
  const lower = stripForMatch(s);
  if (/\bnon[-\s]?seq\b|\bnot\s+in\s+seq\b|\bnon\s+sequence\b/i.test(lower)) {
    return { required: false, note: "non-seq" };
  }
  const patterns: RegExp[] = [
    /\b\d{1,3}\s*(?:tkt|ticket|tix)?\s*(?:in\s+)?(?:pure\s+)?seq(?:uence)?\b/i,
    /\b(?:in\s+(?:pure\s+)?seq(?:uence)?|in\s+sequence|pure\s+seq)\b/i,
    /\bx\s*\d{1,3}[^.\n]{0,40}\bseq\b/i,
    /\b(?:\d{1,3}\+|(?:\d\s*\+\s*){2,}\d)\s*(?:also\s+)?works\b/i,
    /\bsequences?\b/i,
  ];
  for (const p of patterns) {
    const mm = lower.match(p);
    if (mm) {
      const note = mm[0].length > 80 ? `${mm[0].slice(0, 77)}…` : mm[0];
      return { required: true, note };
    }
  }
  return { required: null, note: null };
}

export function extractMatchDate(s: string): string | null {
  const lower = stripForMatch(s);
  const m1 = lower.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:&|and|,)?\\s*(?:\\d{1,2}(?:st|nd|rd|th)?\\s*)?(?:${MONTHS})\\b`, "i"),
  );
  if (m1) {
    return m1[0]!.replace(/\s+/g, " ").trim();
  }
  const m2 = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/);
  if (m2) return m2[0]!;
  return null;
}

export function extractPriceHints(s: string, cap = 5): string[] {
  const lower = stripForMatch(s);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (t: string) => {
    const x = t.trim();
    if (x.length < 2 || x.length > 40) return;
    const k = x.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(x);
  };

  const re1 = /\b(?:mrp|@)\s*[+\-]?\s*\d{2,6}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(lower)) !== null) push(m[0]!);

  const re2 = /\b\d{3,6}\s*(?:each|firm|k\b|\/-|\s*only)\b/gi;
  while ((m = re2.exec(lower)) !== null && out.length < cap) push(m[0]!);

  const re3 = /\b@\s*\d{3,6}\b/gi;
  while ((m = re3.exec(lower)) !== null && out.length < cap) push(m[0]!);

  return out.slice(0, cap);
}

const EXTRA_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /\binstant\s+porter\b|\bporter\s+ready\b|\bporter\s+bands?\b/i, label: "instant porter" },
  { re: /\bbands?\s+ready\b|\bbands?\s+in\s+hand\b/i, label: "bands ready" },
  { re: /\binstant\s+qr\b|\bqr\b.*\binstant\b/i, label: "instant qr" },
  { re: /\binstant\s+transfer\b|\bm[-\s]?ticket\b/i, label: "instant transfer" },
  { re: /\binstant\s+punch\b|\bpunch(?:ing)?\s+on\b/i, label: "instant punch" },
  { re: /\bvouche?s?\b/i, label: "vouches" },
  { re: /\bphysical\s+ticket/i, label: "physical tickets" },
  { re: /\bcash\s+ready\b|\bpayment\s+ready\b/i, label: "cash ready" },
  { re: /\bself\s+booked\b/i, label: "self booked" },
  { re: /\bdelivery\b|\bhome\s+delivered\b/i, label: "delivery" },
  { re: /\bfood\s+and\s+beverage\b|\bf\s*&\s*b\b|\bf&b\b/i, label: "food and beverage" },
];

export function extractExtraInfo(s: string, cap = 8): string[] {
  const lower = stripForMatch(s);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { re, label } of EXTRA_KEYWORDS) {
    if (out.length >= cap) break;
    if (re.test(lower) && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}
