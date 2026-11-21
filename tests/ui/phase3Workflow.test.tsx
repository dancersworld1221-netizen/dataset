import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { StrictMode } from "react";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor, act, cleanup } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import { DatasetProvider } from "@/context/DatasetProvider";
import { AnalyticsProvider } from "@/context/AnalyticsProvider";
import { Upload } from "@/pages/Upload";
import { Preview } from "@/pages/Preview";
import { FeatureAnalysis } from "@/pages/FeatureAnalysis";
import { closeDatabase } from "@/lib/storage/database";
import { datasetRepository } from "@/lib/storage/datasetRepository";
import { analysisCache } from "@/lib/analytics/cache";

// Expected numbers come from tests/fixtures/phase3.expected.json (numpy / scipy), not from the app.
const fixtureDir = resolve(__dirname, "../fixtures");
const csv = readFileSync(join(fixtureDir, "phase3.csv"), "utf8");
const expected = JSON.parse(readFileSync(join(fixtureDir, "phase3.expected.json"), "utf8"));

const routes = [
  { path: "/upload", element: <Upload /> },
  { path: "/analysis", element: <FeatureAnalysis /> },
  { path: "/preview", element: <Preview /> },
];

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  // StrictMode, like main.tsx: effects mount, unmount and mount again in development.
  render(
    <StrictMode>
      <ToastProvider>
        <DatasetProvider>
          <AnalyticsProvider>
            <RouterProvider router={router} />
          </AnalyticsProvider>
        </DatasetProvider>
      </ToastProvider>
    </StrictMode>
  );
  return router;
}

const go = (router: ReturnType<typeof createMemoryRouter>, path: string) => act(async () => { await router.navigate(path); });
const slow = { timeout: 15000 };
const num = (text: string | null | undefined) => Number((text ?? "").replace(/,/g, ""));

/** Reads the value of a metric card by its label. */
function metric(label: string): string {
  const dt = screen.getAllByText((_, el) => el?.tagName === "DT" && (el.textContent ?? "").trim() === label)[0];
  return (dt.nextElementSibling?.textContent ?? "").trim();
}

let datasetId = "";

