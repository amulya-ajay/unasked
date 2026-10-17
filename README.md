# Unasked — The Unasked Question Engine

Unasked reads a pasted project specification and surfaces the assumptions,
unspecified requirements, contradictions, overlooked constraints, dependencies,
risks, and questions the owner must answer before building. Every finding is
backed by an evidence quote copied verbatim from the specification (or explicitly
marked "not specified"), and quotes are verified character-for-character on the
server.

## Features

- Paste a specification (40–20,000 characters) and get a structured review.
- Findings grouped by category and severity, with exact evidence quotes.
- Contradictions show two independently verified passages.
- **Answer → Reanalyze → Verify**: answer a finding's question, rebuild the spec
  with a decisions section, rerun the analysis, and compare (resolved / still
  detected / newly detected / needs review). Comparison is conservative and never
  claims a finding is "resolved" unless it is no longer detected.
- Demo Mode (rule-based) when no API key is configured; Live AI mode otherwise.
- Prompt-injection mitigation: the spec is treated as untrusted data.
- Request-size limits, Zod output validation, and server-side evidence verification.

## Tech stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- Zod for schema validation
- OpenAI-compatible chat completions (Google Gemini by default)
- No database, no auth, no external services beyond the AI provider

## Local setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local and add your key (or leave empty for Demo Mode)
npm run dev
```

Open http://localhost:3000.

## Gemini environment configuration

```env
OPENAI_API_KEY=YOUR_GEMINI_API_KEY
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_MODEL=gemini-3.8-flash
```

Equivalent `GEMINI_*` variables are also supported. If no key is set, the app
runs in clearly-labeled Demo Mode and never claims a live AI call. A present but
invalid key surfaces a real error instead of silently falling back to Demo Mode.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — start the production server
- `npm run typecheck` — TypeScript check
- `npm test` — run all automated tests

## Deployment

1. Set environment variables on your host (Vercel, etc.):
   - `OPENAI_API_KEY` (or `GEMINI_API_KEY`)
   - `OPENAI_BASE_URL`
   - `OPENAI_MODEL`
2. `npm run build` then `npm run start` (or deploy via Vercel).
3. Keep `.env.local` out of version control. Never commit API keys.
4. The `/api/analyze` route is server-side only; credentials never reach the client.

## Security notes

- API keys are read only in server code (`lib/analyze.ts`, `app/api/analyze/route.ts`).
- Evidence quotes are verified server-side, character-for-character.
- Spec input is bounded (40–20,000 chars) and request bodies are capped at 200 KB.
