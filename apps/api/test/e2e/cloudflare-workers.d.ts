/* The only part of `cloudflare:workers` these tests use, typed without the Workers types. */
declare module 'cloudflare:workers' {
  export const exports: {
    default: { fetch(request: Request): Promise<Response> };
  };
}
