export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  initialDelayMs = 2000,
  backoffFactor = 2,
): Promise<T> {
  let lastError: unknown;
  let currentDelay = initialDelayMs;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`Retry attempt ${i + 1} failed with error: ${error}`);
      await new Promise((res) => setTimeout(res, currentDelay));
      currentDelay *= backoffFactor;
    }
  }
  throw lastError;
}
