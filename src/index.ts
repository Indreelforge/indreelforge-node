import { readFileSync, createReadStream } from 'fs';
import { basename } from 'path';

export interface InReelForgeConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export type Platform =
  | 'instagram' | 'youtube' | 'tiktok' | 'facebook' | 'x'
  | 'linkedin' | 'threads' | 'pinterest' | 'reddit' | 'bluesky';

export interface UploadOptions {
  /** Profile name (managed user) */
  user: string;
  /** Platforms to upload to */
  platforms: Platform[];
  /** Post title / caption */
  title?: string;
  /** First comment (Instagram, Facebook, YouTube, X, TikTok) */
  firstComment?: string;
  /** Schedule ISO datetime string */
  schedule?: string;
  /** Timezone for scheduled posts */
  timezone?: string;
  /** Platform-specific overrides */
  instagramTitle?: string;
  youtubeTitle?: string;
  youtubeDescription?: string;
  youtubeTags?: string[];
  youtubePrivacy?: 'public' | 'private' | 'unlisted';
}

export interface UploadVideoOptions extends UploadOptions {
  /** Path to video file */
  videoPath: string;
}

export interface UploadPhotoOptions extends UploadOptions {
  /** Paths to photo files */
  photoPaths: string[];
}

export interface UploadTextOptions extends UploadOptions {
  /** Text content (required for text posts) */
  title: string;
}

export interface UploadResponse {
  status: string;
  message: string;
  data: {
    upload_id: string;
    platforms: string[];
    [key: string]: any;
  };
}

export interface Profile {
  id: number;
  name: string;
  platforms: Record<string, boolean>;
  created_at: string;
}

export interface ProfilesResponse {
  profiles: Profile[];
  usage: { current: number; limit: number };
}

export interface AnalyticsOverview {
  total_views: string;
  total_uploads: string;
  engagement_rate: string;
  followers_gained: string;
  views_trend?: string;
  uploads_trend?: string;
}

export interface Plan {
  name: string;
  slug: string;
  price_monthly: string;
  price_annual: string;
  features: string[];
}

class InReelForgeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'InReelForgeError';
    this.status = status;
  }
}

export class InReelForge {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: InReelForgeConfig) {
    if (!config.apiKey) throw new Error('API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://api.indreelforge.com').replace(/\/$/, '');
    this.timeout = config.timeout || 120000;
  }

  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Apikey ${this.apiKey}`,
          ...options.headers,
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new InReelForgeError(err.error || `HTTP ${res.status}`, res.status);
      }

      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Upload ──

  /**
   * Upload a video to one or more platforms.
   */
  async uploadVideo(options: UploadVideoOptions): Promise<UploadResponse> {
    const form = this.buildForm(options);

    // Read file and create blob
    const fileBuffer = readFileSync(options.videoPath);
    const blob = new Blob([fileBuffer]);
    form.append('video', blob, basename(options.videoPath));

    return this.request('/api/upload', {
      method: 'POST',
      body: form,
    });
  }

  /**
   * Upload photos to one or more platforms.
   */
  async uploadPhotos(options: UploadPhotoOptions): Promise<UploadResponse> {
    const form = this.buildForm(options);

    for (const photoPath of options.photoPaths) {
      const fileBuffer = readFileSync(photoPath);
      const blob = new Blob([fileBuffer]);
      form.append('photos[]', blob, basename(photoPath));
    }

    return this.request('/api/upload_photos', {
      method: 'POST',
      body: form,
    });
  }

  /**
   * Upload a text-only post to one or more platforms.
   */
  async uploadText(options: UploadTextOptions): Promise<UploadResponse> {
    const form = this.buildForm(options);
    return this.request('/api/upload_text', {
      method: 'POST',
      body: form,
    });
  }

  private buildForm(options: UploadOptions): FormData {
    const form = new FormData();
    form.append('user', options.user);
    for (const p of options.platforms) form.append('platform[]', p);
    if (options.title) form.append('title', options.title);
    if (options.firstComment) form.append('first_comment', options.firstComment);
    if (options.schedule) form.append('schedule', options.schedule);
    if (options.timezone) form.append('timezone', options.timezone);
    if (options.instagramTitle) form.append('instagram_title', options.instagramTitle);
    if (options.youtubeTitle) form.append('youtube_title', options.youtubeTitle);
    if (options.youtubeDescription) form.append('youtube_description', options.youtubeDescription);
    if (options.youtubeTags) form.append('youtube_tags', options.youtubeTags.join(','));
    if (options.youtubePrivacy) form.append('youtube_privacy', options.youtubePrivacy);
    return form;
  }

  // ── Profiles ──

  /** List all profiles */
  async getProfiles(): Promise<ProfilesResponse> {
    return this.request('/api/profiles');
  }

  /** Create a new profile */
  async createProfile(name: string): Promise<{ profile: Profile }> {
    return this.request('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  /** Delete a profile */
  async deleteProfile(name: string): Promise<{ message: string }> {
    return this.request(`/api/profiles/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  // ── Analytics ──

  /** Get analytics overview */
  async getAnalytics(range = '30d'): Promise<AnalyticsOverview> {
    return this.request(`/api/analytics/overview?range=${range}`);
  }

  // ── Plans ──

  /** List available plans */
  async getPlans(): Promise<{ plans: Plan[] }> {
    return this.request('/api/plans');
  }
}

export default InReelForge;
