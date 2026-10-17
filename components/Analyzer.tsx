"use client";

import { useMemo, useRef, useState } from "react";
import type { AnalyzeErrorResponse, AnalyzeResponse, Finding, Severity } from "@/lib/schema";
import { SAMPLE_SPEC } from "@/lib/sample";
import { MAX_CHARS, MIN_CHARS } from "@/lib/limits";
import {
  buildRevisedSpec,
  compareFindings,
  findingKey,
  type Comparison,
  type Decision,
} from "@/lib/revision";
import { SEVERITY_ORDER } from "./severity";
import FindingCard, { type CardStatus } from "./FindingCard";

type Status = "idle" | "loading" | "error" | "done";
type Filter = Severity | "All";

type RequestResult =
  | { ok: true; data: AnalyzeResponse }
  | { ok: false; error: AnalyzeErrorResponse };

type RevisionState = {
  spec: string;
  result: AnalyzeResponse;
  comparison: Comparison;
};

export default function Analyzer({ live, model }: { live: boolean; model: string | null }) {
  const [spec, setSpec] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<AnalyzeErrorResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [notice, setNotice] = useState<string | null>(null);

  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [revision, setRevision] = useState<RevisionState | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [answeringKey, setAnsweringKey] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);

  const tooLong = spec.length > MAX_CHARS;
  const canSubmit = spec.trim().length >= MIN_CHARS && !tooLong && status !== "loading";

  const displayResult = revision?.result ?? result;

  const decisionByKey = useMemo(() => {
    const map = new Map<string, Decision>();
    for (const d of decisions) map.set(d.key, d);
    return map;
  }, [decisions]);

  const visible = useMemo(() => {
    if (!displayResult) return [];
    return filter === "All"
      ? displayResult.findings
      : displayResult.findings.filter((f) => f.severity === filter);
  }, [displayResult, filter]);

  async function requestAnalysis(specToSend: string): Promise<RequestResult> {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: specToSend, ...(live ? {} : { mode: "demo" }) }),
      });
      const payload = (await res.json().catch(() => null)) as
        | AnalyzeResponse
        | AnalyzeErrorResponse
        | null;

      if (!res.ok || !payload || "error" in payload) {
        const err = (payload as AnalyzeErrorResponse) ?? {
          error: `Request failed with status ${res.status}.`,
          code: "server_error" as const,
        };
        return { ok: false, error: err };
      }
      return { ok: true, data: payload };
    } catch {
      return {
        ok: false,
        error: {
          error: "The network request failed. Check your connection and try again.",
          code: "server_error",
          fallbackAvailable: true,
        },
      };
    }
  }

  async function analyze() {
    setStatus("loading");
    setError(null);
    setNotice(null);
    setResult(null);
    setRevision(null);
    setDecisions([]);
    setRevisionError(null);

    const outcome = await requestAnalysis(spec);
    if (!outcome.ok) {
      setError(outcome.error);
      setStatus("error");
      return;
    }

    setResult(outcome.data);
    setFilter("All");
    setStatus("done");
    setNotice(
      outcome.data.mode === "demo"
        ? "Demo Mode result: transparent rule-based checks over your submitted text. No AI model was called."
        : `Live result from ${outcome.data.model}.`,
    );
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function applyAnswer(finding: Finding, answer: string) {
    const key = findingKey(finding);
    setRevisionError(null);
    setAnsweringKey(key);

    const nextDecision: Decision = {
      key,
      findingId: finding.id,
      title: finding.title,
      category: finding.category,
      question: finding.recommendation,
      answer,
      at: Date.now(),
    };
    const already = decisions.some((d) => d.key === key);
    const nextDecisions = already
      ? decisions.map((d) => (d.key === key ? { ...nextDecision, at: d.at } : d))
      : [...decisions, nextDecision];

    const built = buildRevisedSpec(spec, nextDecisions, MAX_CHARS);
    if (!built.ok) {
      setRevisionError(built.error);
      setAnsweringKey(null);
      return;
    }

    const previousFindings = (revision?.result ?? result)?.findings ?? [];
    const outcome = await requestAnalysis(built.spec);
    if (!outcome.ok) {
      setAnsweringKey(null);
      setRevisionError(
        `Reanalysis failed: ${outcome.error.error} Your answer was not lost — adjust it and try again.`,
      );
      return;
    }

    setDecisions(nextDecisions);
    setRevision({
      spec: built.spec,
      result: outcome.data,
      comparison: compareFindings(previousFindings, outcome.data.findings),
    });
    setFilter("All");
    setStatus("done");
    setAnsweringKey(null);
  }

  function resetToOriginal() {
    setRevision(null);
    setDecisions([]);
    setRevisionError(null);
    setNotice("Reset to the original analysis. Your original specification is unchanged.");
  }

  function loadSample() {
    setSpec(SAMPLE_SPEC);
    setStatus("idle");
    setResult(null);
    setRevision(null);
    setDecisions([]);
    setRevisionError(null);
    setError(null);
    setNotice("Sample project loaded. Press Analyze.");
  }

  function reset() {
    setSpec("");
    setStatus("idle");
    setResult(null);
    setRevision(null);
    setDecisions([]);
    setRevisionError(null);
    setError(null);
    setNotice(null);
  }

  const statusText =
    status === "loading"
      ? "Analyzing specification…"
      : status === "error"
        ? "Analysis failed."
        : status === "done" && displayResult
          ? `${displayResult.findings.length} finding${displayResult.findings.length === 1 ? "" : "s"} returned${revision ? " (revised analysis)" : ""}.`
          : "Ready.";

  function cardFor(
    finding: Finding,
    index: number,
    status?: CardStatus,
    allowAnswer = true,
  ) {
    return (
      <FindingCard
        key={finding.id}
        finding={finding}
        index={index}
        status={status}
        decision={decisionByKey.get(findingKey(finding)) ?? null}
        answering={answeringKey === findingKey(finding)}
        onAnswer={allowAnswer ? applyAnswer : undefined}
      />
    );
  }

  return (
    <section className="mt-10">
      <div className="rounded-2xl border border-line bg-panel/70 p-5 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.9)] sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label htmlFor="spec" className="font-display text-xl tracking-tight text-ink">
            Project specification
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadSample}
              className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12.5px] text-muted transition-colors hover:border-ember/40 hover:text-ink"
            >
              Load sample project
            </button>
            {spec.length > 0 && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-transparent px-3 py-2 text-[12.5px] text-faint transition-colors hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-faint">
          Paste a brief, PRD, RFC, or a single paragraph. Unasked reviews exactly what you provide —
          it will not assume facts you did not write.
        </p>

        <textarea
          id="spec"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
              e.preventDefault();
              void analyze();
            }
          }}
          aria-describedby="spec-help"
          spellCheck={false}
          placeholder="Paste your project specification here…"
          className={`mt-4 min-h-[240px] w-full resize-y rounded-xl border bg-canvas px-4 py-3.5 font-mono text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint/70 focus:border-ember/60 ${
            tooLong ? "border-crit/60" : "border-line"
          }`}
        />

        <div
          id="spec-help"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-faint"
        >
          <span>
            {spec.trim().length < MIN_CHARS
              ? `At least ${MIN_CHARS} characters required`
              : "⌘/Ctrl + Enter to analyze"}
          </span>
          <span className={tooLong ? "text-crit" : ""}>
            {spec.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={!canSubmit}
            className="group relative inline-flex min-w-[190px] items-center justify-center gap-2 overflow-hidden rounded-xl bg-ember px-6 py-3 text-[14px] font-medium text-[#160c06] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
          >
            {status === "loading" ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#160c06]/40 border-t-[#160c06]" />
                Analyzing…
              </>
            ) : (
              <>Analyze specification</>
            )}
            {status === "loading" && (
              <span className="sheen pointer-events-none absolute inset-0" aria-hidden="true" />
            )}
          </button>

          <p className="text-[12px] leading-snug text-faint">
            {live ? (
              <>
                Live AI mode — requests are proxied through the server.
                <br />
                Model: <span className="text-muted">{model}</span>
              </>
            ) : (
              <>
                Demo Mode — transparent rule-based checks only.
                <br />
                No AI provider key is configured on this deployment.
              </>
            )}
          </p>
        </div>

        <p aria-live="polite" role="status" className="mt-4 font-mono text-[11px] text-faint">
          {statusText}
        </p>
      </div>

      {notice && status !== "error" && (
        <p className="mt-5 rounded-xl border border-line bg-panel/50 px-4 py-3 text-[13px] leading-relaxed text-muted">
          {notice}
        </p>
      )}

      {status === "error" && error && (
        <div className="mt-5 rounded-xl border border-crit/40 bg-crit/5 p-4 sm:p-5" role="alert">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-crit">
            {error.code.replace(/_/g, " ")}
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink">{error.error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!canSubmit}
              className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12.5px] text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Retry
            </button>
            {error.fallbackAvailable && !live && (
              <span className="text-[12px] text-faint">
                This deployment is already in Demo Mode.
              </span>
            )}
          </div>
        </div>
      )}

      <div ref={resultsRef} className="scroll-mt-6">
        {status === "idle" && !result && (
          <div className="mt-8 rounded-2xl border border-dashed border-line bg-panel/30 p-10 text-center">
            <p className="font-display text-lg text-muted">No analysis yet</p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-faint">
              Load the sample project or paste your own specification, then choose Analyze. Findings
              appear here with severity, category, evidence, and the question to ask next.
            </p>
          </div>
        )}

        {status === "loading" && !displayResult && (
          <div className="mt-8 space-y-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-line bg-panel/40"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        )}

        {displayResult && (
          <div className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line-soft pb-4">
              <div>
                <h2 className="font-display text-2xl tracking-tight text-ink">
                  {revision ? "Findings after reanalysis" : "Findings"}
                </h2>
                <p className="mt-1 text-[13px] text-faint">
                  {displayResult.analyzedChars.toLocaleString()} characters analyzed
                  {displayResult.rejected > 0 &&
                    ` · ${displayResult.rejected} rejected (unverifiable evidence)`}
                  {" · "}
                  <span className={displayResult.mode === "demo" ? "text-med" : "text-low"}>
                    {displayResult.mode === "demo" ? "Demo Mode" : "Live AI"}
                  </span>
                </p>
              </div>

              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Filter findings by severity"
              >
                {(["All", ...SEVERITY_ORDER] as Filter[]).map((key) => {
                  const active = filter === key;
                  const count =
                    key === "All"
                      ? displayResult.findings.length
                      : displayResult.findings.filter((f) => f.severity === key).length;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(key)}
                      className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                        active
                          ? "border-ember/50 bg-ember/10 text-ember"
                          : "border-line text-faint hover:text-muted"
                      }`}
                    >
                      {key} {count > 0 && <span className="text-faint">· {count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {revision && (
              <RevisionPanel
                revision={revision}
                originalSpec={spec}
                decisions={decisions}
                error={revisionError}
                onReset={resetToOriginal}
              />
            )}

            {!revision && revisionError && (
              <p role="alert" className="mt-5 rounded-xl border border-crit/40 bg-crit/5 px-4 py-3 text-[13px] leading-relaxed text-crit">
                {revisionError}
              </p>
            )}

            {revision ? (
              <ComparisonView
                revision={revision}
                filter={filter}
                cardFor={cardFor}
              />
            ) : displayResult.findings.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-line bg-panel/40 p-8 text-center">
                <p className="font-display text-lg text-ink">No findings survived review</p>
                <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-faint">
                  Nothing was flagged as an unaddressed assumption, contradiction, or risk. A short or
                  very concrete specification often produces this result — it is not a guarantee that
                  the requirements are complete.
                </p>
              </div>
            ) : (
              <>
                {displayResult.warnings.map((w, i) => (
                  <p
                    key={i}
                    className="mt-5 rounded-xl border border-med/30 bg-med/5 px-4 py-3 text-[12.5px] leading-relaxed text-med"
                  >
                    {w}
                  </p>
                ))}

                <div className="mt-4 space-y-3">
                  {visible.map((f, i) => cardFor(f, i))}
                  {visible.length === 0 && (
                    <p className="rounded-xl border border-line bg-panel/40 px-4 py-6 text-center text-[13px] text-faint">
                      No {filter.toLowerCase()} findings. Choose another filter to see the rest.
                    </p>
                  )}
                </div>

                <p className="mt-6 text-[12px] leading-relaxed text-faint">
                  Severity is an editorial judgement about delivery risk, not a measured value. Every
                  quote shown was verified on the server as an exact, character-for-character substring
                  of the submitted text
                  {displayResult.mode === "demo"
                    ? " by the rule engine."
                    : ", and any finding whose quote was not an exact match was discarded."}{" "}
                  Confidence is an uncalibrated{" "}
                  {displayResult.mode === "demo" ? "rule" : "model"} estimate, not a statistically
                  calibrated probability.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function RevisionPanel({
  revision,
  originalSpec,
  decisions,
  error,
  onReset,
}: {
  revision: RevisionState;
  originalSpec: string;
  decisions: Decision[];
  error: string | null;
  onReset: () => void;
}) {
  const { counts } = revision.comparison;
  return (
    <div className="mt-5 rounded-2xl border border-line bg-panel/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ember">
            Revised specification · reanalyzed
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {decisions.length} decision{decisions.length === 1 ? "" : "s"} incorporated. The original
            specification is preserved below.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12.5px] text-muted transition-colors hover:border-ember/40 hover:text-ink"
        >
          Reset to original analysis
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <SummaryStat label="Resolved after reanalysis" value={counts.resolved} tone="low" />
        <SummaryStat label="Still detected" value={counts.stillDetected} tone="muted" />
        <SummaryStat label="Newly detected" value={counts.newlyDetected} tone="ember" />
      </div>
      {counts.ambiguous > 0 && (
        <p className="mt-2 font-mono text-[11px] text-med">
          {counts.ambiguous} finding{counts.ambiguous === 1 ? "" : "s"} need review (similar but not
          an exact match) — not counted as resolved.
        </p>
      )}

      <details className="mt-4 rounded-xl border border-line bg-canvas/60">
        <summary className="cursor-pointer px-4 py-3 text-[13px] text-muted">
          Inspect original vs. revised specification
        </summary>
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Original ({originalSpec.length.toLocaleString()} chars)
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-ink/80">
              {originalSpec}
            </pre>
          </div>
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Revised ({revision.spec.length.toLocaleString()} chars)
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-ink/80">
              {revision.spec}
            </pre>
          </div>
        </div>
      </details>

      <details className="mt-3 rounded-xl border border-line bg-canvas/60" open>
        <summary className="cursor-pointer px-4 py-3 text-[13px] text-muted">
          Decisions recorded ({decisions.length})
        </summary>
        <ul className="space-y-2 px-4 pb-4">
          {decisions.map((d) => (
            <li key={d.key} className="rounded-lg border border-line-soft bg-panel/50 p-3">
              <p className="text-[13px] text-ink">{d.title}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                {d.category}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Q: {d.question}</p>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink/90">
                A: {d.answer}
              </p>
            </li>
          ))}
        </ul>
      </details>

      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        “Resolved” means the finding was no longer detected in the latest analysis — it is not proof
        that the underlying issue is actually fixed. Answers are recorded as data and are not verified
        as correct.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-crit/40 bg-crit/5 px-3 py-2 text-[12.5px] text-crit">
          {error}
        </p>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "low" | "muted" | "ember";
}) {
  const toneClass = tone === "low" ? "text-low" : tone === "ember" ? "text-ember" : "text-muted";
  return (
    <div className="rounded-xl border border-line bg-canvas/60 px-4 py-3">
      <p className={`font-display text-2xl leading-none ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11.5px] leading-snug text-faint">{label}</p>
    </div>
  );
}

