import { z } from "zod";

export const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;
export const CATEGORIES = [
  "Missing Assumption",
  "Unspecified Requirement",
  "Contradiction",
  "Overlooked Constraint",
  "Dependency",
  "Risk",
  "Open Question",
] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];

/** Raw shape we require from the model (and from the rule engine). */
export const findingSchema = z.object({
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  title: z.string().trim().min(4).max(160),
  explanation: z.string().trim().min(10).max(1500),
  evidence: z.string().trim().max(800).nullable(),
  /**
   * Optional second passage for contradiction findings (statement B).
   * Backward-compatible: older payloads omit it. Verified independently from
   * `evidence`; never rendered as verified unless it matches exactly.
   */
  counter_evidence: z.string().trim().max(800).nullable().optional().default(null),
  evidence_status: z.enum(["quoted", "not_specified"]),
  recommendation: z.string().trim().min(4).max(700),
  confidence: z.number().finite().min(0).max(1),
});

export const modelResponseSchema = z.object({
  findings: z.array(findingSchema).max(30),
});

export type RawFinding = z.infer<typeof findingSchema>;

/** Where a confidence value came from. Both are uncalibrated estimates. */
export type ConfidenceSource = "model" | "rules";

export type Finding = RawFinding & {
  id: string;
  /** True when `evidence` was found as an EXACT substring of the submitted spec. */
  evidenceVerified: boolean;
  /** True when `counter_evidence` was present and matched exactly. */
  counterEvidenceVerified: boolean;
  confidenceSource: ConfidenceSource;
};

export type AnalyzeResponse = {
  mode: "live" | "demo";
  model: string | null;
  findings: Finding[];
  counts: Record<Severity, number>;
  /** Findings whose quoted evidence could not be verified and were rejected. */
  rejected: number;
  warnings: string[];
  analyzedChars: number;
};

export type AnalyzeErrorResponse = {
  error: string;
  code:
    | "invalid_json"
    | "too_short"
    | "too_long"
    | "payload_too_large"
    | "rate_limited"
    | "invalid_credentials"
    | "upstream_error"
    | "malformed_output"
    | "server_error";
  /** Demo Mode is always available locally, even when a live call fails. */
  fallbackAvailable?: boolean;
};
