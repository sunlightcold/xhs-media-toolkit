import { describe, expect, it } from "vitest";

import {
  extractOriginalUrlsFromShareText,
  extractMediaItemsFromNote,
  extractShareUrl,
  inferMediaFileFormat,
  parseInitialStateFromHtml,
  toOriginalImageUrl,
} from "../src/xhs/extractor.js";

describe("extractShareUrl", () => {
  it("extracts Xiaohongshu URLs from copied share text", () => {
    const result = extractShareUrl(
      "标题 http://xhslink.com/o/abc123 复制后打开【小红书】查看笔记！",
    );

    expect(result).toBe("http://xhslink.com/o/abc123");
  });

  it("trims trailing Chinese punctuation from URLs", () => {
    const result = extractShareUrl("https://www.xiaohongshu.com/explore/abc123。");

    expect(result).toBe("https://www.xiaohongshu.com/explore/abc123");
  });

  it("ignores unrelated URLs", () => {
    expect(extractShareUrl("https://example.com/post/1")).toBeNull();
  });
});

describe("extractOriginalUrlsFromShareText", () => {
  it("follows redirects between allowed Xiaohongshu hosts", async () => {
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      const requestUrl = String(url);
      if (requestUrl.startsWith("http://xhslink.com")) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "https://www.xiaohongshu.com/explore/abc123",
          },
        });
      }

      return new Response(
        `<script>window.__INITIAL_STATE__ = {"noteData":{"data":{"note":{"imageList":[{"traceId":"media-token"}]}}}};</script>`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        },
      );
    };

    const result = await extractOriginalUrlsFromShareText("http://xhslink.com/o/abc123", {
      fetchImpl,
    });

    expect(result.finalNoteUrl).toBe("https://www.xiaohongshu.com/explore/abc123");
    expect(result.urls).toEqual(["https://ci.xiaohongshu.com/media-token"]);
  });

  it("rejects redirects to unsupported hosts", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(null, {
        status: 302,
        headers: {
          Location: "https://example.com/private",
        },
      });

    await expect(
      extractOriginalUrlsFromShareText("http://xhslink.com/o/abc123", { fetchImpl }),
    ).rejects.toThrow("Redirected to unsupported host: example.com");
  });
});

describe("parseInitialStateFromHtml", () => {
  it("parses the first initial state object and normalizes undefined values", () => {
    const html = `
      <html>
        <script>
          window.__INITIAL_STATE__ = {"note":{"value":undefined,"title":"demo"}};
        </script>
      </html>
    `;

    expect(parseInitialStateFromHtml(html)).toEqual({
      note: {
        value: null,
        title: "demo",
      },
    });
  });
});

describe("media extraction", () => {
  it("converts xhscdn display image URLs to ci.xiaohongshu.com original URLs", () => {
    const rawUrl = "https://sns-webpic-qc.xhscdn.com/20240501/hash/media-token!h5_1080jpg";

    expect(toOriginalImageUrl(rawUrl)).toBe("https://ci.xiaohongshu.com/media-token");
  });

  it("extracts image and live photo video media items from a note", () => {
    const items = extractMediaItemsFromNote({
      imageList: [
        {
          urlDefault: "https://sns-webpic-qc.xhscdn.com/20240501/hash/media-token!h5_1080jpg",
          stream: {
            h264: [{ masterUrl: "https://sns-video-bd.xhscdn.com/live-photo.mp4" }],
          },
        },
      ],
    });

    expect(items).toEqual([
      {
        type: "image",
        source: "imageList",
        index: 0,
        url: "https://ci.xiaohongshu.com/media-token",
        rawUrl: "https://sns-webpic-qc.xhscdn.com/20240501/hash/media-token!h5_1080jpg",
        format: "jpg",
        filenameExtension: "jpg",
      },
      {
        type: "livePhotoVideo",
        source: "imageList.stream",
        index: 0,
        url: "https://sns-video-bd.xhscdn.com/live-photo.mp4",
        format: "mp4",
        filenameExtension: "mp4",
      },
    ]);
  });

  it("prefers browser-playable MP4 streams over HLS master playlists", () => {
    const items = extractMediaItemsFromNote({
      video: {
        media: {
          stream: {
            h264: [
              {
                masterUrl: "https://sns-video-bd.xhscdn.com/video.m3u8",
                url: "https://sns-video-bd.xhscdn.com/video.mp4",
              },
            ],
          },
        },
      },
    });

    expect(items[0]?.url).toBe("https://sns-video-bd.xhscdn.com/video.mp4");
    expect(items[0]?.format).toBe("mp4");
  });

  it("upgrades extracted Xiaohongshu media URLs from HTTP to HTTPS", () => {
    const items = extractMediaItemsFromNote({
      video: {
        media: {
          stream: {
            h264: [{ url: "http://sns-video-bd.xhscdn.com/video.mp4?sign=abc" }],
          },
        },
      },
    });

    expect(items[0]?.url).toBe("https://sns-video-bd.xhscdn.com/video.mp4?sign=abc");
  });

  it("infers common image and video formats from URLs", () => {
    expect(inferMediaFileFormat("https://example.com/a.webp")).toBe("webp");
    expect(inferMediaFileFormat("https://example.com/video.mp4?token=1")).toBe("mp4");
    expect(inferMediaFileFormat("https://example.com/image!h5_1080jpg")).toBe("jpg");
  });
});
