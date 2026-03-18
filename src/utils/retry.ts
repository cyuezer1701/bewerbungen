import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryOn?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2,
    retryOn,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) break;

      if (retryOn && !retryOn(lastError)) {
        throw lastError;
      }

      const delay = Math.min(
        baseDelayMs * Math.pow(backoffFactor, attempt),
        maxDelayMs
      );
      const jitteredDelay = delay * (0.5 + Math.random() * 0.5);

      logger.warn(
        `Retry ${attempt + 1}/${maxRetries} after ${Math.round(jitteredDelay)}ms: ${lastError.message}`
      );

      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
    }
  }

  throw lastError;
}
