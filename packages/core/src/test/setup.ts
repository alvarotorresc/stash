import { vi } from 'vitest';

// Every test derives password keys through the real worker client, with the worker's handler
// running in-process (see InProcessWorker). Tests of the client itself call vi.unmock.
vi.mock('../crypto/argon2-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crypto/argon2-client')>();
  const { InProcessWorker } = await import('./in-process-worker');
  return {
    ...actual,
    derivePasswordKeysInWorker: actual.createPasswordKeyDeriver(() => new InProcessWorker()),
  };
});