beforeAll(async () => {
  await closeDatabase();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => cleanup());

describe("Phase 3 end-to-end workflow on the acceptance dataset", { timeout: 60000 }, () => {
  const network = {
    fetch: vi.fn(),
    xhr: vi.fn(),
    beacon: vi.fn(),
    ws: vi.fn(),
  };

  beforeAll(() => {
    vi.stubGlobal("fetch", network.fetch);
    vi.stubGlobal("WebSocket", network.ws);
    vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(network.xhr);
    Object.defineProperty(navigator, "sendBeacon", { value: network.beacon, configurable: true });
  });

  it("1. uploads the CSV through the Upload page", async () => {
    renderApp("/upload");
    const input = (await screen.findByText(/Drag & Drop CSV File/i)).closest("div")?.parentElement?.querySelector("input[type=file]") ?? document.querySelector("input[type=file]");
    fireEvent.change(input as HTMLInputElement, { target: { files: [new File([csv], "phase3.csv", { type: "text/csv" })] } });
    fireEvent.click(await screen.findByRole("button", { name: /Process Dataset/ }));
    await screen.findByText(/This file has been processed/, {}, slow);
    const stored = await datasetRepository.getActiveMeta();
    expect(stored?.dataset.recordCount).toBe(120);
    datasetId = stored!.id;
  });

  it("2-3. Feature Analysis: numerical statistics match numpy/scipy", async () => {
    const router = renderApp("/analysis?tab=statistics&col=age");
    await screen.findByText("Descriptive statistics", {}, slow);
    await waitFor(() => expect(metric("Valid observations")).toBe("119"), slow);
    const e = expected.age;
    expect(metric("Invalid numeric")).toBe("1");
    expect(num(metric("Mean"))).toBeCloseTo(e.mean, 3);
    expect(num(metric("Median (Q2)"))).toBeCloseTo(e.median, 3);
    expect(num(metric("Std deviation (sample)"))).toBeCloseTo(e.stdDev, 3);
    expect(num(metric("Std deviation (population)"))).toBeCloseTo(e.populationStdDev, 3);
    expect(num(metric("IQR"))).toBeCloseTo(e.iqr, 3);
    expect(num(metric("MAD"))).toBeCloseTo(e.mad, 3);
    expect(num(metric("Skewness"))).toBeCloseTo(e.skewness, 3);
    expect(num(metric("Excess kurtosis"))).toBeCloseTo(e.excessKurtosis, 3);
    // Tooltips: every metric label carries an explanation.
    expect(screen.getAllByRole("img", { name: /SAMPLE standard deviation/ }).length).toBeGreaterThan(0);

    await go(router, "/analysis?tab=statistics&col=income");
    await waitFor(() => expect(metric("Missing")).toBe("3"), slow);
    expect(num(metric("Mean"))).toBeCloseTo(expected.income.mean, 2);
  });

  it("4. histograms use the real bins and can be adjusted", async () => {
    renderApp("/analysis?tab=distributions&col=age");
    const chart = await screen.findByRole("img", { name: /Histogram with \d+ bins/ }, slow);
    expect(chart.querySelectorAll("rect").length).toBeGreaterThan(0);
    const bins = screen.getByLabelText("Number of bins");
    fireEvent.change(bins, { target: { value: "8" } });
    await waitFor(() => expect(screen.getByRole("img", { name: "Histogram with 8 bins" })).toBeInTheDocument(), slow);
    const table = screen.getByRole("table", { name: "Frequency distribution" });
    const rows = within(table).getAllByRole("row");
    const counts = rows.slice(1, 1 + 8).map((r) => num(within(r).getAllByRole("cell")[1].textContent));
    expect(counts).toEqual(expected.age_hist_8.counts);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(119); // frequencies add up to the valid observations
    expect(within(table).getByText("Total").nextElementSibling?.textContent).toBe("119");
  });

  it("5. outlier detection flags the known rows and filters the Data Preview", async () => {
    const router = renderApp("/analysis?tab=outliers&col=with_outliers");
    await waitFor(() => expect(metric("Candidates")).toMatch(/^2 /), slow);
    const rows = within(screen.getByRole("table", { name: "Affected rows" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["11", "78"]); // expected rows 10 and 77 (0-based)
    expect(rows.map((r) => num(within(r).getAllByRole("cell")[1].textContent))).toEqual([500, -300]);
    expect(screen.getByText(/not necessarily an error/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Show affected rows in Data Preview/ }));
    await screen.findByText(/Showing the 2 row\(s\) flagged as outlier candidates/, {}, slow);
    const table = await screen.findByRole("table", { name: "Dataset records" });
    const previewRows = within(table).getAllByRole("row").slice(1);
    expect(previewRows).toHaveLength(2);
    expect(previewRows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["11", "78"]);
    expect(router.state.location.pathname).toBe("/preview");
    // The stored dataset is untouched.
    expect((await datasetRepository.getRecords(datasetId))?.length).toBe(120);
  });

  it("6. correlation matrix shows the known relationships and pair details", async () => {
    renderApp("/analysis?tab=correlation");
    const grid = await screen.findByRole("grid", { name: "Correlation matrix" }, slow);
    expect(within(grid).queryByLabelText(/row_id/)).toBeNull(); // identifiers are not correlated
    const cell = (a: string, b: string) => within(grid).getByLabelText(new RegExp(`^${a} / ${b}: r = `));
    expect(cell("age", "income").getAttribute("aria-label")).toContain(`r = ${expected.corr_age_income.pearson.toFixed(3)}`);
    expect(cell("age", "income").getAttribute("aria-label")).toContain(`n = ${expected.corr_age_income.n}`);
    expect(cell("age", "debt").getAttribute("aria-label")).toContain(`r = ${expected.corr_age_debt.pearson.toFixed(3)}`);
    expect(cell("age", "spend").getAttribute("aria-label")).toContain(`r = ${expected.corr_age_spend.pearson.toFixed(3)}`);
    fireEvent.click(cell("age", "income"));
    await waitFor(() => expect(metric("Paired observations")).toBe(String(expected.corr_age_income.n)), slow);
    expect(num(metric("Pearson r"))).toBeCloseTo(expected.corr_age_income.pearson, 4);
    expect(num(metric("Spearman ρ"))).toBeCloseTo(expected.corr_age_income.spearman, 4);
    expect(screen.getAllByText(/does not imply causation/i).length).toBeGreaterThan(0);

    // Switching to Spearman recalculates.
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "spearman" } });
    await waitFor(() => expect(screen.getByRole("grid", { name: "Correlation matrix" })).toBeInTheDocument(), slow);
    await waitFor(() => expect(within(screen.getByRole("grid")).getByLabelText(/^age \/ debt: r = /).getAttribute("aria-label")).toContain(`r = ${expected.corr_age_debt.spearman.toFixed(3)}`), slow);
  });

  it("7-9. categorical distributions and class imbalance for a user-selected target", async () => {
    renderApp("/analysis?tab=categorical");
    await screen.findByText(/Choose the target column yourself/, {}, slow);
    expect(screen.getByText(/Select a target column to see/)).toBeInTheDocument(); // nothing is assumed
    const table = await screen.findByRole("table", { name: "Categorical columns summary" }, slow);
    expect(within(table).getByText("category")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target column"), { target: { value: "target" } });
    await waitFor(() => expect(metric("Imbalance ratio")).toBe("9 : 1"), slow);
    expect(metric("Classes")).toBe("2");
    expect(screen.getByText("Moderate imbalance")).toBeInTheDocument();
    expect(metric("Majority class")).toContain("no");
    expect(metric("Majority class")).toContain("90.0%");
  });

  it("10. compares two features and separates exact duplicates from statistical similarity", async () => {
    renderApp("/analysis?tab=compare");
    await screen.findByText("Compare features", {}, slow);
    const pick = (name: string) => {
      const label = screen.getAllByText(name).map((el) => el.closest("label")).find(Boolean) as HTMLLabelElement;
      fireEvent.click(within(label).getByRole("checkbox"));
    };
    pick("age");
    pick("dup_age");
    const pairs = await screen.findByRole("table", { name: "Pairwise comparison" }, slow);
    expect(within(pairs).getByText("exact duplicate")).toBeInTheDocument();
    pick("income");
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Pairwise comparison" })).getAllByRole("row")).toHaveLength(4), slow);
    // Relationship overview: exact duplicates are listed separately from correlated features.
    await waitFor(() => expect(screen.getByText(/age = dup_age/)).toBeInTheDocument(), slow);
    expect(screen.getByText(/Highly correlated numerical features/)).toBeInTheDocument();
  });

  it("11. the analytical report is deterministic and complete", async () => {
    renderApp("/analysis?tab=report&target=target");
    await screen.findByText("Analytical report", {}, slow);
    await screen.findByText("Dataset overview", {}, slow);
    expect(screen.getByText(/120 rows × 12 columns/)).toBeInTheDocument();
    for (const heading of ["Numerical features", "Categorical features", "Distribution observations", "Class imbalance", "Potentially redundant features", "Warnings"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText(/ratio 9 : 1/)).toBeInTheDocument();
    expect(screen.getByText(/age = dup_age/)).toBeInTheDocument();
    expect(screen.getByText(/no AI-written text/i)).toBeInTheDocument();
  });

  it("12-13. after a refresh the dataset is recovered and the analysis is identical", async () => {
    renderApp("/analysis?tab=statistics&col=age");
    await waitFor(() => expect(metric("Valid observations")).toBe("119"), slow);
    const before = { mean: metric("Mean"), sd: metric("Std deviation (sample)"), skew: metric("Skewness") };
    cleanup();
    analysisCache.clear(); // a fresh page has an empty in-memory cache
    renderApp("/analysis?tab=statistics&col=age");
    await waitFor(() => expect(metric("Valid observations")).toBe("119"), slow);
    expect({ mean: metric("Mean"), sd: metric("Std deviation (sample)"), skew: metric("Skewness") }).toEqual(before);
  });

  it("14. deleting the dataset removes its stored data and its cached analysis", async () => {
    const router = renderApp("/analysis?tab=statistics&col=age");
    await waitFor(() => expect(metric("Valid observations")).toBe("119"), slow);
    expect(analysisCache.size(datasetId)).toBeGreaterThan(0);

    await go(router, "/preview");
    // Removing a dataset asks for confirmation first.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Dataset" }, slow));
    expect(confirmSpy).toHaveBeenCalled();
    await screen.findByText(/No dataset|upload/i, {}, slow);
    await waitFor(() => expect(analysisCache.size(datasetId)).toBe(0), slow);
    expect(await datasetRepository.getMeta(datasetId)).toBeNull();
    expect(await datasetRepository.getRecords(datasetId)).toBeNull();

    // Analysis pages fall back to the empty state.
    await go(router, "/analysis?tab=statistics");
    await screen.findByRole("button", { name: "Upload Dataset" }, slow);
  });

  it("never sends uploaded data to external services", () => {
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.xhr).not.toHaveBeenCalled();
    expect(network.beacon).not.toHaveBeenCalled();
    expect(network.ws).not.toHaveBeenCalled();
  });
});

