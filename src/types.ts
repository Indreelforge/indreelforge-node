// Public types for the Post-Upload REST API.

export interface PostUploadConfig {
  /** Your Post-Upload API key (Dashboard → API Keys). */
  apiKey: string;
  /** API base URL. Default: https://api.post-upload.com */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 120000 (120 s). */
  timeout?: number;
  /** Custom fetch implementation (defaults to the global `fetch`, Node >= 18). */
  fetch?: typeof fetch;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** First retry delay (ms) for chunked-upload steps; doubles per attempt unless the server sends Retry-After. Default 1000. */
  retryBaseDelayMs?: number;
}

/** @deprecated Use {@link PostUploadConfig}. */
export type IndReelForgeConfig = PostUploadConfig;
/** @deprecated Use {@link PostUploadConfig}. */
export type InReelForgeConfig = PostUploadConfig;

export type Platform =
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'facebook'
  | 'x'
  | 'linkedin'
  | 'threads'
  | 'pinterest'
  | 'reddit'
  | 'bluesky'
  | 'google_business'
  | 'discord'
  | 'telegram'
  | 'slack'
  | 'mastodon'
  | 'wordpress'
  | 'devto'
  | 'hashnode'
  | 'lemmy'
  | 'nostr'
  | 'whop'
  | 'listmonk'
  // Any other platform key the API supports, while keeping autocomplete for the above.
  | (string & {});

/** Every platform key known to this SDK version. */
export const PLATFORMS = [
  'instagram', 'youtube', 'tiktok', 'facebook', 'x', 'linkedin', 'threads', 'pinterest',
  'reddit', 'bluesky', 'google_business', 'discord', 'telegram', 'slack', 'mastodon', 'wordpress',
  'devto', 'hashnode', 'lemmy', 'nostr', 'whop', 'listmonk',
] as const;

/** Credential fields for platforms that connect with credentials instead of OAuth. */
export interface PlatformCredentials {
  /** Channel webhook URL (Server Settings → Integrations → Webhooks). */
  discord: { webhook_url: string };
  /** Bot token from @BotFather; chat_id is a public channel `@username` or a numeric chat id. */
  telegram: { bot_token: string; chat_id: string };
  /** Incoming webhook URL. Slack can't verify it without posting, so a bad URL only fails on the first post. */
  slack: { webhook_url: string };
  /** Instance URL (e.g. https://mastodon.social) and an access token with write:statuses + write:media. */
  mastodon: { instance_url: string; access_token: string };
  /** Self-hosted site URL, a user who can publish, and an application password. */
  wordpress: { site_url: string; username: string; app_password: string };
  /** DEV / Forem API key; `base_url` only for a Forem site other than dev.to. */
  devto: { api_key: string; base_url?: string };
  /** Personal access token and the publication ID (Hashnode Pro publications only). */
  hashnode: { access_token: string; publication_id: string };
  /** Instance, account and community (`name` or `name@instance`); `totp` only if 2FA is on (used once, not stored). */
  lemmy: { instance_url: string; username: string; password: string; community: string; totp?: string };
  /** Private key (`nsec1…` or 64-char hex); optional comma-separated wss:// relays and a Blossom media server. */
  nostr: { nsec: string; relays?: string; blossom_server?: string };
  /** API key plus either a forum `experience_id` (exp_…) or a chat `channel_id` (not both). */
  whop: { api_key: string; experience_id?: string; channel_id?: string };
  /** Listmonk URL, an API user + token, and the numeric list IDs (comma-separated) each campaign is sent to. */
  listmonk: { base_url: string; api_user: string; api_token: string; list_ids: string };
}

export type CredentialPlatform = keyof PlatformCredentials;

