/**
 * Argon2id benchmark for the phone (plan F1: under about 2 s on a modest Android).
 *
 * Run `pnpm --filter @stash/core bench` on the computer, then open the page on the phone:
 *
 * - Same network: http://<computer-ip>:5173. It only needs WebAssembly and
 *   crypto.getRandomValues, which also work on plain http.
 * - USB: `adb reverse tcp:5173 tcp:5173` and open http://localhost:5173 in Chrome on the phone.
 *   chrome://inspect on the computer shows its console.
 */
import { DEFAULT_KDF_PARAMS, SALT_BYTES, argon2id } from '../src/crypto/kdf';

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

  const password = new TextEncoder().encode('benchmark password');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const timings: number[] = [];
  // The first run also loads and compiles the WebAssembly module.
  for (let index = 0; index <= RUNS; index++) {
    const start = performance.now();
    await argon2id(password, salt, DEFAULT_KDF_PARAMS);
    const elapsed = performance.now() - start;
    if (index === 0) {
      log(`warm-up (includes loading): ${elapsed.toFixed(0)} ms`);
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
