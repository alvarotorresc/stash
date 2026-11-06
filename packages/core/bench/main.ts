/**
 * Argon2id benchmark for the phone (plan F1: under about 2 s on a modest Android).
 *
 * Run `pnpm --filter @stash/core bench` on the computer; the server only listens on localhost.
 * Then open the page on the phone:
 *
 * - USB (default): `adb reverse tcp:5173 tcp:5173` and open http://localhost:5173 in Chrome on
 *   the phone. chrome://inspect on the computer shows its console.
 * - Same network, on purpose and only while measuring: `pnpm --filter @stash/core bench --host`
 *   exposes the dev server, which can read workspace files, to the whole LAN. Open
 *   http://<computer-ip>:5173 and stop the server when done.
 */
import { derivePasswordKeysInWorker } from '../src/crypto/argon2-client';
import { DEFAULT_KDF_PARAMS, SALT_BYTES } from '../src/crypto/kdf';

const RUNS = 5;
const output = document.querySelector('#output') as HTMLPreElement;
const button = document.querySelector('#run') as HTMLButtonElement;

function log(line: string): void {
  output.textContent += `${line}\n`;
}

async function run(): Promise<void> {
  button.disabled = true;
  output.textContent = '';
  const { memoryKiB, iterations, parallelism } = DEFAULT_KDF_PARAMS;
  log(`m = ${memoryKiB / 1024} MiB, t = ${iterations}, p = ${parallelism}`);
  log(navigator.userAgent);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const timings: number[] = [];
  // Each run starts a fresh worker, as a real login does, so the timings include loading and
  // compiling the WebAssembly module. The first run also fills the HTTP cache.
  for (let index = 0; index <= RUNS; index++) {
    const password = new TextEncoder().encode('benchmark password');
    const start = performance.now();
    await derivePasswordKeysInWorker({ password, salt, params: DEFAULT_KDF_PARAMS });
    const elapsed = performance.now() - start;
    if (index === 0) {
      log(`warm-up (fills the cache): ${elapsed.toFixed(0)} ms`);
    } else {
      timings.push(elapsed);
      log(`run ${index}: ${elapsed.toFixed(0)} ms`);
    }
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] as number;
  log(`median: ${median.toFixed(0)} ms, worst: ${(sorted.at(-1) as number).toFixed(0)} ms`);
  button.disabled = false;
}

button.addEventListener('click', () => {
  run().catch((error: unknown) => {
    log(`error: ${String(error)}`);
    button.disabled = false;
  });
});
