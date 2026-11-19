const DEFAULT_INTERVAL_MS = 60 * 1000;

export const startRefundWorker = async ({ intervalMs, runOnce } = {}) => {
  const interval =
    Number(intervalMs ?? process.env.REFUND_WORKER_INTERVAL_MS) ||
    DEFAULT_INTERVAL_MS;
  const worker = await import("./refundService.js");
  const execute =
    runOnce ||
    (async () => {
      try {
        await worker.runRefundWorkerOnce();
      } catch (error) {
        console.error(
          "Refund reconciliation worker cycle failed:",
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    });

  await execute();
  return setInterval(execute, interval);
};
