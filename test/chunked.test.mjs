import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { PostUpload, PostUploadError, CHUNKED_THRESHOLD_BYTES } from '../dist/index.mjs';

const BASE = 'https://api.example.test';

/**
 * A fake chunked-upload server. `chunkSize` is what init returns; `partFailures`
 * maps a part index to a list of responses to send before accepting it.
 */
function fakeServer({ chunkSize = 4, partFailures = {}, initResponse, completeResponse, uploadResponse } = {}) {
  const calls = [];
  const parts = new Map();
  let session = null;
  const json = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    calls.push({ method, path: u.pathname, init });
    if (method === 'POST' && u.pathname === '/api/upload/chunked/init') {
      if (initResponse) return initResponse();
      const body = JSON.parse(init.body);
      session = { ...body, id: 'cus_1', total: Math.ceil(body.size / chunkSize) };
      return json(201, { success: true, upload_session_id: 'cus_1', chunk_size: chunkSize, total_chunks: session.total, expires_at: '2030-01-01T00:00:00Z' });
    }
    let m = u.pathname.match(/^\/api\/upload\/chunked\/([^/]+)\/(\d+)$/);
    if (method === 'PUT' && m) {
      const index = Number(m[2]);
      const queue = partFailures[index];
      if (queue && queue.length) {
        const f = queue.shift();
        if (f instanceof Error) throw f;
        return json(f.status, f.body || { error: 'fail' }, f.headers);
      }
      assert.equal(init.headers['Content-Type'], 'application/octet-stream');
      parts.set(index, Buffer.from(init.body));
      return json(200, { success: true, index });
    }
    m = u.pathname.match(/^\/api\/upload\/chunked\/([^/]+)\/complete$/);
    if (method === 'POST' && m) {
      if (completeResponse) return completeResponse();
      return json(200, { success: true, staged_file_id: m[1], status: 'complete' });
    }
    m = u.pathname.match(/^\/api\/upload\/chunked\/([^/]+)$/);
    if (method === 'DELETE' && m) return json(200, { success: true, upload_session_id: m[1], cancelled: true });
    if (method === 'GET' && m) return json(200, { success: true, upload_session_id: m[1], status: 'uploading', received_chunks: [0] });
    if (method === 'POST' && u.pathname === '/api/upload') {
      if (uploadResponse) return uploadResponse();
      return json(201, { success: true, message: 'queued', data: { upload_id: 'upl_1', platforms: { youtube: 'queued' } } });
    }
    return json(404, { error: `unexpected ${method} ${u.pathname}` });
  };
  return { fetch, calls, parts, get session() { return session; } };
}

function client(fetch) {
  return new PostUpload({ apiKey: 'k', baseUrl: BASE, fetch, retryBaseDelayMs: 1 });
}

function formEntries(form) {
  const out = {};
  for (const [k, v] of form.entries()) (out[k] ||= []).push(v);
  return out;
}

const tmp = mkdtempSync(join(tmpdir(), 'pu-chunked-'));

test('uploadLargeFile: init → exact-size parts in order → complete', async () => {
  const s = fakeServer({ chunkSize: 4 });
  const progress = [];
  const data = Buffer.from('0123456789'); // 4 + 4 + 2
  const res = await client(s.fetch).uploadLargeFile(data, { filename: 'clip.mov', onProgress: (p) => progress.push(p) });
  assert.equal(res.staged_file_id, 'cus_1');

  const init = s.calls[0];
  assert.equal(init.path, '/api/upload/chunked/init');
  assert.deepEqual(JSON.parse(init.init.body), { filename: 'clip.mov', size: 10, mime_type: 'video/quicktime' });
  assert.deepEqual(s.calls.filter((c) => c.method === 'PUT').map((c) => c.path),
    ['/api/upload/chunked/cus_1/0', '/api/upload/chunked/cus_1/1', '/api/upload/chunked/cus_1/2']);
  assert.deepEqual([...s.parts.entries()].map(([i, b]) => [i, b.toString()]), [[0, '0123'], [1, '4567'], [2, '89']]);
  assert.equal(s.calls.at(-1).path, '/api/upload/chunked/cus_1/complete');
  assert.deepEqual(progress.map((p) => [p.uploadedBytes, p.part, p.totalParts, p.totalBytes]), [[4, 1, 3, 10], [8, 2, 3, 10], [10, 3, 3, 10]]);
});

test('parts are read from disk part by part (file path source)', async () => {
  const path = join(tmp, 'episode.mp4');
  writeFileSync(path, Buffer.from('abcdefghij'));
  const s = fakeServer({ chunkSize: 3 });
  await client(s.fetch).uploadLargeFile(path);
  assert.deepEqual(JSON.parse(s.calls[0].init.body), { filename: 'episode.mp4', size: 10, mime_type: 'video/mp4' });
  assert.deepEqual([...s.parts.values()].map((b) => b.toString()), ['abc', 'def', 'ghi', 'j']);
});