function ComparisonView({
  revision,
  filter,
  cardFor,
}: {
  revision: RevisionState;
  filter: Filter;
  cardFor: (finding: Finding, index: number, status?: CardStatus, allowAnswer?: boolean) => React.ReactNode;
}) {
  const { resolved, stillDetected, newlyDetected, ambiguous } = revision.comparison;

  const visible = <T,>(items: T[], of: (item: T) => Finding) =>
    filter === "All" ? items : items.filter((item) => of(item).severity === filter);

  const newVisible = visible(newlyDetected, (f) => f);
  const stillVisible = visible(stillDetected, (s) => s.current);
  const resolvedVisible = visible(resolved, (f) => f);
  const ambiguousVisible = visible(ambiguous, (a) => a.near);

  const total = newVisible.length + stillVisible.length + resolvedVisible.length + ambiguousVisible.length;

  if (total === 0) {
    return (
      <p className="mt-5 rounded-xl border border-line bg-panel/40 px-4 py-6 text-center text-[13px] text-faint">
        No {filter.toLowerCase()} findings in the comparison.
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-6">
      <Group
        title="Newly detected"
        hint="Present in the revised analysis, not in the previous one."
        tone="text-ember"
        items={newVisible}
        render={(f, i) => cardFor(f, i, "new")}
      />
      <Group
        title="Still detected"
        hint="Present in both analyses. Answering again updates the recorded decision."
        tone="text-muted"
        items={stillVisible}
        render={(s, i) => cardFor(s.current, i, "still")}
      />
      <Group
        title="Resolved after reanalysis"
        hint="No longer detected. This is not proof the issue is fixed."
        tone="text-low"
        items={resolvedVisible}
        render={(f, i) => cardFor(f, i, "resolved", false)}
      />
      <Group
        title="Needs review"
        hint="Similar to a previous finding but not an exact match — deliberately not counted as resolved."
        tone="text-med"
        items={ambiguousVisible}
        render={(a, i) => cardFor(a.near, i, "ambiguous")}
      />
    </div>
  );
}

function Group<T>({
  title,
  hint,
  tone,
  items,
  render,
}: {
  title: string;
  hint: string;
  tone: string;
  items: T[];
  render: (item: T, index: number) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={`font-display text-lg tracking-tight ${tone}`}>
        {title} <span className="font-mono text-[11px] text-faint">· {items.length}</span>
      </h3>
      <p className="mt-0.5 mb-3 text-[12px] leading-snug text-faint">{hint}</p>
      <div className="space-y-3">{items.map((item, i) => render(item, i))}</div>
    </div>
  );
}