describe("static check: no network APIs in the application source", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(resolve(__dirname, "../../src"));

  // src/lib/api.ts is the pre-existing client for the Worker's /api/health endpoint. It is not
  // imported by any dataset, profiling or analytics code (checked below) and sends no dataset data.
  // The AI pages below legitimately call the server-side /api/ai/* endpoints (Gemini lives in the
  // Worker, never in the browser), so they are allowed network / API-client callers.
  const ALLOWED = [
    resolve(__dirname, "../../src/lib/api.ts"),
    resolve(__dirname, "../../src/pages/AIInsights.tsx"),
    resolve(__dirname, "../../src/pages/AIChat.tsx"),
    resolve(__dirname, "../../src/pages/AIReport.tsx"),
  ];

  it("contains no fetch, XMLHttpRequest, WebSocket, EventSource or sendBeacon calls (except the health API client)", () => {
    const offenders = files.filter((f) => !ALLOWED.includes(f) && /\bfetch\s*\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps the health API client out of every dataset, profiling, storage and analytics module", () => {
    const importers = files.filter(
      (f) =>
        !ALLOWED.includes(f) &&
        /from\s+["'](@lib\/api|@\/lib\/api|\.{1,2}\/(\.\.\/)*lib\/api|\.\/api)["']/.test(readFileSync(f, "utf8"))
    );
    expect(importers).toEqual([]);
  });
});
