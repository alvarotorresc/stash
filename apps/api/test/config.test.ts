import { describe, expect, it } from 'vitest';
import wranglerConfig from '../wrangler.toml?raw';

/** Top-level keys of the TOML file: the lines before the first `[table]` header. */
function topLevel(toml: string): string {
  const firstTable = toml.search(/^\[/m);
  return firstTable === -1 ? toml : toml.slice(0, firstTable);
}

describe('wrangler.toml', () => {
  it('should make every outbound fetch go through the public internet', () => {
    // Without this flag, requests to a zone of the same account reach its origin directly and skip
    // the Cloudflare security settings of that zone. It must be a top-level key: below a table
    // header TOML would assign it to that table and the flag would be silently lost.
    expect(topLevel(wranglerConfig)).toMatch(
      /^compatibility_flags\s*=\s*\[[^\]]*"global_fetch_strictly_public"[^\]]*\]/m,
    );
  });
});
