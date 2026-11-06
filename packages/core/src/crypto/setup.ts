import type { KdfParams } from './params';

/** What the server stores for the password. */
export interface PasswordSetup {
  readonly salt: string;
  readonly kdf: KdfParams;
  readonly loginKey: string;
  readonly wrappedDataKey: string;
}

/** What the server stores for the recovery code. */
export interface RecoverySetup {
  readonly recoveryAuthKey: string;
  readonly recoveryWrappedDataKey: string;
}