test('streams: with size they are read part by part; without size they are spooled to a temp file', async () => {
  let s = fakeServer({ chunkSize: 4 });
  await client(s.fetch).uploadLargeFile(Readable.from([Buffer.from('012'), Buffer.from('34567'), Buffer.from('89')]), { size: 10 });
  assert.deepEqual([...s.parts.values()].map((b) => b.toString()), ['0123', '4567', '89']);

  s = fakeServer({ chunkSize: 4 });
  await client(s.fetch).uploadLargeFile(Readable.from([Buffer.from('abcdef'), Buffer.from('g')]));
  assert.equal(JSON.parse(s.calls[0].init.body).size, 7);
  assert.deepEqual([...s.parts.values()].map((b) => b.toString()), ['abcd', 'efg']);

  // A stream shorter than the declared size fails and the session is cancelled.
  s = fakeServer({ chunkSize: 4 });
  await assert.rejects(client(s.fetch).uploadLargeFile(Readable.from([Buffer.from('abc')]), { size: 10 }), /stream ended/);
  assert.equal(s.calls.at(-1).method, 'DELETE');
});

test('a part is retried on 503, 429 (Retry-After) and network errors', async () => {
  const s = fakeServer({
    chunkSize: 4,
    partFailures: {
      1: [
        { status: 503, body: { error: 'busy' } },
        { status: 429, body: { error: 'slow down', error_code: 'UPLOAD_CHUNK_RATE_LIMIT' }, headers: { 'retry-after': '0' } },
        new TypeError('fetch failed'),
      ],
    },
  });
  const res = await client(s.fetch).uploadLargeFile(Buffer.from('0123456789'));
  assert.equal(res.staged_file_id, 'cus_1');
  assert.equal(s.calls.filter((c) => c.path === '/api/upload/chunked/cus_1/1').length, 4);
  assert.equal(s.parts.get(1).toString(), '4567');
});

test('a part failing for good (or a 4xx) cancels the session and throws', async () => {
  let s = fakeServer({ chunkSize: 4, partFailures: { 0: Array.from({ length: 10 }, () => ({ status: 502 })) } });
  await assert.rejects(
    client(s.fetch).uploadLargeFile(Buffer.from('0123456789'), { maxRetries: 3 }),
    (err) => err instanceof PostUploadError && err.status === 502,
  );
  assert.equal(s.calls.filter((c) => c.method === 'PUT').length, 3);
  assert.equal(s.calls.at(-1).method, 'DELETE');
  assert.equal(s.calls.at(-1).path, '/api/upload/chunked/cus_1');

  s = fakeServer({ chunkSize: 4, partFailures: { 0: [{ status: 400, body: { error: 'bad size', error_code: 'CHUNK_SIZE_MISMATCH' } }] } });
  await assert.rejects(client(s.fetch).uploadLargeFile(Buffer.from('0123456789')), (err) => err.code === 'CHUNK_SIZE_MISMATCH');
  assert.equal(s.calls.filter((c) => c.method === 'PUT').length, 1, '4xx is not retried');
  assert.equal(s.calls.at(-1).method, 'DELETE');
});

test('init errors are not followed by a cancel; TOO_MANY_CHUNKED_UPLOADS is not retried', async () => {
  let n = 0;
  const s = fakeServer({
    initResponse: () => {
      n++;
      return new Response(JSON.stringify({ error: 'too many', error_code: 'TOO_MANY_CHUNKED_UPLOADS' }), { status: 429 });
    },
  });
  await assert.rejects(client(s.fetch).uploadLargeFile(Buffer.from('abc')), (err) => err.code === 'TOO_MANY_CHUNKED_UPLOADS');
  assert.equal(n, 1);
  assert.ok(!s.calls.some((c) => c.method === 'DELETE'));
});

test('uploadVideo with chunked: true posts staged_file_id instead of the file', async () => {
  const s = fakeServer({ chunkSize: 4 });
  const res = await client(s.fetch).uploadVideo(Buffer.from('0123456789'), {
    user: 'brand', platforms: ['youtube'], title: 'Big', chunked: true, filename: 'big.mp4',
  });
  assert.equal(res.data.upload_id, 'upl_1');
  const post = s.calls.at(-1);
  assert.equal(post.path, '/api/upload');
  const e = formEntries(post.init.body);
  assert.deepEqual(e.staged_file_id, ['cus_1']);
  assert.equal(e.video, undefined);
  assert.deepEqual(e.user, ['brand']);
  assert.deepEqual(e['platform[]'], ['youtube']);
});

