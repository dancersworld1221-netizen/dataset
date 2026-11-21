import { Fragment, type ReactNode } from "react";
import { cn } from "@lib/utils";
import { parseMarkdown } from "@/lib/markdown";

/**
 * Small, safe Markdown renderer for AI output: headings, paragraphs, bullet and numbered lists, tables,
 * block quotes, rules, **bold**, *italic*, `code`. It builds React elements only (never HTML strings), so
 * model output or dataset values can never inject markup.
 */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== "");
  return parts.map((part, i) => {
    if ((part.startsWith("**") && part.endsWith("**") && part.length > 4) || (part.startsWith("__") && part.endsWith("__") && part.length > 4)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if ((part.startsWith("*") && part.endsWith("*") && part.length > 2) || (part.startsWith("_") && part.endsWith("_") && part.length > 2)) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-6 mb-3 text-2xl font-bold",
  2: "mt-6 mb-2 text-xl font-semibold",
  3: "mt-5 mb-2 text-lg font-semibold",
  4: "mt-4 mb-1 text-base font-semibold",
  5: "mt-3 mb-1 text-sm font-semibold",
  6: "mt-3 mb-1 text-sm font-medium",
};

export function Markdown({ markdown, className }: { markdown: string; className?: string }) {
  const blocks = parseMarkdown(markdown);
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-foreground", className)} dir="auto">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(block.level, 6)}` as "h1";
            return (
              <Tag key={i} className={cn("text-foreground", HEADING_CLASS[block.level])}>
                {renderInline(block.text)}
              </Tag>
            );
          }
          case "paragraph":
            return <p key={i}>{renderInline(block.text)}</p>;
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 ps-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 ps-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-s-4 border-border ps-3 text-muted-foreground">
                {renderInline(block.text)}
              </blockquote>
            );
          case "rule":
            return <hr key={i} className="border-border" />;
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-start">
                      {block.header.map((h, j) => (
                        <th key={j} scope="col" className="px-3 py-2 text-start font-semibold">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-2">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
