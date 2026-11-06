import { API_PATHS, DEFAULT_KDF_PARAMS, type KdfParams } from '@stash/core/protocol';
import { jsonData, jsonError } from '../http';
import { readPepper, type AccountsEnv } from './env';
import { ApiError, unauthorized, validationError } from './errors';
import { NO_MATCH_DIGEST, digestsMatch, fakeSalt, hashKey } from './hashing';
import { accountCounterKeys, clientIp, enforceRateLimit, recordFailure } from './rate-limit';
import { newSession, resolveSessionFromRequest, type Session } from './sessions';
import {
  DELETE_ACCOUNT_STATEMENTS,
  findUserByEmail,
  findUserById,
  kdfOf,
  type UserRow,
} from './users';
import {
  accountSetup,
  email,
  passwordSetup,
  readJsonBody,
  sentKey,
  type ParsedPasswordSetup,
} from './validation';

interface Context {
  readonly request: Request;
  readonly env: AccountsEnv;
  readonly db: D1Database;
  readonly pepper: string;
  readonly now: number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Handler = (context: Context) => Promise<Response>;

/** Same answer for an unknown email and a wrong key, so login and recovery reveal nothing. */
function invalidCredentials(message: string, status: 401 | 403): ApiError {
  return new ApiError('INVALID_CREDENTIALS', message, status);
}

async function requireSession({ request, env, now }: Context): Promise<Session> {
  const session = await resolveSessionFromRequest(request, env, now);
  if (session === null) throw unauthorized();
  return session;
}

/** The session's account; a session whose account is gone counts as no session. */
async function requireUser(context: Context, session: Session): Promise<UserRow> {
  const user = await findUserById(context.db, session.userId);
  if (user === null) throw unauthorized();
  return user;
}

/**
 * Checks a key the client sent against the stored digest. With no account it still hashes the
 * key and compares against a digest that never matches, so both paths do the same work.
 */
async function keyMatches(
  pepper: string,
  purpose: 'login-key' | 'recovery-key',
  stored: string | undefined,
  key: Uint8Array,
): Promise<boolean> {
  const candidate = await hashKey(pepper, purpose, key);
  return digestsMatch(stored ?? NO_MATCH_DIGEST, candidate) && stored !== undefined;
}

/** Authenticated actions prove the password again with the current login key. */
async function proveLoginKey(context: Context, user: UserRow, key: Uint8Array): Promise<void> {
  if (!(await keyMatches(context.pepper, 'login-key', user.login_key_hash, key))) {
    throw invalidCredentials('Wrong password', 403);
  }
}

async function register(context: Context): Promise<Response> {
  const { request, db, pepper, now } = context;
  const body = await readJsonBody(request);
  const address = email(body.email);
  const keys = accountSetup(body.keys);
  await enforceRateLimit(db, pepper, 'register', { ip: clientIp(request) }, now);

  const id = crypto.randomUUID();
  const [loginKeyHash, recoveryKeyHash] = await Promise.all([
    hashKey(pepper, 'login-key', keys.loginKey),
    hashKey(pepper, 'recovery-key', keys.recoveryAuthKey),
  ]);
  const inserted = await db
    .prepare(
      `INSERT INTO users (id, email, salt, kdf_memory_kib, kdf_iterations, kdf_parallelism,
         login_key_hash, recovery_key_hash, wrapped_data_key, recovery_wrapped_data_key,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
    )
    .bind(
      id,
      address,
      keys.salt,
      keys.kdf.memoryKiB,
      keys.kdf.iterations,
      loginKeyHash,
      recoveryKeyHash,
      keys.wrappedDataKey,
      keys.recoveryWrappedDataKey,
      now,
      now,
    )
    .first<{ id: string }>();
  // Registration has to say the email is taken; rate limiting keeps that from scaling.
  if (inserted === null) {
    throw new ApiError('EMAIL_TAKEN', 'An account with this email already exists', 409);
  }

  const session = await newSession(db, pepper, id, now);
  await db.batch(session.statements);
  return jsonData({ session: session.grant }, 201);
}

async function prelogin(context: Context): Promise<Response> {
  const { request, db, pepper } = context;
  const address = email((await readJsonBody(request)).email);

  // Not counted in D1: it costs reads only and protects no secret. The fake salt is computed on both paths so an unknown email takes the same work.
  const [user, fake] = await Promise.all([findUserByEmail(db, address), fakeSalt(pepper, address)]);
  const kdf: KdfParams = user === null ? { ...DEFAULT_KDF_PARAMS } : kdfOf(user);
  return jsonData({ salt: user?.salt ?? fake, kdf });
}

async function login(context: Context): Promise<Response> {
  const { request, db, pepper, now } = context;
  const body = await readJsonBody(request);
  const address = email(body.email);
  const loginKey = sentKey(body.loginKey, 'loginKey');
  const subjects = { ip: clientIp(request), email: address };
  await enforceRateLimit(db, pepper, 'login', subjects, now);

  const user = await findUserByEmail(db, address);
  if (!(await keyMatches(pepper, 'login-key', user?.login_key_hash, loginKey)) || user === null) {
    await recordFailure(db, pepper, 'login', subjects, now);
    throw invalidCredentials('Wrong email or password', 401);
  }
  const session = await newSession(db, pepper, user.id, now);
  await db.batch(session.statements);
  return jsonData({ session: session.grant, wrappedDataKey: user.wrapped_data_key });
}

async function logout(context: Context): Promise<Response> {
  const session = await requireSession(context);
  await context.db
    .prepare('DELETE FROM sessions WHERE token_hash = ? AND user_id = ?')
    .bind(session.tokenHash, session.userId)
    .run();
  return jsonData({ ok: true });
}

async function getAccount(context: Context): Promise<Response> {
  const user = await requireUser(context, await requireSession(context));
  return jsonData({
    email: user.email,
    salt: user.salt,
    kdf: kdfOf(user),
    wrappedDataKey: user.wrapped_data_key,
    createdAt: user.created_at,
  });
}

/**
 * Replaces the password setup, proven with the current login key. The update only applies if
 * the stored digest is still the one that was checked, so two concurrent changes cannot both
 * win. With `revokeOtherSessions`, every other session of the account is closed in the same
 * transaction, and only when the update applied.
 */
async function replacePassword(
  context: Context,
  {
    revokeOtherSessions,
    check,
  }: {
    revokeOtherSessions: boolean;
    check?: (user: UserRow, keys: ParsedPasswordSetup) => void;
  },
): Promise<Response> {
  const { request, db, pepper, now } = context;
  const session = await requireSession(context);
  const body = await readJsonBody(request);
  const currentLoginKey = sentKey(body.currentLoginKey, 'currentLoginKey');
  const keys = passwordSetup(body.keys);
  await enforceRateLimit(db, pepper, 'proof', { account: session.userId }, now);

  const user = await requireUser(context, session);
  check?.(user, keys);
  await proveLoginKey(context, user, currentLoginKey);

  const newHash = await hashKey(pepper, 'login-key', keys.loginKey);
  const statements = [
    db
      .prepare(
        `UPDATE users SET salt = ?, kdf_memory_kib = ?, kdf_iterations = ?, login_key_hash = ?,
           wrapped_data_key = ?, updated_at = ?
         WHERE id = ? AND login_key_hash = ?`,
      )
      .bind(
        keys.salt,
        keys.kdf.memoryKiB,
        keys.kdf.iterations,
        newHash,
        keys.wrappedDataKey,
        now,
        user.id,
        user.login_key_hash,
      ),
  ];
  if (revokeOtherSessions) {
    statements.push(
      db
        .prepare(
          `DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2
             AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND login_key_hash = ?3)`,
        )
        .bind(user.id, session.tokenHash, newHash),
    );
  }
  const [update] = await db.batch(statements);
  if (update?.meta.changes !== 1) throw invalidCredentials('Wrong password', 403);
  return jsonData({ ok: true });
}

/** Password change: closes every other session of the account. */
function changePassword(context: Context): Promise<Response> {
  return replacePassword(context, { revokeOtherSessions: true });
}

/**
 * Argon2id parameter upgrade right after a login: same password, new salt and stronger
 * parameters. It must be strictly stronger, so this route cannot stand in for a password change
 * that keeps the other sessions open.
 */
function upgradeKdf(context: Context): Promise<Response> {
  return replacePassword(context, {
    revokeOtherSessions: false,
    check(user, { kdf }) {
      const current = kdfOf(user);
      const notWeaker = kdf.memoryKiB >= current.memoryKiB && kdf.iterations >= current.iterations;
      const stronger = kdf.memoryKiB > current.memoryKiB || kdf.iterations > current.iterations;
      if (!notWeaker || !stronger) {
        throw validationError('kdf must be stronger than the current parameters');
      }
    },
  });
}

/** Checks the recovery auth key for an email; an unknown email fails exactly like a wrong key. */
async function recoveryUser(context: Context, body: Record<string, unknown>): Promise<UserRow> {
  const { request, db, pepper, now } = context;
  const address = email(body.email);
  const recoveryAuthKey = sentKey(body.recoveryAuthKey, 'recoveryAuthKey');
  const subjects = { ip: clientIp(request), email: address };
  await enforceRateLimit(db, pepper, 'recovery', subjects, now);

  const user = await findUserByEmail(db, address);
  if (
    !(await keyMatches(pepper, 'recovery-key', user?.recovery_key_hash, recoveryAuthKey)) ||
    user === null
  ) {
    await recordFailure(db, pepper, 'recovery', subjects, now);
    throw invalidCredentials('Wrong email or recovery code', 401);
  }
  return user;
}

/** First step of a recovery: the recovery-wrapped data key, only for a valid recovery key. */
async function startRecovery(context: Context): Promise<Response> {
  const user = await recoveryUser(context, await readJsonBody(context.request));
  return jsonData({ recoveryWrappedDataKey: user.recovery_wrapped_data_key });
}

/**
 * Second step: checks the recovery key again, replaces the password and the recovery code,
 * closes every session of the account and opens a new one, all in one transaction. The update
 * only applies if the recovery digest is still the one that was checked, and the session
 * statements only take effect when it did.
 */
async function completeRecovery(context: Context): Promise<Response> {
  const { request, db, pepper, now } = context;
  const body = await readJsonBody(request);
  const keys = accountSetup(body.keys);
  const user = await recoveryUser(context, body);

  const [loginKeyHash, recoveryKeyHash] = await Promise.all([
    hashKey(pepper, 'login-key', keys.loginKey),
    hashKey(pepper, 'recovery-key', keys.recoveryAuthKey),
  ]);
  const applied = { sql: 'EXISTS (SELECT 1 FROM users WHERE id = ? AND recovery_key_hash = ?)' };
  const session = await newSession(db, pepper, user.id, now, {
    ...applied,
    params: [user.id, recoveryKeyHash],
  });
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE users SET salt = ?, kdf_memory_kib = ?, kdf_iterations = ?, login_key_hash = ?,
           recovery_key_hash = ?, wrapped_data_key = ?, recovery_wrapped_data_key = ?,
           updated_at = ?
         WHERE id = ? AND recovery_key_hash = ?`,
      )
      .bind(
        keys.salt,
        keys.kdf.memoryKiB,
        keys.kdf.iterations,
        loginKeyHash,
        recoveryKeyHash,
        keys.wrappedDataKey,
        keys.recoveryWrappedDataKey,
        now,
        user.id,
        user.recovery_key_hash,
      ),
    db
      .prepare(`DELETE FROM sessions WHERE user_id = ? AND ${applied.sql}`)
      .bind(user.id, user.id, recoveryKeyHash),
    ...session.statements,
  ]);
  if (update?.meta.changes !== 1) throw invalidCredentials('Wrong email or recovery code', 401);
  return jsonData({ session: session.grant });
}

