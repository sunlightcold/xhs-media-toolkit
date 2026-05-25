const XHS_LINK_RE =
  /https?:\/\/(?:xhslink\.com|www\.xiaohongshu\.com)\/[^\s"'<>\\^`{|}，。；！？、【】《》]+/i;
const ALLOWED_PAGE_HOSTS = new Set(["xhslink.com", "www.xiaohongshu.com"]);
const MAX_PAGE_REDIRECTS = 5;

const PAGE_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 xiaohongshu",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=1.0,image/avif,image/webp,image/apng,*/*;q=0.8",
};

type JsonRecord = Record<string, unknown>;

export type MediaItemType = "image" | "video" | "livePhotoVideo";
export type MediaFileFormat =
  | "jpg"
  | "png"
  | "webp"
  | "gif"
  | "avif"
  | "heic"
  | "heif"
  | "mp4"
  | "m3u8"
  | "mov";

export interface MediaItem {
  type: MediaItemType;
  source: string;
  url: string;
  index?: number;
  rawUrl?: string;
  format?: MediaFileFormat;
  filenameExtension?: string;
}

export interface ExtractResult {
  shareUrl: string;
  finalNoteUrl: string;
  htmlFoundInitialState: boolean;
  noteCount: number;
  urlCount: number;
  urls: string[];
  mediaItems: MediaItem[];
}

export interface ExtractOptions {
  fetchImpl?: typeof fetch;
}

interface StreamEntry {
  masterUrl?: unknown;
  url?: unknown;
}

export async function extractOriginalUrlsFromShareText(
  shareText: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available.");
  }

  const shareUrl = extractShareUrl(shareText);
  if (!shareUrl) {
    throw new Error("No Xiaohongshu URL was found in the provided text.");
  }

  const { response: pageResponse, finalUrl } = await fetchAllowedPage(fetchImpl, shareUrl);

  const finalNoteUrl = finalUrl;
  if (!pageResponse.ok) {
    throw new Error(`Failed to fetch note page: HTTP ${pageResponse.status}`);
  }

  const html = await pageResponse.text();
  const state = parseInitialStateFromHtml(html);
  const notes = state ? findNoteObjects(state) : [];

  const mediaItems: MediaItem[] = [];
  for (const note of notes) {
    mediaItems.push(...extractMediaItemsFromNote(note));
  }

  const urls = dedupe(mediaItems.map((item) => item.url));

  return {
    shareUrl,
    finalNoteUrl,
    htmlFoundInitialState: Boolean(state),
    noteCount: notes.length,
    urlCount: urls.length,
    urls,
    mediaItems: dedupeMediaItems(mediaItems),
  };
}

export function extractShareUrl(shareText: string): string | null {
  if (!shareText || typeof shareText !== "string") return null;
  const match = shareText.match(XHS_LINK_RE);
  return match ? trimUrlPunctuation(match[0]) : null;
}

interface PageFetchResult {
  response: Response;
  finalUrl: string;
}

