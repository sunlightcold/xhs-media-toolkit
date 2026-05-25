import { errorResponse } from "../http/responses.js";

const PROXY_SOURCE = "xhs-media-toolkit";
const ALLOWED_IMAGE_HOST = "ci.xiaohongshu.com";
const ALLOWED_VIDEO_HOST_RE = /^sns-video-[a-z0-9-]+\.xhscdn\.com$/;
const XHS_PUBLIC_REFERER = "https://www.xiaohongshu.com/";
const MAX_PROXY_REDIRECTS = 5;

const MEDIA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 xiaohongshu",
  Accept: "image/avif,image/webp,image/apng,image/*,video/mp4,video/*,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
} as const;

const UPSTREAM_HEADER_PROFILES = [
  { origin: "https://www.xiaohongshu.com", referer: XHS_PUBLIC_REFERER },
  { referer: XHS_PUBLIC_REFERER },
  {},
] as const;

interface ProxyRouteOptions {
  fetchImpl?: typeof fetch;
}

class ProxyRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function handleProxyRequest(
  request: Request,
  url: URL,
  options: ProxyRouteOptions = {},
): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse("Use GET /proxy?u=...", 405);
  }

  const target = url.searchParams.get("u");
  if (!target) {
    return errorResponse("Missing u parameter", 400);
  }

  const targetUrl = parseTargetUrl(target);
  if (!targetUrl) {
    return errorResponse("Invalid target URL", 400);
  }

  const normalizedTargetUrl = normalizeAllowedMediaUrl(targetUrl);
  if (!normalizedTargetUrl) {
    return errorResponse("Host not allowed", 403);
  }

  let upstream: Response;
  try {
    upstream = await fetchAllowedMedia(options.fetchImpl || fetch, normalizedTargetUrl, request);
  } catch (error) {
    if (error instanceof ProxyRouteError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Media proxy upstream request failed", 502);
  }

  if (!upstream.ok) {
    return errorResponse(
      `Media proxy upstream failed with HTTP ${upstream.status}`,
      upstream.status,
    );
  }

  return buildProxyResponse(upstream, normalizedTargetUrl);
}

function parseTargetUrl(target: string): URL | null {
  try {
    return new URL(target);
  } catch {
    return null;
  }
}

function normalizeAllowedMediaUrl(targetUrl: URL): URL | null {
  if (!isAllowedMediaHost(targetUrl)) return null;
  if (targetUrl.protocol === "https:") return targetUrl;
  if (targetUrl.protocol !== "http:") return null;

  const upgradedUrl = new URL(targetUrl);
  upgradedUrl.protocol = "https:";
  return upgradedUrl;
}

function isAllowedMediaUrl(targetUrl: URL): boolean {
  return Boolean(normalizeAllowedMediaUrl(targetUrl));
}

function isAllowedMediaHost(targetUrl: URL): boolean {
  return (
    targetUrl.hostname === ALLOWED_IMAGE_HOST || ALLOWED_VIDEO_HOST_RE.test(targetUrl.hostname)
  );
}

async function fetchAllowedMedia(
  fetchImpl: typeof fetch,
  initialUrl: URL,
  request: Request,
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_PROXY_REDIRECTS; redirectCount++) {
    if (!isAllowedMediaUrl(currentUrl)) {
      throw new ProxyRouteError("Host not allowed", 403);
    }

    const response = await fetchMediaWithFallbackHeaders(fetchImpl, currentUrl, request);

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("Location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, currentUrl);
  }

  throw new ProxyRouteError("Media proxy upstream redirected too many times", 508);
}

async function fetchMediaWithFallbackHeaders(
  fetchImpl: typeof fetch,
  currentUrl: URL,
  request: Request,
): Promise<Response> {
  let blockedResponse: Response | null = null;

  for (const profile of UPSTREAM_HEADER_PROFILES) {
    const response = await fetchImpl(currentUrl.toString(), {
      method: "GET",
      headers: buildUpstreamHeaders(request, currentUrl, profile),
      redirect: "manual",
    });

    if (response.status !== 401 && response.status !== 403) {
      return response;
    }

    blockedResponse = response;
  }

  return blockedResponse || errorResponse("Media proxy upstream request failed", 502);
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function buildUpstreamHeaders(
  request: Request,
  targetUrl: URL,
  profile: (typeof UPSTREAM_HEADER_PROFILES)[number],
): Headers {
  const headers = new Headers(MEDIA_HEADERS);
  const range = request.headers.get("Range");

  if ("origin" in profile && profile.origin) {
    headers.set("Origin", profile.origin);
  }

  if ("referer" in profile && profile.referer) {
    headers.set("Referer", profile.referer);
  }

  if (range) {
    headers.set("Range", range);
  } else if (isVideoMediaUrl(targetUrl)) {
    headers.set("Range", "bytes=0-");
  }

  return headers;
}

function isVideoMediaUrl(targetUrl: URL): boolean {
  return (
    ALLOWED_VIDEO_HOST_RE.test(targetUrl.hostname) ||
    /\.(mp4|mov|m4v)(?:$|[?#])/i.test(targetUrl.pathname)
  );
}

function buildProxyResponse(upstream: Response, targetUrl: URL): Response {
  const headers = new Headers(upstream.headers);
  headers.set("X-Proxy-Source", PROXY_SOURCE);
  headers.set("Accept-Ranges", headers.get("Accept-Ranges") || "bytes");
  headers.set("Cache-Control", headers.get("Cache-Control") || "public, max-age=3600");
  headers.set("Content-Disposition", headers.get("Content-Disposition") || "inline");
  headers.delete("set-cookie");
  headers.delete("content-security-policy");
  headers.delete("cross-origin-resource-policy");

  headers.set("Content-Type", resolveMediaContentType(headers.get("Content-Type"), targetUrl));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function resolveMediaContentType(contentType: string | null, targetUrl: URL): string {
  const pathname = targetUrl.pathname.toLowerCase();
  const normalizedContentType = contentType?.trim().toLowerCase() || "";

  if (
    pathname.endsWith(".mp4") ||
    (targetUrl.hostname.startsWith("sns-video-") &&
      (!normalizedContentType || normalizedContentType.startsWith("text/plain")))
  ) {
    return "video/mp4";
  }

  if (contentType?.trim()) return contentType;

  if (pathname.endsWith(".mov")) return "video/quicktime";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
