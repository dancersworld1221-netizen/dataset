import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/common/Markdown";
import { parseMarkdown } from "@/lib/markdown";

describe("Markdown renderer", () => {
  it("parses headings, lists, tables and rules into blocks, without empty paragraphs", () => {
    const blocks = parseMarkdown("# Title\n\nSome text\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n---\n");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "ul", "ol", "table", "rule"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", text: "Some text second line" });
    expect(blocks[4]).toEqual({ kind: "table", header: ["x", "y"], rows: [["1", "2"]] });
  });

  it("renders bold, italic and code inline", () => {
    render(<Markdown markdown={"**bold** and *soft* and `code`"} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("soft").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });

  it("never turns model or dataset text into HTML", () => {
    const { container } = render(<Markdown markdown={'<img src=x onerror="alert(1)"> <script>alert(1)</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});