async function fetchAllowedPage(
  fetchImpl: typeof fetch,
  initialUrl: string,
): Promise<PageFetchResult> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_PAGE_REDIRECTS; redirectCount++) {
    assertAllowedPageUrl(currentUrl);

    const response = await fetchImpl(currentUrl, {
      headers: PAGE_HEADERS,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return {
        response,
        finalUrl: currentUrl,
      };
    }

    const location = response.headers.get("Location");
    if (!location) {
      return {
        response,
        finalUrl: currentUrl,
      };
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Too many redirects while fetching note page.");
}

function assertAllowedPageUrl(url: string): void {
  const parsed = tryParseUrl(url);
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    throw new Error("Invalid Xiaohongshu URL.");
  }

  if (!ALLOWED_PAGE_HOSTS.has(parsed.hostname)) {
    throw new Error(`Redirected to unsupported host: ${parsed.hostname}`);
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

export function parseInitialStateFromHtml(html: string): unknown {
  if (!html || typeof html !== "string") return null;

  const marker = "window.__INITIAL_STATE__";
  const start = html.indexOf(marker);
  if (start < 0) return null;

  const scriptEnd = html.indexOf("</script>", start);
  const scriptContent = html.slice(start, scriptEnd > start ? scriptEnd : undefined);
  const equalsIndex = scriptContent.indexOf("=");
  if (equalsIndex < 0) return null;

  const afterEquals = scriptContent.slice(equalsIndex + 1).trim();
  let objectLiteral = extractFirstJsObjectLiteral(afterEquals);
  if (!objectLiteral) return null;

  objectLiteral = replaceJsUndefinedWithNull(objectLiteral);
  return JSON.parse(objectLiteral);
}

export function findNoteObjects(root: unknown): JsonRecord[] {
  const notes: JsonRecord[] = [];
  const seen = new Set();

  const addNote = (note: unknown): void => {
    if (!isRecord(note)) return;
    if (!Object.keys(note).length) return;
    const key = note.noteId || note.id || JSON.stringify(Object.keys(note).sort());
    if (seen.has(key)) return;
    seen.add(key);
    notes.push(note);
  };

  const rootRecord = asRecord(root);
  const detailMap = asRecord(asRecord(rootRecord?.note)?.noteDetailMap);
  if (detailMap) {
    for (const entry of Object.values(detailMap)) {
      addNote(asRecord(entry)?.note || entry);
    }
  }

  const noteData = asRecord(asRecord(rootRecord?.noteData)?.data);
  addNote(noteData?.noteData);
  addNote(noteData?.note);

  const feedItems = asRecord(rootRecord?.feed)?.items;
  if (Array.isArray(feedItems)) {
    for (const item of feedItems) addNote(asRecord(item)?.note || item);
  }

  if (!notes.some(isLikelyNoteObject)) {
    for (const candidate of deepFindLikelyNoteObjects(root)) addNote(candidate);
  }

  return notes.filter(isLikelyNoteObject);
}

export function extractMediaItemsFromNote(note: JsonRecord): MediaItem[] {
  const items: MediaItem[] = [];

  const videoUrl = extractMainVideoUrl(asRecord(note.video));
  if (videoUrl) {
    items.push(createMediaItem({ type: "video", source: "video", url: videoUrl }));
  }

  const imageList = normalizeImageList(note);
  imageList.forEach((image, index) => {
    const imageUrl = selectBestImageUrl(image);
    if (imageUrl) {
      const originalImageUrl = toOriginalImageUrl(imageUrl);
      items.push(
        createMediaItem({
          type: "image",
          source: "imageList",
          index,
          url: originalImageUrl,
          rawUrl: imageUrl,
        }),
      );
    }

    const liveVideoUrl = extractLivePhotoVideoUrl(image);
    if (liveVideoUrl) {
      items.push(
        createMediaItem({
          type: "livePhotoVideo",
          source: "imageList.stream",
          index,
          url: liveVideoUrl,
        }),
      );
    }
  });

  return items;
}

export function toOriginalImageUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  if (!rawUrl.includes("xhscdn.com")) return rawUrl;
  if (rawUrl.includes("video") || rawUrl.includes("sns-video")) return rawUrl;

  const parsed = tryParseUrl(rawUrl);
  if (!parsed) return rawUrl;

  const pathname = parsed.pathname.replace(/^\/+/, "");
  const token = pathname.split(/[!?]/)[0] ?? "";

  // Display URLs often look like:
  // /202404121854/hash/token!nd_dft_wlteh_webp_3
  // The last segment is the stable media identifier accepted by ci.xiaohongshu.com.
  const segments = token.split("/").filter(Boolean);
  const mediaToken = segments.length >= 3 ? segments.slice(2).join("/") : token;
  return mediaToken ? `https://ci.xiaohongshu.com/${mediaToken}` : rawUrl;
}

export function inferMediaFileFormat(
  ...urls: Array<string | null | undefined>
): MediaFileFormat | null {
  for (const url of urls) {
    const format = inferMediaFileFormatFromUrl(url);
    if (format) return format;
  }

  return null;
}

function createMediaItem(item: Omit<MediaItem, "format" | "filenameExtension">): MediaItem {
  const format = inferMediaFileFormat(item.rawUrl, item.url);
  if (!format) {
    return item;
  }

  return {
    ...item,
    format,
    filenameExtension: toFilenameExtension(format),
  };
}

function inferMediaFileFormatFromUrl(url: string | null | undefined): MediaFileFormat | null {
  if (!url) return null;

  const decodedUrl = safeDecodeURIComponent(url).toLowerCase();
  const explicitFormat = matchExplicitFormatToken(decodedUrl);
  if (explicitFormat) return explicitFormat;

  const parsed = tryParseUrl(url);
  if (!parsed) return null;

  return matchExplicitFormatToken(
    `${parsed.pathname.toLowerCase()} ${parsed.search.toLowerCase()}`,
  );
}

function matchExplicitFormatToken(value: string): MediaFileFormat | null {
  const normalized = value.replace(/jpeg/g, "jpg");
  const extensionMatch = normalized.match(
    /\.(jpg|png|webp|gif|avif|heic|heif|mp4|m3u8|mov)(?:[/?#:]|$)/,
  );
  if (extensionMatch?.[1]) return extensionMatch[1] as MediaFileFormat;

  const formatSegmentMatch = normalized.match(
    /(?:format[=/_,-]?|\/format\/)(jpg|png|webp|gif|avif|heic|heif)/,
  );
  if (formatSegmentMatch?.[1]) return formatSegmentMatch[1] as MediaFileFormat;

  const xhsTransformMatch = normalized.match(
    /!(?:[^/?#]*?)(jpg|png|webp|gif|avif|heic|heif)(?:[_\d/?#-]|$)/,
  );
  if (xhsTransformMatch?.[1]) return xhsTransformMatch[1] as MediaFileFormat;

  return null;
}

function toFilenameExtension(format: MediaFileFormat): string {
  return format === "heif" ? "heif" : format;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function trimUrlPunctuation(url: string): string {
  return url.replace(/[),.;!?，。；！？、】》]+$/g, "");
}

function extractFirstJsObjectLiteral(input: string): string | null {
  const start = input.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }

  return null;
}

function replaceJsUndefinedWithNull(input: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }

    if (
      input.startsWith("undefined", i) &&
      !isIdentifierChar(input[i - 1]) &&
      !isIdentifierChar(input[i + "undefined".length])
    ) {
      out += "null";
      i += "undefined".length - 1;
      continue;
    }

    out += char;
  }

  return out;
}

function isIdentifierChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
}

function isLikelyNoteObject(obj: unknown): obj is JsonRecord {
  if (!isRecord(obj)) return false;
  return (
    Array.isArray(obj.imageList) ||
    Array.isArray(obj.images) ||
    Boolean(obj.image) ||
    Boolean(obj.video)
  );
}

function deepFindLikelyNoteObjects(root: unknown): JsonRecord[] {
  const found: JsonRecord[] = [];
  const stack = [root];
  const seen = new Set();

  while (stack.length && found.length < 5) {
    const current = stack.pop();
    if (!isObjectLike(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (isLikelyNoteObject(current)) found.push(current);

    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
    } else if (isRecord(current)) {
      for (const value of Object.values(current)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
  }

  return found;
}

function normalizeImageList(note: JsonRecord): JsonRecord[] {
  if (Array.isArray(note.imageList)) return note.imageList.filter(isRecord);
  if (Array.isArray(note.images)) return note.images.filter(isRecord);
  if (isRecord(note.image)) return [note.image];
  return [];
}

function selectBestImageUrl(image: JsonRecord): string | null {
  if (typeof image.urlDefault === "string") return image.urlDefault;
  if (typeof image.url === "string") return image.url;

  const infoList = Array.isArray(image.infoList) ? image.infoList.filter(isRecord) : [];
  const preferred = infoList.find((info) => {
    const scene = String(info?.imageScene || info?.scene || info?.type || "").toLowerCase();
    return /(origin|original|default|dft|wb_dft)/.test(scene) && typeof info?.url === "string";
  });
  const preferredUrl = preferred?.url;
  if (typeof preferredUrl === "string") return preferredUrl;

  const firstInfoUrl = infoList.find((info) => typeof info?.url === "string")?.url;
  if (typeof firstInfoUrl === "string") return firstInfoUrl;

  if (typeof image.traceId === "string") return `https://ci.xiaohongshu.com/${image.traceId}`;
  return null;
}

function extractMainVideoUrl(video: JsonRecord | null): string | null {
  if (!video) return null;

  const originVideoKey = asRecord(video.consumer)?.originVideoKey;
  if (typeof originVideoKey === "string") {
    return `https://sns-video-bd.xhscdn.com/${originVideoKey}`;
  }

  const stream = asRecord(asRecord(video.media)?.stream);
  for (const codec of ["h265", "h264", "h266", "av1"]) {
    const streamUrl = extractFirstStreamUrl(stream?.[codec]);
    if (streamUrl) return streamUrl;
  }

  return null;
}

function extractLivePhotoVideoUrl(image: JsonRecord): string | null {
  const stream = asRecord(image.stream);
  for (const codec of ["h264", "h265", "h266", "av1"]) {
    const streamUrl = extractFirstStreamUrl(stream?.[codec]);
    if (streamUrl) return streamUrl;
  }
  return null;
}

function extractFirstStreamUrl(streamArray: unknown): string | null {
  if (!Array.isArray(streamArray)) return null;
  for (const entry of streamArray) {
    if (typeof entry === "string" && entry.startsWith("http")) return entry;
    if (isStreamEntry(entry) && typeof entry.masterUrl === "string") return entry.masterUrl;
    if (isStreamEntry(entry) && typeof entry.url === "string") return entry.url;
  }
  return null;
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter(isString))];
}

function dedupeMediaItems(items: MediaItem[]): MediaItem[] {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return isObjectLike(value) && !Array.isArray(value);
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isStreamEntry(value: unknown): value is StreamEntry {
  return isRecord(value);
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
