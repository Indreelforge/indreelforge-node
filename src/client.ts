import { readFileSync, createWriteStream } from 'fs';
import * as fs from 'fs';
import { open, stat, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';
import { PostUploadError } from './errors';
import { VERSION } from './version';
import { CHUNKED_THRESHOLD_BYTES } from './types';
import type {
  PostUploadConfig,
  VideoSource,
  ChunkedUploadOptions,
  CreateUploadSessionOptions,
  UploadSession,
  UploadSessionStatus,
  CompleteUploadSessionResponse,
  UploadProgress,
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

export const DEFAULT_BASE_URL = 'https://api.post-upload.com';
/** Parts can be up to 32 MiB; give each PUT at least this long. */
const MIN_PART_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 5;
const MAX_PHOTOS = 10;

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  method?: string;
  query?: Query;
  json?: unknown;
  form?: FormData;
  /** Raw bytes sent as application/octet-stream. */
  raw?: Uint8Array;
  headers?: Record<string, string>;
  /** Overrides the client timeout for this request. */
  timeout?: number;
}

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

function guessVideoMime(filename: string): string {
  return VIDEO_MIME[extname(filename).toLowerCase()] || 'video/mp4';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array;
}

function isStreamLike(v: unknown): v is NodeJS.ReadableStream | AsyncIterable<Uint8Array> {
  return !!v && typeof v === 'object' && typeof (v as any)[Symbol.asyncIterator] === 'function';
}

/** Reads a source part by part: `chunkSize` bytes per part (fewer only for the last). */
interface PartReader {
  size: number;
  read(index: number, chunkSize: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

async function fileReader(path: string): Promise<PartReader> {
  const size = (await stat(path)).size;
  const handle = await open(path, 'r');
  return {
    size,
    async read(index, chunkSize) {
      const start = index * chunkSize;
      const length = Math.max(0, Math.min(chunkSize, size - start));
      const buf = Buffer.alloc(length);
      let off = 0;
      while (off < length) {
        const { bytesRead } = await handle.read(buf, off, length - off, start + off);
        if (bytesRead === 0) throw new Error(`Unexpected end of file reading ${path}`);
        off += bytesRead;
      }
      return buf;
    },
    close: () => handle.close(),
  };
}

function bufferReader(bytes: Uint8Array): PartReader {
  return {
    size: bytes.byteLength,
    async read(index, chunkSize) {
      const start = index * chunkSize;
      return bytes.subarray(start, Math.min(start + chunkSize, bytes.byteLength));
    },
    close: async () => {},
  };
}

/** Sequential reader over a stream of known size (parts must be read in order). */
function streamReader(stream: AsyncIterable<Uint8Array | string>, size: number): PartReader {
  const it = stream[Symbol.asyncIterator]();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let next = 0;
  return {
    size,
    async read(index, chunkSize) {
      if (index !== next) throw new Error('Stream parts must be read in order');
      next++;
      const want = Math.min(chunkSize, size - index * chunkSize);
      while (pendingBytes < want) {
        const r = await it.next();
        if (r.done) break;
        const c = typeof r.value === 'string' ? Buffer.from(r.value) : r.value;
        pending.push(c);
        pendingBytes += c.byteLength;
      }
      if (pendingBytes < want) {
        throw new TypeError(`The stream ended after ${index * chunkSize + pendingBytes} bytes, but size is ${size}`);
      }
      const all = Buffer.concat(pending);
      const part = all.subarray(0, want);
      const rest = all.subarray(want);
      pending = rest.byteLength ? [rest] : [];
      pendingBytes = rest.byteLength;
      return part;
    },
    close: async () => {
      if (typeof it.return === 'function') await it.return().catch(() => undefined);
    },
  };
}

/** Write a stream of unknown size to a temporary file; returns its path and a cleanup function. */
async function spoolToTempFile(stream: AsyncIterable<Uint8Array | string>): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'post-upload-'));
  const path = join(dir, 'upload.bin');
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const out = createWriteStream(path);
    const done = new Promise<void>((resolve, reject) => {
      out.on('error', reject);
      out.on('finish', () => resolve());
    });
    for await (const chunk of stream) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    out.end();
    await done;
    return { path, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/** Buffer a whole stream (only for a stream sent in a single request). */
async function collect(stream: NodeJS.ReadableStream | AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of stream as AsyncIterable<Uint8Array | string>) parts.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(parts);
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
 * Official Node.js client for the Post-Upload Social Media API.
 *
 * @example
 * const client = new PostUpload(process.env.POST_UPLOAD_API_KEY!);
 * await client.uploadVideo('./clip.mp4', { user: 'my-profile', platforms: ['tiktok'] });
 */
export class PostUpload {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private fetchImpl: typeof fetch;
  private extraHeaders: Record<string, string>;
  private retryBaseDelayMs: number;

  /**
   * @param config Options object, or just the API key (`new PostUpload('key')`,
   *   optionally followed by the other options).
   */
  constructor(config: PostUploadConfig | string, options: Omit<PostUploadConfig, 'apiKey'> = {}) {
    if (typeof config === 'string') config = { ...options, apiKey: config };
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
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 1000;
  }

  // ── Core request ──────────────────────────────────────────────────────────

  private async request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = opts.timeout ?? this.timeout;
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      'User-Agent': `post-upload-node/${VERSION}`,
      Accept: 'application/json',
      ...this.extraHeaders,
      Authorization: `Apikey ${this.apiKey}`,
      ...opts.headers,
    };
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form;
    } else if (opts.raw) {
      headers['Content-Type'] = 'application/octet-stream';
      body = opts.raw as unknown as BodyInit;
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
        throw new PostUploadError(`Request timed out after ${timeout} ms`, 408, 'TIMEOUT');
      }
      throw new PostUploadError(
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
        const error = new PostUploadError(String(message), res.status, code ? String(code) : null, obj ?? parsed);
        const retryAfterRaw = res.headers.get('retry-after');
        const retryAfter = Number(retryAfterRaw);
        if (retryAfterRaw !== null && retryAfterRaw.trim() !== '' && Number.isFinite(retryAfter) && retryAfter >= 0) {
          error.retryAfter = retryAfter;
        }
        throw error;
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof PostUploadError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new PostUploadError(`Request timed out after ${timeout} ms`, 408, 'TIMEOUT');
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

  /**
   * Upload a video: a local file (`videoPath`, or a path as the first argument), a Buffer or
   * stream (`video`), a public URL (`videoUrl`, up to 500 MB, downloaded by the server) or a
   * file already sent in parts (`stagedFileId`).
   *
   * Files larger than {@link CHUNKED_THRESHOLD_BYTES} (95 MiB) are sent automatically with the
   * chunked upload endpoints (up to 500 MB); force or disable that with `chunked`.
   *
   * @example
   * await client.uploadVideo('./video.mp4', { user: 'my-profile', platforms: ['youtube'], title: 'Hi' });
   */
  async uploadVideo(options: UploadVideoOptions): Promise<UploadResponse>;
  async uploadVideo(source: VideoSource, options: Omit<UploadVideoOptions, 'videoPath' | 'video' | 'videoUrl' | 'stagedFileId'>): Promise<UploadResponse>;
  async uploadVideo(sourceOrOptions: VideoSource | UploadVideoOptions, maybeOptions?: UploadOptions): Promise<UploadResponse> {
    let options: UploadVideoOptions;
    if (
      maybeOptions !== undefined ||
      typeof sourceOrOptions === 'string' ||
      isBytes(sourceOrOptions) ||
      isStreamLike(sourceOrOptions)
    ) {
      const source = sourceOrOptions as VideoSource;
      options = { ...(maybeOptions as UploadVideoOptions) };
      if (typeof source === 'string') {
        if (/^https?:\/\//i.test(source)) options.videoUrl = source;
        else options.videoPath = source;
      } else {
        options.video = source;
      }
    } else {
      options = sourceOrOptions as UploadVideoOptions;
    }

    const given = [options.videoPath, options.video, options.videoUrl, options.stagedFileId].filter(
      (v) => v !== undefined && v !== null && v !== '',
    );
    if (given.length === 0) {
      throw new TypeError('uploadVideo requires `videoPath`, `video`, `videoUrl` or `stagedFileId`');
    }
    if (given.length > 1) {
      throw new TypeError('uploadVideo takes only one of `videoPath`, `video`, `videoUrl` or `stagedFileId`');
    }
    // Validate the post fields before sending any file data.
    const form = this.buildForm(options);

    let stagedFileId = options.stagedFileId;
    const local = options.videoPath ?? options.video;
    if (local !== undefined && (await this.shouldChunk(local, options))) {
      const done = await this.uploadLargeFile(local, {
        filename: options.filename,
        mimeType: options.mimeType,
        size: options.size,
        onProgress: options.onProgress,
        maxRetries: options.maxRetries,
      });
      stagedFileId = done.staged_file_id;
    }

    if (stagedFileId) {
      form.append('staged_file_id', stagedFileId);
    } else if (options.videoPath) {
      form.append('video', await fileBlob(options.videoPath), basename(options.videoPath));
    } else if (options.video !== undefined) {
      const name = options.filename || 'video.mp4';
      const type = options.mimeType || guessVideoMime(name);
      const bytes = isBytes(options.video) ? options.video : await collect(options.video);
      form.append('video', new Blob([bytes as unknown as BlobPart], { type }), name);
    } else {
      form.append('video', options.videoUrl as string);
    }
    return this.request('/api/upload', {
      method: 'POST',
      form,
      headers: this.idemHeaders(options.idempotencyKey),
    });
  }

  private async shouldChunk(source: VideoSource, options: UploadVideoOptions): Promise<boolean> {
    const mode = options.chunked ?? 'auto';
    if (mode === true) return true;
    if (mode === false) return false;
    let size: number | undefined;
    if (typeof source === 'string') size = (await stat(source)).size;
    else if (isBytes(source)) size = source.byteLength;
    else size = options.size;
    // A stream of unknown size goes in a single request unless `chunked: true`.
    return size !== undefined && size > CHUNKED_THRESHOLD_BYTES;
  }

  // ── Chunked upload (large videos, up to 500 MB) ───────────────────────────

  /**
   * Start a chunked upload session (`POST /api/upload/chunked/init`). Send every part with
   * {@link uploadPart}, then call {@link completeUploadSession}. Most callers want
   * {@link uploadLargeFile} or `uploadVideo`, which do all of this.
   */
  async createUploadSession(options: CreateUploadSessionOptions): Promise<UploadSession> {
    requireArg(options?.filename, 'filename');
    if (!Number.isInteger(options.size) || options.size <= 0) {
      throw new TypeError('size must be a positive number of bytes');
    }
    return this.request('/api/upload/chunked/init', {
      method: 'POST',
      json: {
        filename: options.filename,
        size: options.size,
        mime_type: options.mime_type || guessVideoMime(options.filename),
      },
    });
  }

  /**
   * Send one part (`PUT /api/upload/chunked/:id/:index`). Every part must be exactly the
   * session's `chunk_size` bytes except the last. Single attempt; re-sending an index replaces it.
   */
  async uploadPart(sessionId: string, index: number, bytes: Uint8Array): Promise<JsonObject> {
    requireArg(sessionId, 'sessionId');
    if (!Number.isInteger(index) || index < 0) throw new TypeError('index must be a non-negative integer');
    if (!isBytes(bytes)) throw new TypeError('bytes must be a Buffer or Uint8Array');
    return this.request(`/api/upload/chunked/${seg(sessionId)}/${index}`, {
      method: 'PUT',
      raw: bytes,
      timeout: Math.max(this.timeout, MIN_PART_TIMEOUT_MS),
    });
  }

  /** Assemble the parts (`POST /api/upload/chunked/:id/complete`); returns the `staged_file_id`. */
  async completeUploadSession(sessionId: string): Promise<CompleteUploadSessionResponse> {
    requireArg(sessionId, 'sessionId');
    return this.request(`/api/upload/chunked/${seg(sessionId)}/complete`, {
      method: 'POST',
      timeout: Math.max(this.timeout, MIN_PART_TIMEOUT_MS),
    });
  }

  /** Parts received so far (`GET /api/upload/chunked/:id`), to resume an interrupted upload. */
  async getUploadSession(sessionId: string): Promise<UploadSessionStatus> {
    requireArg(sessionId, 'sessionId');
    return this.request(`/api/upload/chunked/${seg(sessionId)}`);
  }

  /** Cancel a chunked upload and delete its parts (`DELETE /api/upload/chunked/:id`). */
  async abortUploadSession(sessionId: string): Promise<JsonObject> {
    requireArg(sessionId, 'sessionId');
    return this.request(`/api/upload/chunked/${seg(sessionId)}`, { method: 'DELETE' });
  }

  /**
   * Send a large video with the chunked upload endpoints: init → parts (sequential, retried on
   * 429 / 5xx / network errors) → complete. Resolves with the `staged_file_id` to post with
   * `uploadVideo({ stagedFileId })` (usable once, within 6 hours). The session is cancelled if a
   * step fails for good.
   *
   * `source` is a file path, a Buffer / Uint8Array, or a readable stream. Files are read part by
   * part; a stream with `size` is read part by part, and a stream without `size` is first written
   * to a temporary file (deleted afterwards).
   */
  async uploadLargeFile(source: VideoSource, options: ChunkedUploadOptions = {}): Promise<CompleteUploadSessionResponse> {
    let reader: PartReader;
    let cleanup: (() => Promise<void>) | undefined;
    let filename = options.filename;
    if (typeof source === 'string') {
      reader = await fileReader(source);
      filename ||= basename(source);
    } else if (isBytes(source)) {
      reader = bufferReader(source);
    } else if (isStreamLike(source)) {
      if (options.size !== undefined) {
        if (!Number.isInteger(options.size) || options.size <= 0) {
          throw new TypeError('size must be a positive number of bytes');
        }
        reader = streamReader(source as AsyncIterable<Uint8Array>, options.size);
      } else {
        const spooled = await spoolToTempFile(source as AsyncIterable<Uint8Array>);
        cleanup = spooled.cleanup;
        reader = await fileReader(spooled.path);
      }
    } else {
      throw new TypeError('source must be a file path, a Buffer / Uint8Array or a readable stream');
    }
    const name = filename || 'video.mp4';
    const attempts = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);

    try {
      if (reader.size <= 0) throw new TypeError('The file is empty');
      const session = await this.withRetry(
        () => this.createUploadSession({ filename: name, size: reader.size, mime_type: options.mimeType || guessVideoMime(name) }),
        attempts,
        // 5 sessions already in progress: waiting won't help.
        (err) => err.code !== 'TOO_MANY_CHUNKED_UPLOADS',
      );
      const id = session.upload_session_id;
      try {
        const chunkSize = session.chunk_size;
        const totalParts = session.total_chunks ?? Math.ceil(reader.size / chunkSize);
        let uploadedBytes = 0;
        for (let index = 0; index < totalParts; index++) {
          const bytes = await reader.read(index, chunkSize);
          await this.withRetry(() => this.uploadPart(id, index, bytes), attempts);
          uploadedBytes += bytes.byteLength;
          const progress: UploadProgress = { uploadedBytes, totalBytes: reader.size, part: index + 1, totalParts };
          options.onProgress?.(progress);
        }
        return await this.withRetry(() => this.completeUploadSession(id), attempts);
      } catch (err) {
        await this.abortUploadSession(id).catch(() => undefined);
        throw err;
      }
    } finally {
      await reader.close().catch(() => undefined);
      if (cleanup) await cleanup().catch(() => undefined);
    }
  }

  /** Retry `fn` on network errors, timeouts, 429 and 5xx (honouring Retry-After), up to `attempts` tries. */
  private async withRetry<T>(
    fn: () => Promise<T>,
    attempts: number,
    alsoRequire: (err: PostUploadError) => boolean = () => true,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const retryable =
          err instanceof PostUploadError &&
          (err.status === 0 || err.status === 408 || err.status === 429 || (err.status >= 500 && err.status !== 501)) &&
          err.code !== 'INSUFFICIENT_STORAGE' &&
          alsoRequire(err);
        if (!retryable || attempt >= attempts) throw err;
        const backoff = Math.min(30_000, this.retryBaseDelayMs * 2 ** (attempt - 1));
        const delay =
          err.retryAfter != null ? Math.min(err.retryAfter * 1000, 120_000) : backoff + Math.random() * backoff * 0.2;
        await sleep(delay);
      }
    }
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
   * Slack, Mastodon, WordPress, Dev.to, Hashnode, Lemmy, Nostr, Whop, Listmonk). The server verifies them live before saving;
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
 * @deprecated Use {@link PostUpload}. Alias kept from the `indreelforge` package
 * (the same class, so `instanceof` keeps working).
 */
export const IndReelForge = PostUpload;
/** @deprecated Use {@link PostUpload}. */
export type IndReelForge = PostUpload;

/**
 * @deprecated Use {@link PostUpload}. Alias kept for 1.0.x code.
 */
export const InReelForge = PostUpload;
/** @deprecated Use {@link PostUpload}. */
export type InReelForge = PostUpload;
