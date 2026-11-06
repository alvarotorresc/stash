import type { KdfParams } from '@stash/core/protocol';

export interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly salt: string;
  readonly kdf_memory_kib: number;
  readonly kdf_iterations: number;
  readonly login_key_hash: string;
  readonly recovery_key_hash: string;
  readonly wrapped_data_key: string;
  readonly recovery_wrapped_data_key: string;
  readonly created_at: number;
}

const COLUMNS = `id, email, salt, kdf_memory_kib, kdf_iterations, login_key_hash, recovery_key_hash,
  wrapped_data_key, recovery_wrapped_data_key, created_at`;

export function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`).bind(email).first<UserRow>();
}

export function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
}

export function kdfOf(row: Pick<UserRow, 'kdf_memory_kib' | 'kdf_iterations'>): KdfParams {
  return {
    algorithm: 'argon2id',
    memoryKiB: row.kdf_memory_kib,
    iterations: row.kdf_iterations,
    parallelism: 1,
  };
}

/**
 * Every statement that deletes an account, run in one batch, which D1 runs as a single
 * transaction. The account stops existing at once: its user row (with the wrapped data keys),
 * its sessions and its record counts go, and a tombstone keeps its id from ever being used
 * again. Its records are left to the daily sweep, which purges a bounded number per run (see
 * `sweep.ts`): deleting them here could write a whole account of rows at once. Until then no
 * session can reach them and they stay encrypted under a key nobody holds any more. Any new table
 * of a small, bounded number of rows per account adds its statement here; one that can grow with
 * the account is purged by the sweep instead.
 */
export const DELETE_ACCOUNT_STATEMENTS = [
  'INSERT INTO deleted_users (id) VALUES (?1)',
  'DELETE FROM record_counts WHERE user_id = ?1',
  'DELETE FROM sessions WHERE user_id = ?1',
  'DELETE FROM users WHERE id = ?1',
] as const;
