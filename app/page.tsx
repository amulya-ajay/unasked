import Link from "next/link";
import Analyzer from "@/components/Analyzer";
import { resolveProvider } from "@/lib/analyze";

export const dynamic = "force-dynamic";

export default function Home() {
  const provider = resolveProvider();

  return (
    <main className="page-bg min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
        <header className="rise">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-8 w-8 items-center justify-center rounded-[9px] border border-ember/50 bg-ember/10 font-display text-lg leading-none text-ember">
                ?
              </span>
              <div className="leading-tight">
                <p className="font-display text-lg tracking-tight">Unasked</p>
                <p className="text-[11px] uppercase tracking-[0.22em] text-faint">
                  The Unasked Question Engine
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${
                provider
                  ? "border-low/40 bg-low/10 text-low"
                  : "border-med/40 bg-med/10 text-med"
              }`}
              title={
                provider
                  ? "A provider API key is configured; analyses run live on the server."
                  : "No provider API key is configured. Analyses use transparent rule-based checks."
              }
            >
              <span className={`h-1.5 w-1.5 rounded-full ${provider ? "bg-low" : "bg-med"}`} />
              {provider ? "Live AI mode" : "Demo mode"}
            </span>
          </div>

          <div className="mt-12 grid gap-10 border-b border-line-soft pb-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <h1 className="font-display text-4xl leading-[1.08] tracking-tight text-ink sm:text-5xl">
                Find the questions your
                <span className="text-ember"> specification never answers.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
                Paste a project brief, PRD, or one-paragraph idea. Unasked returns the missing
                assumptions, real contradictions, overlooked constraints, dependencies, and risks —
                each with severity, evidence quoted from your own text, and the exact question to ask
                next.
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 self-start text-sm">
              {[
                ["Contradictions", "Tensions between statements you actually wrote"],
                ["Missing assumptions", "Gaps stated as gaps, never as facts"],
                ["Evidence-checked", "Quotes are verified against your input"],
                ["Questions", "A corrective action for every finding"],
              ].map(([term, desc]) => (
                <div key={term} className="border-l border-line pl-4">
                  <dt className="text-ink">{term}</dt>
                  <dd className="mt-1 text-[13px] leading-snug text-faint">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        <Analyzer live={Boolean(provider)} model={provider ? `${provider.label} · ${provider.model}` : null} />

        <footer className="mt-16 border-t border-line-soft pt-6 text-[13px] leading-relaxed text-faint">
          <p>
            Unasked distinguishes a detected contradiction from a possible gap, and states plainly
            when information was not specified. It does not invent evidence and does not claim that
            something does not exist.
          </p>
          <p className="mt-2">
            {provider
              ? "AI requests are made server-side; your key is never sent to the browser."
              : "Demo Mode runs transparent rule-based checks on your text — no AI call is made. Add a provider API key to enable live analysis."}{" "}
            Pasted text is sent to the model provider only when Live AI mode is active and is not
            stored.
          </p>
          <p className="mt-2">
            <Link className="text-muted underline decoration-line underline-offset-4 hover:text-ink" href="/api/analyze">
              GET /api/analyze
            </Link>{" "}
            reports the active mode.
          </p>
        </footer>
      </div>
    </main>
  );
}
