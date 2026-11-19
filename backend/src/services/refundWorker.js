import { runRefundWorkerOnce } from "./refundService.js";

const DEFAULT_INTERVAL_MS = 60 * 1000;
let workerInstance;

export const createRefundWorker = ({
  intervalMs = Number(process.env.REFUND_WORKER_INTERVAL_MS) ||
    DEFAULT_INTERVAL_MS,
  runOnce = runRefundWorkerOnce,
  schedule = setInterval,
} = {}) => {
  let running = false;
  let timer;

  const runCycle = async () => {
    if (running) return false;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      console.error(
        "Refund reconciliation worker cycle failed:",
        error instanceof Error ? error.message : "Unknown error"
      );
    } finally {
      running = false;
    }
    return true;
  };

  const start = async () => {
    if (timer) return timer;
    timer = schedule(() => {
      void runCycle();
    }, intervalMs);
    void runCycle();
    return timer;
  };

  return { runCycle, start };
};

export const startRefundWorker = async (options) => {
  if (!workerInstance) {
    workerInstance = createRefundWorker(options);
  }
  return workerInstance.start();
};
