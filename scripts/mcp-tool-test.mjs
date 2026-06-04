/**
 * MCP Gateway Tool Surface Test
 * Spawns a fresh gateway subprocess on port 3009 (leaving the running gateway at :3002 untouched)
 * then exercises MCP tools and resources via StreamableHTTP transport.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SDK = `file:///${ROOT}/node_modules/.pnpm/@modelcontextprotocol+sdk@1.26.0_zod@3.25.76/node_modules/@modelcontextprotocol/sdk/dist/esm/`;
const TEST_PORT = 3009;
const GATEWAY = `http://localhost:${TEST_PORT}`;
// JWT from registered test user (testmcp@example.com / Test1234!)
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI2ZmE4YjIxOC1hNzA4LTRmYjAtOTFkOS1mYzc5OTBlZGJkMTciLCJ0eXBlIjoiSFVNQU4iLCJuYW1lIjoiTUNQVGVzdGVyIiwic2NvcGVzIjpbImNoYXQiLCJzdHJlYW0iXSwianRpIjoiYzlhNDQ5ZDAtZjA2Zi00NzU1LWFhNDItMzBkN2U5ZTc1ZmMwIiwiaWF0IjoxNzgwNTI2NDk5fQ.XUBql-pKmzbT4tsOqr0sGMPPo_4tE03Tkh7l9j-iVOU';

const results = [];

function report(name, passed, detail) {
  const status = passed ? 'PASS' : 'FAIL';
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ' — ' + detail : ''}`);
}

function summarise(obj) {
  if (obj == null) return 'null';
  if (typeof obj === 'string') return obj.slice(0, 80);
  return Object.keys(obj).slice(0, 5).join(', ');
}

async function waitForGateway(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function spawnGateway() {
  const env = {
    ...process.env,
    TRANSPORT: 'http',
    PORT: String(TEST_PORT),
    HOST: '127.0.0.1',
    STORAGE_MODE: 'memory',
    WS_SERVER_URL: 'ws://localhost:3001',
    API_SERVER_URL: 'http://localhost:3000',
    JWT_SECRET: 'dev-secret-change-in-production-min-32-chars!!',
    PERSIST_FILE: '',        // disable persistence so it starts clean
    NODE_ENV: 'development',
  };

  const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
  const entry = path.join(ROOT, 'apps/agent-gateway/src/index.ts');

  // On Windows, spawn via node + tsx's actual entrypoint to avoid .cmd shell issues
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  let tsxBin;
  try {
    tsxBin = req.resolve('tsx/cli');
  } catch {
    tsxBin = tsx;
  }

  const proc = spawn(process.execPath, [tsxBin, entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });

  proc.stdout.on('data', d => process.stderr.write(`[gw-out] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[gw-err] ${d}`));
  proc.on('error', e => process.stderr.write(`[gw-spawn-err] ${e.message}\n`));

  return proc;
}

async function main() {
  console.log('=== MCP Gateway Tool Surface Test ===\n');

  // ── Health check: existing gateway at :3002 ──────────────────────────────
  try {
    const h = await fetch('http://localhost:3002/health');
    const hj = await h.json();
    report('existing_gateway_health', hj?.status === 'ok', JSON.stringify(hj));
  } catch (e) {
    report('existing_gateway_health', false, e.message);
  }

  // ── Spawn fresh gateway on :3009 ─────────────────────────────────────────
  let gwProc = null;
  try {
    gwProc = await spawnGateway();
    const ready = await waitForGateway(TEST_PORT);
    report('spawn_fresh_gateway', ready, ready ? `Port ${TEST_PORT} ready` : 'Timed out');
    if (!ready) { printSummary(); return; }
  } catch (e) {
    report('spawn_fresh_gateway', false, e.message);
    printSummary();
    return;
  }

  // ── Load MCP SDK ──────────────────────────────────────────────────────────
  const { Client } = await import(`${SDK}client/index.js`);
  const { StreamableHTTPClientTransport } = await import(`${SDK}client/streamableHttp.js`);

  // ── Connect MCP client ────────────────────────────────────────────────────
  const transport = new StreamableHTTPClientTransport(new URL(`${GATEWAY}/mcp`));
  const client = new Client({ name: 'mcp-tool-test', version: '1.0.0' });

  try {
    await client.connect(transport);
    report('mcp_connect', true, 'MCP session established');
  } catch (e) {
    report('mcp_connect', false, e.message);
    gwProc.kill();
    printSummary();
    return;
  }

  // ── list_tools ────────────────────────────────────────────────────────────
  let toolNames = [];
  try {
    const tools = await client.listTools();
    toolNames = tools.tools.map(t => t.name);
    report('list_tools', toolNames.length > 0, `${toolNames.length} tools registered`);
  } catch (e) {
    report('list_tools', false, e.message);
  }

  // ── list_resources ────────────────────────────────────────────────────────
  try {
    const resources = await client.listResources();
    const uris = resources.resources.map(r => r.uri).join(', ');
    report('list_resources', resources.resources.length > 0,
      `${resources.resources.length} resources: ${uris}`);
  } catch (e) {
    report('list_resources', false, e.message);
  }

  // ── authenticate ──────────────────────────────────────────────────────────
  let authOk = false;
  try {
    const resp = await client.callTool({ name: 'authenticate', arguments: { token: JWT } });
    const parsed = JSON.parse(resp.content[0].text);
    authOk = parsed?.success === true;
    report('authenticate', authOk, `entityId=${parsed?.entityId}, name=${parsed?.entityName}, type=${parsed?.entityType}`);
  } catch (e) {
    report('authenticate', false, e.message);
  }

  // ── list_connections ──────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'list_connections', arguments: {} });
    const parsed = JSON.parse(resp.content[0].text);
    report('list_connections', parsed != null, `connected=${parsed?.connected}, channels=${JSON.stringify(parsed?.channels ?? [])}`);
  } catch (e) {
    report('list_connections', false, e.message);
  }

  // ── list_channels ─────────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'list_channels', arguments: {} });
    const parsed = JSON.parse(resp.content[0].text);
    report('list_channels', parsed != null, summarise(parsed));
  } catch (e) {
    report('list_channels', false, e.message);
  }

  // ── connect_service ───────────────────────────────────────────────────────
  let channelId = 'general';
  try {
    const resp = await client.callTool({ name: 'connect_service', arguments: { channelId: 'general' } });
    const parsed = JSON.parse(resp.content[0].text);
    channelId = parsed?.channelId ?? 'general';
    report('connect_service', parsed?.success === true, `channelId=${channelId}, msg=${parsed?.message}`);
  } catch (e) {
    report('connect_service', false, e.message);
  }

  // ── list_connections (after join) ─────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'list_connections', arguments: {} });
    const parsed = JSON.parse(resp.content[0].text);
    report('list_connections_after_join', parsed != null,
      `connected=${parsed?.connected}, channels=${JSON.stringify(parsed?.channels)}`);
  } catch (e) {
    report('list_connections_after_join', false, e.message);
  }

  // ── list_members ──────────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'list_members', arguments: { channelId } });
    const parsed = JSON.parse(resp.content[0].text);
    report('list_members', parsed != null, summarise(parsed));
  } catch (e) {
    report('list_members', false, e.message);
  }

  // ── send_message ──────────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'send_message', arguments: {
      channelId,
      content: 'Hello from mcp-tool-test.mjs!',
    }});
    const parsed = JSON.parse(resp.content[0].text);
    const ok = parsed?.success === true || parsed?.messageId != null || parsed?.id != null;
    report('send_message', ok, summarise(parsed));
  } catch (e) {
    report('send_message', false, e.message);
  }

  // ── read_history ──────────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'read_history', arguments: { channelId, limit: 5 } });
    const parsed = JSON.parse(resp.content[0].text);
    report('read_history', parsed != null, summarise(parsed));
  } catch (e) {
    report('read_history', false, e.message);
  }

  // ── get_context ───────────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'get_context', arguments: { channelId, limit: 5 } });
    const parsed = JSON.parse(resp.content[0].text);
    report('get_context', parsed != null, summarise(parsed));
  } catch (e) {
    report('get_context', false, e.message);
  }

  // ── get_unread ────────────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'get_unread', arguments: { channelId } });
    const parsed = JSON.parse(resp.content[0].text);
    report('get_unread', parsed != null && 'messages' in parsed, summarise(parsed));
  } catch (e) {
    report('get_unread', false, e.message);
  }

  // ── stream_output ─────────────────────────────────────────────────────────
  try {
    const resp = await client.callTool({ name: 'stream_output', arguments: {
      channelId,
      content: 'streamed chunk from test',
      done: true,
    }});
    const parsed = JSON.parse(resp.content[0].text);
    report('stream_output', parsed != null, summarise(parsed));
  } catch (e) {
    report('stream_output', false, e.message);
  }

  // ── Resources ─────────────────────────────────────────────────────────────
  const resourceCases = [
    'connection://status',
    'metrics://snapshot',
    `connection://${channelId}/status`,
    `stream://${channelId}/messages/recent`,
    `stream://${channelId}/messages/latest`,
  ];

  for (const uri of resourceCases) {
    try {
      const resp = await client.readResource({ uri });
      const text = resp?.contents?.[0]?.text;
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      report(`resource: ${uri}`, parsed != null, summarise(parsed));
    } catch (e) {
      report(`resource: ${uri}`, false, e.message);
    }
  }

  await client.close();
  gwProc.kill();
  printSummary();
}

function printSummary() {
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n=== SUMMARY: ${pass} PASS / ${fail} FAIL / ${results.length} total ===`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r =>
      console.log(`  FAIL  ${r.name}: ${r.detail}`)
    );
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
