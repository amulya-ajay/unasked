/**
 * Request-body size guards.
 *
 * The specification limit is expressed in characters (`MAX_CHARS`), but a
 * request can still arrive with a huge or misleading body. We therefore:
 *   1. reject early when a trustworthy Content-Length already exceeds the cap;
 *   2. read the body through a bounded stream reader so a missing, absent, or
 *      understated Content-Length cannot bypass the cap.
 *
 * 20,000 characters of UTF-8 text is at most ~80 KB; JSON string escaping can
 * roughly double that. 200 KB leaves comfortable headroom while still refusing
 * abusive payloads well before they are parsed.
 */
export const MAX_REQUEST_BYTES = 200_000;

/** True when an announced Content-Length is present and above the cap. */
export function contentLengthExceeds(
  rawLength: string | null | undefined,
  maxBytes: number = MAX_REQUEST_BYTES,
): boolean {
  if (!rawLength) return false;
  const value = Number.parseInt(rawLength, 10);
  return Number.isFinite(value) && value > maxBytes;
}

export type BoundedReadResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; bytes: number };

/**
 * Read a request body up to `maxBytes`. Stops and cancels the stream as soon as
 * the limit is crossed, so oversized payloads are never fully buffered.
 */
export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number = MAX_REQUEST_BYTES,
): Promise<BoundedReadResult> {
  if (!body) return { ok: true, text: "", bytes: 0 };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, bytes };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged), bytes };
}
