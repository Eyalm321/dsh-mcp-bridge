# dsh-mcp-bridge

Hands a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) deployment's
capabilities to any MCP client — memory, the durable task ledger, project-agent dispatch and
the wider MCP estate — as **declared tools** instead of shell commands a model has to be told
about and remember.

## Why

`claude -p` runs its own agent loop, so it never receives the harness's tool schemas: a
Claude-backed session has no memory, no ledger, no dispatch. It *does* accept MCP servers.
This is that server.

Everything it exposes already has a command-line entry point, so this adds a **surface, not
authority** — it can do exactly what the caller could already do in a shell. What it cannot
bridge is anything that only exists inside a live harness turn (goals, AgentTeams); those are
session-scoped by design and have no external surface.

## Tools

| tool | does |
|---|---|
| `dsh_memory_search` / `dsh_memory_write` | the durable memory store |
| `dsh_tasks_list` / `_add` / `_done` / `_block` | the task ledger |
| `dsh_dispatch` / `dsh_job_status` | hand work to a project agent, then poll it |
| `dsh_mcp_call` / `dsh_mcp_schema` | any server in the MCP estate, uncomposed |
| `dsh_projects` | the repository ownership registry |
| `dsh_notify` | reach the user |

## Use

```jsonc
// mcp-bridge.json
{ "mcpServers": { "dsh": { "command": "node", "args": ["/path/to/src/server.js"] } } }
```

```sh
claude -p --strict-mcp-config --mcp-config ./mcp-bridge.json
```

Point `DSH_JARVIS_BIN` at the directory holding the CLIs if it is not `~/.dsh-jarvis/bin`.

## Three things learned the hard way

- **`--mcp-config` is variadic.** Inline JSON followed by a positional prompt makes the client
  read the prompt as a second config path (`MCP config file not found: /tmp/List the tool…`).
  Pass a file.
- **Don't exit the instant stdin reports EOF.** The spec says client-closes-stdin is shutdown,
  but some clients hand the server a stdin already at EOF; the server exits before the first
  request, the client respawns it, and it loops. Observed: 32 spawns in three minutes, no call
  completed. Here EOF only ends the process once something has been served, with a bounded
  idle timeout so an abandoned server still goes away.
- **Verify a bridge with a write, never a read.** A model asked to "call the search tool" can
  reproduce plausible output from its own context when the call actually failed — one did
  exactly that here and later admitted it. A write with a random token either lands in the
  store or does not.

## Tests

```sh
npm test
```

20 tests, no dependencies, no client required: the tool catalogue and the JSON-RPC layer are
both pure.

## License

MIT
