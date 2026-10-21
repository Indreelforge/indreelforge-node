import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import IndReelForgeDefault, {
  IndReelForge,
  InReelForge,
  IndReelForgeError,
  InReelForgeError,
  VERSION,
} from '../dist/index.mjs';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** Build a mock fetch that records calls and replies with queued responses. */
function mockFetch(...responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.length > 1 ? responses.shift() : responses[0] ?? { status: 200, body: {} };
    if (r instanceof Error) throw r;
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return new Response(r.status === 204 ? null : body, {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers || {}) },
    });
  };
  fn.calls = calls;
  return fn;
}

function client(fetch, extra = {}) {
  return new IndReelForge({ apiKey: 'test-key', baseUrl: 'https://api.example.test/', fetch, ...extra });
}

function formEntries(form) {
  const out = {};
  for (const [k, v] of form.entries()) (out[k] ||= []).push(v);
  return out;
}

const tmp = mkdtempSync(join(tmpdir(), 'irf-sdk-'));
const videoPath = join(tmp, 'clip.mp4');
const photoPath = join(tmp, 'a.jpg');
const docPath = join(tmp, 'deck.pdf');
writeFileSync(videoPath, Buffer.from('fake-video'));
writeFileSync(photoPath, Buffer.from('fake-jpg'));
writeFileSync(docPath, Buffer.from('%PDF-1.4'));

test('version matches package.json and exports/aliases exist', () => {
  assert.equal(VERSION, pkg.version);
  assert.equal(VERSION, '1.1.0');
  assert.equal(IndReelForgeDefault, IndReelForge);
  assert.equal(InReelForge, IndReelForge);
  assert.equal(InReelForgeError, IndReelForgeError);
  const cjs = require('../dist/index.js');
  assert.equal(typeof cjs.IndReelForge, 'function');
  assert.equal(cjs.InReelForge, cjs.IndReelForge);
  assert.equal(cjs.default, cjs.IndReelForge);
});

test('constructor requires an API key', () => {
  assert.throws(() => new IndReelForge({ apiKey: '' }), /API key is required/);
});

test('sends auth, user agent and strips trailing slash from baseUrl', async () => {
  const f = mockFetch({ body: { id: 1, email: 'a@b.c', plan: 'free' } });
  const me = await client(f).getMe();
  assert.equal(me.plan, 'free');
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.example.test/api/me');
  assert.equal(init.method, 'GET');
  assert.equal(init.headers.Authorization, 'Apikey test-key');
  assert.equal(init.headers['User-Agent'], `indreelforge-node/${VERSION}`);
});

test('uploadVideo (file) builds multipart form with all options', async () => {
  const f = mockFetch({ status: 201, body: { success: true, message: 'ok', data: { upload_id: 'u1', platforms: {} } } });
  const res = await client(f).uploadVideo({
    user: 'brand',
    platforms: ['tiktok', 'youtube', 'google_business'],
    videoPath,
    title: 'T',
    description: 'D',
    firstComment: 'FC',
    schedule: '2030-01-01T10:00:00Z',
    timezone: 'UTC',
    addToQueue: false,
    asyncUpload: false,
    requestId: 'req-1',
    idempotencyKey: 'idem-1',
    youtubeTags: ['a', 'b'],
    youtubePrivacy: 'unlisted',
    platformOptions: {
      privacy_level: 'PUBLIC_TO_EVERYONE',
      disable_duet: true,
      poll_options: ['x', 'y'],
      user_tags: { a: 1 },
      skip_me: undefined,
      skip_null: null,
    },
  });
  assert.equal(res.data.upload_id, 'u1');
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.example.test/api/upload');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Idempotency-Key'], 'idem-1');
  assert.equal(init.headers['Content-Type'], undefined, 'fetch sets multipart boundary itself');
  const e = formEntries(init.body);
  assert.deepEqual(e.user, ['brand']);
  assert.deepEqual(e['platform[]'], ['tiktok', 'youtube', 'google_business']);
  assert.deepEqual(e.title, ['T']);
  assert.deepEqual(e.description, ['D']);
  assert.deepEqual(e.first_comment, ['FC']);
  assert.deepEqual(e.schedule, ['2030-01-01T10:00:00Z']);
  assert.deepEqual(e.timezone, ['UTC']);
  assert.deepEqual(e.add_to_queue, ['false']);
  assert.deepEqual(e.async_upload, ['false']);
  assert.deepEqual(e.request_id, ['req-1']);
  assert.deepEqual(e.youtube_tags, ['a,b']);
  assert.deepEqual(e.youtube_privacy, ['unlisted']);
  assert.deepEqual(e.privacy_level, ['PUBLIC_TO_EVERYONE']);
  assert.deepEqual(e.disable_duet, ['true']);
  assert.deepEqual(e.poll_options, ['x', 'y']);
  assert.deepEqual(e.user_tags, ['{"a":1}']);
  assert.equal(e.skip_me, undefined);
  assert.equal(e.skip_null, undefined);
  const file = e.video[0];
  assert.equal(file.name, 'clip.mp4');
  assert.equal(await file.text(), 'fake-video');
});

