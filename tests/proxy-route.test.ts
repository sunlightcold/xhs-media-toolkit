import { describe, expect, it, vi } from "vitest";

import { handleProxyRequest } from "../src/routes/proxy-route.js";

describe("handleProxyRequest", () => {
  it("rejects non-GET requests", async () => {
    const response = await handleProxyRequest(
      new Request("https://worker.example/proxy", { method: "POST" }),
      new URL("https://worker.example/proxy"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: "Use GET /proxy?u=..." });
  });

  it("rejects missing target URLs", async () => {
    const response = await handleProxyRequest(
      new Request("https://worker.example/proxy"),
      new URL("https://worker.example/proxy"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing u parameter" });
  });

  it("prevents the proxy from being used for arbitrary hosts", async () => {
    const response = await handleProxyRequest(
      new Request("https://worker.example/proxy?u=https%3A%2F%2Fexample.com%2Fimage.jpg"),
      new URL("https://worker.example/proxy?u=https%3A%2F%2Fexample.com%2Fimage.jpg"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Host not allowed" });
  });

  it("rejects non-HTTPS media URLs", async () => {
    const response = await handleProxyRequest(
      new Request("https://worker.example/proxy?u=http%3A%2F%2Fci.xiaohongshu.com%2Fimage.jpg"),
      new URL("https://worker.example/proxy?u=http%3A%2F%2Fci.xiaohongshu.com%2Fimage.jpg"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Host not allowed" });
  });

  it("proxies allowed media hosts and forwards Range without Referer", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("media", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-3/10",
          "Set-Cookie": "session=private",
        },
      }),
    );
    const target = encodeURIComponent("https://sns-video-bd.xhscdn.com/video.mp4");
    const request = new Request(`https://worker.example/proxy?u=${target}`, {
      headers: {
        Range: "bytes=0-3",
        Referer: "https://site.example/private",
      },
    });

    const response = await handleProxyRequest(request, new URL(request.url), { fetchImpl });

    expect(response.status).toBe(206);
    expect(response.headers.get("X-Proxy-Source")).toBe("xhs-media-toolkit");
    expect(response.headers.has("Set-Cookie")).toBe(false);

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Range")).toBe("bytes=0-3");
    expect(headers.has("Referer")).toBe(false);
  });

  it("follows redirects only when the redirected media host is allowed", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: "https://sns-video-bd.xhscdn.com/redirected.mp4",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("media", {
          status: 200,
          headers: {
            "Content-Type": "video/mp4",
          },
        }),
      );
    const target = encodeURIComponent("https://sns-video-bd.xhscdn.com/video.mp4");
    const request = new Request(`https://worker.example/proxy?u=${target}`);

    const response = await handleProxyRequest(request, new URL(request.url), { fetchImpl });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://sns-video-bd.xhscdn.com/redirected.mp4");
  });

  it("rejects redirects to unsupported media hosts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          Location: "https://example.com/redirected.mp4",
        },
      }),
    );
    const target = encodeURIComponent("https://sns-video-bd.xhscdn.com/video.mp4");
    const request = new Request(`https://worker.example/proxy?u=${target}`);

    const response = await handleProxyRequest(request, new URL(request.url), { fetchImpl });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Host not allowed" });
  });

  it("returns a JSON error when the upstream request fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network failed"));
    const target = encodeURIComponent("https://sns-video-bd.xhscdn.com/video.mp4");
    const request = new Request(`https://worker.example/proxy?u=${target}`);

    const response = await handleProxyRequest(request, new URL(request.url), { fetchImpl });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Media proxy upstream request failed",
    });
  });
});
