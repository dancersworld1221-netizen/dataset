import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { DatasetProvider } from "@/context/DatasetProvider";
import { useDataset } from "@/hooks/useDataset";
import { closeDatabase } from "@/lib/storage/database";
import { datasetRepository } from "@/lib/storage/datasetRepository";
import { analysisCache } from "@/lib/analytics/cache";

/**
 * The cleaning workflow against the REAL provider and a real (fake) IndexedDB: whatever the cleaning pages show
 * afterwards (record counts, columns, statistics, quality report) and whatever survives a reload must describe
 * the cleaned rows, not the originally uploaded ones.
 */
const CSV = ["id,age,city,notes", "1,10,Baku,a", "2,,Baku,b", "3,30,Tehran,c", "3,30,Tehran,c", "4,abc,Tabriz,d", ""].join("\n");

let api: ReturnType<typeof useDataset>;
function Probe() {
  api = useDataset();
  return null;
}

beforeEach(async () => {
  await closeDatabase();
  globalThis.indexedDB = new IDBFactory();
  analysisCache.clear?.();
});
afterEach(() => cleanup());

async function load(csv = CSV, rows = 5) {
  render(
    <ToastProvider>
      <DatasetProvider>
        <Probe />
      </DatasetProvider>
    </ToastProvider>
  );
  await act(async () => {
    await api.processFile(new File([csv], "people.csv", { type: "text/csv" }));
  });
  await waitFor(() => expect(api.dataset?.recordCount).toBe(rows));
  await act(async () => {
    await api.loadRecords();
  });
  await waitFor(() => expect(api.records).not.toBeNull());
}

describe("cleaning keeps the dataset, its statistics and its storage consistent", () => {
  it("removing a column updates columns, profile and quality report, and is saved", async () => {
    await load();
    expect(api.dataset?.columns.map((c) => c.name)).toEqual(["id", "age", "city", "notes"]);

    await act(async () => {
      expect(await api.cleaning.executeMissingCleaning({ type: "remove_column", targetColumns: ["notes"], parameters: {} })).toBe(true);
    });

    expect(api.dataset?.columnCount).toBe(3);
    expect(api.dataset?.columns.map((c) => c.name)).toEqual(["id", "age", "city"]);
    expect(api.dataset?.profile?.columnMetadata.map((c) => c.name)).toEqual(["id", "age", "city"]);
    expect(Object.keys(api.records![0])).toEqual(["id", "age", "city"]);
    expect(api.dataset?.cleaningRevision).toBe(1);

    const stored = await datasetRepository.get(api.dataset!.id);
    expect(stored?.dataset.columnCount).toBe(3);
    expect(Object.keys(stored!.records[0])).toEqual(["id", "age", "city"]);
  });

  it("removing duplicates recalculates the row count everywhere and undo / redo move between versions", async () => {
    await load();
    await act(async () => {
      await api.cleaning.executeDuplicateRemoval({ type: "remove_duplicates", targetColumns: [], parameters: {} });
    });
    expect(api.dataset?.recordCount).toBe(4);
    expect(api.dataset?.profile?.totalRecords).toBe(4);
    expect(api.dataset?.profile?.duplicateRecords).toBe(0);
    expect((await datasetRepository.getRecords(api.dataset!.id))?.length).toBe(4);
    expect(api.cleaning.canUndo).toBe(true);

    await act(async () => {
      await api.cleaning.undo();
    });
    expect(api.dataset?.recordCount).toBe(5);
    expect((await datasetRepository.getRecords(api.dataset!.id))?.length).toBe(5);
    expect(api.cleaning.canRedo).toBe(true);

    await act(async () => {
      await api.cleaning.redo();
    });
    expect(api.dataset?.recordCount).toBe(4);
  });

  it("clearing invalid values then imputing leaves a complete numeric column", async () => {
    // Type inference tolerates a small share of bad cells, so the column needs enough valid numbers to stay "integer".
    const ages = [...Array.from({ length: 60 }, (_, i) => String(10 + (i % 10))), "abc", ""];
    // A second column keeps the row with the blank age from being read as an empty line.
    await load(["age,tag", ...ages.map((a) => `${a},x`)].join("\n") + "\n", ages.length);
    expect(api.dataset!.columns[0].dataType).toBe("integer");
    await act(async () => {
      await api.cleaning.executeTypeValidation({ type: "validate_type", targetColumns: ["age"], parameters: {} });
    });
    const age = () => api.dataset!.columns.find((c) => c.name === "age")!;
    expect(age().missingCount).toBe(2); // the original blank + the cleared "abc"
    expect(age().invalidCount).toBe(0);

    await act(async () => {
      await api.cleaning.executeMissingCleaning({ type: "impute_median", targetColumns: ["age"], parameters: {} });
    });
    expect(age().missingCount).toBe(0);
    expect(api.records!.every((r) => r.age !== "")).toBe(true);
    expect(api.records![60].age).toBe("14.5"); // median of the 60 valid ages (10..19, six times each)
  });

  it("a new upload starts with a clean cleaning session", async () => {
    await load();
    await act(async () => {
      await api.cleaning.executeMissingCleaning({ type: "remove_column", targetColumns: ["notes"], parameters: {} });
    });
    expect(api.cleaning.history).toHaveLength(1);

    await act(async () => {
      await api.processFile(new File(["x,y\n1,2\n"], "other.csv", { type: "text/csv" }));
    });
    await waitFor(() => expect(api.dataset?.filename).toBe("other.csv"));
    expect(api.cleaning.history).toHaveLength(0);
    expect(api.cleaning.canUndo).toBe(false);
  });

  it("an impossible operation fails with a message and changes nothing", async () => {
    await load();
    let ok = true;
    await act(async () => {
      ok = await api.cleaning.executeMissingCleaning({ type: "remove_column", targetColumns: ["id", "age", "city", "notes"], parameters: {} });
    });
    expect(ok).toBe(false);
    expect(api.cleaning.error).toMatch(/must remain/i);
    expect(api.dataset?.columnCount).toBe(4);
    expect(api.cleaning.history).toHaveLength(0);
  });
});
