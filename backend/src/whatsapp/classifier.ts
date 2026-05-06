/**
 * Regex + keyword classifier for ticket buy/sell intent and IPL team-match detection.
 * Pure function — no I/O.
 */

export type ClassifiedIntent = "buy" | "sell" | "none";

export type ClassifyResult = {
  intent: ClassifiedIntent;
  /** Canonical label from the configured `matches` list, e.g. "MI vs CSK" */
  matchedMatch: string | null;
};

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

const SEP = String.raw`[\s*.,\-_/\\|&*]+`;

function lineTokens(text: string) {
  return text
    .toLowerCase()
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function stripNoise(s: string) {
  return s
    .toLowerCase()
    .replace(/[`*_#]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

/**
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
  const lines = lineTokens(body);
  const first = lines[0] ?? s.slice(0, 80);

  const buyScore = BUY_PATTERNS.filter((p) => p.test(s)).length;
  const sellScore = SELL_PATTERNS.filter((p) => p.test(s)).length;

  let intent: ClassifiedIntent = "none";
  if (buyScore === 0 && sellScore === 0) {
    intent = "none";
  } else if (buyScore > 0 && sellScore > 0) {
    if (
      /\bwtb\b/i.test(first) ||
      /want to buy/i.test(first) ||
      (/need /i.test(first) && /(?:ticket|tkt)/i.test(first))
    ) {
      intent = "buy";
    } else {
      intent = "sell";
    }
  } else if (sellScore > 0) {
    intent = "sell";
  } else {
    intent = "buy";
  }

  let matchedMatch: string | null = null;
  for (const label of matchLabels) {
    const pair = splitMatchLabel(label);
    if (!pair) {
      continue;
    }
    const { reBoth } = twoTeamRegexForLabel(pair);
    if (reBoth.test(s)) {
      matchedMatch = label;
      break;
    }
    if (hasTeamsNear(s, pair, 40)) {
      matchedMatch = label;
      break;
    }
  }

  if (matchedMatch == null) {
    intent = "none";
  }

  return { intent, matchedMatch };
}
