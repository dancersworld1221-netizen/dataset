import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import { DatasetProvider } from "@/context/DatasetProvider";
import { Cleaning } from "@/pages/Cleaning";
import { useDataset } from "@/hooks/useDataset";
import { closeDatabase } from "@/lib/storage/database";

const ages = Array.from({ length: 40 }, (_, i) => String(20 + (i % 5)));
ages[3] = "";
ages[10] = "";
const CSV = ["age,city", ...ages.map((a, i) => `${a},c${i % 4}`)].join("\n") + "\n";
const slow = { timeout: 10000 };

let api: ReturnType<typeof useDataset>;
function Probe() {
  api = useDataset();
  return null;
}
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderPage() {
  render(
    <ToastProvider>
      <DatasetProvider>
        <Probe />
        <MemoryRouter initialEntries={["/cleaning"]}>
          <Where />
          <Routes>
            <Route path="/cleaning" element={<Cleaning />} />
            <Route path="/upload" element={<div>upload page</div>} />
          </Routes>
        </MemoryRouter>
      </DatasetProvider>
    </ToastProvider>
  );
}

beforeEach(async () => {
  await closeDatabase();
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => cleanup());

describe("Cleaning page", { timeout: 30000 }, () => {
  it("without a dataset, the empty-state button really goes to the upload page", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Upload Dataset" }));
    expect(await screen.findByText("upload page")).toBeInTheDocument();
  });

  it("detects problems by itself, previews the exact cell changes and applies them", async () => {
    renderPage();
    await act(async () => {
      await api.processFile(new File([CSV], "people.csv", { type: "text/csv" }));
    });

    // Nothing has to be clicked for the counts to appear.
    await waitFor(() => expect(screen.getByText("Missing cells").nextElementSibling).toHaveTextContent("2"), slow);

    fireEvent.click(screen.getByRole("tab", { name: "Missing Values" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill with median" }));

    const dialog = await screen.findByRole("dialog", {}, slow);
    expect(within(dialog).getByText(/Changed cells/)).toBeInTheDocument();
    // Row 4 and row 11 are the blank ages; both become the median (22).
    expect(within(dialog).getAllByText("(empty)")).toHaveLength(2);
    expect(within(dialog).getAllByText("“22”")).toHaveLength(2);

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(api.dataset?.columns.find((c) => c.name === "age")?.missingCount).toBe(0), slow);
    await waitFor(() => expect(screen.getByText("Missing cells").nextElementSibling).toHaveTextContent("0"), slow);

    // Undo is available in the header and brings the blanks back.
    const undo = screen.getByRole("button", { name: /Undo$/ });
    await waitFor(() => expect(undo).toBeEnabled(), slow); // enabled again once saving has finished
    fireEvent.click(undo);
    await waitFor(() => expect(api.dataset?.columns.find((c) => c.name === "age")?.missingCount).toBe(2), slow);
  });

  it("exports the cleaned rows as a CSV download", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), "blob:x"), revokeObjectURL: vi.fn() }));
    renderPage();
    await act(async () => {
      await api.processFile(new File([CSV], "people.csv", { type: "text/csv" }));
    });
    const button = await screen.findByRole("button", { name: /Download CSV/ }, slow);
    await waitFor(() => expect(button).toBeEnabled(), slow);
    fireEvent.click(button);
    expect(created).toHaveLength(1);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]);
    });
    expect(text.replace("\ufeff", "").startsWith("age,city")).toBe(true);
    vi.unstubAllGlobals();
  });
});