/** Platforms connected via `connectWithCredentials()`, with their required fields. */
export const CREDENTIAL_PLATFORMS: { readonly [P in CredentialPlatform]: ReadonlyArray<keyof PlatformCredentials[P]> } = {
  discord: ['webhook_url'],
  telegram: ['bot_token', 'chat_id'],
  slack: ['webhook_url'],
  mastodon: ['instance_url', 'access_token'],
  wordpress: ['site_url', 'username', 'app_password'],
  devto: ['api_key'],
  hashnode: ['access_token', 'publication_id'],
  lemmy: ['instance_url', 'username', 'password', 'community'],
  nostr: ['nsec'],
  whop: ['api_key'],
  listmonk: ['base_url', 'api_user', 'api_token', 'list_ids'],
};

export interface ConnectCredentialsResponse {
  success: boolean;
  message: string;
  /** Account / channel name the credentials resolved to. */
  platform_username: string;
  [key: string]: any;
}

/** Value accepted for a platform-specific form field. */
export type PlatformOptionValue = string | number | boolean | string[] | Record<string, unknown> | null | undefined;

/**
 * Platform-specific fields, sent verbatim as form fields (snake_case API names),
 * e.g. `{ privacy_level: 'PUBLIC_TO_EVERYONE', pinterest_board_id: '123', gbp_cta_type: 'LEARN_MORE' }`.
 * Arrays are sent as repeated fields, booleans as "true"/"false", objects as JSON.
 */
export type PlatformOptions = Record<string, PlatformOptionValue>;

export interface UploadOptions {
  /** Profile name (managed user). */
  user: string;
  /** Platforms to publish to. */
  platforms: Platform[];
  /** Post title / caption. */
  title?: string;
  /** Long description (YouTube, LinkedIn, Facebook, Pinterest, ...). */
  description?: string;
  /** First comment (Instagram, Facebook, YouTube, X, Threads, ...). */
  firstComment?: string;
  /** Schedule for later: ISO-8601 datetime. */
  schedule?: string;
  /** IANA timezone used with `schedule` (e.g. "America/New_York"). */
  timezone?: string;
  /** Add the post to the profile's next free queue slot. */
  addToQueue?: boolean;
  /**
   * `false` = synchronous mode: the server waits (up to ~50 s) for the publish
   * result and returns `{ sync: true, data: { status, platforms, platform_post_ids } }`.
   * Default (omitted / `true`) returns immediately and publishes in the background.
   */
  asyncUpload?: boolean;
  /** Your own correlation id; look the upload up later with `getRequestStatus()`. */
  requestId?: string;
  /** Sent as the `Idempotency-Key` header: retries with the same key never double-post. */
  idempotencyKey?: string;
  /** Any platform-specific fields (see {@link PlatformOptions}). */
  platformOptions?: PlatformOptions;

  // Convenience shortcuts kept from 1.0 (equivalent to platformOptions entries).
  instagramTitle?: string;
  youtubeTitle?: string;
  youtubeDescription?: string;
  youtubeTags?: string[];
  youtubePrivacy?: 'public' | 'private' | 'unlisted';
}

/** Progress of a chunked upload, reported after each part. */
export interface UploadProgress {
  /** Bytes confirmed by the server so far. */
  uploadedBytes: number;
  /** Total file size in bytes. */
  totalBytes: number;
  /** Number of parts uploaded so far (1-based count). */
  part: number;
  /** Total number of parts. */
  totalParts: number;
}

/** What can be sent as a video: a local path, a Buffer / Uint8Array, or a readable stream. */
export type VideoSource = string | Uint8Array | NodeJS.ReadableStream | AsyncIterable<Uint8Array>;

export interface ChunkedUploadOptions {
  /** File name sent to the server (its extension decides the type). Default: the path's basename, or "video.mp4". */
  filename?: string;
  /** MIME type. Default: guessed from the file name (video/mp4 when unknown). */
  mimeType?: string;
  /** Size in bytes. Required for streams; read from disk / the buffer otherwise. */
  size?: number;
  /** Called after each part is uploaded. */
  onProgress?: (progress: UploadProgress) => void;
  /** Attempts per part (and per init/complete call) on 429 / 5xx / network errors. Default 5. */
  maxRetries?: number;
}

