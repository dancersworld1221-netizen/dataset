import type { AiChatMessage } from "@/types";

/**
 * In-memory cache of AI answers. Generating them costs quota and takes seconds, so leaving a page and coming
 * back (or switching between AI pages) must not throw them away. Results are keyed by dataset id AND dataset
 * version, so any change of the data (a new upload, a cleaning step) makes them stale automatically.
 */
type Kind = "insights" | "report";

const results = new Map<string, unknown>();
const chats = new Map<string, AiChatMessage[]>();

const key = (datasetId: string, version: string, kind: Kind) => `${datasetId}|${version}|${kind}`;

export const aiResultStore = {
  get<T>(datasetId: string, version: string, kind: Kind): T | undefined {
    return results.get(key(datasetId, version, kind)) as T | undefined;
  },

  set(datasetId: string, version: string, kind: Kind, value: unknown): void {
    // The app works on one dataset at a time: drop everything that belongs to another one.
    for (const k of [...results.keys()]) if (!k.startsWith(`${datasetId}|`)) results.delete(k);
    for (const k of [...chats.keys()]) if (k !== datasetId) chats.delete(k);
    results.set(key(datasetId, version, kind), value);
  },

  getChat(datasetId: string): AiChatMessage[] {
    return chats.get(datasetId) ?? [];
  },

  setChat(datasetId: string, history: AiChatMessage[]): void {
    for (const k of [...chats.keys()]) if (k !== datasetId) chats.delete(k);
    chats.set(datasetId, history);
  },

  clear(): void {
    results.clear();
    chats.clear();
  },
};
