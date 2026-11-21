/// Entry point of the analysis Web Worker. It only wires `postMessage` to the shared handler.
import { createWorkerHandler } from "./workerHandler";
import type { FromWorkerMessage, ToWorkerMessage } from "./protocol";

const scope = self as unknown as {
  postMessage: (message: FromWorkerMessage) => void;
  onmessage: ((event: MessageEvent<ToWorkerMessage>) => void) | null;
};

const handle = createWorkerHandler((message) => scope.postMessage(message));
scope.onmessage = (event) => handle(event.data);
