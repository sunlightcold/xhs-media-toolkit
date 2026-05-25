# xhs-media-toolkit 使用说明

这个 Worker 提供两个接口：

- `/extract`：从小红书分享文本或笔记 URL 中提取媒体原始地址。
- `/proxy`：代理受限的小红书图片和视频媒体域名，避免你的网页 Referer 暴露给上游 CDN。

请只用于你有权访问和保存的内容。这个 Worker 只读取公开页面响应里已有的媒体元数据，不绕过登录、验证码、权限控制或付费墙。

在线演示页：[https://sunlightcold.github.io/xhs-media-toolkit/](https://sunlightcold.github.io/xhs-media-toolkit/)

## 1. Worker 地址

本文示例用 `<WORKER_BASE>` 代表你的 Worker 地址。本地开发时通常是：

```text
<WORKER_BASE> = http://127.0.0.1:8787
```

## 1.1 跨域 Origin 配置

默认不配置时，Worker 只允许同源浏览器请求，不会对任意跨域页面回传 `Access-Control-Allow-Origin`。如果需要让 GitHub Pages、本地演示页或自己的站点调用 Worker，可以在 `wrangler.toml` 中设置 `ALLOWED_ORIGINS` 白名单，例如：

```toml
[vars]
ALLOWED_ORIGINS = "https://sunlightcold.github.io,http://127.0.0.1:8787,http://localhost:8787"
```

需要新增域名时，修改 `wrangler.toml` 的 `ALLOWED_ORIGINS`，使用英文逗号分隔。删除或留空 `ALLOWED_ORIGINS` 时不会开放所有 Origin，只会保留同源浏览器请求。CORS 不是完整鉴权方案，如果 Worker 被公开部署，仍建议结合 Cloudflare WAF、速率限制或额外鉴权做更强防护。

## 2. 提取原图地址

接口：

```http
POST /extract
Content-Type: application/json
```

请求体：

```json
{
  "shareText": "小红书分享文本或笔记 URL"
}
```

`shareText` 可以是完整复制出来的分享文案，也可以只是干净 URL，例如：

```text
https://www.xiaohongshu.com/explore/<note-id>?xsec_token=...
```

### PowerShell 调用

```powershell
$body = @{
  shareText = "https://www.xiaohongshu.com/explore/<note-id>?xsec_token=..."
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "<WORKER_BASE>/extract" `
  -ContentType "application/json" `
  -Body $body
```

### JavaScript 调用

```js
async function extractXhsUrls(shareText) {
  const workerBase = "<WORKER_BASE>";
  const response = await fetch(`${workerBase}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareText }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Extract failed: ${response.status}`);
  }

  return response.json();
}
```

### 返回格式

成功时返回：

```json
{
  "shareUrl": "https://www.xiaohongshu.com/explore/...",
  "finalNoteUrl": "https://www.xiaohongshu.com/discovery/item/...",
  "htmlFoundInitialState": true,
  "noteCount": 1,
  "urlCount": 12,
  "urls": ["https://ci.xiaohongshu.com/notes_pre_post/..."],
  "mediaItems": [
    {
      "type": "image",
      "source": "imageList",
      "index": 0,
      "url": "https://ci.xiaohongshu.com/notes_pre_post/...",
      "rawUrl": "http://sns-webpic-qc.xhscdn.com/...!h5_1080jpg",
      "format": "jpg",
      "filenameExtension": "jpg"
    }
  ]
}
```

常用字段：

- `urls`：去重后的媒体地址列表，前端通常用这个就够了。
- `mediaItems`：包含类型、序号、原始展示 URL、推断格式等信息。下载命名时优先使用 `filenameExtension`，避免把 WebP/PNG/视频统一保存成 JPG。
- `finalNoteUrl`：短链或 `/explore/` 链接重定向后的最终笔记页。
- `htmlFoundInitialState`：是否在页面 HTML 中找到了 `window.__INITIAL_STATE__`。

## 3. 代理显示媒体

接口：

```http
GET /proxy?u=<URL_ENCODED_MEDIA_URL>
```

`u` 参数必须是 URL 编码后的 `https:` 媒体地址。Worker 只允许代理下面这些小红书媒体域名，防止接口变成开放代理：

- `ci.xiaohongshu.com`
- `sns-video-*.xhscdn.com`

视频播放通常会发送 `Range` 请求头，Worker 会转发该头，并在 CORS 中允许 `Range`。

HTML 示例：

