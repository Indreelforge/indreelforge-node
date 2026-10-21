// Public types for the IndReelForge REST API.

export interface IndReelForgeConfig {
  /** Your IndReelForge API key (Dashboard → API Keys). */
  apiKey: string;
  /** API base URL. Default: https://api.indreelforge.com */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 120000 (120 s). */
  timeout?: number;
  /** Custom fetch implementation (defaults to the global `fetch`, Node >= 18). */
  fetch?: typeof fetch;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

/** @deprecated Use {@link IndReelForgeConfig}. */
export type InReelForgeConfig = IndReelForgeConfig;

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
  // Any other platform key the API supports, while keeping autocomplete for the above.
  | (string & {});

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

export interface UploadVideoOptions extends UploadOptions {
  /** Path to a local video file. */
  videoPath?: string;
  /** Public http(s) URL of a video; the server downloads it. */
  videoUrl?: string;
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
  type: string;
  level?: string;
  platform?: string;
  message: string;
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
    error_message?: string | null;
    scheduled_date?: string;
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
