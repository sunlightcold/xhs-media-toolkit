import { errorResponse, jsonResponse } from "../http/responses.js";
import { extractOriginalUrlsFromShareText } from "../xhs/extractor.js";

interface ExtractRequestBody {
  shareText?: unknown;
  url?: unknown;
}

interface ExtractRouteOptions {
  fetchImpl?: typeof fetch;
}

export async function handleExtractRequest(
  request: Request,
  options: ExtractRouteOptions = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("Use POST /extract", 405);
  }

  let body: ExtractRequestBody;
  try {
    body = (await request.json()) as ExtractRequestBody;
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  try {
    const shareText = normalizeShareText(body);
    const result = await extractOriginalUrlsFromShareText(shareText, {
      fetchImpl: options.fetchImpl || fetch,
    });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error), 422);
  }
}

function normalizeShareText(body: ExtractRequestBody): string {
  if (typeof body.shareText === "string") return body.shareText;
  if (typeof body.url === "string") return body.url;
  return "";
}