```html
<img
  src="<WORKER_BASE>/proxy?u=https%3A%2F%2Fci.xiaohongshu.com%2Fnotes_pre_post%2F1040g3k031vt7ufte3q505qen7snstbka2san378"
  referrerpolicy="no-referrer"
  alt=""
/>

<video
  src="<WORKER_BASE>/proxy?u=https%3A%2F%2Fsns-video-bd.xhscdn.com%2F..."
  controls
  playsinline
></video>
```

JavaScript 拼接方式：

```js
function buildProxyUrl(mediaUrl) {
  const workerBase = "<WORKER_BASE>";
  return `${workerBase}/proxy?u=${encodeURIComponent(mediaUrl)}`;
}
```

## 4. 代理下载媒体

推荐用 `fetch -> Blob -> ObjectURL`，这样可以控制文件名，也不会依赖浏览器对跨域 `download` 属性的兼容性。

```js
async function downloadViaWorker(mediaUrl, filename = "xhs-media.bin") {
  const workerBase = "<WORKER_BASE>";
  const proxyUrl = `${workerBase}/proxy?u=${encodeURIComponent(mediaUrl)}`;

  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(objectUrl);
}
```

## 5. 本地演示页

仓库里已经有一个静态演示页：

```text
public/index.html
```

可以直接双击打开。它会调用你在页面里填写的 Worker 地址，并展示提取结果、图片预览和下载按钮。

也可以使用本地静态服务打开：

```powershell
pnpm run demo
```

## 6. GitHub Pages 部署

仓库已提供 GitHub Actions 配置：`.github/workflows/pages.yml`。它会发布 `public/` 目录作为 GitHub Pages 演示页。

GitHub Pages 只负责部署静态演示页，不会部署 Cloudflare Worker。可以通过仓库变量 `WORKER_BASE_URL` 给页面注入默认 Worker 地址；如果没有配置，页面会使用仓库内的默认 Worker 地址。

当前演示页地址：[https://sunlightcold.github.io/xhs-media-toolkit/](https://sunlightcold.github.io/xhs-media-toolkit/)

首次使用时，需要在 GitHub 仓库设置中启用 Pages，并将构建来源选择为 `GitHub Actions`：

```text
Settings -> Pages -> Build and deployment -> Source -> GitHub Actions
```

启用后，推送到 `main` 会自动运行 `Pages` 工作流，也可以在 GitHub Actions 页面手动运行 `Pages` 工作流重新部署。

如果要让 Pages 自动填入 Worker 地址，在 GitHub 仓库设置里新增变量：

```text
Settings -> Secrets and variables -> Actions -> Variables -> New repository variable
Name: WORKER_BASE_URL
Value: https://<your-worker-domain>
```

修改变量后，重新运行 `Pages` 工作流即可生效。Worker 也需要把 Pages 所在 Origin 加入 `ALLOWED_ORIGINS`，例如 `https://sunlightcold.github.io`。

提交代码仍然使用：

```powershell
git add .
git commit -m "chore: update project"
git push origin main
```

如果修改了演示页，推送到 `main` 后会自动重新部署 `public/index.html`。

## 7. 常见问题

### `/extract` 返回 `No Xiaohongshu URL was found`

说明传入的 `shareText` 里没有识别到 `xhslink.com` 或 `www.xiaohongshu.com` 链接。请确认复制的是完整分享文本或笔记 URL。

### `/extract` 返回 `htmlFoundInitialState: false`

说明 Worker 拿到的页面 HTML 里没有 `window.__INITIAL_STATE__`。常见原因：

- 该笔记需要登录或触发风控。
- 链接过期或 `xsec_token` 失效。
- 小红书页面结构变更。

### `/extract` 返回空数组

说明页面状态解析到了，但没有找到 `imageList`、`video` 或可识别的媒体字段。可以查看返回的 `mediaItems` 和 Worker 日志进一步判断。

### `/proxy` 返回 403

常见原因：

- `u` 不是允许的小红书图片或视频媒体域名。
- 媒体地址已经失效。
- 上游 CDN 临时拒绝或限流。

### 媒体能显示但下载失败

优先使用本文的 `fetch -> Blob -> ObjectURL` 方式下载。不要只依赖：

```html
<a href="跨域媒体地址" download>下载</a>
```

跨域场景下浏览器可能忽略 `download` 属性。

## 8. 重新部署

修改 Worker 代码后，在目录下执行：

```powershell
pnpm run worker:deploy
```

部署成功后，Cloudflare 会输出当前版本 ID 和 Worker 地址。
