import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { runMcpBridge, DEFAULT_MCP_URL, VERSION } from '../dist/index.mjs';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };

/**
 * Run the bridge over in-memory streams. `handler(req, n)` returns a Response
 * (or throws) for the n-th POST. Resolves with stdout lines, logs and calls.
 */
async function bridge(lines, handler, extra = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (c) => { out += c; });
  const logs = [];
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(init, calls.length);
  };
  const done = runMcpBridge({ apiKey: 'k_test', url: 'https://mcp.example.test/mcp', input, output, fetch, log: (m) => logs.push(m), ...extra });
  for (const l of lines) input.write(typeof l === 'string' ? `${l}\n` : `${JSON.stringify(l)}\n`);
  input.end();
  await done;
  return { lines: out.split('\n').filter(Boolean).map((l) => JSON.parse(l)), raw: out, logs, calls };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('default URL is the hosted endpoint', () => {
  assert.equal(DEFAULT_MCP_URL, 'https://api.indreelforge.com/mcp');
});

test('forwards requests with the right headers and writes one line per response', async () => {
  const result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'indreelforge' } };
  const r = await bridge([INIT], () => json({ jsonrpc: '2.0', id: 1, result }));
  assert.equal(r.calls.length, 1);
  const { url, init } = r.calls[0];
  assert.equal(url, 'https://mcp.example.test/mcp');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'ApiKey k_test');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers.Accept, 'application/json, text/event-stream');
  assert.equal(init.headers['User-Agent'], `indreelforge-node/${VERSION}`);
  assert.deepEqual(r.calls[0].body, INIT);
  assert.deepEqual(r.lines, [{ jsonrpc: '2.0', id: 1, result }]);
  assert.equal(r.raw.split('\n').length, 2, 'exactly one line plus trailing newline');
});

test('pretty-printed server JSON is re-serialized onto a single line', async () => {
  const r = await bridge([{ jsonrpc: '2.0', id: 7, method: 'tools/list' }], () =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { tools: [] } }, null, 2), { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.equal(r.raw, '{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}\n');
});

test('writes nothing for 202 / 204 (notifications)', async () => {
  const r = await bridge(
    [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }],
    (_init, n) => new Response(null, { status: n === 1 ? 202 : 204 }),
  );
  assert.equal(r.calls.length, 2);
  assert.equal(r.raw, '');
});

test('echoes Mcp-Session-Id and the negotiated protocol version on later requests', async () => {
  const r = await bridge(
    [INIT, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }],
    (_init, n) => {
      if (n === 1) return json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, 200, { 'Mcp-Session-Id': 'sess-123' });
      if (n === 2) return new Response(null, { status: 202 });
      return json({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
    },
  );
  assert.equal(r.calls[0].init.headers['Mcp-Session-Id'], undefined);
  for (const c of r.calls.slice(1)) {
    assert.equal(c.init.headers['Mcp-Session-Id'], 'sess-123');
    assert.equal(c.init.headers['MCP-Protocol-Version'], '2025-06-18');
  }
  assert.deepEqual(r.lines.map((l) => l.id), [1, 2]);
});

test('unwraps SSE responses (multiple events, multi-line data, comments)', async () => {
  const sse = [
    ': keep-alive',
    '',
    'event: message',
    'id: 1',
    'data: {"jsonrpc":"2.0","method":"notifications/progress",',
    'data: "params":{"progress":1}}',
    '',
    'data: {"jsonrpc":"2.0","id":3,"result":{"content":[]}}',
    '',
    'event: ping',
    'data: {"ignored":true}',
    '',
  ].join('\n');
  const r = await bridge([{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} }], () =>
    new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }));
  assert.deepEqual(r.lines, [
    { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } },
    { jsonrpc: '2.0', id: 3, result: { content: [] } },
  ]);
});

test('HTTP 401 with {error} body becomes a JSON-RPC error for that id', async () => {
  const r = await bridge([{ jsonrpc: '2.0', id: 'abc', method: 'tools/list' }], () => json({ error: 'Invalid API key' }, 401));
  assert.equal(r.lines.length, 1);
  const [line] = r.lines;
  assert.equal(line.jsonrpc, '2.0');
  assert.equal(line.id, 'abc');
  assert.equal(line.error.code, -32000);
  assert.match(line.error.message, /HTTP 401: Invalid API key/);
  assert.match(line.error.message, /INDREELFORGE_API_KEY/);
  assert.deepEqual(line.error.data, { httpStatus: 401, body: { error: 'Invalid API key' } });
  assert.ok(r.logs.some((l) => l.includes('HTTP 401')));
});