test('uploadVideo (URL) sends the URL string in the video field', async () => {
  const f = mockFetch({ status: 201, body: { data: { upload_id: 'u2', platforms: {} } } });
  await client(f).uploadVideo({ user: 'brand', platforms: ['instagram'], videoUrl: 'https://cdn.example.com/v.mp4' });
  const e = formEntries(f.calls[0].init.body);
  assert.deepEqual(e.video, ['https://cdn.example.com/v.mp4']);
  assert.equal(f.calls[0].init.headers['Idempotency-Key'], undefined);
});

test('uploadVideo validates input before any request', async () => {
  const f = mockFetch({ body: {} });
  await assert.rejects(client(f).uploadVideo({ user: 'u', platforms: ['x'] }), /videoPath` or `videoUrl/);
  assert.equal(f.calls.length, 0);
});

test('uploadPhotos supports files and URLs, max 10', async () => {
  const f = mockFetch({ status: 201, body: { data: { upload_id: 'p1', platforms: {} } } });
  await client(f).uploadPhotos({
    user: 'brand',
    platforms: ['instagram'],
    photoPaths: [photoPath],
    photoUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
  });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.example.test/api/upload_photos');
  const e = formEntries(init.body);
  assert.equal(e['photos[]'].length, 1);
  assert.equal(e['photos[]'][0].name, 'a.jpg');
  assert.deepEqual(e['photo_urls[]'], ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg']);

  const many = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
  await assert.rejects(client(f).uploadPhotos({ user: 'b', platforms: ['instagram'], photoUrls: many }), /at most 10/);
  await assert.rejects(client(f).uploadPhotos({ user: 'b', platforms: ['instagram'] }), /photoPaths` or `photoUrls/);
});

test('uploadText sends text (title kept as backward-compatible alias)', async () => {
  const f = mockFetch({ status: 201, body: { data: { upload_id: 't1', platforms: {} } } });
  await client(f).uploadText({ user: 'brand', platforms: ['x', 'threads'], title: 'hello' });
  await client(f).uploadText({ user: 'brand', platforms: ['bluesky'], text: 'world' });
  assert.equal(f.calls[0].url, 'https://api.example.test/api/upload_text');
  assert.deepEqual(formEntries(f.calls[0].init.body).text, ['hello']);
  assert.equal(formEntries(f.calls[0].init.body).title, undefined);
  assert.deepEqual(formEntries(f.calls[1].init.body).text, ['world']);
  await assert.rejects(client(f).uploadText({ user: 'b', platforms: ['x'] }), /requires `text`/);
});

test('uploadDocument posts the document file', async () => {
  const f = mockFetch({ status: 201, body: { data: { upload_id: 'd1', platforms: {} } } });
  await client(f).uploadDocument({ user: 'brand', documentPath: docPath, title: 'Deck', visibility: 'PUBLIC', targetLinkedinPageId: '42', idempotencyKey: 'k' });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.example.test/api/upload_document');
  assert.equal(init.headers['Idempotency-Key'], 'k');
  const e = formEntries(init.body);
  assert.equal(e.document[0].name, 'deck.pdf');
  assert.deepEqual(e.visibility, ['PUBLIC']);
  assert.deepEqual(e.target_linkedin_page_id, ['42']);
});

test('read/manage endpoints hit the right method + path + query', async () => {
  const cases = [
    [(c) => c.getUploadStatus('u 1'), 'GET', '/api/upload/u%201/status'],
    [(c) => c.getRequestStatus('r1'), 'GET', '/api/uploadposts/status?request_id=r1'],
    [(c) => c.listUploads({ limit: 5, page: 2, status: 'failed' }), 'GET', '/api/uploads?limit=5&page=2&status=failed'],
    [(c) => c.listUploads(), 'GET', '/api/uploads'],
    [(c) => c.getUpload('u1'), 'GET', '/api/uploads/u1'],
    [(c) => c.deleteUpload('u1'), 'DELETE', '/api/uploads/u1'],
    [(c) => c.retryUpload('u1'), 'POST', '/api/uploads/u1/retry'],
    [(c) => c.getPlatformLimits(), 'GET', '/api/platform-limits'],
    [(c) => c.getProfiles(), 'GET', '/api/profiles'],
    [(c) => c.deleteProfile('my brand'), 'DELETE', '/api/profiles/my%20brand'],
    [(c) => c.getScheduledPosts(), 'GET', '/api/schedule'],
    [(c) => c.cancelScheduledPost('j1'), 'DELETE', '/api/schedule/j1'],
    [(c) => c.getQueueSettings('brand'), 'GET', '/api/queue/settings?profile=brand'],
    [(c) => c.getQueuePreview('brand', 5), 'GET', '/api/queue/preview?profile=brand&count=5'],
    [(c) => c.getNextQueueSlot('brand'), 'GET', '/api/queue/next-slot?profile=brand'],
    [(c) => c.getFacebookPages('brand'), 'GET', '/api/platforms/facebook/pages?profile=brand'],
    [(c) => c.getLinkedInPages('brand'), 'GET', '/api/platforms/linkedin/pages?profile=brand'],
    [(c) => c.getPinterestBoards('brand'), 'GET', '/api/platforms/pinterest/boards?profile=brand'],
    [(c) => c.getGoogleBusinessLocations('brand'), 'GET', '/api/platforms/google-business/locations?profile=brand'],
    [(c) => c.getAnalytics(), 'GET', '/api/analytics/overview?range=30d'],
    [(c) => c.getAnalytics('7d'), 'GET', '/api/analytics/overview?range=7d'],
    [(c) => c.getLiveAnalytics('brand', ['instagram', 'youtube']), 'GET', '/api/analytics/live/brand?platforms=instagram%2Cyoutube'],
    [(c) => c.getLiveAnalytics('brand'), 'GET', '/api/analytics/live/brand'],
    [(c) => c.getPostAnalytics('u1', 'tiktok'), 'GET', '/api/analytics/post/u1?platform=tiktok'],
    [(c) => c.getTotalImpressions('brand', { period: '30d' }), 'GET', '/api/analytics/total-impressions/brand?period=30d'],
    [(c) => c.getFfmpegUsage(), 'GET', '/api/ffmpeg/usage'],
    [(c) => c.listFfmpegJobs(), 'GET', '/api/ffmpeg/jobs'],
    [(c) => c.getFfmpegJob('j1'), 'GET', '/api/ffmpeg/jobs/j1'],
    [(c) => c.getPlans(), 'GET', '/api/plans'],
  ];
  for (const [call, method, path] of cases) {
    const f = mockFetch({ body: { ok: true } });
    await call(client(f));
    assert.equal(f.calls[0].init.method, method, path);
    assert.equal(f.calls[0].url, `https://api.example.test${path}`);
  }
});

test('JSON body endpoints send snake_case payloads', async () => {
  let f = mockFetch({ status: 201, body: { profile: { id: 1, name: 'n' } } });
  await client(f).createProfile('n');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { name: 'n' });

  f = mockFetch({ body: {} });
  await client(f).updateScheduledPost('j1', { scheduledDate: '2030-01-01T00:00:00Z', timezone: 'UTC', caption: 'c' });
  assert.equal(f.calls[0].init.method, 'PATCH');
  assert.equal(f.calls[0].url, 'https://api.example.test/api/schedule/j1');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { scheduled_date: '2030-01-01T00:00:00Z', timezone: 'UTC', caption: 'c' });

  f = mockFetch({ body: {} });
  await client(f).updateQueueSettings({ profile: 'brand', slots: ['09:00'], daysOfWeek: [1, 2], timezone: 'UTC', maxPostsPerSlot: 2 });
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].url, 'https://api.example.test/api/queue/settings');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), {
    profile_username: 'brand', slots: ['09:00'], days_of_week: [1, 2], timezone: 'UTC', max_posts_per_slot: 2,
  });
});

