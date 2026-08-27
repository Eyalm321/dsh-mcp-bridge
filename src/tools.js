/**
 * The tool catalogue this bridge exposes, and how each maps to a command.
 *
 * Deliberately a data structure rather than a pile of handlers: the mapping from tool call
 * to argv is the whole substance of this server, and keeping it declarative means it can be
 * tested without spawning anything or speaking a line of protocol.
 *
 * Why a bridge exists at all: `claude -p` runs its own agent loop, so it never receives the
 * harness's tool schemas — a Claude-backed session has no goals, memory or MCP of its own.
 * It does accept MCP servers, so the capabilities can be handed over that way instead. What
 * cannot be bridged is anything that only exists inside a live harness turn (goals,
 * AgentTeams); those are session-scoped by design and have no external surface.
 *
 * @module dsh-mcp-bridge/tools
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

const BIN = process.env.DSH_JARVIS_BIN || join(homedir(), '.dsh-jarvis', 'bin');
const bin = (name) => join(BIN, name);

/** A string argument that must be present and non-empty. */
const req = (description) => ({ type: 'string', description });
const opt = (description) => ({ type: 'string', description });

export const TOOLS = [
  {
    name: 'dsh_web_search',
    description:
      'Search the web and get an answer with source URLs. Use it whenever a question turns on '
      + 'anything after your training cutoff, anything that changes (prices, versions, releases, '
      + 'news), or any fact you would otherwise state from memory and hope. Returns snippets, not '
      + 'whole pages: open a URL with the agent-browser tools when the detail matters.',
    schema: {
      type: 'object',
      properties: { query: req('What to find out, phrased as a question.') },
      required: ['query'],
    },
    argv: (a) => [bin('dsh-search.py'), a.query],
  },
  {
    name: 'dsh_memory_search',
    description: 'Search the harness memory store (full-text). Use before assuming something is unknown — durable facts about the user, projects and past decisions live here.',
    schema: { type: 'object', properties: { query: req('Words to search for.'), limit: { type: 'integer', description: 'Max results (default 10).' } }, required: ['query'] },
    argv: (a) => [bin('dsh-memory.py'), 'search', a.query, ...(a.limit ? ['--limit', String(a.limit)] : [])],
  },
  {
    name: 'dsh_memory_write',
    description: 'Record a durable fact. Anything that should outlive this session goes here. Never write secrets — the store is readable.',
    schema: { type: 'object', properties: { text: req('The fact, stated plainly.'), tags: opt('Comma-separated tags.'), pin: { type: 'boolean', description: 'Pin to the top of listings.' } }, required: ['text'] },
    argv: (a) => [bin('dsh-memory.py'), 'write', a.text, ...(a.tags ? ['--tags', a.tags] : []), ...(a.pin ? ['--pin'] : [])],
  },
  {
    name: 'dsh_tasks_list',
    description: 'Open work in the durable task ledger, optionally for one project.',
    schema: { type: 'object', properties: { project: opt('Project name; omit for all.') } },
    argv: (a) => [bin('dsh-tasks.py'), 'list', ...(a.project ? [a.project] : [])],
  },
  {
    name: 'dsh_tasks_add',
    description: 'Add a task to the durable ledger. Work that outlives one turn belongs here, not in prose.',
    schema: { type: 'object', properties: { project: req('Owning project.'), title: req('What needs doing.'), note: opt('Context worth keeping.') }, required: ['project', 'title'] },
    argv: (a) => [bin('dsh-tasks.py'), 'add', a.project, a.title, ...(a.note ? ['--note', a.note] : [])],
  },
  {
    name: 'dsh_tasks_done',
    description: 'Close a ledger task, optionally recording what was actually done. Close work when it is finished, not when it is started.',
    schema: { type: 'object', properties: { project: req('Owning project.'), id: req('Task id, e.g. can-3.'), note: opt('What was done.') }, required: ['project', 'id'] },
    argv: (a) => [bin('dsh-tasks.py'), 'done', a.project, a.id, ...(a.note ? ['--note', a.note] : [])],
  },
  {
    name: 'dsh_tasks_block',
    description: 'Mark a ledger task blocked and say what it is waiting on. A blocked task with no reason is worse than no task.',
    schema: { type: 'object', properties: { project: req('Owning project.'), id: req('Task id.'), reason: req('What it is waiting on.') }, required: ['project', 'id', 'reason'] },
    argv: (a) => [bin('dsh-tasks.py'), 'block', a.project, a.id, '--reason', a.reason],
  },
  {
    name: 'dsh_role',
    description: 'The operating rules for a project or repository — branch policy, toolchain facts, production access. Read this BEFORE editing anything in a repo: project rules are not loaded into a general session, and acting without them is how work lands on the wrong branch.',
    schema: { type: 'object', properties: { target: req('Project name or repository name.') }, required: ['target'] },
    argv: (a) => [bin('dsh-role.sh'), a.target],
  },
  {
    name: 'dsh_projects',
    description: 'The project registry: which agent owns which repositories. Read this before assuming where a repo belongs.',
    schema: { type: 'object', properties: {} },
    argv: () => ['cat', join(homedir(), '.dsh-jarvis', 'PROJECTS.md')],
  },
  {
    name: 'dsh_notify',
    description: 'Send a message to the user (Telegram by default). A conclusion left in a log reaches nobody.',
    schema: { type: 'object', properties: { text: req('One short line.'), channel: { type: 'string', enum: ['telegram', 'whatsapp'], description: 'Default telegram.' } }, required: ['text'] },
    argv: (a) => [bin('dsh-notify.sh'), ...(a.channel === 'whatsapp' ? ['--whatsapp'] : []), a.text],
  },
  {
    name: 'dsh_mcp_call',
    description: 'Call any tool on the wider MCP estate (github, shopify, digitalocean, tailscale, zernio and ~20 more) without composing it. Discover signatures with dsh_mcp_schema first.',
    schema: { type: 'object', properties: { server: req('Server name, e.g. github.'), tool: req('Tool name.'), params: opt('JSON object of arguments.') }, required: ['server', 'tool'] },
    argv: (a) => ['mcporter', 'call', a.server, a.tool, '--params', a.params || '{}'],
  },
  {
    name: 'dsh_mcp_schema',
    description: 'List one MCP server\u2019s tools and their exact signatures. Call this before dsh_mcp_call rather than guessing an argument shape.',
    schema: { type: 'object', properties: { server: req('Server name.') }, required: ['server'] },
    argv: (a) => ['mcporter', 'list', a.server, '--schema'],
  },
  {
    name: 'dsh_dispatch',
    description: 'Hand a task to a project agent running on the implementation model. Returns immediately with a job id — delegation takes minutes, so poll with dsh_job_status rather than waiting.',
    schema: {
      type: 'object',
      properties: { project: req('Owning project.'), task: req('A complete, self-contained brief.'), repo: opt('Repository to work in.') },
      required: ['project', 'task'],
    },
    background: true,
    argv: (a) => [bin('dsh-agent.sh'), a.project, ...(a.repo ? ['--repo', a.repo] : []), a.task],
  },
  {
    name: 'dsh_job_status',
    description: 'Check a dispatched job: whether it is still running, and its output so far.',
    schema: { type: 'object', properties: { job_id: req('Id from dsh_dispatch.'), tail: { type: 'integer', description: 'Lines of output (default 40).' } }, required: ['job_id'] },
    special: 'job_status',
  },
];

export const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The MCP-facing declaration for one tool. */
export function declare(tool) {
  return { name: tool.name, description: tool.description, inputSchema: tool.schema };
}

/**
 * Validate arguments against a tool's schema.
 * Only what matters here: required strings present and actually strings.
 */
export function validate(tool, args = {}) {
  const missing = (tool.schema.required ?? []).filter(
    (k) => args[k] === undefined || args[k] === null || String(args[k]).trim() === '',
  );
  if (missing.length) return `missing required argument(s): ${missing.join(', ')}`;
  return null;
}
