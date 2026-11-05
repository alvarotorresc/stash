/**
 * Session middleware. Every private route goes through `requireSession`: without a valid session
 * it answers 401 and the handler never runs. Handlers read the session from their argument, never
 * from the request.
 */

import { jsonError } from '../http';

export interface Session {
  /** Opaque id of the account that owns the session. */
  accountId: string;
}

/** Resolves the session of a request (for example from its Bearer token), or null if none. */
export type SessionResolver = (request: Request) => Promise<Session | null>;

export type SessionHandler = (request: Request, session: Session) => Promise<Response>;

/**
 * Production resolver.
 *
 * TODO(F2): verify the session token once accounts and sessions exist. Until then it fails closed:
 * no request has a session, so every private route answers 401.
 */
export const resolveSession: SessionResolver = async () => null;

export function requireSession(
  resolve: SessionResolver,
  handler: SessionHandler,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let session: Session | null;
    try {
      session = await resolve(request);
    } catch (error) {
      // Fail closed with the JSON envelope instead of the platform error page. Only the error type
      // is reported: its message could carry a token or other request data.
      console.error('session: resolver failed', error instanceof Error ? error.name : typeof error);
      return jsonError('INTERNAL_ERROR', 'Internal error', 500);
    }
    if (!session) return jsonError('UNAUTHORIZED', 'Authentication required', 401);
    return handler(request, session);
  };
}