/** Deletes the account and every row it owns, proven with the login key. */
async function deleteAccount(context: Context): Promise<Response> {
  const { request, db, pepper, now } = context;
  const session = await requireSession(context);
  const loginKey = sentKey((await readJsonBody(request)).loginKey, 'loginKey');
  await enforceRateLimit(db, pepper, 'proof', { account: session.userId }, now);

  const user = await requireUser(context, session);
  await proveLoginKey(context, user, loginKey);
  const counters = await accountCounterKeys(pepper, user.id, user.email);
  await db.batch([
    ...DELETE_ACCOUNT_STATEMENTS.map((sql) => db.prepare(sql).bind(user.id)),
    ...counters.map((key) => db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key)),
  ]);
  return jsonData({ ok: true });
}

const ROUTES: Record<string, Partial<Record<Method, Handler>>> = {
  [API_PATHS.register]: { POST: register },
  [API_PATHS.prelogin]: { POST: prelogin },
  [API_PATHS.login]: { POST: login },
  [API_PATHS.logout]: { POST: logout },
  [API_PATHS.recoveryStart]: { POST: startRecovery },
  [API_PATHS.recoveryComplete]: { POST: completeRecovery },
  [API_PATHS.account]: { GET: getAccount, DELETE: deleteAccount },
  [API_PATHS.password]: { PUT: changePassword },
  [API_PATHS.kdf]: { PUT: upgradeKdf },
};

/** Whether the path belongs to the account API: `/api/auth/*` and `/api/account*`. */
export function isAccountsPath(pathname: string): boolean {
  return pathname.startsWith('/api/auth/') || /^\/api\/account(\/|$)/.test(pathname);
}

export async function handleAccountsRequest(request: Request, env: AccountsEnv): Promise<Response> {
  const route = ROUTES[new URL(request.url).pathname];
  if (route === undefined) return jsonError('NOT_FOUND', 'Not found', 404);
  const handler = route[request.method as Method];
  if (handler === undefined) {
    return jsonError('METHOD_NOT_ALLOWED', 'Method not allowed', 405, {
      Allow: Object.keys(route).join(', '),
    });
  }
  try {
    return await handler({ request, env, db: env.DB, pepper: readPepper(env), now: Date.now() });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    // Only the error's name: messages could carry request data, which is never logged.
    console.error(`accounts: unexpected ${error instanceof Error ? error.name : 'error'}`);
    return jsonError('INTERNAL_ERROR', 'Something went wrong', 500);
  }
}
