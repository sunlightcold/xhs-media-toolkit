import { describe, expect, it } from "vitest";

import { createCorsHeaders, emptyCorsResponse } from "../src/http/responses.js";

describe("createCorsHeaders", () => {
  it("allows same-origin browser requests when ALLOWED_ORIGINS is not configured", () => {
    const request = new Request("https://worker.example/extract", {
      headers: {
        Origin: "https://worker.example",
      },
    });

    const headers = createCorsHeaders(request, {});

    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://worker.example");
    expect(headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Range");
  });

  it("does not allow cross-origin browser requests by default", () => {
    const request = new Request("https://worker.example/extract", {
      headers: {
        Origin: "https://attacker.example",
      },
    });

    const headers = createCorsHeaders(request, {});

    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("allows origins configured by ALLOWED_ORIGINS", () => {
    const request = new Request("https://worker.example/extract", {
      headers: {
        Origin: "http://localhost:3000",
      },
    });

    const headers = createCorsHeaders(request, {
      ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
    });

    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("rejects cross-origin preflight requests when ALLOWED_ORIGINS is not configured", () => {
    const request = new Request("https://worker.example/extract", {
      headers: {
        Origin: "https://example.com",
      },
    });

    const response = emptyCorsResponse(createCorsHeaders(request, {}));

    expect(response.status).toBe(403);
  });

  it("rejects preflight requests when ALLOWED_ORIGINS is configured and the origin is not allowed", () => {
    const request = new Request("https://worker.example/extract", {
      headers: {
        Origin: "https://example.com",
      },
    });

    const response = emptyCorsResponse(
      createCorsHeaders(request, {
        ALLOWED_ORIGINS: "http://localhost:3000",
      }),
    );

    expect(response.status).toBe(403);
  });
});
