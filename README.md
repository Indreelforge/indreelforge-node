# IndReelForge — Node.js SDK & MCP bridge

[![npm version](https://img.shields.io/npm/v/indreelforge.svg)](https://www.npmjs.com/package/indreelforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Official Node.js SDK for the [IndReelForge](https://indreelforge.com) Social Media API. Publish videos, photos, text and documents to **Instagram, YouTube, TikTok, Facebook, X (Twitter), LinkedIn, Threads, Pinterest, Reddit, Bluesky & Google Business Profile** with a single API call.

The package also ships `npx indreelforge mcp`, a zero-dependency stdio bridge that connects AI agents (Claude Desktop, Cursor and other MCP clients) to the hosted IndReelForge MCP server.

## Installation

```bash
npm install indreelforge
```

Requires Node.js 18 or newer (uses the built-in `fetch`, `FormData` and `Blob`). No runtime dependencies.

## Quick start

```typescript
import IndReelForge from 'indreelforge';

const client = new IndReelForge({ apiKey: process.env.INDREELFORGE_API_KEY! });

const result = await client.uploadVideo({
  user: 'my-profile',
  platforms: ['instagram', 'tiktok', 'youtube'],
  videoPath: './my-video.mp4',
  title: 'Check out this video!',
});

console.log(result.data.upload_id);
```

CommonJS works too: `const { IndReelForge } = require('indreelforge');`

## Configuration

```typescript
const client = new IndReelForge({
  apiKey: 'your-api-key',                  // Required. Dashboard → API Keys
  baseUrl: 'https://api.indreelforge.com', // Optional (default)
  timeout: 120000,                         // Optional, ms (default 120 s)
  fetch: customFetch,                      // Optional, custom fetch implementation
  headers: { 'X-Trace': 'abc' },           // Optional, extra headers on every request
});
```

Every request sends `Authorization: Apikey <key>` and `User-Agent: indreelforge-node/<version>`.

## Publishing

### Common upload options

All `upload*` methods accept:

| Option | API field | Description |
|---|---|---|
| `user` | `user` | Profile name (required) |
| `platforms` | `platform[]` | `instagram`, `youtube`, `tiktok`, `facebook`, `x`, `linkedin`, `threads`, `pinterest`, `reddit`, `bluesky`, `google_business` |
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
// From a local file
await client.uploadVideo({
  user: 'my-profile',
  platforms: ['instagram', 'tiktok', 'youtube', 'facebook'],
  videoPath: './video.mp4',
  title: 'My video',
  firstComment: '#socialmedia',
  schedule: '2026-12-01T10:00:00Z',
  youtubePrivacy: 'public',
  youtubeTags: ['tutorial', 'tech'],
  idempotencyKey: 'video-2026-12-01',
});

// From a public URL (the server downloads it)
await client.uploadVideo({
  user: 'my-profile',
  platforms: ['tiktok'],
  videoUrl: 'https://cdn.example.com/clip.mp4',
});
```

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
  platforms: ['x', 'threads', 'bluesky', 'linkedin'],
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

Use the platform helper methods below to look up page, board and location ids.

## All methods

| Area | Method | Endpoint |
|---|---|---|
| Upload | `uploadVideo(options)` | `POST /api/upload` |
| | `uploadPhotos(options)` | `POST /api/upload_photos` |
| | `uploadText(options)` | `POST /api/upload_text` |
| | `uploadDocument(options)` | `POST /api/upload_document` |
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
await client.uploadVideo({ user: 'my-profile', platforms: ['youtube'], videoPath: './v.mp4', addToQueue: true });

const { scheduled_posts } = await client.getScheduledPosts();
await client.updateScheduledPost(scheduled_posts[0].id, { scheduledDate: '2026-12-24T09:00:00Z' });
```

## Error handling

Every API failure throws an `IndReelForgeError`:

| Property | Description |
|---|---|
| `status` | HTTP status (`0` = network error, `408` = client-side timeout) |
| `code` | API error code (`error_code` / `code`), e.g. `MISSING_VIDEO`, or `NETWORK_ERROR` / `TIMEOUT` |
| `body` | Parsed response body |
| `message` | Human-readable message from the API |

```typescript
import { IndReelForgeError } from 'indreelforge';

try {
  await client.uploadVideo({ user: 'my-profile', platforms: ['tiktok'], videoPath: './v.mp4' });
} catch (err) {
  if (err instanceof IndReelForgeError) {
    console.error(`API error ${err.status} (${err.code}): ${err.message}`, err.body);
  } else {
    throw err;
  }
}
```

Invalid arguments (for example no `videoPath`/`videoUrl`, or more than 10 photos) throw a `TypeError` before any request is made.

## MCP: use IndReelForge from AI agents

IndReelForge runs a hosted [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude, ChatGPT, Cursor and other agents can publish posts, check upload status and read analytics with your API key.

### Option 1 — stdio bridge (Claude Desktop, Cursor, any stdio MCP client)

Add this to your client's MCP config (`claude_desktop_config.json` for Claude Desktop; `~/.cursor/mcp.json` or `.cursor/mcp.json` for Cursor):

```json
{
  "mcpServers": {
    "indreelforge": {
      "command": "npx",
      "args": ["-y", "indreelforge", "mcp"],
      "env": {
        "INDREELFORGE_API_KEY": "your-api-key"
      }
    }
  }
}
```

Environment variables:

| Variable | Required | Description |
|---|---|---|
| `INDREELFORGE_API_KEY` | yes | Your IndReelForge API key |
| `INDREELFORGE_MCP_URL` | no | MCP endpoint (default `https://api.indreelforge.com/mcp`) |
| `INDREELFORGE_MCP_TIMEOUT_MS` | no | Per-request timeout in ms (default `300000`) |

The bridge reads JSON-RPC messages from stdin, forwards each to the hosted server and writes the responses to stdout, one per line. Only JSON-RPC goes to stdout; diagnostics go to stderr. HTTP and network failures come back as JSON-RPC errors for the matching request id, so the client never hangs. `npx indreelforge --help` and `npx indreelforge --version` are available.

### Option 2 — connect to the hosted URL directly

Clients that support remote (Streamable HTTP) MCP servers with custom headers (for example Cursor or Claude Code) can skip the bridge:

- URL: `https://api.indreelforge.com/mcp`
- Header: `Authorization: ApiKey your-api-key`

```json
{
  "mcpServers": {
    "indreelforge": {
      "url": "https://api.indreelforge.com/mcp",
      "headers": { "Authorization": "ApiKey your-api-key" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http indreelforge https://api.indreelforge.com/mcp \
  --header "Authorization: ApiKey your-api-key"
```

### Programmatic bridge

```typescript
import { runMcpBridge } from 'indreelforge';

await runMcpBridge({ apiKey: process.env.INDREELFORGE_API_KEY!, input: process.stdin, output: process.stdout });
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

## Upgrading from 1.0

1.1 is backward compatible: existing method names, options and return values keep working.

- The class is now `IndReelForge`; `InReelForge` is still exported as an alias, and the default export is the same class.
- Errors are `IndReelForgeError` (now exported). `InReelForgeError` is an alias, so `instanceof InReelForgeError` still works. `err.name` is now `'IndReelForgeError'`, so prefer `instanceof` checks.
- `uploadText` sends your text as `text` (the API treats `text` and `title` the same).

## Links

- [Website](https://indreelforge.com)
- [API documentation](https://indreelforge.com/docs)
- [Dashboard](https://indreelforge.com/dashboard)
- [Pricing](https://indreelforge.com/pricing)
- [Python SDK](https://pypi.org/project/indreelforge/)

## License

MIT
