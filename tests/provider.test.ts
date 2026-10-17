import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  AnalysisError,
  GEMINI_BASE_URL,
  callModel,
  finalize,
  isGeminiEndpoint,
  parseModelFindings,
  resolveProvider,
  type Provider,
} from "../lib/analyze";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const KNOWN_ENV = [
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "GROQ_MODEL",
];

/** Run `fn` with exactly the given provider env vars set, then restore. */
function withEnv(set: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of KNOWN_ENV) saved[k] = process.env[k];
  for (const k of KNOWN_ENV) delete process.env[k];
  for (const [k, v] of Object.entries(set)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const k of KNOWN_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

type MockOut = { status: number; body: string };

function startMock(respond: (callIndex: number, body: any) => MockOut) {
  const requests: Array<{ body: any }> = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = data;
      }
      const callIndex = requests.length;
      requests.push({ body: parsed, auth: req.headers.authorization } as any);
      const out = respond(callIndex, parsed);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(out.body);
    });
  });
  return new Promise<{ baseUrl: string; requests: any[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function provider(baseUrl: string, overrides: Partial<Provider> = {}): Provider {
  return { key: "test-key", baseUrl, model: "test-model", label: "Mock", ...overrides };
}

const SPEC =
  "The app must be fast and modern. Data is stored locally and also synced to the cloud in real time.";

function chatResponse(content: string): string {
  return JSON.stringify({ choices: [{ message: { role: "assistant", content } }] });
}

/* ------------------------------------------------------------------ */
/* Provider selection                                                  */
/* ------------------------------------------------------------------ */

test("resolveProvider returns null when no key is configured", () => {
  withEnv({}, () => {
    assert.equal(resolveProvider(), null);
  });
});

test("resolveProvider ignores a blank/whitespace key", () => {
  withEnv({ OPENAI_API_KEY: "   " }, () => {
    assert.equal(resolveProvider(), null);
  });
});

test("OPENAI_* pointing at Gemini is labelled Google Gemini and normalises the URL", () => {
  withEnv(
    {
      OPENAI_API_KEY: "gem-key",
      OPENAI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      OPENAI_MODEL: "gemini-3.8-flash",
    },
    () => {
      const p = resolveProvider();
      assert.ok(p);
      assert.equal(p!.label, "Google Gemini");
      assert.equal(p!.key, "gem-key");
      assert.equal(p!.model, "gemini-3.8-flash");
      assert.equal(p!.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
      assert.equal(p!.baseUrl.endsWith("/"), false);
    },
  );
});

test("explicit GEMINI_API_KEY selects live mode with Gemini defaults", () => {
  withEnv({ GEMINI_API_KEY: "g-key" }, () => {
    const p = resolveProvider();
    assert.ok(p);
    assert.equal(p!.label, "Google Gemini");
    assert.equal(p!.baseUrl, GEMINI_BASE_URL);
    assert.equal(p!.model, "gemini-2.0-flash");
  });
});

test("GEMINI_API_KEY takes priority over OPENAI_API_KEY", () => {
  withEnv({ GEMINI_API_KEY: "g-key", OPENAI_API_KEY: "o-key" }, () => {
    const p = resolveProvider();
    assert.ok(p);
    assert.equal(p!.key, "g-key");
    assert.equal(p!.label, "Google Gemini");
  });
});

test("a present but invalid key still selects live mode (never demo)", () => {
  withEnv({ OPENAI_API_KEY: "definitely-not-valid" }, () => {
    assert.ok(resolveProvider());
  });
});

test("isGeminiEndpoint detects the Gemini host only", () => {
  assert.equal(isGeminiEndpoint(GEMINI_BASE_URL), true);
  assert.equal(isGeminiEndpoint("https://api.openai.com/v1"), false);
  assert.equal(isGeminiEndpoint("https://api.groq.com/openai/v1"), false);
});

/* ------------------------------------------------------------------ */
/* Provider error handling                                             */
/* ------------------------------------------------------------------ */

test("callModel maps 401 to invalid_credentials", async () => {
  const mock = await startMock(() => ({ status: 401, body: JSON.stringify({ error: { message: "API key not valid" } }) }));
  try {
    await assert.rejects(
      () => callModel(SPEC, provider(mock.baseUrl)),
      (err: unknown) => {
        assert.ok(err instanceof AnalysisError);
        assert.equal((err as AnalysisError).code, "invalid_credentials");
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test("callModel maps 403 to invalid_credentials", async () => {
  const mock = await startMock(() => ({ status: 403, body: "forbidden" }));
  try {
    await assert.rejects(
      () => callModel(SPEC, provider(mock.baseUrl)),
      (err: unknown) => err instanceof AnalysisError && err.code === "invalid_credentials",
    );
  } finally {
    await mock.close();
  }
});

test("callModel maps 404 to an upstream_error naming the model", async () => {
  const mock = await startMock(() => ({ status: 404, body: "model not found" }));
  try {
    await assert.rejects(
      () => callModel(SPEC, provider(mock.baseUrl, { model: "gemini-3.8-flash" })),
      (err: unknown) => {
        assert.ok(err instanceof AnalysisError);
        assert.equal((err as AnalysisError).code, "upstream_error");
        assert.match((err as Error).message, /gemini-3\.8-flash/);
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test("callModel maps 429 to rate_limited", async () => {
  const mock = await startMock(() => ({ status: 429, body: "slow down" }));
  try {
    await assert.rejects(
      () => callModel(SPEC, provider(mock.baseUrl)),
      (err: unknown) => err instanceof AnalysisError && err.code === "rate_limited",
    );
  } finally {
    await mock.close();
  }
});

/* ------------------------------------------------------------------ */
/* Parameter compatibility + output parsing                            */
/* ------------------------------------------------------------------ */

test("callModel retries once without response_format when it is unsupported", async () => {
  const valid = chatResponse(
    JSON.stringify({ findings: [] }),
  );
  const mock = await startMock((callIndex) => {
    if (callIndex === 0) {
      return { status: 400, body: JSON.stringify({ error: { message: "Unsupported parameter: response_format" } }) };
    }
    return { status: 200, body: valid };
  });
  try {
    const findings = await callModel(SPEC, provider(mock.baseUrl));
    assert.deepEqual(findings, []);
    assert.equal(mock.requests.length, 2);
    assert.ok("response_format" in mock.requests[0].body);
    assert.equal("response_format" in mock.requests[1].body, false);
    // Core parameters survive the retry.
    assert.equal(mock.requests[1].body.model, "test-model");
    assert.ok(Array.isArray(mock.requests[1].body.messages));
  } finally {
    await mock.close();
  }
});

test("callModel does NOT retry an unrelated 400 (no silent weakening)", async () => {
  const mock = await startMock(() => ({ status: 400, body: JSON.stringify({ error: { message: "invalid request" } }) }));
  try {
    await assert.rejects(
      () => callModel(SPEC, provider(mock.baseUrl)),
      (err: unknown) => err instanceof AnalysisError && err.code === "upstream_error",
    );
    assert.equal(mock.requests.length, 1);
  } finally {
    await mock.close();
  }
});

test("callModel sends the bearer key and never exposes it in the body", async () => {
  const mock = await startMock(() => ({ status: 200, body: chatResponse(JSON.stringify({ findings: [] })) }));
  try {
    await callModel(SPEC, provider(mock.baseUrl, { key: "secret-key-value" }));
    assert.equal(mock.requests[0].auth, "Bearer secret-key-value");
    assert.equal(JSON.stringify(mock.requests[0].body).includes("secret-key-value"), false);
  } finally {
    await mock.close();
  }
});

test("callModel rejects a non-JSON body", async () => {
  const mock = await startMock(() => ({ status: 200, body: chatResponse("I cannot help with that.") }));
  try {
    await assert.rejects(
      () => callModel(SPEC, provider(mock.baseUrl)),
      (err: unknown) => err instanceof AnalysisError && err.code === "malformed_output",
    );
  } finally {
    await mock.close();
  }
});

test("callModel rejects an empty choices response", async () => {
  const mock = await startMock(() => ({ status: 200, body: JSON.stringify({ choices: [] }) }));
  try {
    await assert.rejects(
      () => callModel(SPEC, provider(mock.baseUrl)),
      (err: unknown) => err instanceof AnalysisError && err.code === "malformed_output",
    );
  } finally {
    await mock.close();
  }
});

test("evidence is verified character-for-character after a live-style response", () => {
  const modelJson = JSON.stringify({
    findings: [
      {
        category: "Missing Assumption",
        severity: "High",
        title: "Storage location is unspecified",
        explanation: "Where data actually lives is not stated.",
        evidence: "Data is stored locally",
        counter_evidence: null,
        evidence_status: "quoted",
        recommendation: "Confirm the source of truth for storage.",
        confidence: 0.6,
      },
      {
        category: "Risk",
        severity: "Medium",
        title: "Fabricated quote",
        explanation: "This quote is not in the spec.",
        evidence: "Data is stored locally and encrypted with AES-256",
        counter_evidence: null,
        evidence_status: "quoted",
        recommendation: "Should not survive verification.",
        confidence: 0.5,
      },
    ],
  });

  const raws = parseModelFindings(modelJson);
  const { findings, rejected } = finalize(raws, SPEC, "model");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidenceVerified, true);
  assert.ok(SPEC.includes(findings[0].evidence!));
  assert.equal(rejected, 1);
  assert.equal(findings.some((f) => f.evidence?.includes("AES-256")), false);
});
