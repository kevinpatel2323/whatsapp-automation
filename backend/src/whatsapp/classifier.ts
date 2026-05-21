/**
 * Regex + keyword classifier for ticket buy/sell intent and IPL team-match detection.
 * Pure function — no I/O.
 */

import {
  extractBlocks,
  extractExtraInfo,
  extractMatchDate,
  extractPriceHints,
  extractQuantity,
  extractSequence,
  extractSeats,
  rawSnippet,
  stripForMatch,
} from "./classifier-extract.js";

export type ClassifiedIntent = "buy" | "sell" | "none";

export type ClassifyResult = {
  intent: ClassifiedIntent;
  /** Canonical label from the configured `matches` list, e.g. "MI vs CSK" */
  matchedMatch: string | null;
};

/** Full rule-based classification + structured extraction for dashboard / classified_messages */
export type ClassifyRichResult = {
  intent: ClassifiedIntent;
  matchedMatch: string | null;
  /** True when `matchedMatch` came from settings `matches`, not from free-text pairing detection */
  isConfiguredMatch: boolean;
  matchDate: string | null;
  quantity: number | null;
  blocks: string[];
  seats: string[];
  sequenceRequired: boolean | null;
  sequenceNote: string | null;
  priceHints: string[];
  extraInfo: string[];
  rawSnippet: string;
};

/**
 * Playoff stage labels — when present in `matchLabels`, these win over team-pair
 * labels in the same message (e.g. "MI vs CSK Qualifier 1" → "Qualifier 1").
 * Aliases catch the common variants people actually type.
 */
const STAGE_ALIASES: Record<string, string> = {
  "Qualifier 1": String.raw`q(?:f|ual(?:ifier)?)?\s*[-]?\s*1|qualifier\s*one`,
  "Qualifier 2": String.raw`q(?:f|ual(?:ifier)?)?\s*[-]?\s*2|qualifier\s*two`,
  "Eliminator":  String.raw`eliminator|elim(?:i)?`,
  "Final":       String.raw`grand\s*final|finale?`,
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TEAM_ALIASES: Record<string, string> = {
  MI: String.raw`(?:mi|mivscsk|mivs?csk|mumbai(?:\s*indians)?)`,
  CSK: String.raw`(?:csk|chennai(?:\s*super(?:\s*kings)?)?)`,
  RCB: String.raw`(?:rcb|royal(?:\s*challengers)?(?:\s*(?:bangalore|bengaluru))?)`,
  GT: String.raw`(?:gt|gujarat(?:\s*titans)?)`,
  DC: String.raw`(?:dc|delhi(?:\s*capitals)?)`,
  SRH: String.raw`(?:srh|hyderabad)`,
  KKR: String.raw`(?:kkr|kolkata(?:\s*knight)?(?:\s*riders)?)`,
  LSG: String.raw`(?:lsg|lucknow(?:\s*super(?:\s*giants)?)?)`,
  PBKS: String.raw`(?:pbks|punjab)`,
  RR: String.raw`(?:rr|rajasthan(?:\s*royals)?)`,
};

const ALL_TEAMS = Object.keys(TEAM_ALIASES) as string[];

const SEP = String.raw`[\s*.,\-_/\\|&*]+`;

function lineTokens(text: string) {
  return text
    .toLowerCase()
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function stripNoise(s: string) {
  return stripForMatch(s);
}

function splitMatchLabel(label: string): [string, string] | null {
  const t = label.trim();
  const m = t.split(/\bvs\.?\b/i);
  if (m.length < 2) {
    return null;
  }
  return [m[0]!.trim().toUpperCase().replace(/\s+/g, " "), m[1]!.trim().toUpperCase().replace(/\s+/g, " ")];
}

/**
 * For a canonical label "MI vs CSK", return RegExp that matches the match mention in any order
 * in free text, with vs between or both teams within 40 chars of each other.
 */
function twoTeamRegexForLabel(teams: [string, string]): { reBoth: RegExp; reA: RegExp; reB: RegExp } {
  const a = teams[0]!;
  const b = teams[1]!;
  // explicit A … B or B … A (vs / punctuation between)
  const pA = TEAM_ALIASES[a] ?? `\\b${a}\\b`;
  const pB = TEAM_ALIASES[b] ?? `\\b${b}\\b`;
  // SEP already ends with + (one or more separator chars)
  const reBoth = new RegExp(
    `(${pA})${SEP}(${pB})|(${pB})${SEP}(${pA})`,
    "i",
  );
  return { reBoth, reA: reBoth, reB: reBoth };
}

function hasTeamsNear(
  s: string,
  teams: [string, string],
  window: number,
): boolean {
  const a = (TEAM_ALIASES[teams[0]!] ?? `\\b${teams[0]}\\b`)!;
  const b = (TEAM_ALIASES[teams[1]!] ?? `\\b${teams[1]}\\b`)!;
  const reA = new RegExp(a, "gi");
  const reB = new RegExp(b, "gi");
  let aMatch: RegExpExecArray | null;
  reA.lastIndex = 0;
  while ((aMatch = reA.exec(s)) !== null) {
    reB.lastIndex = 0;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = reB.exec(s)) !== null) {
      if (aMatch[0] === bMatch[0] && aMatch.index === bMatch.index) {
        continue;
      }
      const d = Math.abs((aMatch.index as number) - (bMatch.index as number));
      if (d <= window) {
        return true;
      }
    }
  }
  return false;
}

