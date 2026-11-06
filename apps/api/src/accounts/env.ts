/** Bindings and secrets the account routes need. */
export interface AccountsEnv {
  readonly DB: D1Database;
  /** Secret key for every HMAC the Worker computes. Set with `wrangler secret put PEPPER`. */
  readonly PEPPER?: string;
}

/** A pepper shorter than this is treated as missing: 32 characters of a random secret. */
const MIN_PEPPER_LENGTH = 32;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Fails closed: without a proper pepper no account route runs. */
export function readPepper(env: AccountsEnv): string {
  const pepper = env.PEPPER;
  if (typeof pepper !== 'string' || pepper.length < MIN_PEPPER_LENGTH) {
    throw new ConfigError('PEPPER is missing or too short');
  }
  return pepper;
}
