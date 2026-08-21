#!/usr/bin/env node
/**
 * dsh-mcp-bridge — hands a DeepSeek Harness deployment's capabilities to an MCP client.
 *
 * `claude -p` runs its own agent loop and never sees the harness's tool schemas, so a
 * Claude-backed session has no memory, ledger, dispatch or MCP estate. It does accept MCP
 * servers. This is that server: the same capabilities, declared as tools instead of shell
 * commands the model has to be told about and remember.
 *
 * Everything it exposes already exists as a command-line entry point, so this adds a
 * surface, not authority: it can do exactly what the caller could already do in a shell.
 *
 * @module dsh-mcp-bridge/server
 */
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { BY_NAME, TOOLS, declare, validate } from './tools.js';
import { start, status } from './jobs.js';
import { handle, content } from './rpc.js';

const TIMEOUT_MS = Number(process.env.DSH_BRIDGE_TIMEOUT_MS || 120_000);

function run(argv) {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: TIMEOUT_MS, maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
      const out = [stdout, stderr].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n');
      if (error) {
        // Return the failure as tool content rather than an RPC error: the model can act on
        // "no such project", but a transport-level error just looks like the tool is broken.
        resolve(content(out || error.message, true));
        return;
      }
      resolve(content(out || '(no output)'));
    });
  });
}

async function call(name, args) {
  const tool = BY_NAME.get(name);
  if (!tool) return content(`no such tool: ${name}`, true);

  const bad = validate(tool, args);
  if (bad) return content(bad, true);

  if (tool.special === 'job_status') {
    const s = status(String(args.job_id), { tail: args.tail ?? 40 });
    return content(s.text, !s.found);
  }
  if (tool.background) {
    const { id, log } = start(tool.argv(args));
    return content(
      `dispatched as job ${id}\n`
      + `poll with dsh_job_status({"job_id":"${id}"})\n`
      + `log: ${log}\n\n`
      + 'Delegation takes minutes. Do not block on it — do other work and check back.',
    );
  }
  return run(tool.argv(args));
}

const deps = { list: () => TOOLS.map(declare), call };

if (process.env.DSH_BRIDGE_TRACE) {
  const t = (m) => { try { require('node:fs').appendFileSync(process.env.DSH_BRIDGE_TRACE, `${new Date().toISOString()} ${m}\n`); } catch {} };
  process.on('exit', (c) => t(`exit code=${c} served=${served}`));
  process.on('uncaughtException', (e) => t(`uncaught: ${e?.stack || e}`));
  process.on('unhandledRejection', (e) => t(`unhandled: ${e}`));
  process.stdin.on('end', () => t('stdin end'));
  process.stdin.on('error', (e) => t(`stdin error: ${e.message}`));
  try { require('node:fs').appendFileSync(process.env.DSH_BRIDGE_TRACE, `${new Date().toISOString()} bridge started pid=${process.pid}\n`); } catch {}
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

// Requests are answered asynchronously, so stdin closing must not kill work already in
// flight — otherwise a client that closes the pipe right after a call loses the answer,
// and the tool looks like it silently did nothing.
let inFlight = 0;
let closed = false;
let served = 0;

// Exiting the moment stdin reports EOF looked correct — the spec says the client closing
// stdin is the shutdown signal — but some clients hand the server a stdin that is already
// at EOF, and the server then exits before the first request, the client respawns it, and
// the pair loops forever at a few seconds an iteration. Observed against claude -p: 32
// spawns in three minutes and no tool call ever completed.
//
// So EOF only ends the process once it has actually served something. Before that it waits,
// bounded, so an abandoned server still goes away instead of lingering.
const IDLE_EXIT_MS = Number(process.env.DSH_BRIDGE_IDLE_MS || 300_000);
let idleTimer = null;
const maybeExit = () => {
  if (!closed || inFlight > 0) return;
  if (served > 0) { process.exit(0); return; }
  if (idleTimer) return;
  idleTimer = setTimeout(() => process.exit(0), IDLE_EXIT_MS);
  idleTimer.unref?.();
};

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
  inFlight += 1;
  try {
    const res = await handle(msg, deps);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  } catch (e) {
    if (msg?.id !== undefined && msg?.id !== null) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e?.message ?? e) } }) + '\n');
    }
  } finally {
    inFlight -= 1;
    served += 1;
    maybeExit();
  }
});

// stdio transport: the client closing stdin is the shutdown signal — but drain first.
rl.on('close', () => { closed = true; maybeExit(); });
