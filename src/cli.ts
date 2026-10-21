#!/usr/bin/env node
/**
 * indreelforge CLI.
 *
 *   npx -y indreelforge mcp      stdio MCP bridge to the hosted IndReelForge MCP server
 *
 * stdout carries JSON-RPC only; everything else goes to stderr.
 */
import { VERSION } from './version';
import { DEFAULT_MCP_URL, DEFAULT_MCP_TIMEOUT_MS, runMcpBridge } from './mcp-bridge';

const HELP = `indreelforge ${VERSION} — IndReelForge CLI

Usage:
  indreelforge mcp           Run the stdio MCP bridge (for Claude Desktop, Cursor, ...)
  indreelforge --version     Print the version
  indreelforge --help        Show this help

Environment (mcp):
  INDREELFORGE_API_KEY       Required. Your IndReelForge API key.
  INDREELFORGE_MCP_URL       Optional. MCP endpoint (default: ${DEFAULT_MCP_URL}).
  INDREELFORGE_MCP_TIMEOUT_MS Optional. Per-request timeout (default: ${DEFAULT_MCP_TIMEOUT_MS}).

Example MCP client config:
  {
    "mcpServers": {
      "indreelforge": {
        "command": "npx",
        "args": ["-y", "indreelforge", "mcp"],
        "env": { "INDREELFORGE_API_KEY": "your-api-key" }
      }
    }
  }
`;

function fail(message: string): never {
  process.stderr.write(`indreelforge: ${message}\n`);
  process.exit(1);
}

async function runMcp(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 18) {
    fail(`Node.js >= 18 is required (found ${process.versions.node}).`);
  }

  const apiKey = (process.env.INDREELFORGE_API_KEY || '').trim();
  if (!apiKey) {
    fail(
      'INDREELFORGE_API_KEY is not set. Create an API key at https://indreelforge.com/dashboard ' +
        'and pass it via the "env" block of your MCP client config.',
    );
  }

  const url = (process.env.INDREELFORGE_MCP_URL || '').trim() || DEFAULT_MCP_URL;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('unsupported protocol');
  } catch {
    fail(`INDREELFORGE_MCP_URL is not a valid http(s) URL: ${url}`);
  }

  const timeoutRaw = process.env.INDREELFORGE_MCP_TIMEOUT_MS;
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_MCP_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(`INDREELFORGE_MCP_TIMEOUT_MS must be a positive number of milliseconds (got "${timeoutRaw}").`);
  }

  // A closed stdout (client went away) is not an error worth a stack trace.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    process.stderr.write(`indreelforge: stdout error: ${err.message}\n`);
    process.exit(1);
  });

  process.stderr.write(`[indreelforge] MCP bridge v${VERSION} -> ${url}\n`);
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
  process.stderr.write(`indreelforge: unknown command "${command}"\n\n${HELP}`);
  process.exit(1);
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`indreelforge: ${(err as Error)?.stack || String(err)}\n`);
  process.exit(1);
});
