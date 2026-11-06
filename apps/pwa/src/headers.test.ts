import { describe, expect, it } from 'vitest';
import headers from '../public/_headers?raw';

/** The directives of the Content-Security-Policy served for every path. */
function csp(): Map<string, string> {
  const line = headers.split('\n').find((row) => row.trim().startsWith('Content-Security-Policy:'));
  const value = line?.split(':').slice(1).join(':') ?? '';
  return new Map(
    value
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name ?? '', sources.join(' ')]),
  );
}

describe('security headers of the PWA', () => {
  it('should apply to every path', () => {
    expect(headers.split('\n')[0]).toBe('/*');
  });

  it('should only allow the app itself to run code, style and connect', () => {
    const policy = csp();

    expect(policy.get('default-src')).toBe("'self'");
    expect(policy.get('script-src')).toBe("'self' 'wasm-unsafe-eval'");
    expect(policy.get('style-src')).toBe("'self'");
    expect(policy.get('connect-src')).toBe("'self'");
    expect(policy.get('img-src')).toBe("'self' blob: data:");
    expect(policy.get('object-src')).toBe("'none'");
    expect(policy.get('base-uri')).toBe("'none'");
    expect(policy.get('frame-ancestors')).toBe("'none'");
  });

  it('should send the companion headers', () => {
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toMatch(/Strict-Transport-Security: max-age=\d+/);
  });
});
