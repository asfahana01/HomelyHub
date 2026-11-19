let startupPromise;

export const startBackend = ({
  connect,
  startWorker,
  listen,
}) => {
  if (!startupPromise) {
    startupPromise = (async () => {
      await connect();
      await startWorker();
      return listen();
    })().catch((error) => {
      startupPromise = undefined;
      throw error;
    });
  }
  return startupPromise;
};
