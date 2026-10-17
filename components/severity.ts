import type { Severity } from "@/lib/schema";

export const SEVERITY_ORDER: Severity[] = ["Critical", "High", "Medium", "Low"];

export const severityMeta: Record<
  Severity,
  { label: string; text: string; bg: string; border: string; dot: string; blurb: string }
> = {
  Critical: {
    label: "Critical",
    text: "text-crit",
    bg: "bg-crit/10",
    border: "border-crit/40",
    dot: "bg-crit",
    blurb: "Blocks delivery or creates unacceptable risk",
  },
  High: {
    label: "High",
    text: "text-high",
    bg: "bg-high/10",
    border: "border-high/40",
    dot: "bg-high",
    blurb: "Must be resolved before implementation",
  },
  Medium: {
    label: "Medium",
    text: "text-med",
    bg: "bg-med/10",
    border: "border-med/40",
    dot: "bg-med",
    blurb: "Resolve during planning",
  },
  Low: {
    label: "Low",
    text: "text-low",
    bg: "bg-low/10",
    border: "border-low/40",
    dot: "bg-low",
    blurb: "Worth clarifying when convenient",
  },
};