export interface UploadVideoOptions extends UploadOptions {
  /** Path to a local video file. */
  videoPath?: string;
  /** Video bytes (Buffer / Uint8Array) or a readable stream (requires `size` for chunked uploads). */
  video?: Uint8Array | NodeJS.ReadableStream | AsyncIterable<Uint8Array>;
  /** Public http(s) URL of a video (up to 500 MB); the server downloads it. */
  videoUrl?: string;
  /** A file already sent with the chunked upload endpoints (`uploadLargeFile` / `completeUploadSession`). */
  stagedFileId?: string;
  /**
   * Send the file in parts through the chunked upload endpoints (up to 500 MB).
   * Default `'auto'`: chunked when the file is larger than {@link CHUNKED_THRESHOLD_BYTES} (95 MiB),
   * which is required above ~100 MB. `true` always, `false` never.
   */
  chunked?: boolean | 'auto';
  /** File name for a Buffer / stream `video` (default "video.mp4"). */
  filename?: string;
  /** MIME type for the file (default: guessed from the name). */
  mimeType?: string;
  /** Size in bytes of a stream `video` (needed for a chunked upload of a stream). */
  size?: number;
  /** Progress of a chunked upload (called after each part). */
  onProgress?: (progress: UploadProgress) => void;
  /** Attempts per part on 429 / 5xx / network errors during a chunked upload. Default 5. */
  maxRetries?: number;
}

/** Files above this size are sent with the chunked upload endpoints by default (Cloudflare caps a request at 100 MB). */
export const CHUNKED_THRESHOLD_BYTES = 95 * 1024 * 1024;
/** Largest video the API accepts (chunked upload or `videoUrl`). */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export interface CreateUploadSessionOptions {
  filename: string;
  /** File size in bytes. */
  size: number;
  /** e.g. "video/mp4". */
  mime_type?: string;
}

export interface UploadSession {
  success?: boolean;
  upload_session_id: string;
  /** Every part except the last must be exactly this many bytes. */
  chunk_size: number;
  total_chunks: number;
  expires_at: string;
  [key: string]: any;
}

export interface UploadSessionStatus {
  success?: boolean;
  upload_session_id?: string;
  status?: string;
  /** Indexes already received (to resume). */
  received_chunks?: number[];
  total_chunks?: number;
  chunk_size?: number;
  staged_file_id?: string;
  expires_at?: string;
  [key: string]: any;
}

export interface CompleteUploadSessionResponse {
  success?: boolean;
  /** Pass to `uploadVideo({ stagedFileId })` / `POST /api/upload staged_file_id`. Usable once. */
  staged_file_id: string;
  expires_at?: string;
  message?: string;
  [key: string]: any;
}

export interface UploadPhotoOptions extends UploadOptions {
  /** Paths to local photo files (max 10 in total with `photoUrls`). */
  photoPaths?: string[];
  /** Public http(s) URLs of photos (max 10 in total with `photoPaths`). */
  photoUrls?: string[];
}

export interface UploadTextOptions extends UploadOptions {
  /** Text content. Either `text` or `title` is required. */
  text?: string;
}

export interface UploadDocumentOptions {
  /** Profile name (managed user). Document posts go to LinkedIn. */
  user: string;
  /** Path to a PDF, PPT, PPTX, DOC or DOCX file (max 100 MB). */
  documentPath: string;
  title?: string;
  description?: string;
  firstComment?: string;
  /** LinkedIn visibility, e.g. "PUBLIC" or "CONNECTIONS". */
  visibility?: string;
  /** Post as a LinkedIn company page instead of the personal profile. */
  targetLinkedinPageId?: string;
  schedule?: string;
  timezone?: string;
  requestId?: string;
  idempotencyKey?: string;
  platformOptions?: PlatformOptions;
}

export interface UploadWarning {
  /** e.g. `upload_limit`, `ffmpeg_limit`, `platform_rate_limit`, `platform_skipped`. */
  type: string;
  level?: string;
  platform?: string;
  error_code?: string;
  message: string;
  [key: string]: any;
}

