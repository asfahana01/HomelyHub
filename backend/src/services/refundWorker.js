
import { runRefundWorkerOnce } from "./refundService.js";
import { logger } from "../utils/logger.js";

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
      logger.error("payment.refund_worker_cycle_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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
