/**
 * Errors that the MCP layer is allowed to retry: Atlas loads and saves asynchronously, so a tool
 * that arrives mid-load is not a user error and must not surface as one.
 */
export class RetryableSceneError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'RetryableSceneError';
  }
}

export function isRetryable(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { retryable?: boolean }).retryable === true;
}