/** A platform the file was too large for: stored as failed, never sent, no quota used. */
export interface SkippedPlatform {
  platform: Platform;
  /** `FILE_TOO_LARGE_FOR_PLATFORM`. */
  error_code: string;
  message: string;
  file_size_mb?: number;
  max_size_mb?: number;
  [key: string]: any;
}

export interface UploadResponse {
  success?: boolean;
  /** Present on some responses (e.g. idempotent replays). */
  status?: string;
  message: string;
  request_id?: string;
  /** `true` when `asyncUpload: false` and the publish finished within the wait window. */
  sync?: boolean;
  data: {
    upload_id: string;
    platforms: Record<string, unknown> | string[];
    status?: string;
    platform_post_ids?: Record<string, string> | null;
    /** With skipped platforms: JSON string `{"platform_errors": {…}}`. */
    error_message?: string | null;
    scheduled_date?: string;
    /** Platforms the file was too large for (the others still publish). */
    skipped_platforms?: SkippedPlatform[];
    [key: string]: any;
  };
  warnings?: UploadWarning[];
  [key: string]: any;
}

export type UploadStatus = 'queued' | 'processing' | 'scheduled' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface UploadStatusResponse {
  upload_id: string;
  request_id?: string | null;
  status: UploadStatus | string;
  upload_type: string;
  platforms: Record<string, unknown> | null;
  platform_post_ids: Record<string, string> | null;
  created_at: string;
  completed_at: string | null;
  scheduled_at?: string | null;
  error_message: string | null;
}

export interface UploadRecord {
  id: string;
  title: string | null;
  description: string | null;
  upload_type: string;
  platforms: string[];
  platform_statuses: Record<string, unknown> | null;
  platform_post_ids: Record<string, string> | null;
  platform_post_urls: Record<string, string> | null;
  status: UploadStatus | string;
  scheduled_at: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  [key: string]: any;
}

export interface ListUploadsOptions {
  /** Page size (1-100, default 20). */
  limit?: number;
  /** Page number (1-based). */
  page?: number;
  status?: UploadStatus;
}

export interface ListUploadsResponse {
  uploads: UploadRecord[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface Me {
  id: number | string;
  email: string;
  role: string;
  plan: string;
  uploads_this_month: number | null;
  month_reset_at: string | null;
  api_key_id?: number | string;
  [key: string]: any;
}

export interface Profile {
  id: number;
  name: string;
  platforms: Record<string, boolean>;
  created_at: string;
  [key: string]: any;
}

export interface ProfilesResponse {
  profiles: Profile[];
  usage: { current: number; limit: number };
  [key: string]: any;
}

export interface ScheduledPost {
  id: string;
  title: string | null;
  description: string | null;
  upload_type: string;
  platforms: string[];
  platform_statuses: Record<string, unknown> | null;
  scheduled_at: string;
  timezone: string | null;
  created_at: string;
}

export interface UpdateScheduledPostOptions {
  /** New ISO-8601 datetime (or a zoneless wall-clock time combined with `timezone`). */
  scheduledDate?: string;
  timezone?: string;
  title?: string;
  caption?: string;
}

export interface QueueSlot {
  /** "HH:MM" (24h). */
  time?: string;
  [key: string]: any;
}

export interface UpdateQueueSettingsOptions {
  /** Profile name the queue belongs to. */
  profile: string;
  /** Posting times, e.g. ["09:00", "13:00"] or slot objects. */
  slots?: Array<string | QueueSlot>;
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek?: number[];
  timezone?: string;
  maxPostsPerSlot?: number;
}

export interface TotalImpressionsOptions {
  platform?: string;
  period?: string;
  startDate?: string;
  endDate?: string;
}

export interface AnalyticsOverview {
  total_views: string;
  total_uploads: string;
  engagement_rate: string;
  followers_gained: string;
  views_trend?: string;
  uploads_trend?: string;
  [key: string]: any;
}

export interface Plan {
  name: string;
  slug: string;
  price_monthly: string;
  price_annual: string;
  features: string[];
  [key: string]: any;
}

/** Generic JSON object returned by endpoints without a dedicated type. */
export type JsonObject = Record<string, any>;
