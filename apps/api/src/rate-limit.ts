/**
 * Rate limiting hook of the extraction routes. Same shape as the Workers Rate Limiting binding
 * (`env.<BINDING>.limit`). Production uses the D1 counters of `accounts/rate-limit.ts`
 * (`createExtractRateLimiter`): a limit per account and a global daily cap.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