const BUY_PATTERNS: RegExp[] = [
  /\bwtb\b/i,
  /\bwant to buy\b/i,
  /\blooking (?:out )?for\b/i,
  /\bneed (?:\d+|\b(?:one|two|2|1)\b|tickets?|seq)/i,
  /\bpaying\b/i,
  /\bbudget\b/i,
  /\bgoing with lowest\b/i,
  /\bclos(?:e|ing) (?:asap|now)\b.*\b(?:budget|k)\b/i,
  /\bdm (?:if )?with (?:price|rates|offers|quantity|seat|your)/i,
];

const SELL_PATTERNS: RegExp[] = [
  /\bwts\b/i,
  /\bwys\b/i,
  /\bwant to sell\b/i,
  /\b(?:^|\n)want to sell\b/mi,
  /\bselling\b/i,
  /\bfor sale\b/i,
  /\b(?:tickets?|vouche?s?) available/i,
  /\b(?:mrmrp|mrp|firm|non[- ]?nego|non negotiable)\b/i,
  /@\d+[/:-]\s*\-*/i, // MRP-6200 style
  /\bin hand\b/i,
  /\bdm to close/i,
  /\bclos(?:e|ing) (?:asap|now)(?!.*budget)/i,
  /\boffer good\b/i,
  /\b(?:instant|imdt)\s*(?:transfer|porter)\b/i,
  /\b(?:take any|@)\d+[/:-]/i, // "Take any *@4500"
];

/** Buy/sell/none from keywords only — independent of which match is mentioned */
function computeBuySellIntent(body: string, s: string): ClassifiedIntent {
  const lines = lineTokens(body);
  const first = lines[0] ?? s.slice(0, 80);

  const buyScore = BUY_PATTERNS.filter((p) => p.test(s)).length;
  const sellScore = SELL_PATTERNS.filter((p) => p.test(s)).length;

  if (buyScore === 0 && sellScore === 0) {
    return "none";
  }
  if (buyScore > 0 && sellScore > 0) {
    if (
      /\bwtb\b/i.test(first) ||
      /want to buy/i.test(first) ||
      (/need /i.test(first) && /(?:ticket|tkt)/i.test(first))
    ) {
      return "buy";
    }
    return "sell";
  }
  if (sellScore > 0) {
    return "sell";
  }
  return "buy";
}

/**
 * Resolve which configured label fires for a normalized message body.
 * Two-pass: known playoff stages win over team pairs when both are present in
 * the same message. Within each pass, list order from settings is honored.
 */
function matchConfigured(s: string, matchLabels: string[]): string | null {
  for (const label of matchLabels) {
    const stagePattern = STAGE_ALIASES[label];
    if (!stagePattern) continue;
    if (new RegExp(`\\b(?:${stagePattern})\\b`, "i").test(s)) return label;
  }
  for (const label of matchLabels) {
    if (label in STAGE_ALIASES) continue;
    const pair = splitMatchLabel(label);
    if (pair) {
      const { reBoth } = twoTeamRegexForLabel(pair);
      if (reBoth.test(s) || hasTeamsNear(s, pair, 40)) return label;
      continue;
    }
    if (new RegExp(`\\b${escapeRegex(label)}\\b`, "i").test(s)) return label;
  }
  return null;
}

