import { toBase64Url } from '@stash/core/protocol';

/**
 * Stand-in for the Argon2id Web Worker, which neither Node nor jsdom can run: it answers with HKDF
 * over the password and salt, so tests stay fast while the rest of the key chain is the real one.
 */
export class FastKdfWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;

  postMessage({ password, salt }: { password: Uint8Array; salt: Uint8Array }): void {
    void (async () => {
      const material = new Uint8Array(password.length + salt.length);
      material.set(password);
      material.set(salt, password.length);
      const base = await crypto.subtle.importKey('raw', material, 'HKDF', false, [
        'deriveBits',
        'deriveKey',
      ]);
      const hkdf = (info: string) => ({
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: new TextEncoder().encode(info),
      });
      const sent = await crypto.subtle.deriveBits(hkdf('stash/v1/login-key'), base, 256);
      const kek = await crypto.subtle.deriveKey(
        hkdf('stash/v1/password-kek'),
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey'],
      );
      this.onmessage?.({ data: { ok: true, sentKey: toBase64Url(new Uint8Array(sent)), kek } });
    })();
  }

  terminate(): void {}
}
