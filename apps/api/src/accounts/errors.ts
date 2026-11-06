import type { AccountErrorCode } from '@stash/core/protocol';
import { jsonError } from '../http';

/** An error that is safe to show: it becomes the `{ error }` envelope as is. */
export class ApiError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    readonly status: number,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toResponse(): Response {
    return jsonError(this.code, this.message, this.status, this.headers);
  }
}

export function validationError(message: string): ApiError {
  return new ApiError('VALIDATION_ERROR', message, 400);
}

export function unauthorized(): ApiError {
  return new ApiError('UNAUTHORIZED', 'Authentication required', 401);
}
