import { createCorsHeaders, emptyCorsResponse, errorResponse, withCors } from "./http/responses.js";
import { handleExtractRequest } from "./routes/extract-route.js";
import { handleProxyRequest } from "./routes/proxy-route.js";

export interface Env {
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = createCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return emptyCorsResponse(corsHeaders);
    }

    const url = new URL(request.url);

    if (url.pathname === "/extract") {
      return withCors(await handleExtractRequest(request, { fetchImpl: fetch }), corsHeaders);
    }

    if (url.pathname === "/proxy") {
      return withCors(await handleProxyRequest(request, url, { fetchImpl: fetch }), corsHeaders);
    }

    return withCors(errorResponse("Not found", 404), corsHeaders);
  },
} satisfies ExportedHandler<Env>;
