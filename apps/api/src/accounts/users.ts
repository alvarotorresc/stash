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
 * Every statement that removes an account's rows, dependants first. Any table that stores rows
 * of an account (such as the encrypted records) must add its statement here, so deleting the
 * account removes everything in one batch, which D1 runs as a single transaction.
 */
export const DELETE_ACCOUNT_STATEMENTS = [
  'DELETE FROM sessions WHERE user_id = ?1',
  'DELETE FROM users WHERE id = ?1',
] as const;
