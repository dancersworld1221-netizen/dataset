# Full review: bugs found and fixed

Typecheck, lint and all tests were green at the start, yet the app had many functional bugs that the tests did not cover
(they tested pieces, not the workflows). Every fix below has a test.

## Data cleaning (the largest problem area)
| # | Bug | Fix |
|---|-----|-----|
| 1 | Cleaned data was never saved: a reload brought back the original rows | Every apply / undo / redo / reset is saved to IndexedDB |
| 2 | Statistics, columns and quality report were never recalculated after cleaning; removing a column left a "ghost" column in Preview, Quality, Analysis and AI | The dataset is re-profiled after every change; undo/redo use cached snapshots |
| 3 | Preview "before" samples showed the already-cleaned values | Previews carry real cell-level changes (row, column, before, after) |
| 4 | Previews of "remove rows with missing values" / "remove column" showed nothing, but applying removed data | One code path now builds the preview and the result |
| 5 | The preview table showed the first column of each row instead of the cleaned column | New preview with changed cells, removed rows and removed columns |
| 6 | Duplicate detection was O(n²) (froze the tab on large files) | Single pass; only real duplicate groups are kept |
| 7 | Type validation could never find anything (it compared the inferred type with itself) and counted distinct values instead of cells | Checks cells against the column's type; new "clear invalid values" action |
| 8 | "Upload Dataset" button on the empty state did nothing | Navigates to /upload |
| 9 | Detection only ran after clicking a button; results went stale after each change | Runs automatically and after every change |
| 10 | Errors were never shown; click handlers could throw unhandled rejections | Errors are shown in the page; handlers catch |
| 11 | Undo history kept a full copy of every undone branch (memory leak) | Branches are released; unchanged rows are shared between versions |
| 12 | Mean imputation produced `3.3333333333333335` | Rounded to 12 significant digits, with a warning for integer columns |
| 13 | Cleaning state of an old dataset leaked into a new upload; a failed upload turned the loaded dataset's status to "error" | Cleaning session reset on upload / removal; status restored on failure |
| 14 | No way to export cleaned data (Dashboard promised "Clean and export") | Download CSV (UTF-8 BOM for Excel, formula-injection guard) |

## AI / Worker
| # | Bug | Fix |
|---|-----|-----|
| 1 | `GEMINI_API_KEY: ""` in `wrangler.jsonc` can overwrite the real secret on deploy | Removed; documented |
| 2 | Gemini 2.5 "thinking" tokens ate the 2048-token budget and long reports were truncated (broken JSON) | Thinking off for 2.5-flash, larger budgets, reports requested as Markdown, `finishReason` handled |
| 3 | Duplicate safety category; key in the URL | Fixed; key in the `x-goog-api-key` header |
| 4 | Context never contained correlations / outliers, so "relationship" questions could not be answered | Context is enriched with the analysis report |
| 5 | Chat flattened history into the prompt and could send two user turns in a row | Real alternating `contents`; failed question can be retried |
| 6 | Malformed context caused 500; unbounded body size; any website could call the endpoints | 400 validation, 256 KB limit, cross-site requests refused, context size bounded |
| 7 | One bad insight item failed the whole response | Items are validated individually |
| 8 | Results lost on navigation, no "Regenerate", no cancellation, quota wasted | Per-dataset-version cache, Regenerate, AbortController |
| 9 | Privacy text said "no raw data is sent" although top values were | Values only for low-cardinality text columns; wording corrected everywhere |
| 10 | Report had no timestamp although the prompt promised one; Markdown rendering was weak (blank paragraphs, no bold / tables) | Timestamp added; safe Markdown renderer shared by chat and report |

## UI / structure
Dashboard and Settings still said "Planned" for finished features; Cleaning route had no error boundary (route errors showed
React Router's raw screen); drawer stayed scroll-locked after resizing; new file showed the previous file's parse result;
"Remove Dataset" deleted without asking; the table's "#" column lost original row numbers when sorting/searching; tabs had no
keyboard navigation and overflowed on phones; clipboard / download helpers failed silently; the main bundle was 554 kB
(now 496 kB: Cleaning, Insights and Settings are lazy-loaded).

## Verified
`npm run typecheck`, `npm run lint` (0 warnings), `npm test` (736 tests), `npm run build`.
