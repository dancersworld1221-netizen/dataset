// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import {
  boundContext,
  buildChatContents,
  parseReportText,
  validateInsightsResponse,
  validateRecommendationsResponse,
} from "../worker/gemini";
import type { DatasetContext, Env } from "../worker/types";

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;
const env = (extra: Partial<Env> = {}) => ({ ASSETS: { fetch: vi.fn() }, GEMINI_API_KEY: "secret-key", ...extra }) as unknown as Env;

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    datasetId: "ds-1",
    datasetName: "sales.csv",
    rowCount: 10,
    columnCount: 1,
    columns: [{ name: "city", type: "string", topValues: [{ value: "Baku", count: 3 }] }],
    qualityIssues: [],
    strongCorrelations: [],
    outlierColumns: [],
    ...overrides,
  }) as unknown as DatasetContext;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function geminiReply(text: string, finishReason = "STOP") {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }), { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe("request protection", () => {
  it("refuses cross-site browser requests before spending any quota", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: context() }, { "Sec-Fetch-Site": "cross-site" }), env(), ctx);
    expect(res.status).toBe(403);
    const other = await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: context() }, { Origin: "https://evil.example" }), env(), ctx);
    expect(other.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await worker.fetch(post("/api/ai/chat", { datasetId: "d", context: context(), message: "x".repeat(300_000) }), env(), ctx);
    expect(res.status).toBe(413);
  });

  it("answers 400 (not 500) for a malformed context and for an over-long chat message", async () => {
    const bad = await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: { columns: "nope" } }), env(), ctx);
    expect(bad.status).toBe(400);
    const long = await worker.fetch(post("/api/ai/chat", { datasetId: "d", context: context(), message: "x".repeat(5000) }), env(), ctx);
    expect(long.status).toBe(400);
  });
});

describe("Gemini request", () => {
  it("sends the key in a header (never in the URL) and asks for JSON without thinking tokens", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      geminiReply(JSON.stringify({ summary: "ok", insights: [], limitations: [] }))
    );
    const res = await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: context() }), env(), ctx);
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("secret-key");
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    const categories = body.safetySettings.map((s: { category: string }) => s.category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("does not force thinking off for models that need it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(geminiReply(JSON.stringify({ summary: "ok", insights: [], limitations: [] })));
    await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: context() }), env({ GEMINI_MODEL: "gemini-2.5-pro" }), ctx);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("chat sends a real alternating conversation and keeps the context in the system instruction", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(geminiReply("Answer"));
    const res = await worker.fetch(
      post("/api/ai/chat", {
        datasetId: "d",
        context: context(),
        message: "and now?",
        history: [
          { role: "model", content: "stray" },
          { role: "user", content: "hi" },
          { role: "model", content: "hello" },
        ],
      }),
      env(),
      ctx
    );
    expect(await res.json()).toEqual({ text: "Answer" });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.systemInstruction.parts[0].text).toContain("sales.csv");
  });

  it("report: accepts plain Markdown, stamps it, and never needs JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(geminiReply("## Executive summary\nAll good."));
    const res = await worker.fetch(post("/api/ai/reports", { datasetId: "d", context: context() }), env(), ctx);
    const { report } = (await res.json()) as { report: string };
    expect(report.startsWith("## Executive summary")).toBe(true);
    expect(report).toMatch(/Generated by DataMind AI/);
  });

  it("maps provider failures to honest statuses without leaking details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "quota details" } }), { status: 429 }));
    const limited = await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: context() }), env(), ctx);
    expect(limited.status).toBe(429);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(geminiReply('{"summary": "cut', "MAX_TOKENS"));
    const cut = await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: context() }), env(), ctx);
    expect(cut.status).toBe(502);
    expect(await cut.text()).not.toContain("summary");

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket hang up with secret-key"));
    const down = await worker.fetch(post("/api/ai/insights", { datasetId: "d", context: context() }), env(), ctx);
    expect(down.status).toBe(502);
    expect(await down.text()).not.toContain("secret-key");
  });
});

describe("context bounding", () => {
  it("caps lists and sample values without mutating the input", () => {
    const wide = context({
      columns: Array.from({ length: 200 }, (_, i) => ({
        name: `c${i}`,
        type: "string",
        topValues: Array.from({ length: 20 }, (_, j) => ({ value: "v".repeat(500) + j, count: j })),
      })),
      qualityIssues: Array.from({ length: 500 }, () => ({ type: "x", severity: "low", description: "d".repeat(2000) })),
    });
    const before = JSON.stringify(wide);
    const bounded = boundContext(wide);
    expect(JSON.stringify(wide)).toBe(before);
    expect(bounded.columns.length).toBeLessThanOrEqual(60);
    expect(bounded.qualityIssues.length).toBeLessThanOrEqual(40);
    expect(JSON.stringify(bounded).length / 4).toBeLessThanOrEqual(6_100);
  });
});

describe("response handling", () => {
  it("skips malformed insight items instead of failing everything, and fills defaults", () => {
    const result = validateInsightsResponse({
      summary: "s",
      insights: [
        { title: "A", description: "a", category: "made-up", severity: "huge" },
        { title: "", description: "no title" },
        { id: "x", title: "B", description: "b", category: "anomaly", severity: "high", confidence: "high", evidence: [{ label: "n", value: 3 }] },
      ],
    });
    expect(result.insights).toHaveLength(2);
    expect(result.insights[0]).toMatchObject({ id: "insight-1", category: "statistical", severity: "info", confidence: "low" });
    expect(() => validateInsightsResponse({ summary: "s", insights: [{ nope: true }] })).toThrow();
    expect(validateRecommendationsResponse({ recommendations: [{ title: "t", explanation: "e" }] }).recommendations[0].priority).toBe("medium");
  });

  it("parses reports given as Markdown, fenced Markdown or JSON", () => {
    expect(parseReportText("# R")).toBe("# R");
    expect(parseReportText("```markdown\n# R\n```")).toBe("# R");
    expect(parseReportText('{"report": "# R"}')).toBe("# R");
  });

  it("keeps chat turns alternating", () => {
    const turns = buildChatContents(
      [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "model", content: "c" },
      ],
      "d"
    );
    expect(turns.map((t) => t.role)).toEqual(["user", "model", "user"]);
    expect(turns[0].parts[0].text).toBe("a\n\nb");
  });
});
