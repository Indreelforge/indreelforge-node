# InReelForge — Node.js SDK

[![npm version](https://img.shields.io/npm/v/indreelforge.svg)](https://www.npmjs.com/package/indreelforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Official Node.js SDK for the [InReelForge](https://indreelforge.com) Social Media API. Upload videos, photos, and text to **Instagram, YouTube, TikTok, Facebook, X (Twitter), LinkedIn, Threads, Pinterest, Reddit & Bluesky** with a single API call.

## Installation

```bash
npm install indreelforge
```

## Quick Start

```typescript
import InReelForge from 'indreelforge';

const client = new InReelForge({
  apiKey: 'your-api-key-here',
});

// Upload a video to multiple platforms
const result = await client.uploadVideo({
  user: 'my-profile',
  platforms: ['instagram', 'tiktok', 'youtube'],
  videoPath: './my-video.mp4',
  title: 'Check out this amazing video!',
});

console.log(result);
// { status: 'success', data: { upload_id: '...', platforms: [...] } }
```

## Features

- **One API call, all platforms** — Upload to 10+ social networks simultaneously
- **Video, Photo & Text** — Support for all content types
- **Scheduling** — Schedule posts for any future date/time
- **Analytics** — Track performance across all platforms
- **Profile Management** — Manage multiple social media accounts
- **TypeScript** — Full type definitions included
- **Lightweight** — Zero dependencies (uses native `fetch`)

## Usage

### Upload Video

```typescript
await client.uploadVideo({
  user: 'my-profile',
  platforms: ['instagram', 'tiktok', 'youtube', 'facebook'],
  videoPath: './video.mp4',
  title: 'My awesome video',
  firstComment: '#socialmedia #viral',
  schedule: '2026-04-15T10:00:00Z',
  youtubePrivacy: 'public',
  youtubeTags: ['tutorial', 'tech'],
});
```

### Upload Photos

```typescript
await client.uploadPhotos({
  user: 'my-profile',
  platforms: ['instagram', 'facebook', 'pinterest'],
  photoPaths: ['./photo1.jpg', './photo2.jpg'],
  title: 'Photo carousel',
});
```

### Upload Text

```typescript
await client.uploadText({
  user: 'my-profile',
  platforms: ['x', 'threads', 'bluesky'],
  title: 'Just shipped a new feature! 🚀',
});
```

### Manage Profiles

```typescript
// List profiles
const { profiles } = await client.getProfiles();

// Create profile
await client.createProfile('brand-account');

// Delete profile
await client.deleteProfile('old-account');
```

### Analytics

```typescript
const analytics = await client.getAnalytics('30d');
console.log(analytics.total_views, analytics.engagement_rate);
```

## Supported Platforms

| Platform | Video | Photo | Text | Scheduling |
|----------|-------|-------|------|------------|
| Instagram | ✓ | ✓ | - | ✓ |
| YouTube | ✓ | - | - | ✓ |
| TikTok | ✓ | ✓ | - | ✓ |
| Facebook | ✓ | ✓ | ✓ | ✓ |
| X (Twitter) | ✓ | ✓ | ✓ | ✓ |
| LinkedIn | ✓ | ✓ | ✓ | ✓ |
| Threads | - | ✓ | ✓ | ✓ |
| Pinterest | - | ✓ | - | ✓ |
| Reddit | ✓ | ✓ | ✓ | ✓ |
| Bluesky | - | ✓ | ✓ | ✓ |

## Configuration

```typescript
const client = new InReelForge({
  apiKey: 'your-api-key',           // Required
  baseUrl: 'https://api.indreelforge.com', // Optional (default)
  timeout: 120000,                  // Optional: request timeout in ms (default: 120s)
});
```

## Error Handling

```typescript
try {
  await client.uploadVideo({ ... });
} catch (err) {
  if (err.name === 'InReelForgeError') {
    console.error(`API Error (${err.status}): ${err.message}`);
  }
}
```

## Links

- [Website](https://indreelforge.com)
- [API Documentation](https://indreelforge.com/docs)
- [Dashboard](https://indreelforge.com/dashboard)
- [Pricing](https://indreelforge.com/pricing)
- [Status](https://indreelforge.com/status)
- [Python SDK](https://pypi.org/project/indreelforge/)

## License

MIT
