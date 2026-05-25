const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Range",
  "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range,Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

interface CorsEnv {
  ALLOWED_ORIGINS?: string;
}

export function createCorsHeaders(request: Request, env: CorsEnv = {}): Headers {
  const headers = new Headers(BASE_CORS_HEADERS);
  const origin = request.headers.get("Origin");
  const allowedOrigins = resolveAllowedOrigins(request, env.ALLOWED_ORIGINS);

  if (!origin) {
    return headers;
  }

  if (isOriginAllowed(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin);
  }

  return headers;
}

export function emptyCorsResponse(corsHeaders: Headers): Response {
  const isAllowedPreflight = corsHeaders.has("Access-Control-Allow-Origin");

  return new Response(null, {
    status: isAllowedPreflight ? 204 : 403,
    headers: corsHeaders,
  });
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, { status });
}

export function withCors(response: Response, corsHeaders: Headers): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders.entries()) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function resolveAllowedOrigins(request: Request, configuredOrigins: string | undefined): string[] {
  const requestOrigin = new URL(request.url).origin;
  const configured = configuredOrigins?.trim()
    ? configuredOrigins
        .split(",")
        .map((origin) => normalizeOrigin(origin))
        .filter((origin): origin is string => origin.length > 0)
    : [];

  return [requestOrigin, ...configured];
}

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === "*") return true;
    if (allowedOrigin.endsWith(":*")) {
      return normalizedOrigin.startsWith(allowedOrigin.slice(0, -1));
    }
    return allowedOrigin === normalizedOrigin;
  });
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/g, "");
}
