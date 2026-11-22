# Post-Upload — Node.js SDK & MCP bridge

[![npm version](https://img.shields.io/npm/v/post-upload.svg)](https://www.npmjs.com/package/post-upload)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Official Node.js SDK for the [Post-Upload](https://post-upload.com) Social Media API. Publish videos, photos, text and documents to **22 platforms** with a single API call: **Instagram, YouTube, TikTok, Facebook, X (Twitter), LinkedIn, Threads, Pinterest, Reddit, Bluesky, Google Business Profile, Discord, Telegram, Slack, Mastodon, WordPress, Dev.to, Hashnode, Lemmy, Nostr, Whop & Listmonk**.

Videos up to **500 MB** are supported: files over 95 MiB are sent automatically in parts through the chunked upload API.

The package also ships `npx post-upload mcp`, a zero-dependency stdio bridge that connects AI agents (Claude Desktop, Cursor and other MCP clients) to the hosted Post-Upload MCP server.

> **Renamed from `indreelforge`.** This package was published on npm as [`indreelforge`](https://www.npmjs.com/package/indreelforge), which is deprecated and gets no further updates. Switch with `npm uninstall indreelforge && npm install post-upload` and change your imports from `'indreelforge'` to `'post-upload'`. The old class names (`IndReelForge`, `InReelForge`, `IndReelForgeError`, `InReelForgeError`) are still exported as deprecated aliases of `PostUpload` / `PostUploadError`, and the `INDREELFORGE_*` environment variables are still read by the CLI, so nothing else has to change. See [Migrating from `indreelforge`](#migrating-from-indreelforge).

## Installation

```bash
npm install post-upload
```

Requires Node.js 18 or newer (uses the built-in `fetch`, `FormData` and `Blob`). No runtime dependencies.

## Quick start

```typescript
import PostUpload from 'post-upload';

const client = new PostUpload(process.env.POST_UPLOAD_API_KEY!);

const result = await client.uploadVideo('./my-video.mp4', {
  user: 'my-profile',
  platforms: ['instagram', 'tiktok', 'youtube'],
  title: 'Check out this video!',
});

console.log(result.data.upload_id);
```

CommonJS works too: `const { PostUpload } = require('post-upload');`

## Configuration

```typescript
const client = new PostUpload({
  apiKey: 'your-api-key',                  // Required. Dashboard → API Keys
  baseUrl: 'https://api.post-upload.com',  // Optional (default)
  timeout: 120000,                         // Optional, ms (default 120 s; chunk uploads get at least 300 s)
  fetch: customFetch,                      // Optional, custom fetch implementation
  headers: { 'X-Trace': 'abc' },           // Optional, extra headers on every request
  retryBaseDelayMs: 1000,                  // Optional, first retry delay for chunked-upload steps
});

// Or just the key (plus optional options):
const client2 = new PostUpload('your-api-key', { timeout: 60000 });
```

Every request sends `Authorization: Apikey <key>` and `User-Agent: post-upload-node/<version>`.

## Publishing

### Common upload options

All `upload*` methods accept:

| Option | API field | Description |
|---|---|---|
| `user` | `user` | Profile name (required) |
| `platforms` | `platform[]` | `instagram`, `youtube`, `tiktok`, `facebook`, `x`, `linkedin`, `threads`, `pinterest`, `reddit`, `bluesky`, `google_business`, `discord`, `telegram`, `slack`, `mastodon`, `wordpress`, `devto`, `hashnode`, `lemmy`, `nostr`, `whop`, `listmonk` (also exported as `PLATFORMS`) |
| `title` | `title` | Title / caption |
| `description` | `description` | Long description |
| `firstComment` | `first_comment` | First comment |
| `schedule` | `schedule` | ISO-8601 datetime to publish later |
| `timezone` | `timezone` | IANA timezone for `schedule` |
| `addToQueue` | `add_to_queue` | Put the post in the profile's next free queue slot |
| `asyncUpload` | `async_upload` | `false` = wait (up to ~50 s) for the publish result |
| `requestId` | `request_id` | Your own correlation id (see `getRequestStatus`) |
| `idempotencyKey` | `Idempotency-Key` header | Retries with the same key never double-post |
| `platformOptions` | any | Platform-specific fields, sent as-is (see below) |

### Upload a video

```typescript
// From a local file (path as the first argument, or `videoPath` in the options)
await client.uploadVideo('./video.mp4', {
  user: 'my-profile',
  platforms: ['instagram', 'tiktok', 'youtube', 'facebook'],
  title: 'My video',
  firstComment: '#socialmedia',
  schedule: '2026-12-01T10:00:00Z',
  youtubePrivacy: 'public',
  youtubeTags: ['tutorial', 'tech'],
  idempotencyKey: 'video-2026-12-01',
});

// From a public URL (up to 500 MB; the server downloads it)
await client.uploadVideo({
  user: 'my-profile',
  platforms: ['tiktok'],
  videoUrl: 'https://cdn.example.com/clip.mp4',
});

// From a Buffer or a readable stream
await client.uploadVideo(buffer, { user: 'my-profile', platforms: ['youtube'], filename: 'clip.mp4' });
```

### Large videos (chunked upload, up to 500 MB)

Requests to the API are capped at 100 MB at the edge. `uploadVideo` sends any local file or Buffer larger than **95 MiB** (`CHUNKED_THRESHOLD_BYTES`) through the [chunked upload endpoints](https://docs.post-upload.com/api-reference/upload-video#large-files-chunked-upload) automatically: it opens an upload session, sends the file in parts (each exactly the server's `chunk_size`, 32 MiB, read from disk one part at a time), completes the session and publishes it by `staged_file_id`. Parts are sent one after another and retried with exponential backoff on `429`, `5xx` and network errors (honouring `Retry-After`); if a part fails for good the session is cancelled.

```typescript
await client.uploadVideo('./full-episode.mp4', {
  user: 'my-profile',
  platforms: ['youtube', 'facebook'],
  title: 'Full episode',
  onProgress: ({ uploadedBytes, totalBytes, part, totalParts }) =>
    console.log(`part ${part}/${totalParts}: ${Math.round((uploadedBytes / totalBytes) * 100)}%`),
});
```

| Option | Description |
|---|---|
| `chunked` | `'auto'` (default: above 95 MiB), `true` (always) or `false` (never) |
| `onProgress` | Called after each part with `{ uploadedBytes, totalBytes, part, totalParts }` |
| `maxRetries` | Attempts per part / step on 429, 5xx and network errors (default 5) |
| `filename`, `mimeType` | For a Buffer or stream (default `video.mp4`; the type is guessed from the name) |
| `size` | Size in bytes of a stream. With `size` a stream is read part by part; without it, a `chunked: true` stream is first written to a temporary file (deleted afterwards). In `'auto'` mode a stream without `size` is sent in a single request |

Send the file now and post it later, or drive the steps yourself:

```typescript
// Upload only, then post by staged_file_id (usable once, within 6 hours)
const { staged_file_id } = await client.uploadLargeFile('./full-episode.mp4', { onProgress });
await client.uploadVideo({ user: 'my-profile', platforms: ['youtube'], stagedFileId: staged_file_id });

// Low-level
const session = await client.createUploadSession({ filename: 'a.mp4', size, mime_type: 'video/mp4' });
// → { upload_session_id, chunk_size, total_chunks, expires_at }
await client.uploadPart(session.upload_session_id, 0, firstChunkBytes); // one attempt per call
await client.getUploadSession(session.upload_session_id);              // received_chunks, to resume
const done = await client.completeUploadSession(session.upload_session_id); // → { staged_file_id }
await client.abortUploadSession(session.upload_session_id);            // cancel
```

### Skipped platforms

Each platform has its own maximum file size (e.g. Instagram 300 MB, Bluesky 100 MB, Discord 10 MB). A platform the file is too large for is skipped while the others publish. Skipped platforms are listed in `data.skipped_platforms` (typed as `SkippedPlatform[]`) and as `platform_skipped` entries in `warnings`:

```typescript
const res = await client.uploadVideo('./big.mp4', { user: 'my-profile', platforms: ['youtube', 'bluesky'] });
for (const s of res.data.skipped_platforms ?? []) {
  console.warn(`${s.platform} skipped: ${s.message} (${s.file_size_mb} MB > ${s.max_size_mb} MB)`);
}
```

Only when no selected platform can take the file is the request refused (`413 FILE_TOO_LARGE_FOR_PLATFORM`).

### Upload photos

Local files, public URLs, or both — up to 10 in total.

```typescript
await client.uploadPhotos({
  user: 'my-profile',
  platforms: ['instagram', 'facebook', 'pinterest'],
  photoPaths: ['./photo1.jpg'],
  photoUrls: ['https://cdn.example.com/photo2.jpg'],
  title: 'Photo carousel',
  platformOptions: { pinterest_board_id: '1234567890' },
});
```

### Text post

```typescript
await client.uploadText({
  user: 'my-profile',
  platforms: ['x', 'threads', 'bluesky', 'linkedin', 'devto', 'nostr'],
  text: 'Just shipped a new feature!',   // `title` is still accepted as before
});
```

### Document post (LinkedIn)

```typescript
await client.uploadDocument({
  user: 'my-profile',
  documentPath: './deck.pdf',            // PDF, PPT, PPTX, DOC, DOCX (max 100 MB)
  title: 'Q4 results',
  visibility: 'PUBLIC',
  targetLinkedinPageId: '12345',         // optional: post as a company page
});
```

### Synchronous mode

By default an upload returns immediately and publishes in the background. With `asyncUpload: false` the server waits up to about 50 seconds and returns the outcome:

```typescript
const res = await client.uploadText({ user: 'my-profile', platforms: ['bluesky'], text: 'hi', asyncUpload: false });
if (res.sync) {
  console.log(res.data.status, res.data.platforms, res.data.platform_post_ids);
} else {
  // Took longer than the wait window: poll instead
  console.log(await client.getUploadStatus(res.data.upload_id));
}
```

### Platform-specific options

Pass any platform-specific API field through `platformOptions`. Arrays are sent as repeated fields, booleans as `"true"`/`"false"`, objects as JSON.

```typescript
await client.uploadPhotos({
  user: 'my-profile',
  platforms: ['tiktok', 'google_business', 'reddit'],
  photoUrls: ['https://cdn.example.com/menu.jpg'],
  title: 'New menu is live',
  platformOptions: {
    privacy_level: 'PUBLIC_TO_EVERYONE',   // TikTok
    auto_add_music: true,
    gbp_location_id: 'locations/123',      // Google Business Profile
    gbp_cta_type: 'LEARN_MORE',
    gbp_cta_url: 'https://example.com',
    reddit_subreddit: 'food',              // Reddit
  },
});
```

Use the platform helper methods below to look up page, board and location ids. The full list of platform fields is in the [platform guides](https://docs.post-upload.com).

**Per-platform text overrides (every platform).** `<platform>_title` and `<platform>_description` replace the shared `title` / `description` for that platform only, e.g. `x_title`, `linkedin_description`, `mastodon_title`, `devto_description`.

**Mastodon**

| Field | Values |
|---|---|
| `mastodon_visibility` | `public` (default), `unlisted`, `private` or `direct` |
| `mastodon_spoiler_text` | Content warning shown before the post |
| `mastodon_sensitive` | `true` to mark media as sensitive. Omit it otherwise: the server treats any non-empty value, including `"false"`, as true |
| `mastodon_alt_text` | Alt text for attached media (defaults to the title) |
| `mastodon_language` | ISO 639 language code, e.g. `en` |

**WordPress**

| Field | Values |
|---|---|
| `wordpress_status` | `publish` (default) or `draft` |
| `wordpress_categories` | Numeric category IDs: `'3,7'` or `[3, 7]` |
| `wordpress_tags` | Numeric tag IDs: `'12,15'` or `[12, 15]` |

```typescript
await client.uploadText({
  user: 'my-profile',
  platforms: ['mastodon', 'wordpress', 'slack'],
  title: 'Release notes',
  description: 'Full changelog for 1.2 …',
  platformOptions: {
    mastodon_title: 'Release notes are out (short version for Mastodon)',
    mastodon_visibility: 'unlisted',
    mastodon_language: 'en',
    wordpress_status: 'draft',
    wordpress_categories: [3, 7],
    wordpress_tags: '12,15',
  },
});
```

## Connect platforms with credentials

Discord, Telegram, Slack, Mastodon, WordPress, Dev.to, Hashnode, Lemmy, Nostr, Whop and Listmonk connect with credentials instead of an OAuth login. `connectWithCredentials(profile, platform, credentials)` sends them to the API, which verifies them live with the platform before saving them (encrypted). Connecting again replaces the stored credentials. The credentials object is typed per platform:

| Platform | Credentials (`?` = optional) |
|---|---|
| `discord` | `{ webhook_url }` — channel webhook URL |
| `telegram` | `{ bot_token, chat_id }` — token from @BotFather; public channel `@username` or numeric chat ID |
| `slack` | `{ webhook_url }` — incoming webhook URL (Slack can only verify it on the first post) |
| `mastodon` | `{ instance_url, access_token }` — e.g. `https://mastodon.social`; token with `write:statuses` and `write:media` |
| `wordpress` | `{ site_url, username, app_password }` — self-hosted site, a user who can publish, an application password |
| `devto` | `{ api_key, base_url? }` — DEV API key (Settings → Extensions); `base_url` only for another Forem site |
| `hashnode` | `{ access_token, publication_id }` — personal access token; the publication must be on Hashnode Pro |
| `lemmy` | `{ instance_url, username, password, community, totp? }` — `community` is `name` or `name@instance`; `totp` only with 2FA (used once, not stored) |
| `nostr` | `{ nsec, relays?, blossom_server? }` — `nsec1…` or hex key; comma-separated `wss://` relays; Blossom server for photos |
| `whop` | `{ api_key, experience_id?, channel_id? }` — a forum `experience_id` (exp_…) or a chat `channel_id`, not both |
| `listmonk` | `{ base_url, api_user, api_token, list_ids }` — Listmonk URL, an API user and token, comma-separated list IDs |

```typescript
const res = await client.connectWithCredentials('my-profile', 'telegram', {
  bot_token: '123456789:AA…',
  chat_id: '@mychannel',
});
console.log(res.platform_username);

await client.connectWithCredentials('my-profile', 'devto', { api_key: process.env.DEVTO_API_KEY! });

try {
  await client.connectWithCredentials('my-profile', 'mastodon', { instance_url: 'https://mastodon.social', access_token: 'bad' });
} catch (err) {
  if (err instanceof PostUploadError && err.status === 400) {
    // err.code: 'MISSING_FIELD' | 'FIELD_TOO_LONG' | 'INVALID_CREDENTIALS'
    console.error(err.code, err.body?.details?.field, err.message);
  }
}
```

Other failures: `404` (profile not found) and `502` (the platform could not be reached to verify the details). The required fields per platform are also exported as `CREDENTIAL_PLATFORMS`.

## All methods

| Area | Method | Endpoint |
|---|---|---|
| Upload | `uploadVideo(options)` / `uploadVideo(source, options)` | `POST /api/upload` (plus the chunked endpoints for large files) |
| | `uploadPhotos(options)` | `POST /api/upload_photos` |
| | `uploadText(options)` | `POST /api/upload_text` |
| | `uploadDocument(options)` | `POST /api/upload_document` |
| Chunked upload | `uploadLargeFile(source, { filename, mimeType, size, onProgress, maxRetries })` | init → parts → complete |
| | `createUploadSession({ filename, size, mime_type })` | `POST /api/upload/chunked/init` |
| | `uploadPart(sessionId, index, bytes)` | `PUT /api/upload/chunked/:id/:index` |
| | `completeUploadSession(sessionId)` | `POST /api/upload/chunked/:id/complete` |
| | `getUploadSession(sessionId)` | `GET /api/upload/chunked/:id` |
| | `abortUploadSession(sessionId)` | `DELETE /api/upload/chunked/:id` |
| Account | `getMe()` | `GET /api/me` |
| Uploads | `getUploadStatus(uploadId)` | `GET /api/upload/:id/status` |
| | `getRequestStatus(requestId)` | `GET /api/uploadposts/status?request_id=` |
| | `listUploads({ limit, page, status })` | `GET /api/uploads` |
| | `getUpload(uploadId)` | `GET /api/uploads/:id` |
| | `deleteUpload(uploadId)` | `DELETE /api/uploads/:id` |
| | `retryUpload(uploadId)` | `POST /api/uploads/:id/retry` |
| | `getPlatformLimits()` | `GET /api/platform-limits` |
| Profiles | `getProfiles()` | `GET /api/profiles` |
| | `createProfile(name)` | `POST /api/profiles` |
| | `deleteProfile(name)` | `DELETE /api/profiles/:name` |
| | `connectWithCredentials(profile, platform, credentials)` | `POST /api/profiles/:name/connect/:platform/credentials` |
| Schedule | `getScheduledPosts()` | `GET /api/schedule` |
| | `updateScheduledPost(jobId, { scheduledDate, timezone, title, caption })` | `PATCH /api/schedule/:jobId` |
| | `cancelScheduledPost(jobId)` | `DELETE /api/schedule/:jobId` |
| Queue | `getQueueSettings(profile)` | `GET /api/queue/settings` |
| | `updateQueueSettings({ profile, slots, daysOfWeek, timezone, maxPostsPerSlot })` | `POST /api/queue/settings` |
| | `getQueuePreview(profile, count?)` | `GET /api/queue/preview` |
| | `getNextQueueSlot(profile)` | `GET /api/queue/next-slot` |
| Platform helpers | `getFacebookPages(profile)` | `GET /api/platforms/facebook/pages` |
| | `getLinkedInPages(profile)` | `GET /api/platforms/linkedin/pages` |
| | `getPinterestBoards(profile)` | `GET /api/platforms/pinterest/boards` |
| | `getGoogleBusinessLocations(profile)` | `GET /api/platforms/google-business/locations` |
| Analytics | `getAnalytics(range = '30d')` | `GET /api/analytics/overview` |
| | `getLiveAnalytics(profile, platforms?)` | `GET /api/analytics/live/:profile` |
| | `getPostAnalytics(uploadId, platform?)` | `GET /api/analytics/post/:upload_id` |
| | `getTotalImpressions(profile, { platform, period, startDate, endDate })` | `GET /api/analytics/total-impressions/:profile` |
| FFmpeg | `getFfmpegUsage()` | `GET /api/ffmpeg/usage` |
| | `listFfmpegJobs()` | `GET /api/ffmpeg/jobs` |
| | `getFfmpegJob(jobId)` | `GET /api/ffmpeg/jobs/:jobId` |
| Plans | `getPlans()` | `GET /api/plans` |

Examples:

```typescript
const me = await client.getMe();                              // plan + monthly usage
const { uploads } = await client.listUploads({ status: 'failed', limit: 10 });
await client.retryUpload(uploads[0].id);

await client.updateQueueSettings({
  profile: 'my-profile',
  slots: ['09:00', '17:30'],
  daysOfWeek: [1, 2, 3, 4, 5],
  timezone: 'Europe/London',
});
await client.uploadVideo('./v.mp4', { user: 'my-profile', platforms: ['youtube'], addToQueue: true });

const { scheduled_posts } = await client.getScheduledPosts();
await client.updateScheduledPost(scheduled_posts[0].id, { scheduledDate: '2026-12-24T09:00:00Z' });
```

## Error handling

Every API failure throws a `PostUploadError`:

| Property | Description |
|---|---|
| `status` | HTTP status (`0` = network error, `408` = client-side timeout) |
| `code` | API error code (`error_code` / `code`), e.g. `MISSING_VIDEO`, `CHUNK_SIZE_MISMATCH`, or `NETWORK_ERROR` / `TIMEOUT` |
| `body` | Parsed response body |
| `message` | Human-readable message from the API |
| `retryAfter` | Seconds from the `Retry-After` header (e.g. on 429), or `null` |

```typescript
import { PostUploadError } from 'post-upload';

try {
  await client.uploadVideo('./v.mp4', { user: 'my-profile', platforms: ['tiktok'] });
} catch (err) {
  if (err instanceof PostUploadError) {
    console.error(`API error ${err.status} (${err.code}): ${err.message}`, err.body);
  } else {
    throw err;
  }
}
```

Invalid arguments (for example no video source, or more than 10 photos) throw a `TypeError` before any request is made.

## MCP: use Post-Upload from AI agents

Post-Upload runs a hosted [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude, ChatGPT, Cursor and other agents can publish posts, check upload status and read analytics with your API key.

### Option 1 — stdio bridge (Claude Desktop, Cursor, any stdio MCP client)

Add this to your client's MCP config (`claude_desktop_config.json` for Claude Desktop; `~/.cursor/mcp.json` or `.cursor/mcp.json` for Cursor):

```json
{
  "mcpServers": {
    "post-upload": {
      "command": "npx",
      "args": ["-y", "post-upload", "mcp"],
      "env": {
        "POST_UPLOAD_API_KEY": "your-api-key"
      }
    }
  }
}
```

Environment variables:

| Variable | Required | Description |
|---|---|---|
| `POST_UPLOAD_API_KEY` | yes | Your Post-Upload API key |
| `POST_UPLOAD_MCP_URL` | no | MCP endpoint (default `https://api.post-upload.com/mcp`) |
| `POST_UPLOAD_MCP_TIMEOUT_MS` | no | Per-request timeout in ms (default `300000`) |

The former `INDREELFORGE_API_KEY`, `INDREELFORGE_MCP_URL` and `INDREELFORGE_MCP_TIMEOUT_MS` are still read when the new names are not set.

The bridge reads JSON-RPC messages from stdin, forwards each to the hosted server and writes the responses to stdout, one per line. Only JSON-RPC goes to stdout; diagnostics go to stderr. HTTP and network failures come back as JSON-RPC errors for the matching request id, so the client never hangs. `npx post-upload --help` and `npx post-upload --version` are available.

### Option 2 — connect to the hosted URL directly

Clients that support remote (Streamable HTTP) MCP servers with custom headers (for example Cursor or Claude Code) can skip the bridge:

- URL: `https://api.post-upload.com/mcp`
- Header: `Authorization: ApiKey your-api-key`

```json
{
  "mcpServers": {
    "post-upload": {
      "url": "https://api.post-upload.com/mcp",
      "headers": { "Authorization": "ApiKey your-api-key" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http post-upload https://api.post-upload.com/mcp \
  --header "Authorization: ApiKey your-api-key"
```

### Programmatic bridge

```typescript
import { runMcpBridge } from 'post-upload';

await runMcpBridge({ apiKey: process.env.POST_UPLOAD_API_KEY!, input: process.stdin, output: process.stdout });
```

## Supported platforms

| Platform | Video | Photo | Text | Document | Scheduling |
|----------|-------|-------|------|----------|------------|
| Instagram | ✓ | ✓ | - | - | ✓ |
| YouTube | ✓ | - | - | - | ✓ |
| TikTok | ✓ | ✓ | - | - | ✓ |
| Facebook | ✓ | ✓ | ✓ | - | ✓ |
| X (Twitter) | ✓ | ✓ | ✓ | - | ✓ |
| LinkedIn | ✓ | ✓ | ✓ | ✓ | ✓ |
| Threads | ✓ | ✓ | ✓ | - | ✓ |
| Pinterest | ✓ | ✓ | - | - | ✓ |
| Reddit | ✓ | ✓ | ✓ | - | ✓ |
| Bluesky | ✓ | ✓ | ✓ | - | ✓ |
| Google Business Profile | - | ✓ | ✓ | - | ✓ |
| Discord | ✓ | ✓ | ✓ | - | ✓ |
| Telegram | ✓ | ✓ | ✓ | - | ✓ |
| Slack | - | - | ✓ | - | ✓ |
| Mastodon | ✓ | ✓ | ✓ | - | ✓ |
| WordPress | ✓ | ✓ | ✓ | - | ✓ |
| Dev.to | - | - | ✓ | - | ✓ |
| Hashnode | - | ✓ | ✓ | - | ✓ |
| Lemmy | - | ✓ | ✓ | - | ✓ |
| Nostr | - | ✓ | ✓ | - | ✓ |
| Whop | ✓ | ✓ | ✓ | - | ✓ |
| Listmonk | - | ✓ | ✓ | - | ✓ |

Discord, Telegram, Slack, Mastodon, WordPress, Dev.to, Hashnode, Lemmy, Nostr, Whop and Listmonk are connected with [credentials](#connect-platforms-with-credentials); the others connect through an OAuth login in the dashboard (or an app password for Bluesky).

## Migrating from `indreelforge`

1.2 is backward compatible with the `indreelforge` 1.0 / 1.1 API; only the package name changed.

```bash
npm uninstall indreelforge
npm install post-upload
```

```diff
- import IndReelForge, { IndReelForgeError } from 'indreelforge';
- const client = new IndReelForge({ apiKey: process.env.INDREELFORGE_API_KEY! });
+ import PostUpload, { PostUploadError } from 'post-upload';
+ const client = new PostUpload({ apiKey: process.env.POST_UPLOAD_API_KEY! });
```

- `IndReelForge` / `InReelForge` and `IndReelForgeError` / `InReelForgeError` are still exported as deprecated aliases of the same classes, so existing code and `instanceof` checks keep working. `err.name` is now `'PostUploadError'`; prefer `instanceof` checks.
- The default API address is now `https://api.post-upload.com` (the old `api.indreelforge.com` address keeps working while it is phased out). Pass `baseUrl` to override.
- The CLI is `post-upload` (`npx -y post-upload mcp`); an `indreelforge` bin is still installed, and the `INDREELFORGE_*` environment variables are still read.
- New: chunked uploads up to 500 MB, `uploadVideo(source, options)`, `new PostUpload('key')`, six new platforms and `skipped_platforms` in upload responses. See [CHANGELOG.md](CHANGELOG.md).

## Links

- [Website](https://post-upload.com)
- [API documentation](https://docs.post-upload.com)
- [Dashboard](https://post-upload.com/dashboard)
- [Pricing](https://post-upload.com/pricing)
- [Python SDK](https://pypi.org/project/post-upload/)

## License

MIT
