import { readFileSync } from 'fs';
import * as fs from 'fs';
import { basename } from 'path';
import { IndReelForgeError } from './errors';
import { VERSION } from './version';
import type {
  IndReelForgeConfig,
  UploadOptions,
  UploadVideoOptions,
  UploadPhotoOptions,
  UploadTextOptions,
  UploadDocumentOptions,
  UploadResponse,
  UploadStatusResponse,
  UploadRecord,
  ListUploadsOptions,
  ListUploadsResponse,
  Me,
  Profile,
  ProfilesResponse,
  ScheduledPost,
  UpdateScheduledPostOptions,
  UpdateQueueSettingsOptions,
  TotalImpressionsOptions,
  AnalyticsOverview,
  Plan,
  PlatformOptions,
  JsonObject,
  CredentialPlatform,
  PlatformCredentials,
  ConnectCredentialsResponse,
} from './types';

export const DEFAULT_BASE_URL = 'https://api.indreelforge.com';
const MAX_PHOTOS = 10;

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  method?: string;
  query?: Query;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

function qs(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

function requireArg(value: unknown, name: string): void {
  if (value === undefined || value === null || value === '') {
    throw new TypeError(`${name} is required`);
  }
}

/** Read a local file as a Blob, streaming from disk where the runtime supports it. */
async function fileBlob(path: string): Promise<Blob> {
  const openAsBlob = (fs as unknown as { openAsBlob?: (p: string) => Promise<Blob> }).openAsBlob;
  if (typeof openAsBlob === 'function') return openAsBlob(path);
  return new Blob([readFileSync(path)]);
}

function appendOption(form: FormData, key: string, value: PlatformOptions[string]): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const v of value) form.append(key, String(v));
  } else if (typeof value === 'object') {
    form.append(key, JSON.stringify(value));
  } else {
    form.append(key, String(value));
  }
}

/**
 * Official Node.js client for the IndReelForge Social Media API.
 *
 * @example
 * const client = new IndReelForge({ apiKey: process.env.INDREELFORGE_API_KEY! });
 * await client.uploadVideo({ user: 'my-profile', platforms: ['tiktok'], videoPath: './clip.mp4' });
 */
export class IndReelForge {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private fetchImpl: typeof fetch;
  private extraHeaders: Record<string, string>;