test('non-JSON error pages (e.g. 502 HTML) are mapped too', async () => {
  const r = await bridge([{ jsonrpc: '2.0', id: 4, method: 'tools/list' }], () =>
    new Response('<html><body>Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } }));
  assert.equal(r.lines[0].id, 4);
  assert.match(r.lines[0].error.message, /HTTP 502/);
  assert.equal(r.lines[0].error.data.httpStatus, 502);
});

test('JSON-RPC error bodies on non-2xx responses are passed through untouched', async () => {
  const body = { jsonrpc: '2.0', id: 5, error: { code: -32000, message: 'Rate limit exceeded' } };
  const r = await bridge([{ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} }], () => json(body, 429));
  assert.deepEqual(r.lines, [body]);
});

test('network errors and timeouts become JSON-RPC errors; notifications stay silent', async () => {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ENOTFOUND' };
  const r = await bridge(
    [{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }],
    () => { throw err; },
  );
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].id, 6);
  assert.equal(r.lines[0].error.code, -32000);
  assert.match(r.lines[0].error.message, /Could not reach IndReelForge MCP server.*ENOTFOUND/);

  const slow = await bridge(
    [{ jsonrpc: '2.0', id: 8, method: 'ping' }],
    (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
    })),
    { timeoutMs: 20 },
  );
  assert.equal(slow.lines[0].id, 8);
  assert.match(slow.lines[0].error.message, /timed out/);
});

test('invalid JSON on stdin yields a parse error with id null and no request', async () => {
  const r = await bridge(['{not json', ''], () => json({}));
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.lines, [{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON received on stdin' } }]);
});

test('batch requests get a batch of errors on transport failure', async () => {
  const r = await bridge(
    [[{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]],
    () => json({ error: 'nope' }, 500),
  );
  assert.equal(r.lines.length, 1);
  assert.ok(Array.isArray(r.lines[0]));
  assert.deepEqual(r.lines[0].map((e) => e.id), [1, 2]);
});

test('empty 200 body for a request yields an error instead of hanging the client', async () => {
  const r = await bridge([{ jsonrpc: '2.0', id: 9, method: 'ping' }], () => new Response('', { status: 200 }));
  assert.equal(r.lines[0].id, 9);
  assert.equal(r.lines[0].error.code, -32603);
});

// ── CLI process tests ───────────────────────────────────────────────────────

function runCli(args, { env = {}, stdin = '' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test('cli --version / --help', async () => {
  const v = await runCli(['--version']);
  assert.equal(v.code, 0);
  assert.equal(v.stdout.trim(), VERSION);
  const h = await runCli(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /indreelforge mcp/);
  const none = await runCli([]);
  assert.equal(none.code, 1);
  assert.equal(none.stdout, '');
});

test('cli mcp exits 1 with a stderr message when INDREELFORGE_API_KEY is missing', async () => {
  const r = await runCli(['mcp']);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /INDREELFORGE_API_KEY is not set/);
});

test('cli mcp bridges stdin/stdout against a real HTTP server', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(body) });
      const msg = JSON.parse(body);
      if (req.headers.authorization !== 'ApiKey good') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid API key' }));
      }
      if (!('id' in msg)) { res.writeHead(202); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's-1' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  try {
    const stdin = `${JSON.stringify(INIT)}\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`;
    const ok = await runCli(['mcp'], { env: { INDREELFORGE_API_KEY: 'good', INDREELFORGE_MCP_URL: url }, stdin });
    assert.equal(ok.code, 0);
    const lines = ok.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.id), [1, 2]);
    assert.equal(seen[0].headers['user-agent'], `indreelforge-node/${VERSION}`);
    assert.equal(seen[2].headers['mcp-session-id'], 's-1');
    assert.match(ok.stderr, /MCP bridge v/);

    const bad = await runCli(['mcp'], { env: { INDREELFORGE_API_KEY: 'bad', INDREELFORGE_MCP_URL: url }, stdin: `${JSON.stringify(INIT)}\n` });
    assert.equal(bad.code, 0);
    const [err] = bad.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(err.id, 1);
    assert.equal(err.error.code, -32000);
    assert.match(err.error.message, /HTTP 401/);
  } finally {
    server.close();
  }
});
