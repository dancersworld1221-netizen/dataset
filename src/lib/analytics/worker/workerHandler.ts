import { AnalysisEngine } from "../engine";
import { AnalysisCancelledError } from "../types";
import type { FromWorkerMessage, ToWorkerMessage } from "./protocol";

/**
 * Message handler of the analysis worker, kept separate from the worker entry file so the exact same
 * protocol can be exercised in tests without a real Worker.
 *
 * Cancellation is cooperative: long analyses yield to the event loop between units of work, which is
 * when `cancel` messages are delivered and noticed.
 */
export function createWorkerHandler(post: (message: FromWorkerMessage) => void): (message: ToWorkerMessage) => void {
  const engine = new AnalysisEngine();
  const cancelled = new Set<number>();

  return (message) => {
    switch (message.type) {
      case "load":
        engine.load(message.dataset);
        post({ type: "loaded", loadId: message.loadId });
        return;
      case "unload":
        engine.unload();
        return;
      case "cancel":
        cancelled.add(message.requestId);
        return;
      case "run": {
        const { requestId } = message;
        if (engine.datasetKey !== message.datasetKey) {
          post({ type: "error", requestId, message: "The dataset changed while the analysis was queued.", cancelled: true });
          return;
        }
        void engine
          .run(message.request, {
            isCancelled: () => cancelled.has(requestId),
            yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)),
          })
          .then((result) => post({ type: "result", requestId, result }))
          .catch((error: unknown) => {
            const wasCancelled = error instanceof AnalysisCancelledError;
            post({
              type: "error",
              requestId,
              message: error instanceof Error ? error.message : "Analysis failed",
              cancelled: wasCancelled,
            });
          })
          .finally(() => cancelled.delete(requestId));
        return;
      }
    }
  };
}
