/**
 * stdio <-> Streamable HTTP bridge for the hosted IndReelForge MCP server.
 *
 * MCP clients that only speak stdio (Claude Desktop, Cursor, ...) launch
 * `npx -y indreelforge mcp`; this module reads newline-delimited JSON-RPC
 * messages from stdin, POSTs each one to the hosted server and writes every
 * JSON-RPC response back to stdout as exactly one line. Nothing but JSON-RPC
 * is ever written to stdout; diagnostics go to the `log` callback (stderr).
 */
import { createInterface } from 'readline';
import { VERSION } from './version';

export const DEFAULT_MCP_URL = 'https://api.indreelforge.com/mcp';
export const DEFAULT_MCP_TIMEOUT_MS = 300_000;

/** JSON-RPC "server error" range code used for transport / HTTP failures. */
export const TRANSPORT_ERROR_CODE = -32000;
export const PARSE_ERROR_CODE = -32700;
export const INTERNAL_ERROR_CODE = -32603;

export interface McpBridgeOptions {
  /** IndReelForge API key (sent as `Authorization: ApiKey <key>`). */
  apiKey: string;
  /** MCP endpoint. Default: https://api.indreelforge.com/mcp */
  url?: string;
  /** Source of newline-delimited JSON-RPC (default: process.stdin). */
  input?: NodeJS.ReadableStream;
  /** Sink for JSON-RPC responses, one per line (default: process.stdout). */
  output?: NodeJS.WritableStream;
  /** Diagnostics sink (default: writes to stderr). */
  log?: (message: string) => void;
  /** Custom fetch implementation (default: global fetch). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (default 300000). */
  timeoutMs?: number;
}

type JsonRpcId = string | number;
type JsonRpcMessage = Record<string, any>;

interface BridgeState {
  sessionId: string | null;
  protocolVersion: string | null;
  /** Resolves once an in-flight `initialize` has finished. */
  initGate: Promise<void> | null;
}

/** Parse an SSE payload into the JSON strings carried by its `message` events. */
export function parseSseData(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? '' : line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (event === 'message' && data.length) {
      const joined = data.join('\n');
      if (joined.trim()) out.push(joined);
    }
  }
  return out;
}

function isRequest(m: unknown): m is JsonRpcMessage {
  return !!m && typeof m === 'object' && !Array.isArray(m) && typeof (m as JsonRpcMessage).method === 'string'
    && (m as JsonRpcMessage).id !== undefined && (m as JsonRpcMessage).id !== null;
}

function isJsonRpcResponse(m: unknown): boolean {
  return !!m && typeof m === 'object' && (m as JsonRpcMessage).jsonrpc === '2.0'
    && ('error' in (m as JsonRpcMessage) || 'result' in (m as JsonRpcMessage));
}