  constructor(config: IndReelForgeConfig) {
    if (!config || !config.apiKey) throw new Error('API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = config.timeout || 120000;
    const f = config.fetch || (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof f !== 'function') {
      throw new Error('No fetch implementation available. Use Node.js >= 18 or pass `fetch` in the config.');
    }
    this.fetchImpl = f;
    this.extraHeaders = config.headers || {};
  }

  // ── Core request ──────────────────────────────────────────────────────────

  private async request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const headers: Record<string, string> = {
      'User-Agent': `indreelforge-node/${VERSION}`,
      Accept: 'application/json',
      ...this.extraHeaders,
      Authorization: `Apikey ${this.apiKey}`,
      ...opts.headers,
    };
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form;
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}${qs(opts.query)}`, {
        method: opts.method || 'GET',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error)?.name === 'AbortError') {
        throw new IndReelForgeError(`Request timed out after ${this.timeout} ms`, 408, 'TIMEOUT');
      }
      throw new IndReelForgeError(
        `Connection failed: ${(err as Error)?.message || String(err)}`,
        0,
        'NETWORK_ERROR',
      );
    }

    try {
      const text = await res.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          /* non-JSON body: keep raw text */
        }
      } else {
        parsed = {};
      }

      if (!res.ok) {
        const obj = parsed && typeof parsed === 'object' ? (parsed as JsonObject) : null;
        const message =
          (obj && (obj.error_description || obj.error || obj.message)) ||
          (typeof parsed === 'string' && parsed.trim() ? parsed.trim().slice(0, 300) : `HTTP ${res.status}`);
        const code = (obj && (obj.error_code || obj.code)) || null;
        throw new IndReelForgeError(String(message), res.status, code ? String(code) : null, obj ?? parsed);
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof IndReelForgeError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new IndReelForgeError(`Request timed out after ${this.timeout} ms`, 408, 'TIMEOUT');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildForm(options: UploadOptions): FormData {
    requireArg(options.user, 'user');
    const form = new FormData();
    form.append('user', options.user);
    for (const p of options.platforms || []) form.append('platform[]', p);
    if (options.title) form.append('title', options.title);
    if (options.description) form.append('description', options.description);
    if (options.firstComment) form.append('first_comment', options.firstComment);
    if (options.schedule) form.append('schedule', options.schedule);
    if (options.timezone) form.append('timezone', options.timezone);
    if (options.addToQueue !== undefined) form.append('add_to_queue', String(options.addToQueue));
    if (options.asyncUpload !== undefined) form.append('async_upload', String(options.asyncUpload));
    if (options.requestId) form.append('request_id', options.requestId);
    if (options.instagramTitle) form.append('instagram_title', options.instagramTitle);
    if (options.youtubeTitle) form.append('youtube_title', options.youtubeTitle);
    if (options.youtubeDescription) form.append('youtube_description', options.youtubeDescription);
    if (options.youtubeTags) form.append('youtube_tags', options.youtubeTags.join(','));
    if (options.youtubePrivacy) form.append('youtube_privacy', options.youtubePrivacy);
    for (const [k, v] of Object.entries(options.platformOptions || {})) appendOption(form, k, v);
    return form;
  }

  private idemHeaders(key?: string): Record<string, string> | undefined {
    return key ? { 'Idempotency-Key': key } : undefined;
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  /** Upload a video (local file via `videoPath`, or a public URL via `videoUrl`). */
  async uploadVideo(options: UploadVideoOptions): Promise<UploadResponse> {
    if (!options.videoPath && !options.videoUrl) {
      throw new TypeError('uploadVideo requires `videoPath` or `videoUrl`');
    }
    const form = this.buildForm(options);
    if (options.videoPath) {
      form.append('video', await fileBlob(options.videoPath), basename(options.videoPath));
    } else {
      form.append('video', options.videoUrl as string);
    }
    return this.request('/api/upload', {
      method: 'POST',
      form,
      headers: this.idemHeaders(options.idempotencyKey),
    });
  }

  /** Upload photos / a carousel (local files via `photoPaths` and/or public URLs via `photoUrls`; max 10). */
  async uploadPhotos(options: UploadPhotoOptions): Promise<UploadResponse> {
    const paths = options.photoPaths || [];
    const urls = options.photoUrls || [];
    if (paths.length + urls.length === 0) {
      throw new TypeError('uploadPhotos requires `photoPaths` or `photoUrls`');
    }
    if (paths.length + urls.length > MAX_PHOTOS) {
      throw new TypeError(`uploadPhotos accepts at most ${MAX_PHOTOS} photos`);
    }
    const form = this.buildForm(options);
    for (const p of paths) form.append('photos[]', await fileBlob(p), basename(p));
    for (const u of urls) form.append('photo_urls[]', u);
    return this.request('/api/upload_photos', {
      method: 'POST',
      form,
      headers: this.idemHeaders(options.idempotencyKey),
    });
  }

  /** Publish a text-only post (`text` or `title`). */
  async uploadText(options: UploadTextOptions): Promise<UploadResponse> {
    const text = options.text ?? options.title;
    if (!text) throw new TypeError('uploadText requires `text` (or `title`)');
    const form = this.buildForm({ ...options, title: undefined });
    form.append('text', text);
    return this.request('/api/upload_text', {
      method: 'POST',
      form,
      headers: this.idemHeaders(options.idempotencyKey),
    });
  }

  /** Publish a LinkedIn document post (PDF, PPT, PPTX, DOC, DOCX). */
  async uploadDocument(options: UploadDocumentOptions): Promise<UploadResponse> {
    requireArg(options.user, 'user');
    requireArg(options.documentPath, 'documentPath');
    const form = new FormData();
    form.append('user', options.user);
    if (options.title) form.append('title', options.title);
    if (options.description) form.append('description', options.description);
    if (options.firstComment) form.append('first_comment', options.firstComment);
    if (options.visibility) form.append('visibility', options.visibility);
    if (options.targetLinkedinPageId) form.append('target_linkedin_page_id', options.targetLinkedinPageId);
    if (options.schedule) form.append('schedule', options.schedule);
    if (options.timezone) form.append('timezone', options.timezone);
    if (options.requestId) form.append('request_id', options.requestId);
    for (const [k, v] of Object.entries(options.platformOptions || {})) appendOption(form, k, v);
    form.append('document', await fileBlob(options.documentPath), basename(options.documentPath));
    return this.request('/api/upload_document', {
      method: 'POST',
      form,
      headers: this.idemHeaders(options.idempotencyKey),
    });
  }

  // ── Uploads / status ──────────────────────────────────────────────────────

  /** Current account: plan, monthly usage, API key id. */
  async getMe(): Promise<Me> {
    return this.request('/api/me');
  }

  /** Status of one upload (per-platform results, post ids, errors). */
  async getUploadStatus(uploadId: string): Promise<UploadStatusResponse> {
    requireArg(uploadId, 'uploadId');
    return this.request(`/api/upload/${seg(uploadId)}/status`);
  }

  /** Look an upload up by your own `requestId` (or by upload id). */
  async getRequestStatus(requestId: string): Promise<UploadStatusResponse> {
    requireArg(requestId, 'requestId');
    return this.request('/api/uploadposts/status', { query: { request_id: requestId } });
  }

  /** Paginated upload history. */
  async listUploads(options: ListUploadsOptions = {}): Promise<ListUploadsResponse> {
    return this.request('/api/uploads', {
      query: { limit: options.limit, page: options.page, status: options.status },
    });
  }

  /** A single upload record. */
  async getUpload(uploadId: string): Promise<UploadRecord> {
    requireArg(uploadId, 'uploadId');
    return this.request(`/api/uploads/${seg(uploadId)}`);
  }

  /** Delete an upload record (and its stored media). Not allowed while processing. */
  async deleteUpload(uploadId: string): Promise<JsonObject> {
    requireArg(uploadId, 'uploadId');
    return this.request(`/api/uploads/${seg(uploadId)}`, { method: 'DELETE' });
  }

  /** Retry a failed upload. */
  async retryUpload(uploadId: string): Promise<JsonObject> {
    requireArg(uploadId, 'uploadId');
    return this.request(`/api/uploads/${seg(uploadId)}/retry`, { method: 'POST' });
  }

  /** Per-platform daily posting limits and current usage. */
  async getPlatformLimits(): Promise<JsonObject> {
    return this.request('/api/platform-limits');
  }

  // ── Profiles ──────────────────────────────────────────────────────────────

  /** List all profiles. */
  async getProfiles(): Promise<ProfilesResponse> {
    return this.request('/api/profiles');
  }

  /** Create a new profile. */
  async createProfile(name: string): Promise<{ profile: Profile } & JsonObject> {
    requireArg(name, 'name');
    return this.request('/api/profiles', { method: 'POST', json: { name } });
  }

  /** Delete a profile. */
  async deleteProfile(name: string): Promise<{ message: string } & JsonObject> {
    requireArg(name, 'name');
    return this.request(`/api/profiles/${seg(name)}`, { method: 'DELETE' });
  }

  /**
   * Connect a platform that uses credentials instead of OAuth (Discord, Telegram,
   * Slack, Mastodon, WordPress). The server verifies them live before saving;
   * connecting again replaces the stored credentials.
   *
   * Errors: 400 with `code` MISSING_FIELD / FIELD_TOO_LONG / INVALID_CREDENTIALS
   * (`err.body.details.field` names the field), 404 unknown profile, 502 platform unreachable.
   *
   * @example
   * await client.connectWithCredentials('my-brand', 'mastodon', {
   *   instance_url: 'https://mastodon.social', access_token: '...',
   * });
   */
  async connectWithCredentials<P extends CredentialPlatform | (string & {})>(
    profile: string,
    platform: P,
    credentials: P extends CredentialPlatform ? PlatformCredentials[P] : Record<string, string>,
  ): Promise<ConnectCredentialsResponse> {
    requireArg(profile, 'profile');
    requireArg(platform, 'platform');
    if (!credentials || typeof credentials !== 'object') throw new TypeError('credentials is required');
    return this.request(`/api/profiles/${seg(profile)}/connect/${seg(platform)}/credentials`, {
      method: 'POST',
      json: credentials,
    });
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  /** All scheduled (not yet published) posts. */
  async getScheduledPosts(): Promise<{ scheduled_posts: ScheduledPost[] }> {
    return this.request('/api/schedule');
  }

  /** Reschedule or edit a scheduled post. */
  async updateScheduledPost(jobId: string, options: UpdateScheduledPostOptions): Promise<JsonObject> {
    requireArg(jobId, 'jobId');
    const body: JsonObject = {};
    if (options.scheduledDate !== undefined) body.scheduled_date = options.scheduledDate;
    if (options.timezone !== undefined) body.timezone = options.timezone;
    if (options.title !== undefined) body.title = options.title;
    if (options.caption !== undefined) body.caption = options.caption;
    return this.request(`/api/schedule/${seg(jobId)}`, { method: 'PATCH', json: body });
  }

  /** Cancel a scheduled post. */
  async cancelScheduledPost(jobId: string): Promise<JsonObject> {
    requireArg(jobId, 'jobId');
    return this.request(`/api/schedule/${seg(jobId)}`, { method: 'DELETE' });
  }

  // ── Queue ─────────────────────────────────────────────────────────────────

  /** Queue settings (time slots, days, timezone) for a profile. */
  async getQueueSettings(profile: string): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request('/api/queue/settings', { query: { profile } });
  }

  /** Create or update a profile's queue settings. */
  async updateQueueSettings(options: UpdateQueueSettingsOptions): Promise<JsonObject> {
    requireArg(options?.profile, 'profile');
    const body: JsonObject = { profile_username: options.profile };
    if (options.slots !== undefined) body.slots = options.slots;
    if (options.daysOfWeek !== undefined) body.days_of_week = options.daysOfWeek;
    if (options.timezone !== undefined) body.timezone = options.timezone;
    if (options.maxPostsPerSlot !== undefined) body.max_posts_per_slot = options.maxPostsPerSlot;
    return this.request('/api/queue/settings', { method: 'POST', json: body });
  }

  /** Upcoming queue slots for a profile. */
  async getQueuePreview(profile: string, count?: number): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request('/api/queue/preview', { query: { profile, count } });
  }

  /** The next free queue slot for a profile. */
  async getNextQueueSlot(profile: string): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request('/api/queue/next-slot', { query: { profile } });
  }

  // ── Platform helpers ──────────────────────────────────────────────────────

  /** Facebook pages available to the profile (use the id as `facebook_page_id`). */
  async getFacebookPages(profile: string): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request('/api/platforms/facebook/pages', { query: { profile } });
  }

  /** LinkedIn company pages (use the id as `target_linkedin_page_id`). */
  async getLinkedInPages(profile: string): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request('/api/platforms/linkedin/pages', { query: { profile } });
  }

  /** Pinterest boards (use the id as `pinterest_board_id`). */
  async getPinterestBoards(profile: string): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request('/api/platforms/pinterest/boards', { query: { profile } });
  }

  /** Google Business Profile locations (use the id as `gbp_location_id`). */
  async getGoogleBusinessLocations(profile: string): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request('/api/platforms/google-business/locations', { query: { profile } });
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  /** Account analytics overview (e.g. range "7d", "30d", "90d"). */
  async getAnalytics(range = '30d'): Promise<AnalyticsOverview> {
    return this.request('/api/analytics/overview', { query: { range } });
  }

  /** Live follower / engagement stats pulled from the platforms for a profile. */
  async getLiveAnalytics(profile: string, platforms?: string[]): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request(`/api/analytics/live/${seg(profile)}`, {
      query: { platforms: platforms && platforms.length ? platforms.join(',') : undefined },
    });
  }

  /** Per-post analytics for an upload (optionally a single platform). */
  async getPostAnalytics(uploadId: string, platform?: string): Promise<JsonObject> {
    requireArg(uploadId, 'uploadId');
    return this.request(`/api/analytics/post/${seg(uploadId)}`, { query: { platform } });
  }

  /** Total impressions for a profile. */
  async getTotalImpressions(profile: string, options: TotalImpressionsOptions = {}): Promise<JsonObject> {
    requireArg(profile, 'profile');
    return this.request(`/api/analytics/total-impressions/${seg(profile)}`, {
      query: {
        platform: options.platform,
        period: options.period,
        start_date: options.startDate,
        end_date: options.endDate,
      },
    });
  }

  // ── FFmpeg ────────────────────────────────────────────────────────────────

  /** FFmpeg processing minutes used / remaining this month. */
  async getFfmpegUsage(): Promise<JsonObject> {
    return this.request('/api/ffmpeg/usage');
  }

  /** Recent FFmpeg jobs (latest 50). */
  async listFfmpegJobs(): Promise<{ jobs: JsonObject[] }> {
    return this.request('/api/ffmpeg/jobs');
  }

  /** A single FFmpeg job. */
  async getFfmpegJob(jobId: string): Promise<JsonObject> {
    requireArg(jobId, 'jobId');
    return this.request(`/api/ffmpeg/jobs/${seg(jobId)}`);
  }

  // ── Plans ─────────────────────────────────────────────────────────────────

  /** List available plans. */
  async getPlans(): Promise<{ plans: Plan[] } & JsonObject> {
    return this.request('/api/plans');
  }
}

/**
 * @deprecated Use {@link IndReelForge}. Alias kept for 1.0.x code.
 */
export const InReelForge = IndReelForge;
/** @deprecated Use {@link IndReelForge}. */
export type InReelForge = IndReelForge;
