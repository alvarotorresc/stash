/* Types of `cloudflare:workers` in the tests: `exports` are those of `src/index.ts`. */
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('../src/index');
  }
}
