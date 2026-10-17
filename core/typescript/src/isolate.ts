import { fork, type ChildProcess } from "node:child_process";
import type { DatabaseAdapter, QueryOptions, QueryResult, TableSummary, TableDescription } from "./adapter.js";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Reply = { id: number; result?: unknown; error?: string };

/**
 * Runs an adapter in a child process. For drivers that execute a statement
 * synchronously on the calling thread (better-sqlite3, libsql local files):
 * such a statement blocks the event loop and cannot be interrupted, so no
 * in-process timer can enforce queryTimeoutMs, and a worker thread stuck in
 * native code cannot even be terminated (issue #38). Here the server stays
 * responsive; at the deadline the child is killed and replaced on next use.
 *
 * The adapter is constructed in the child from its module URL, export name
 * and constructor arguments, which must survive structured clone (no
 * Secret instances; isolate only adapters that need no credentials).
 */
export class IsolatedAdapter implements DatabaseAdapter {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private readOnly = true;

  constructor(
    public engine: string,
    private moduleUrl: string,
    private exportName: string,
    private args: unknown[],
  ) {}

  async connect({ readOnly }: { readOnly: boolean }): Promise<void> {
    this.readOnly = readOnly;
    await this.ready();
  }

  async close(): Promise<void> {
    this.child?.kill();
    this.child = undefined;
  }

  async query(sql: string, opts: QueryOptions): Promise<QueryResult> {
    await this.ready();
    return (await this.call("query", [sql, opts], opts.timeoutMs)) as QueryResult;
  }

  async listTables(): Promise<TableSummary[]> {
    await this.ready();
    return (await this.call("listTables", [])) as TableSummary[];
  }

  async describeTable(table: string): Promise<TableDescription> {
    await this.ready();
    return (await this.call("describeTable", [table])) as TableDescription;
  }

  private ready(): Promise<void> {
    if (this.child) return Promise.resolve();
    this.starting ??= this.start().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async start(): Promise<void> {
    // stdout is the MCP stream, so the child gets none. Its stderr is
    // forwarded through this process's stderr, which carries the redaction
    // filter.
    const child = fork(new URL("./isolate-child.js", import.meta.url), [], {
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    // Calls are tracked per child: a killed child's late exit event must not
    // reject calls already sent to its replacement.
    const pending = new Map<number, Pending>();
    child.on("message", (m: Reply) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.result);
    });
    child.on("exit", () => {
      if (this.child === child) this.child = undefined;
      for (const p of pending.values()) p.reject(new Error("database process exited"));
      pending.clear();
    });
    this.child = child;
    this.pending = pending;
    try {
      await this.call("init", [this.moduleUrl, this.exportName, this.args, this.readOnly]);
    } catch (e) {
      child.kill();
      this.child = undefined;
      throw e;
    }
  }

  private call(op: string, args: unknown[], timeoutMs?: number): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("database process is not running"));
    const pending = this.pending;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              pending.delete(id);
              // The only way to stop a statement stuck in native code.
              this.child = undefined;
              child.kill("SIGKILL");
              reject(new Error(`timeout: query exceeded ${timeoutMs}ms`));
            }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.send({ id, op, args });
    });
  }
}
