# Changelog

## 1.2.0 — 2026-11-22

The package is renamed from `indreelforge` to **`post-upload`** (the product's new name). The `indreelforge` npm package is deprecated; this release is backward compatible with it.

### Changed
- npm package name `post-upload`; main class `PostUpload` (also the default export) and error class `PostUploadError`. `IndReelForge`, `InReelForge`, `IndReelForgeError` and `InReelForgeError` remain as deprecated aliases of the same classes. `err.name` is now `'PostUploadError'`.
- Default API address `https://api.post-upload.com`, MCP endpoint `https://api.post-upload.com/mcp`.
- CLI is `post-upload` (`npx -y post-upload mcp`), reading `POST_UPLOAD_API_KEY`, `POST_UPLOAD_MCP_URL` and `POST_UPLOAD_MCP_TIMEOUT_MS`, with the `INDREELFORGE_*` names as a fallback. An `indreelforge` bin is still installed.
- User-Agent is `post-upload-node/<version>`.

### Added
- Chunked uploads for videos up to 500 MB. `uploadVideo` sends local files and Buffers over 95 MiB (`CHUNKED_THRESHOLD_BYTES`) through `/api/upload/chunked/*` automatically (or always/never with `chunked: true | false`), reading the file one part at a time, retrying parts on 429 / 5xx / network errors with backoff and `Retry-After`, cancelling the session on failure, and reporting `onProgress`.
- `uploadLargeFile(source, options)` and the low-level `createUploadSession`, `uploadPart`, `completeUploadSession`, `getUploadSession` and `abortUploadSession`.
- `uploadVideo` accepts `stagedFileId`, a Buffer / stream as `video`, and the source as the first argument: `uploadVideo('./v.mp4', { user, platforms })`.
- `new PostUpload('api-key')` shorthand.
- Six platforms (22 in total): `devto`, `hashnode`, `lemmy`, `nostr`, `whop`, `listmonk`, in `Platform`, `PLATFORMS`, `PlatformCredentials` and `CREDENTIAL_PLATFORMS`.
- `data.skipped_platforms` (`SkippedPlatform[]`) and `data.error_message` in `UploadResponse`; `error_code` on `UploadWarning` (`platform_skipped`).
- `PostUploadError.retryAfter` (seconds from the `Retry-After` header).

## 1.1.0 (not published to npm)

- Typed methods for the full REST API, typed errors (`IndReelForgeError`), `npx indreelforge mcp` stdio bridge, Discord, Telegram, Slack, Mastodon and WordPress with `connectWithCredentials`.

## 1.0.1 / 1.0.0

- First releases on npm as `indreelforge`.
