/**
 * The MCP wire protocol: newline-delimited JSON-RPC 2.0 over stdio.
 *
 * Implemented directly rather than via an SDK for the same reason the other plugins here
 * have no dependencies — three message types is less code than a dependency tree, and it
 * keeps the server auditable by anyone deciding whether to let it touch their machine.
 *
 * @module dsh-mcp-bridge/rpc
 */

export const SERVER_INFO = { name: 'dsh-mcp-bridge', version: '0.1.0' };

/** A JSON-RPC success envelope. */
export const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

/** A JSON-RPC error envelope. */
export const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** MCP tool results are content arrays; isError marks a failed call the model should read. */
export const content = (text, isError = false) => ({
  content: [{ type: 'text', text: String(text ?? '').slice(0, 100_000) }],
  ...(isError ? { isError: true } : {}),
});

/**
 * Route one request. Returns a response object, or null for notifications
 * (which must not be answered — a reply to a notification is a protocol error).
 */
export async function handle(msg, deps) {
  const { id, method, params } = msg ?? {};
  if (method === undefined) return err(id ?? null, -32600, 'not a request');
  if (id === undefined || id === null) return null;   // notification

  switch (method) {
    case 'initialize':
      return ok(id, {
        // Echo the client's protocol version when it names one: this server's surface is
        // small enough to be compatible across revisions, and refusing on a version
        // mismatch is the most common way a bridge silently fails to load.
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: deps.list() });
    case 'tools/call': {
      const out = await deps.call(params?.name, params?.arguments ?? {});
      return ok(id, out);
    }
    default:
      return err(id, -32601, `method not found: ${method}`);
  }
}
