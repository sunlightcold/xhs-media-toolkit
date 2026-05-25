import { errorResponse } from "../http/responses.js";

const PROXY_SOURCE = "xhs-media-toolkit";
const ALLOWED_IMAGE_HOST = "ci.xiaohongshu.com";
const ALLOWED_VIDEO_HOST_RE = /^sns-video-[a-z0-9-]+\.xhscdn\.com$/;
const MAX_PROXY_REDIRECTS = 5;

const MEDIA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,video/mp4,video/*,*/*;q=0.8",
} as const;

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

  if (!isAllowedMediaUrl(targetUrl)) {
    return errorResponse("Host not allowed", 403);
  }

  let upstream: Response;
  try {
    upstream = await fetchAllowedMedia(options.fetchImpl || fetch, targetUrl, request);
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

  return buildProxyResponse(upstream);
}

function parseTargetUrl(target: string): URL | null {
  try {
    return new URL(target);
  } catch {
    return null;
  }
}

function isAllowedMediaUrl(targetUrl: URL): boolean {
  if (targetUrl.protocol !== "https:") {
    return false;
  }

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

    const response = await fetchImpl(currentUrl.toString(), {
      method: "GET",
      headers: buildUpstreamHeaders(request),
      redirect: "manual",
    });

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

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function buildUpstreamHeaders(request: Request): Headers {
  const headers = new Headers(MEDIA_HEADERS);
  const range = request.headers.get("Range");

  if (range) {
    headers.set("Range", range);
  }

  return headers;
}

function buildProxyResponse(upstream: Response): Response {
  const headers = new Headers(upstream.headers);
  headers.set("X-Proxy-Source", PROXY_SOURCE);
  headers.set("Accept-Ranges", headers.get("Accept-Ranges") || "bytes");
  headers.delete("set-cookie");
  headers.delete("content-security-policy");
  headers.delete("cross-origin-resource-policy");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