/**
 * First playoff stage label whose alias matches the (already stripped) text,
 * preferring the earliest occurrence in the message. Used for the dashboard /
 * classified_messages view so unconfigured stages still get categorized.
 */
export function detectStage(s: string): string | null {
  const lower = stripNoise(s);
  let best: { label: string; idx: number } | null = null;
  for (const [label, pattern] of Object.entries(STAGE_ALIASES)) {
    const re = new RegExp(`\\b(?:${pattern})\\b`, "i");
    const m = re.exec(lower);
    if (m?.index != null && (best == null || m.index < best.idx)) {
      best = { label, idx: m.index };
    }
  }
  return best?.label ?? null;
}

/**
 * Any two known IPL teams co-mentioned (explicit vs / punctuation, or within 40 chars).
 * Label order follows first occurrence in text (left-to-right).
 */
export function detectAnyPairing(s: string): string | null {
  const lower = stripNoise(s);
  type Hit = { team: string; idx: number };
  const hits: Hit[] = [];
  for (const team of ALL_TEAMS) {
    const pattern = TEAM_ALIASES[team] ?? String.raw`\b${team}\b`;
    const re = new RegExp(pattern, "i");
    re.lastIndex = 0;
    const m = re.exec(lower);
    if (m?.index != null) {
      hits.push({ team, idx: m.index });
    }
  }
  if (hits.length < 2) {
    return null;
  }
  hits.sort((a, b) => a.idx - b.idx);
  const byTeam = new Map<string, number>();
  for (const h of hits) {
    if (!byTeam.has(h.team)) {
      byTeam.set(h.team, h.idx);
    }
  }
  const ordered = [...byTeam.entries()].sort((a, b) => a[1] - b[1]);
  if (ordered.length < 2) {
    return null;
  }
  const t1 = ordered[0]![0];
  const t2 = ordered[1]![0];
  const pair: [string, string] = [t1, t2];
  const { reBoth } = twoTeamRegexForLabel(pair);
  if (reBoth.test(lower)) {
    return `${t1} vs ${t2}`;
  }
  if (hasTeamsNear(lower, pair, 40)) {
    return `${t1} vs ${t2}`;
  }
  return null;
}

/**
 * Rich classification + extraction (rules only). Intent is independent of configured matches.
 * `matchedMatch` prefers a configured label; otherwise any detected two-team pairing.
 */
export function classifyTextRich(
  body: string | null | undefined,
  matchLabels: string[],
): ClassifyRichResult {
  if (!body?.trim()) {
    return {
      intent: "none",
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
      rawSnippet: "",
    };
  }
  const s = stripNoise(body);
  const intent = computeBuySellIntent(body, s);
  let matchedMatch = matchConfigured(s, matchLabels);
  let isConfiguredMatch = matchedMatch != null;
  if (!matchedMatch) {
    // Stage detection beats team-pair detection (e.g. "MI vs CSK Qualifier 1" → "Qualifier 1")
    matchedMatch = detectStage(s) ?? detectAnyPairing(s);
    isConfiguredMatch = false;
  }
  const seq = extractSequence(body);
  return {
    intent,
    matchedMatch,
    isConfiguredMatch,
    matchDate: extractMatchDate(body),
    quantity: extractQuantity(body),
    blocks: extractBlocks(body),
    seats: extractSeats(body),
    sequenceRequired: seq.required,
    sequenceNote: seq.note,
    priceHints: extractPriceHints(body),
    extraInfo: extractExtraInfo(body),
    rawSnippet: rawSnippet(body),
  };
}

/**
 * Auto-reply / Message row: only when a **configured** match is detected.
 * If no configured match, intent is forced to `none` and matchedMatch is null (no auto-reply).
 *
 * @param body — message text (or null for non-text)
 * @param matchLabels — canonical list from settings, e.g. ["MI vs CSK", "RCB vs GT"]
 */
export function classifyText(
  body: string | null | undefined,
  matchLabels: string[],
): ClassifyResult {
  if (!body?.trim()) {
    return { intent: "none", matchedMatch: null };
  }
  const s = stripNoise(body);
  const intentRaw = computeBuySellIntent(body, s);
  const matched = matchConfigured(s, matchLabels);
  if (matched == null) {
    return { intent: "none", matchedMatch: null };
  }
  return { intent: intentRaw, matchedMatch: matched };
}
