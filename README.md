# xhs-media-toolkit

`xhs-media-toolkit` 是一个 Cloudflare Worker / TypeScript 项目，也提供本地 CLI，用于从小红书分享文本或笔记 URL 中提取公开页面响应里已经存在的媒体元数据。

本项目有明确边界：不绕过登录、验证码、付费墙、权限控制、风控或任何私有内容边界。请只用于你有权访问和保存的内容。

## 功能

- 从小红书分享文本、`xhslink.com` 短链或 `www.xiaohongshu.com` 笔记 URL 中提取媒体地址。
- 返回结构化的 `mediaItems`，包含媒体类型、来源、推断格式和文件扩展名。
- 提供受限的 `/proxy` 接口，只代理允许的小红书图片和视频媒体域名。
- 代理媒体时不向上游 CDN 转发你的网站 `Referer`。
- 页面请求和重定向只允许小红书相关页面域名。
- 支持本地 CLI 调试和 Cloudflare Worker 部署。

## 非目标

- 不处理登录、Cookie、Token、验证码、付费墙或风控绕过。
- 不访问私有或未授权内容。
- 不提供通用开放代理。
- 不做账号自动化或爬虫框架。

## 环境要求

- Node.js `>=22.0.0`
- pnpm `>=10.0.0`
- Cloudflare Wrangler

## 快速开始

```powershell
pnpm install
pnpm run verify
```

运行本地 CLI：

```powershell
pnpm run extract -- "https://www.xiaohongshu.com/explore/..."
```

也可以传入完整分享文案：

```powershell
pnpm run extract -- "标题 http://xhslink.com/o/abc123 复制后打开【小红书】查看笔记！"
```

打开本地演示页：

```powershell
pnpm run demo
```

GitHub Pages 演示页会发布 `public/` 目录。Pages 只托管静态演示页，不部署 Worker；可以通过仓库变量 `WORKER_BASE_URL` 给页面注入默认 Worker 地址。

## Worker 本地开发

```powershell
pnpm run worker:dev
```

本地调用 `/extract`：

```powershell
$body = @{ shareText = "https://www.xiaohongshu.com/explore/..." } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/extract" -ContentType "application/json" -Body $body
```

## API

### `POST /extract`

请求体：

```json
{
  "shareText": "小红书分享文本或笔记 URL"
}
```

成功响应示例：

```json
{
  "shareUrl": "https://www.xiaohongshu.com/explore/...",
  "finalNoteUrl": "https://www.xiaohongshu.com/discovery/item/...",
  "htmlFoundInitialState": true,
  "noteCount": 1,
  "urlCount": 1,
  "urls": ["https://ci.xiaohongshu.com/notes_pre_post/..."],
  "mediaItems": [
    {
      "type": "image",
      "source": "imageList",
      "index": 0,
      "url": "https://ci.xiaohongshu.com/notes_pre_post/...",
      "rawUrl": "https://sns-webpic-qc.xhscdn.com/...!h5_1080jpg",
      "format": "jpg",
      "filenameExtension": "jpg"
    }
  ]
}
```

### `GET /proxy?u=<URL_ENCODED_MEDIA_URL>`

`/proxy` 只允许代理 `https:` 协议下的以下媒体域名：

- `ci.xiaohongshu.com`
- `sns-video-*.xhscdn.com`

示例：

```html
<img
  src="https://your-worker.example.workers.dev/proxy?u=https%3A%2F%2Fci.xiaohongshu.com%2Fnotes_pre_post%2F..."
  referrerpolicy="no-referrer"
  alt=""
/>
```

## 配置

默认只允许同源浏览器请求，不会对任意跨域页面回传 `Access-Control-Allow-Origin`。如果需要让 GitHub Pages、本地演示页或自己的站点调用 Worker，需要在 `wrangler.toml` 或 Cloudflare Worker 环境变量中配置 `ALLOWED_ORIGINS`，多个 Origin 使用英文逗号分隔。

```toml
[vars]
ALLOWED_ORIGINS = "https://<your-pages-origin>,http://127.0.0.1:8787,http://localhost:8787"
```

CORS 只能防止普通浏览器页面直接跨域调用你的 Worker，不能阻止服务端脚本、命令行或恶意代理转发请求。如果要做更强的滥用防护，请结合 Cloudflare WAF、速率限制或额外鉴权。

## 质量检查

```powershell
pnpm run verify
```

CI 会在推送和拉取请求时执行同样的检查。

## 项目结构

```text
src/worker.ts          Worker 入口
src/http/              HTTP 和 CORS 响应辅助逻辑
src/routes/            Worker 路由处理
src/xhs/               小红书提取逻辑
scripts/extract.ts     本地 CLI 入口
tests/                 单元测试
public/index.html      GitHub Pages 和本地演示页
```

## 参与贡献

提交问题或拉取请求前，请先阅读 `CONTRIBUTING.md` 和 `SECURITY.md`。

如果修改了公开接口行为，请同步更新 `README.md` 和 `USAGE.md`。

## 许可证

MIT
