/**
 * Background jobs, because delegation is slow.
 *
 * A dispatch boots a second harness and runs a full agent turn — minutes, sometimes many.
 * Holding an MCP call open that long is how a client times out mid-flight and leaves the
 * caller unsure whether the work is running, finished, or lost. So a dispatch returns a job
 * id immediately and the output accumulates in a file the caller can poll.
 *
 * @module dsh-mcp-bridge/jobs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const JOB_DIR = process.env.DSH_BRIDGE_JOBS
  || join(homedir(), '.dsh-jarvis', 'bridge-jobs');

export function jobPaths(id, dir = JOB_DIR) {
  return { log: join(dir, `${id}.log`), meta: join(dir, `${id}.json`) };
}

/** Start a detached job and return its id without waiting for it. */
export function start(argv, { dir = JOB_DIR, spawnImpl = spawn, id = randomUUID().slice(0, 8) } = {}) {
  mkdirSync(dir, { recursive: true });
  const { log, meta } = jobPaths(id, dir);
  const fd = openSync(log, 'a');
  const child = spawnImpl(argv[0], argv.slice(1), {
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref?.();
  writeFileSync(meta, JSON.stringify({ id, pid: child.pid, argv, started: new Date().toISOString() }));
  return { id, log, pid: child.pid };
}

/** Whether a pid is still alive, without signalling it. */
export function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }   // EPERM means it exists but is not ours
}

/** Status and output tail for one job. */
export function status(id, { dir = JOB_DIR, tail = 40 } = {}) {
  const { log, meta } = jobPaths(id, dir);
  if (!existsSync(meta)) return { found: false, text: `no such job: ${id}` };
  const info = JSON.parse(readFileSync(meta, 'utf8'));
  const running = alive(info.pid);
  let out = '';
  try { out = readFileSync(log, 'utf8'); } catch { /* not written yet */ }
  const lines = out.split('\n').filter(Boolean);
  return {
    found: true,
    running,
    text: [
      `job ${id}: ${running ? 'running' : 'finished'} (started ${info.started})`,
      '',
      ...lines.slice(-tail),
    ].join('\n'),
  };
}