function rpcError(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcMessage {
  const error: JsonRpcMessage = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function describeHttpError(status: number, statusText: string, body: unknown, text: string): string {
  let detail = '';
  if (body && typeof body === 'object') {
    const b = body as JsonRpcMessage;
    const parts = [b.error, b.error_description, b.message].filter((p) => typeof p === 'string' && p);
    detail = [...new Set(parts)].join(': ');
  }
  if (!detail && text.trim()) detail = text.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!detail) detail = statusText || 'request failed';
  let msg = `IndReelForge MCP server returned HTTP ${status}: ${detail}`;
  if (status === 401 || status === 403) {
    msg += ' (check that INDREELFORGE_API_KEY is a valid IndReelForge API key)';
  }
  return msg;
}

/**
 * Forward one raw stdin line. Returns the JSON-RPC payloads to write to stdout
 * (each becomes one line). Exposed for testing.
 */
export async function forwardLine(
  line: string,
  state: BridgeState,
  opts: Required<Pick<McpBridgeOptions, 'apiKey' | 'url' | 'timeoutMs'>> & { fetch: typeof fetch; log: (m: string) => void },
): Promise<unknown[]> {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    opts.log(`[indreelforge] ignoring invalid JSON on stdin: ${(err as Error).message}`);
    return [rpcError(null, PARSE_ERROR_CODE, 'Parse error: invalid JSON received on stdin')];
  }

  const isBatch = Array.isArray(msg);
  const requests = (isBatch ? (msg as unknown[]) : [msg]).filter(isRequest);
  const ids: JsonRpcId[] = requests.map((r) => r.id as JsonRpcId);
  const isInitialize = requests.some((r) => r.method === 'initialize');

  /** Turn a transport failure into a JSON-RPC error for every request id. */
  const failAll = (code: number, message: string, data?: unknown): unknown[] => {
    opts.log(`[indreelforge] ${message}`);
    if (!ids.length) return [];
    const errors = ids.map((id) => rpcError(id, code, message, data));
    return isBatch ? [errors] : errors;
  };

  const headers: Record<string, string> = {
    Authorization: `ApiKey ${opts.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': `indreelforge-node/${VERSION}`,
  };
  if (state.sessionId) headers['Mcp-Session-Id'] = state.sessionId;
  if (state.protocolVersion && !isInitialize) headers['MCP-Protocol-Version'] = state.protocolVersion;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res: Response;
  let text: string;
  try {
    res = await opts.fetch(opts.url, { method: 'POST', headers, body: trimmed, signal: controller.signal });
    text = await res.text();
  } catch (err) {
    const e = err as Error;
    if (e?.name === 'AbortError') {
      return failAll(TRANSPORT_ERROR_CODE, `Request to IndReelForge MCP server timed out after ${Math.round(opts.timeoutMs / 1000)}s`);
    }
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const reason = cause?.code || cause?.message || e?.message || String(err);
    return failAll(TRANSPORT_ERROR_CODE, `Could not reach IndReelForge MCP server at ${opts.url}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  const sid = res.headers.get('mcp-session-id');
  if (sid) state.sessionId = sid;

  if (res.status === 202 || res.status === 204) return [];

  // Decode the body: either a JSON payload or an SSE stream of JSON payloads.
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const payloads: unknown[] = [];
  let undecodable = false;
  const chunks = contentType.includes('text/event-stream') ? parseSseData(text) : text.trim() ? [text] : [];
  for (const chunk of chunks) {
    try {
      payloads.push(JSON.parse(chunk));
    } catch {
      undecodable = true;
    }
  }

  if (!res.ok) {
    if (res.status === 404 && state.sessionId) {
      opts.log('[indreelforge] MCP session expired; the client must re-initialize');
      state.sessionId = null;
    }
    const rpc = payloads.filter((p) => isJsonRpcResponse(p) || (Array.isArray(p) && p.some(isJsonRpcResponse)));
    if (rpc.length) {
      opts.log(`[indreelforge] HTTP ${res.status} with JSON-RPC error body (passed through)`);
      return rpc;
    }
    return failAll(
      TRANSPORT_ERROR_CODE,
      describeHttpError(res.status, res.statusText, payloads[0], text),
      { httpStatus: res.status, body: payloads[0] ?? (text.trim() ? text.slice(0, 500) : null) },
    );
  }

  if (!payloads.length) {
    if (undecodable) return failAll(INTERNAL_ERROR_CODE, 'IndReelForge MCP server returned a response that is not valid JSON');
    return ids.length ? failAll(INTERNAL_ERROR_CODE, `IndReelForge MCP server returned an empty response (HTTP ${res.status})`) : [];
  }

  if (isInitialize) {
    for (const p of payloads.flat()) {
      const v = (p as JsonRpcMessage)?.result?.protocolVersion;
      if (typeof v === 'string') state.protocolVersion = v;
    }
  }
  return payloads;
}

/**
 * Run the bridge until `input` ends and every in-flight request has been
 * answered. Requests are forwarded concurrently, except that messages arriving
 * while an `initialize` is in flight wait for it (so they carry the session id).
 */
export async function runMcpBridge(options: McpBridgeOptions): Promise<void> {
  if (!options.apiKey) throw new Error('apiKey is required');
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const log = options.log || ((m: string) => process.stderr.write(`${m}\n`));
  const fetchImpl = options.fetch || (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable; Node.js >= 18 is required');

  const opts = {
    apiKey: options.apiKey,
    url: options.url || DEFAULT_MCP_URL,
    timeoutMs: options.timeoutMs || DEFAULT_MCP_TIMEOUT_MS,
    fetch: fetchImpl,
    log,
  };
  const state: BridgeState = { sessionId: null, protocolVersion: null, initGate: null };
  const inflight = new Set<Promise<void>>();

  const write = (payload: unknown) => {
    output.write(`${JSON.stringify(payload)}\n`);
  };

  const handle = async (line: string) => {
    const gate = state.initGate;
    if (gate) await gate;
    try {
      for (const payload of await forwardLine(line, state, opts)) write(payload);
    } catch (err) {
      log(`[indreelforge] unexpected bridge error: ${(err as Error)?.stack || String(err)}`);
    }
  };

  const rl = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let initializing = false;
    try {
      const parsed = JSON.parse(line);
      initializing = (Array.isArray(parsed) ? parsed : [parsed]).some((m) => m && m.method === 'initialize');
    } catch {
      /* forwardLine reports the parse error */
    }
    const p = handle(line);
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    if (initializing) state.initGate = p.then(() => undefined);
  }
  await Promise.allSettled([...inflight]);
}
