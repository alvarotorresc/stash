const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function jsonData<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status, headers: BASE_HEADERS });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { ...BASE_HEADERS, ...headers } },
  );
}
