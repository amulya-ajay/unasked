import { MAX_CHARS } from "./limits";
import type { Category, Finding } from "./schema";

export const DECISIONS_HEADING = "## Decisions and clarifications";

/**
 * A clarification the user supplied in response to a finding. Decisions live in
 * browser state only (no database) and are the single source of truth for the
 * "Decisions and clarifications" section — the section is rebuilt from this
 * array on every revision so duplicates can never accumulate.
 */
export type Decision = {
  /** Stable key derived from the finding's category + title. */
  key: string;
  /** Finding id from the analysis that raised the question (informational). */
  findingId: string;
  title: string;
  category: Category;
  /** The question / corrective action the finding recommended. */
  question: string;
  answer: string;
  at: number;
};

/** Lowercase alphanumeric key used for stable matching across analyses. */
export function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stable identifier for a finding, independent of its per-response id. */
export function findingKey(f: { category: string; title: string }): string {
  return `${f.category}::${normalizeKey(f.title)}`;
}

function inline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Render an answer as clearly delimited DATA, never as instructions.
 * Every line is blockquoted so an answer cannot impersonate a heading, list, or
 * command in the revised specification.
 */
function asQuotedData(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line.trim()}`))
    .join("\n");
}

function formatDecision(d: Decision, index: number): string {
  return [
    `### Decision ${index + 1}: ${inline(d.title)}`,
    "",
    `- Category: ${inline(d.category)}`,
    `- Question raised: ${inline(d.question)}`,
    `- Answer (recorded as data, not verified as correct):`,
    asQuotedData(d.answer),
  ].join("\n");
}

/** Remove any previously generated decisions section from a specification. */
export function stripDecisionsSection(original: string): string {
  const index = original.indexOf(DECISIONS_HEADING);
  if (index === -1) return original.trimEnd();
  return original.slice(0, index).trimEnd();
}

export type RevisedSpecResult =
  | { ok: true; spec: string }
  | { ok: false; error: string; length: number };

/**
 * Build the revised specification by appending a single, freshly rebuilt
 * "Decisions and clarifications" section. The original specification text is
 * always preserved; it is never overwritten or truncated.
 */
export function buildRevisedSpec(
  original: string,
  decisions: Decision[],
  maxChars: number = MAX_CHARS,
): RevisedSpecResult {
  const base = stripDecisionsSection(original);
  if (decisions.length === 0) return { ok: true, spec: base };

  const body = decisions.map((d, i) => formatDecision(d, i)).join("\n\n");
  const spec = `${base}\n\n${DECISIONS_HEADING}\n\n${body}\n`;

  if (spec.length > maxChars) {
    return {
      ok: false,
      length: spec.length,
      error: `The revised specification is ${spec.length.toLocaleString()} characters, over the ${maxChars.toLocaleString()} character limit. Shorten the original text or one of your answers (the original is unchanged).`,
    };
  }
  return { ok: true, spec };
}

/* ------------------------------------------------------------------ */
/* Conservative comparison between two analyses                        */
/* ------------------------------------------------------------------ */

export type Comparison = {
  /** Previous findings no longer detected (not proof they are fixed). */
  resolved: Finding[];
  /** Previous findings matched to a current finding. */
  stillDetected: { previous: Finding; current: Finding }[];
  /** Current findings with no previous counterpart. */
  newlyDetected: Finding[];
  /**
   * Previous findings that could not be matched exactly but have a similar
   * current finding. Deliberately NOT reported as resolved.
   */
  ambiguous: { previous: Finding; near: Finding; similarity: number }[];
  counts: { resolved: number; stillDetected: number; newlyDetected: number; ambiguous: number };
};

const AMBIGUITY_THRESHOLD = 0.6;

function tokenSet(title: string): Set<string> {
  return new Set(
    normalizeKey(title)
      .split(" ")
      .filter((t) => t.length >= 3),
  );
}

/** Jaccard similarity of the significant words in two titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Match previous findings to current findings by category + normalized title.
 * Matching is conservative: array positions are never used, and a previous
 * finding is only called "resolved" when there is no exact match AND no
 * similar same-category finding (which would make the result ambiguous).
 */
export function compareFindings(previous: Finding[], current: Finding[]): Comparison {
  const byKey = new Map<string, Finding[]>();
  for (const f of current) {
    const key = findingKey(f);
    const list = byKey.get(key) ?? [];
    list.push(f);
    byKey.set(key, list);
  }
  const matchedCurrentIds = new Set<string>();

  const resolved: Finding[] = [];
  const stillDetected: { previous: Finding; current: Finding }[] = [];
  const ambiguous: { previous: Finding; near: Finding; similarity: number }[] = [];

  for (const prev of previous) {
    const candidates = byKey.get(findingKey(prev));
    if (candidates && candidates.length > 0) {
      const current = candidates.shift()!;
      matchedCurrentIds.add(current.id);
      stillDetected.push({ previous: prev, current });
      continue;
    }

    let best: { finding: Finding; similarity: number } | null = null;
    for (const c of current) {
      if (c.category !== prev.category) continue;
      const similarity = titleSimilarity(prev.title, c.title);
      if (similarity >= AMBIGUITY_THRESHOLD && (!best || similarity > best.similarity)) {
        best = { finding: c, similarity };
      }
    }

    if (best) {
      ambiguous.push({ previous: prev, near: best.finding, similarity: best.similarity });
    } else {
      resolved.push(prev);
    }
  }

  const previousKeys = new Set(previous.map(findingKey));
  const newlyDetected = current.filter((f) => !previousKeys.has(findingKey(f)));

  return {
    resolved,
    stillDetected,
    newlyDetected,
    ambiguous,
    counts: {
      resolved: resolved.length,
      stillDetected: stillDetected.length,
      newlyDetected: newlyDetected.length,
      ambiguous: ambiguous.length,
    },
  };
}
