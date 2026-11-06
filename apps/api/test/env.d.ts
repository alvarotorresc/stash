/* Types of `cloudflare:workers` in the tests: `exports` are those of `src/index.ts`. */
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('../src/index');
  }
}

/* Vite raw imports, used to read configuration files from the tests. */
declare module '*?raw' {
  const content: string;
  export default content;
}
