#!/usr/bin/env node
/**
 * post-upload CLI (also installed as `indreelforge` for backwards compatibility).
 *
 *   npx -y post-upload mcp      stdio MCP bridge to the hosted Post-Upload MCP server
 *
 * stdout carries JSON-RPC only; everything else goes to stderr.
 */
import { VERSION } from './version';
import { DEFAULT_MCP_URL, DEFAULT_MCP_TIMEOUT_MS, runMcpBridge } from './mcp-bridge';

const HELP = `post-upload ${VERSION} — Post-Upload CLI

Usage:
  post-upload mcp            Run the stdio MCP bridge (for Claude Desktop, Cursor, ...)
  post-upload --version      Print the version
  post-upload --help         Show this help

Environment (mcp):
  POST_UPLOAD_API_KEY        Required. Your Post-Upload API key.
  POST_UPLOAD_MCP_URL        Optional. MCP endpoint (default: ${DEFAULT_MCP_URL}).
  POST_UPLOAD_MCP_TIMEOUT_MS Optional. Per-request timeout (default: ${DEFAULT_MCP_TIMEOUT_MS}).
  (The former INDREELFORGE_* names are still read as a fallback.)

Example MCP client config:
  {
    "mcpServers": {
      "post-upload": {
        "command": "npx",
        "args": ["-y", "post-upload", "mcp"],
        "env": { "POST_UPLOAD_API_KEY": "your-api-key" }
      }
    }
  }
`;

function fail(message: string): never {
  process.stderr.write(`post-upload: ${message}\n`);
  process.exit(1);
}

/** POST_UPLOAD_<name>, falling back to the pre-rename INDREELFORGE_<name>. */
function env(name: string): { value: string | undefined; key: string } {
  const current = `POST_UPLOAD_${name}`;
  const legacy = `INDREELFORGE_${name}`;
  if (process.env[current]) return { value: process.env[current], key: current };
  if (process.env[legacy]) return { value: process.env[legacy], key: legacy };
  return { value: undefined, key: current };
}

async function runMcp(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 18) {
    fail(`Node.js >= 18 is required (found ${process.versions.node}).`);
  }

  const apiKey = (env('API_KEY').value || '').trim();
  if (!apiKey) {
    fail(
      'POST_UPLOAD_API_KEY is not set. Create an API key at https://post-upload.com/dashboard ' +
        'and pass it via the "env" block of your MCP client config.',
    );
  }

  const urlEnv = env('MCP_URL');
  const url = (urlEnv.value || '').trim() || DEFAULT_MCP_URL;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('unsupported protocol');
  } catch {
    fail(`${urlEnv.key} is not a valid http(s) URL: ${url}`);
  }

  const timeoutEnv = env('MCP_TIMEOUT_MS');
  const timeoutRaw = timeoutEnv.value;
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_MCP_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(`${timeoutEnv.key} must be a positive number of milliseconds (got "${timeoutRaw}").`);
  }

  // A closed stdout (client went away) is not an error worth a stack trace.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    process.stderr.write(`post-upload: stdout error: ${err.message}\n`);
    process.exit(1);
  });

  process.stderr.write(`[post-upload] MCP bridge v${VERSION} -> ${url}\n`);
  await runMcpBridge({ apiKey, url, timeoutMs });
}

async function main(argv: string[]): Promise<void> {
  const args = argv.filter((a) => a !== '--');
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  const [command] = args;
  if (!command) {
    process.stderr.write(HELP);
    process.exit(1);
  }
  if (command === 'mcp') {
    await runMcp();
    return;
  }
  process.stderr.write(`post-upload: unknown command "${command}"\n\n${HELP}`);
  process.exit(1);
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`post-upload: ${(err as Error)?.stack || String(err)}\n`);
  process.exit(1);
});
