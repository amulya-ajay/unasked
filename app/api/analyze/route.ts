import { NextResponse } from "next/server";
import {
  MAX_CHARS,
  MIN_CHARS,
  AnalysisError,
  callModel,
  countBySeverity,
  finalize,
  resolveProvider,
  runRules,
} from "@/lib/analyze";
import { MAX_REQUEST_BYTES, contentLengthExceeds, readBoundedText } from "@/lib/http";
import type { AnalyzeErrorResponse, AnalyzeResponse } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

function fail(code: AnalyzeErrorResponse["code"], error: string, status: number, fallbackAvailable?: boolean) {
  return NextResponse.json<AnalyzeErrorResponse>({ error, code, ...(fallbackAvailable ? { fallbackAvailable } : {}) }, { status });
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  if (rateLimited(ip)) {
    return fail("rate_limited", "Too many analyses from this address. Wait about a minute and try again.", 429);
  }

  // Reject clearly oversized requests before reading their contents.
  if (contentLengthExceeds(req.headers.get("content-length"))) {
    return fail(
      "payload_too_large",
      `The request body is too large. The limit is ${MAX_REQUEST_BYTES.toLocaleString()} bytes.`,
      413,
    );
  }

  // Read with a hard byte cap so a missing or understated Content-Length cannot
  // bypass the limit and force a huge payload to be buffered/parsed.
  const bounded = await readBoundedText(req.body, MAX_REQUEST_BYTES);
  if (!bounded.ok) {
    return fail(
      "payload_too_large",
      `The request body is too large. The limit is ${MAX_REQUEST_BYTES.toLocaleString()} bytes.`,
      413,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bounded.text);
  } catch {
    return fail("invalid_json", "Request body must be JSON with a `spec` string.", 400);
  }

  const body = (parsed && typeof parsed === "object" ? parsed : {}) as {
    spec?: unknown;
    mode?: unknown;
  };
  const spec = typeof body.spec === "string" ? body.spec.trim() : "";
  const forceDemo = body.mode === "demo";

  if (spec.length < MIN_CHARS) {
    return fail("too_short", `The specification is too short to analyze. Paste at least ${MIN_CHARS} characters.`, 400);
  }
  if (spec.length > MAX_CHARS) {
    return fail("too_long", `The specification is too long. The limit is ${MAX_CHARS.toLocaleString()} characters (received ${spec.length.toLocaleString()}).`, 413);
  }

  const provider = resolveProvider();

  try {
    if (provider && !forceDemo) {
      const raws = await callModel(spec, provider);
      const { findings, rejected, warnings } = finalize(raws, spec, "model");
      if (raws.length > 0 && findings.length === 0) {
        return fail("malformed_output", "Every finding returned by the model failed evidence verification and was rejected.", 502, true);
      }
      return NextResponse.json<AnalyzeResponse>({
        mode: "live",
        model: `${provider.label} · ${provider.model}`,
        findings,
        counts: countBySeverity(findings),
        rejected,
        warnings,
        analyzedChars: spec.length,
      });
    }

    const raws = runRules(spec);
    const { findings, rejected, warnings } = finalize(raws, spec, "rules");
    warnings.unshift(
      "Demo Mode: no AI API key is configured. These findings come from transparent rule-based checks over the text you submitted — not from a live AI model.",
    );
    return NextResponse.json<AnalyzeResponse>({
      mode: "demo",
      model: null,
      findings,
      counts: countBySeverity(findings),
      rejected,
      warnings,
      analyzedChars: spec.length,
    });
  } catch (err) {
    if (err instanceof AnalysisError) {
      const status = err.status as number;
      return fail(err.code as AnalyzeErrorResponse["code"], err.message, status, true);
    }
    console.error("analyze route error", err);
    return fail("server_error", "Something went wrong while analyzing the specification.", 500, true);
  }
}

export async function GET() {
  const provider = resolveProvider();
  return NextResponse.json({
    live: Boolean(provider),
    model: provider ? `${provider.label} · ${provider.model}` : null,
    minChars: MIN_CHARS,
    maxChars: MAX_CHARS,
  });
}
