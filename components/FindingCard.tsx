"use client";

import { useState } from "react";
import type { Finding } from "@/lib/schema";
import type { Decision } from "@/lib/revision";
import { ANSWER_MAX } from "@/lib/limits";
import { severityMeta } from "./severity";

export type CardStatus = "new" | "still" | "resolved" | "ambiguous";

const statusMeta: Record<CardStatus, { label: string; className: string }> = {
  new: { label: "Newly detected", className: "border-ember/50 bg-ember/10 text-ember" },
  still: { label: "Still detected", className: "border-line bg-panel-2 text-muted" },
  resolved: { label: "Resolved after reanalysis", className: "border-low/40 bg-low/10 text-low" },
  ambiguous: { label: "Needs review", className: "border-med/40 bg-med/10 text-med" },
};

export default function FindingCard({
  finding,
  index,
  status,
  decision,
  onAnswer,
  answering = false,
}: {
  finding: Finding;
  index: number;
  status?: CardStatus;
  decision?: Decision | null;
  onAnswer?: (finding: Finding, answer: string) => void;
  answering?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(decision?.answer ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const meta = severityMeta[finding.severity];
  const notSpecified = finding.evidence_status === "not_specified" || !finding.evidence;
  const hasSecondPassage = Boolean(finding.counter_evidence && finding.counterEvidenceVerified);
  const isTension = finding.category === "Contradiction";
  const panelId = `finding-${elementId(finding.id)}-detail`;
  const answerId = `finding-${elementId(finding.id)}-answer`;
  const confidenceLabel =
    finding.confidenceSource === "model" ? "Model confidence estimate" : "Rule confidence estimate";

  function submit() {
    const trimmed = answer.trim();
    if (trimmed.length < 3) {
      setLocalError("Please enter a short answer (at least 3 characters) before applying it.");
      return;
    }
    if (trimmed.length > ANSWER_MAX) {
      setLocalError(`The answer is too long. Keep it under ${ANSWER_MAX} characters.`);
      return;
    }
    setLocalError(null);
    onAnswer?.(finding, trimmed);
  }

  return (
    <article
      className="rise overflow-hidden rounded-xl border border-line bg-panel/80"
      style={{ animationDelay: `${Math.min(index * 45, 360)}ms` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-4 p-4 text-left transition-colors hover:bg-panel-2 sm:p-5"
      >
        <span className="mt-0.5 flex shrink-0 flex-col items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          <span className="font-mono text-[10px] text-faint">
            {String(index + 1).padStart(2, "0")}
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${meta.text} ${meta.bg} ${meta.border}`}
            >
              {meta.label}
            </span>
            <span className="rounded border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              {finding.category}
            </span>
            {status && (
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${statusMeta[status].className}`}
              >
                {statusMeta[status].label}
              </span>
            )}
            <span
              className="font-mono text-[10px] text-faint"
              title="Uncalibrated estimate reported by the analysis engine — not a statistically calibrated probability."
            >
              {confidenceLabel} {Math.round(finding.confidence * 100)}%
            </span>
          </span>

          <span className="mt-3 block font-display text-[19px] leading-snug text-ink">
            {finding.title}
          </span>

          <span className="mt-2 block text-[14px] leading-relaxed text-muted">
            {finding.explanation}
          </span>

          <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-faint">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            >
              <path d="M2 1l5 4-5 4z" fill="currentColor" />
            </svg>
            {open ? "Hide evidence & action" : "Show evidence & action"}
          </span>
        </span>
      </button>

      <div id={panelId} hidden={!open} className="border-t border-line-soft bg-canvas-2/70">
        <div className="grid gap-0 sm:grid-cols-2">
          <div className="border-line-soft p-4 sm:border-r sm:p-5">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
              {isTension && hasSecondPassage
                ? "Evidence from your specification — two statements"
                : "Evidence from your specification"}
            </p>
            {notSpecified ? (
              <p className="rounded-lg border border-dashed border-med/40 bg-med/5 p-3 text-[13px] leading-relaxed text-med">
                Not specified. This information does not appear anywhere in the submitted text; it is
                reported as a gap, not as an established fact.
              </p>
            ) : (
              <div className="space-y-3">
                {hasSecondPassage && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                    Statement A
                  </p>
                )}
                <blockquote className="rounded-lg border border-line bg-canvas p-3 font-mono text-[12.5px] leading-relaxed text-ink/90">
                  <span className="mr-1 select-none text-ember">“</span>
                  {finding.evidence}
                  <span className="ml-0.5 select-none text-ember">”</span>
                </blockquote>

                {hasSecondPassage && (
                  <>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                      Statement B
                    </p>
                    <blockquote className="rounded-lg border border-line bg-canvas p-3 font-mono text-[12.5px] leading-relaxed text-ink/90">
                      <span className="mr-1 select-none text-ember">“</span>
                      {finding.counter_evidence}
                      <span className="ml-0.5 select-none text-ember">”</span>
                    </blockquote>
                  </>
                )}
              </div>
            )}

            {finding.evidenceVerified && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-low">
                ✓{" "}
                {hasSecondPassage
                  ? "both quotes are exact matches in the submitted text"
                  : "exact quote verified in submitted text"}
              </p>
            )}
            {isTension && !hasSecondPassage && !notSpecified && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-med">
                single verified passage — no second passage could be quoted exactly
              </p>
            )}
          </div>

          <div className="p-4 sm:p-5">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
              Recommended question / action
            </p>
            <p className="text-[13.5px] leading-relaxed text-ink/90">{finding.recommendation}</p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              {finding.category} · {meta.label} — {meta.blurb}
            </p>
          </div>
        </div>
      </div>

      {onAnswer && (
        <div className="border-t border-line-soft bg-canvas/40 p-4 sm:p-5">
          <label
            htmlFor={answerId}
            className="block font-mono text-[10px] uppercase tracking-[0.18em] text-faint"
          >
            {decision ? "Your recorded decision (edit and reapply if needed)" : "Answer this question"}
          </label>
          <textarea
            id={answerId}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={answering}
            rows={2}
            placeholder="Type the clarification the project owner would need to provide…"
            className="mt-2 w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint/70 focus:border-ember/60 disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-[11px] leading-snug text-faint">
              Adds a labeled “Decisions and clarifications” section to a revised copy of your
              specification, then re-runs the analysis. It does not verify that the answer is correct.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={answering}
              className="inline-flex items-center gap-2 rounded-lg bg-ember px-4 py-2 text-[12.5px] font-medium text-[#160c06] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
            >
              {answering ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#160c06]/40 border-t-[#160c06]" />
                  Reanalyzing…
                </>
              ) : (
                "Apply answer & reanalyze"
              )}
            </button>
          </div>
          <p className="mt-1 font-mono text-[10px] text-faint">
            {answer.trim().length} / {ANSWER_MAX} characters
          </p>
          {localError && (
            <p role="alert" className="mt-1 text-[12px] leading-snug text-crit">
              {localError}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function elementId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}
