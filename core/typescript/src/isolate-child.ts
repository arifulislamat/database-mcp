// The child side of IsolatedAdapter: owns the adapter and its connection,
// answers one IPC message per call. Never writes to stdout.
import type { DatabaseAdapter } from "./adapter.js";

type Message = { id: number; op: string; args: unknown[] };

let adapter: DatabaseAdapter | undefined;

// The parent is gone (or killed us on purpose): nothing left to serve.
process.on("disconnect", () => process.exit(0));

process.on("message", async ({ id, op, args }: Message) => {
  try {
    let result: unknown;
    if (op === "init") {
      const [moduleUrl, exportName, ctorArgs, readOnly] = args as [string, string, unknown[], boolean];
      const Adapter = (await import(moduleUrl))[exportName] as new (...a: unknown[]) => DatabaseAdapter;
      adapter = new Adapter(...ctorArgs);
      await adapter.connect({ readOnly });
    } else {
      const method = (adapter as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[op];
      result = await method.apply(adapter, args);
    }
    process.send?.({ id, result });
  } catch (e) {
    process.send?.({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