test('uploadVideo switches to chunked automatically above the 95 MiB threshold', async () => {
  const path = join(tmp, 'large.mp4');
  const fd = openSync(path, 'w');
  ftruncateSync(fd, CHUNKED_THRESHOLD_BYTES + 1); // sparse file
  closeSync(fd);
  const s = fakeServer({ chunkSize: 64 * 1024 * 1024 });
  await client(s.fetch).uploadVideo(path, { user: 'brand', platforms: ['youtube'] });
  const puts = s.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(s.parts.get(0).length, 64 * 1024 * 1024);
  assert.equal(s.parts.get(1).length, CHUNKED_THRESHOLD_BYTES + 1 - 64 * 1024 * 1024);
  assert.deepEqual(formEntries(s.calls.at(-1).init.body).staged_file_id, ['cus_1']);

  // Small files (and chunked: false) still go in one multipart request.
  const small = join(tmp, 'small.mp4');
  writeFileSync(small, Buffer.from('tiny'));
  const s2 = fakeServer();
  await client(s2.fetch).uploadVideo(small, { user: 'brand', platforms: ['youtube'] });
  assert.deepEqual(s2.calls.map((c) => c.path), ['/api/upload']);
  assert.equal(formEntries(s2.calls[0].init.body).video[0].name, 'small.mp4');
  const s3 = fakeServer();
  await client(s3.fetch).uploadVideo({ user: 'brand', platforms: ['youtube'], videoPath: path, chunked: false });
  assert.deepEqual(s3.calls.map((c) => c.path), ['/api/upload']);
});

test('uploadVideo accepts stagedFileId, a URL as first argument, and Buffers', async () => {
  let s = fakeServer();
  await client(s.fetch).uploadVideo({ user: 'b', platforms: ['tiktok'], stagedFileId: 'cus_9' });
  assert.deepEqual(formEntries(s.calls[0].init.body).staged_file_id, ['cus_9']);

  s = fakeServer();
  await client(s.fetch).uploadVideo('https://cdn.example.com/v.mp4', { user: 'b', platforms: ['tiktok'] });
  assert.deepEqual(formEntries(s.calls[0].init.body).video, ['https://cdn.example.com/v.mp4']);

  s = fakeServer();
  await client(s.fetch).uploadVideo(Buffer.from('vid'), { user: 'b', platforms: ['tiktok'], filename: 'a.webm' });
  const file = formEntries(s.calls[0].init.body).video[0];
  assert.equal(file.name, 'a.webm');
  assert.equal(file.type, 'video/webm');
  assert.equal(await file.text(), 'vid');

  await assert.rejects(
    client(s.fetch).uploadVideo({ user: 'b', platforms: ['tiktok'], stagedFileId: 'x', videoUrl: 'https://a/b.mp4' }),
    /only one of/,
  );
});

test('skipped_platforms and platform_skipped warnings come through typed responses', async () => {
  const body = {
    success: true,
    message: 'Video upload queued successfully. Skipped (file too large): bluesky.',
    data: {
      upload_id: 'upl_2',
      platforms: { youtube: 'queued', bluesky: 'failed' },
      skipped_platforms: [{ platform: 'bluesky', error_code: 'FILE_TOO_LARGE_FOR_PLATFORM', message: 'too big', file_size_mb: 150, max_size_mb: 100 }],
      error_message: '{"platform_errors":{"bluesky":{}}}',
    },
    warnings: [{ type: 'platform_skipped', platform: 'bluesky', level: 'warning', error_code: 'FILE_TOO_LARGE_FOR_PLATFORM', message: 'too big' }],
  };
  const s = fakeServer({ uploadResponse: () => new Response(JSON.stringify(body), { status: 201 }) });
  const res = await client(s.fetch).uploadVideo({ user: 'b', platforms: ['youtube', 'bluesky'], stagedFileId: 'cus_1' });
  assert.equal(res.data.skipped_platforms[0].platform, 'bluesky');
  assert.equal(res.data.skipped_platforms[0].max_size_mb, 100);
  assert.equal(res.warnings[0].type, 'platform_skipped');
});

test('low-level session methods hit the documented endpoints', async () => {
  const s = fakeServer({ chunkSize: 8 });
  const c = client(s.fetch);
  const session = await c.createUploadSession({ filename: 'x.mkv', size: 10 });
  assert.equal(session.upload_session_id, 'cus_1');
  assert.equal(JSON.parse(s.calls[0].init.body).mime_type, 'video/x-matroska');
  await c.uploadPart('cus_1', 0, Buffer.from('01234567'));
  const status = await c.getUploadSession('cus_1');
  assert.deepEqual(status.received_chunks, [0]);
  await c.abortUploadSession('cus_1');
  const done = await c.completeUploadSession('cus_1');
  assert.equal(done.staged_file_id, 'cus_1');
  assert.deepEqual(s.calls.map((x) => `${x.method} ${x.path}`), [
    'POST /api/upload/chunked/init',
    'PUT /api/upload/chunked/cus_1/0',
    'GET /api/upload/chunked/cus_1',
    'DELETE /api/upload/chunked/cus_1',
    'POST /api/upload/chunked/cus_1/complete',
  ]);
  await assert.rejects(c.createUploadSession({ filename: 'x.mp4', size: 0 }), /positive/);
  await assert.rejects(c.uploadPart('cus_1', -1, Buffer.from('a')), /non-negative/);
});
