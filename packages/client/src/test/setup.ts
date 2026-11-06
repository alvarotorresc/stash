import { vi } from 'vitest';
import { FastKdfWorker } from './fast-kdf-worker';

// Argon2id runs in a module Web Worker in the browser; jsdom has none, so every derivation goes
// through the fast stand-in. The rest of the key chain is the production code.
vi.stubGlobal('Worker', FastKdfWorker);
