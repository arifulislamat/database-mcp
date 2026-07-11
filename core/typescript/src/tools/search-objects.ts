import type { DatabaseAdapter } from "../adapter.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function makeSearchObjects(adapter: DatabaseAdapter) {
  return async ({ table }: { table?: string }): Promise<ToolResult> => {
    try {
      const result = table
        ? await adapter.describeTable(table)
        : { tables: await adapter.listTables() };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };
}
