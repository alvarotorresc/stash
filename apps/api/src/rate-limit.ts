/**
 * Rate limiting hook. Same shape as the Workers Rate Limiting binding (`env.<BINDING>.limit`), so
 * the binding can be passed as is once configured in `wrangler.toml` (`[[ratelimits]]`, keyed by
 * account for `extract`). Whether that binding is available on the Free plan is not verified;
 * until it is wired, `allowAll` is used and the only limits are the session and the Workers quotas.
 */

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const allowAll: RateLimiter = {
  limit: async () => ({ success: true }),
};
