import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "./adapter.js";
import type { Config } from "./config.js";
import { installLogRedaction, redact } from "./secret.js";
import { buildServer } from "./server.js";

/**
 * Connects the adapter, registers the tools, and serves over the configured
 * transport (stdio by default, Streamable HTTP with --transport http).
 * The whole lifecycle an engine entry point needs.
 */
export async function serve(adapter: DatabaseAdapter, config: Config, version: string): Promise<void> {
  // stdout is reserved for the MCP stream; stderr carries logs and is
  // masked by the redaction filter before anything reaches the terminal.
  installLogRedaction();

  try {
    await adapter.connect({ readOnly: config.guardrails.readOnly });
  } catch (e) {
    // Driver connection errors can echo credentials; never rethrow raw.
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`connection failed: ${redact(message)}`);
  }

  if (config.transport.type === "http") {
    await serveHttp(adapter, config, version);
    return;
  }

  const server = buildServer(adapter, config.guardrails, version);
  const shutdown = async () => {
    await server.close();
    await adapter.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(new StdioServerTransport());
  console.error(`database-mcp-${adapter.engine} ${version} ready (read-only: ${config.guardrails.readOnly})`);
}

/**
 * Streamable HTTP (the current spec transport; SSE is deprecated and not
 * implemented). One MCP session per client, all sharing the adapter's pool.
 * Binds 127.0.0.1 only; remote auth is deliberately out of scope for now.
 */
async function serveHttp(adapter: DatabaseAdapter, config: Config, version: string): Promise<void> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith("/mcp")) {
        res.writeHead(404).end();
        return;
      }
      let body: unknown;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        body = JSON.parse(Buffer.concat(chunks).toString() || "null");
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        if (req.method !== "POST" || !isInitializeRequest(body)) {
          res
            .writeHead(400, { "content-type": "application/json" })
            .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: no valid session" }, id: null }));
          return;
        }
        const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, t);
          },
        });
        t.onclose = () => {
          if (t.sessionId) transports.delete(t.sessionId);
        };
        await buildServer(adapter, config.guardrails, version).connect(t);
        transport = t;
      }
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error(redact(e instanceof Error ? e.message : String(e)));
      if (!res.headersSent) res.writeHead(500).end();
    }
  });

  const shutdown = async () => {
    httpServer.close();
    for (const t of transports.values()) await t.close().catch(() => {});
    await adapter.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>((resolve) => httpServer.listen(config.transport.port, "127.0.0.1", resolve));
  console.error(
    `database-mcp-${adapter.engine} ${version} listening on http://127.0.0.1:${config.transport.port}/mcp (read-only: ${config.guardrails.readOnly})`,
  );
}
