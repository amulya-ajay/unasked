import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_REQUEST_BYTES,
  contentLengthExceeds,
  readBoundedText,
} from "../lib/http";

test("contentLengthExceeds flags oversized announced bodies", () => {
  assert.equal(contentLengthExceeds(String(MAX_REQUEST_BYTES + 1)), true);
  assert.equal(contentLengthExceeds(String(MAX_REQUEST_BYTES)), false);
});

test("contentLengthExceeds ignores missing or malformed headers", () => {
  assert.equal(contentLengthExceeds(null), false);
  assert.equal(contentLengthExceeds(undefined), false);
  assert.equal(contentLengthExceeds(""), false);
  assert.equal(contentLengthExceeds("not-a-number"), false);
  assert.equal(contentLengthExceeds("12345"), false);
});

test("readBoundedText reads a small body fully", async () => {
  const payload = JSON.stringify({ spec: "hello world" });
  const req = new Request("http://localhost/api/analyze", { method: "POST", body: payload });
  const result = await readBoundedText(req.body, MAX_REQUEST_BYTES);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.text, payload);
    assert.equal(result.bytes, Buffer.byteLength(payload, "utf8"));
  }
});

test("readBoundedText stops bodies larger than the cap (no Content-Length needed)", async () => {
  // A stream body makes the fetch layer use chunked encoding and omit
  // Content-Length, exercising the bounded read rather than the header check.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 40; i++) controller.enqueue(new Uint8Array(1024));
      controller.close();
    },
  });
  const req = new Request("http://localhost/api/analyze", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal(req.headers.get("content-length"), null);

  const result = await readBoundedText(req.body, 4096);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.bytes > 4096);
});

test("readBoundedText treats an absent body as empty", async () => {
  const result = await readBoundedText(null, MAX_REQUEST_BYTES);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.text, "");
});

test("MAX_REQUEST_BYTES leaves headroom above the character limit", () => {
  // 20,000 chars * 4 bytes (worst-case UTF-8) = 80 KB, and JSON escaping can
  // roughly double that, so 200 KB is a safe ceiling.
  assert.ok(MAX_REQUEST_BYTES >= 20000 * 4);
});
