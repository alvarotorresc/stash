import {
  SENT_KEY_BYTES,
  fromBase64Url,
  toBase64Url,
  type SessionGrant,
} from '@stash/core/protocol';
import { readPepper, type AccountsEnv } from './env';
import { hashKey } from './hashing';

/**
 * Sessions last 30 days from the login, password change or recovery that created them and are
 * never extended, like the data key the device remembers. Logging in again starts a new one.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = SENT_KEY_BYTES;
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

/** The account behind a valid bearer token. */
export interface Session {
  readonly userId: string;
  /** Digest of the token; identifies this session in the database. */
  readonly tokenHash: string;
  readonly expiresAt: number;
}

export interface NewSession {
  readonly grant: SessionGrant;
  /** Statements that store the session; run them in a batch. */
  readonly statements: D1PreparedStatement[];
}

/**
 * A new opaque token of 256 random bits. Only its digest is stored, so a copy of the database
 * cannot be used to act as anyone. `onlyIf` makes the insert conditional on a SQL check.
 */
export async function newSession(
  db: D1Database,
  pepper: string,
  userId: string,
  now = Date.now(),
  onlyIf?: { sql: string; params: unknown[] },
): Promise<NewSession> {
  const token = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const tokenHash = await hashKey(pepper, 'session-token', token);
  const expiresAt = now + SESSION_TTL_MS;
  const values = [tokenHash, userId, expiresAt, now];
  const insert =
    onlyIf === undefined
      ? db
          .prepare(
            'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
          )
          .bind(...values)
      : db
          .prepare(
            `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
             SELECT ?, ?, ?, ? WHERE ${onlyIf.sql}`,
          )
          .bind(...values, ...onlyIf.params);
  return {
    grant: { token: toBase64Url(token), expiresAt },
    statements: [insert],
  };
}

/** Reads `Authorization: Bearer <token>` and returns its digest, or null when malformed. */
async function bearerTokenHash(request: Request, pepper: string): Promise<string | null> {
  const match = BEARER.exec(request.headers.get('Authorization') ?? '');
  if (match === null) return null;
  let token: Uint8Array;
  try {
    token = fromBase64Url(match[1] as string);
  } catch {
    return null;
  }
  return hashKey(pepper, 'session-token', token);
}

/**
 * The session behind the request's bearer token, or null when the header is missing or
 * malformed, the token is unknown (logged out, revoked or deleted with its account) or the
 * session has expired. Every account route takes the user id from here, never from the body.
 */
export async function resolveSessionFromRequest(
  request: Request,
  env: AccountsEnv,
  now = Date.now(),
): Promise<Session | null> {
  const tokenHash = await bearerTokenHash(request, readPepper(env));
  if (tokenHash === null) return null;
  const row = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?',
  )
    .bind(tokenHash, now)
    .first<{ user_id: string; expires_at: number }>();
  if (row === null) return null;
  return { userId: row.user_id, tokenHash, expiresAt: row.expires_at };
}
