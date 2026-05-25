# 贡献指南

感谢你愿意改进 `xhs-media-toolkit`。这个项目刻意保持小而清晰，并且非常重视安全边界。贡献时请让 Worker 专注在公开页面响应中已有媒体元数据的提取，不要扩展到绕过、爬取或账号自动化方向。

## 维护范围

本仓库只维护：

- `src/worker.ts` 中的 Cloudflare Worker 入口。
- `src/http/` 中的 HTTP 响应辅助逻辑。
- `src/routes/` 中的 Worker 路由。
- `src/xhs/` 中的小红书提取逻辑。
- `scripts/extract.ts` 中的本地 CLI。
- 本地演示页和相关说明文档。

请不要加入绕过登录、验证码、权限控制、付费墙、风控或私有内容边界的逻辑。

## 环境准备

```powershell
pnpm install
pnpm run verify
```

## 本地开发

```powershell
pnpm run extract -- "<分享文本或笔记 URL>"
pnpm run worker:dev
```

提交 Pull Request 前请运行：

```powershell
pnpm run format
pnpm run verify
```

## 拉取请求要求

- 保持改动聚焦，并清楚说明行为变化。
- 修改公开 API 行为时，同步更新 `README.md` 和 `USAGE.md`。
- 修改解析、路由、CORS 或 `/proxy` 域名白名单时，补充或更新测试。
- 不提交 `node_modules/`、`.wrangler/`、构建产物、本地环境文件或任何密钥。
- 保持 `/proxy` 的域名白名单限制，不要把它改成通用开放代理。

## 提交问题

反馈问题时，请提供使用的命令或接口、预期行为、实际行为，以及最小化且已脱敏的输入。不要在公开问题中包含私有 Token、Cookie、账号信息，或你无权分享的内容。
