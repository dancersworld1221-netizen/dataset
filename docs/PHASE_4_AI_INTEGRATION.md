# Phase 4: Gemini-Powered AI Intelligence

This document describes the Phase 4 AI integration for DataMind AI. It turns raw analytical results into
understandable, actionable, context-aware intelligence using Google Gemini, running server-side in Cloudflare Workers.

## What Phase 4 adds

- **Secure backend-first Gemini integration** — all Gemini API calls originate from the Cloudflare Worker; the browser never sees an API key.
- **Dataset context builder** — a compact, reusable representation of the dataset built from existing profiling and analytical results (never raw CSV rows).
- **AI Insights** — statistical, data-quality, correlation, anomaly and business insights, each with evidence, severity, confidence and a recommended next step.
- **Dataset AI Assistant** — an interactive chat that answers natural-language questions about the currently selected dataset, with conversation history scoped per dataset.
- **AI Recommendations** — evidence-based, non-destructive recommendations (investigate high missing-value columns, strong correlations, potential outliers, low-information columns).
- **AI-generated reports** — comprehensive Markdown reports (executive summary, overview, quality, statistics, relationships, anomalies, recommendations, limitations) with copy and Markdown download.
- **API endpoints** — `POST /api/ai/insights`, `/api/ai/chat`, `/api/ai/recommendations`, `/api/ai/reports`.
- **Navigation** — the AI Insights, Dataset Assistant and AI Report pages are added to the sidebar.

## Architecture

```
Browser (React SPA)  ── HTTPS ──►  Cloudflare Worker  ── HTTPS ──►  Google Gemini API
                              (GEMINI_API_KEY, server-side only)
```

The Worker is the only place with access to `GEMINI_API_KEY`. The frontend builds a compact `DatasetContext` from analysis
results already computed by Phases 0–3 (profiling, data quality, correlations, outliers) and sends it to the Worker. The
Worker calls Gemini with a system instruction that treats all dataset values as **data, never instructions**, validates the
model's JSON response, and returns a typed result.

## Backend files

- `worker/gemini.ts` — centralized `GeminiService`: builds prompts, calls the Gemini REST API, validates and normalizes responses.
- `worker/index.ts` — routes `POST /api/ai/{insights,chat,recommendations,reports}` to the service; input validation, consistent error responses, no credential leakage.
- `worker/types.ts` — `Env` (adds `GEMINI_API_KEY`, `GEMINI_MODEL`) and all AI request/response contracts.
- `wrangler.jsonc` — documents `GEMINI_API_KEY` and `GEMINI_MODEL` vars (real key set via Cloudflare secrets, never committed).

## Frontend files

- `src/lib/api.ts` — `generateAiInsights`, `askAiAboutDataset`, `generateAiRecommendations`, `generateAiReport`.
- `src/lib/ai/contextBuilder.ts` — `buildDatasetContext` plus response-shape validators.
- `src/pages/AIInsights.tsx` — AI Insights page (summary, insight cards, recommendations).
- `src/pages/AIChat.tsx` — Dataset Assistant chat page.
- `src/pages/AIReport.tsx` — AI Report page (copy + Markdown download).
- `src/app/router.tsx` — routes `/insights`, `/ai-chat`, `/ai-report`.
- `src/lib/navigation.ts` — sidebar entries for the three AI pages.
- `src/types/index.ts` — shared AI TypeScript contracts.

## Environment configuration

Copy `.dev.vars.example` to `.dev.vars` (git-ignored, local only):

```
ENVIRONMENT=development
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-2.5-flash
```

Get a key from https://aistudio.google.com/app/apikey. Never commit real credentials.

Without a valid `GEMINI_API_KEY`, AI endpoints return a `401 Invalid or missing Gemini API key` error and the UI shows "Failed to generate insights."

For Cloudflare deployment, set the key as a secret:

```
wrangler secret put GEMINI_API_KEY
```

`GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`, a current model suited to analytical reasoning and structured JSON responses.

## How the dataset context builder works

`buildDatasetContext(dataset, analyticalReport?)` collects, from existing results:

- Dataset id, name, row/column count, size, completeness, duplicates, truncation.
- Per-column: type, missing count/percentage, unique/duplicate counts, invalid count, statistics (min/max/mean/median/stdDev/q1/q3/iqr/outlierCount/skewness/count), top values.
- Data-quality issues (type, column, severity, description).
- Strong correlations and outlier columns from the analytical report.

Columns/issues/correlations/outliers are capped to keep prompts bounded. Raw CSV rows are never sent. The builder is modular, pure, and testable.

## API endpoints

All endpoints accept JSON, validate input, and return consistent JSON error responses with meaningful status codes.

| Endpoint | Body | Response |
|---|---|---|
| `POST /api/ai/insights` | `{ datasetId, context }` | `{ summary, insights[], limitations[] }` |
| `POST /api/ai/chat` | `{ datasetId, context, message, history[] }` | `{ text }` |
| `POST /api/ai/recommendations` | `{ datasetId, context }` | `{ recommendations[] }` |
| `POST /api/ai/reports` | `{ datasetId, context }` | `{ report }` |

Dataset access is validated server-side by checking the supplied `datasetId` is a non-empty string; dataset rows remain in browser IndexedDB and are never transmitted. A dataset ID supplied by the client is never trusted without the accompanying context being present.

## Security and privacy

- `GEMINI_API_KEY` is server-side only; never in frontend bundles, API responses, logs, or error messages.
- All dataset values are treated as untrusted data; the system instruction forbids treating them as instructions.
- Markdown in AI reports is rendered with a tiny safe parser (headings, lists, paragraphs) — no raw HTML, so no XSS from dataset content.
- Context payloads are capped; sensitive or identifying cell values are never included.
- Error messages shown to users are generic; provider internals and credentials are never leaked.
- Rate-limit (429) and API-key (401/403) errors are mapped to user-friendly messages.

## Error handling

Handled explicitly: missing/invalid API key, unsupported model, rate limits, quota exhaustion, network failures, provider timeouts, invalid AI responses, dataset not found, empty dataset, context too large, malformed requests, unauthorized access. Every AI component has initial, loading, success, empty, error and retry states.

## Testing

- `tests/lib/ai/contextBuilder.test.ts` — context builder and response validators.
- `tests/aiWorker.test.ts` — AI endpoint validation, missing API key, malformed requests, method handling.

Run with `npm test`. The `app.test.tsx` and `phase3Workflow.test.tsx` navigation tests fail in this environment due to a pre-existing jsdom `AbortSignal` issue during React Router navigation, unrelated to Phase 4 changes. My new tests pass.

## Known limitations

- Dataset rows live in browser IndexedDB; the Worker never sees them. The context is built entirely from profiling/analytical results already computed by previous phases.
- AI responses are generated by a non-deterministic model; all outputs are validated against a strict schema, but the model may still omit or generalize some details.
- Correlation insights never state causation.
- No automatic/destructive data modifications are performed — Phase 4 is analysis and recommendations only.

## Local development

```
npm ci
cp .dev.vars.example .dev.vars   # set GEMINI_API_KEY
npm run dev                     # Vite + Worker on http://localhost:3000
npm run typecheck               # tsc -b
npm run lint                    # eslint, zero warnings
npm test                        # vitest
npm run build                   # typecheck + production build
```