test('API errors become IndReelForgeError with status, code and body', async () => {
  const f = mockFetch({ status: 400, body: { error: 'Missing video', error_code: 'MISSING_VIDEO' } });
  await assert.rejects(client(f).getMe(), (err) => {
    assert.ok(err instanceof IndReelForgeError);
    assert.ok(err instanceof InReelForgeError);
    assert.equal(err.name, 'IndReelForgeError');
    assert.equal(err.message, 'Missing video');
    assert.equal(err.status, 400);
    assert.equal(err.code, 'MISSING_VIDEO');
    assert.deepEqual(err.body, { error: 'Missing video', error_code: 'MISSING_VIDEO' });
    return true;
  });

  const f2 = mockFetch({ status: 401, body: { error: 'Invalid session', code: 'INVALID_SESSION' } });
  await assert.rejects(client(f2).getMe(), (err) => err.status === 401 && err.code === 'INVALID_SESSION');

  const f3 = mockFetch({ status: 502, body: '<html>Bad gateway</html>', headers: { 'content-type': 'text/html' } });
  await assert.rejects(client(f3).getMe(), (err) => err.status === 502 && err.code === null && err.body === '<html>Bad gateway</html>');
});

test('network failures and timeouts map to IndReelForgeError', async () => {
  const f = mockFetch(new TypeError('fetch failed'));
  await assert.rejects(client(f).getMe(), (err) => err instanceof IndReelForgeError && err.status === 0 && err.code === 'NETWORK_ERROR');

  const hanging = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
    }));
  await assert.rejects(client(hanging, { timeout: 20 }).getMe(), (err) => err.status === 408 && err.code === 'TIMEOUT');
});

test('empty success bodies resolve to an empty object', async () => {
  const f = mockFetch({ status: 204 });
  assert.deepEqual(await client(f).deleteUpload('u1'), {});
});
