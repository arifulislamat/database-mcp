# @database-mcp/core

Engine-agnostic core for [database-mcp](https://github.com/arifulislamat/database-mcp)
MCP servers: the protocol layer, the `DatabaseAdapter` interface, guardrails,
config loading, and the SQL guard.

You probably want an engine package instead (`@database-mcp/sqlite`,
`@database-mcp/mysql`, and so on). Each is a thin adapter on top of this core.

## Writing an engine package

Implement `DatabaseAdapter`, then:

```ts
#!/usr/bin/env node
import { loadConfig, serve } from "@database-mcp/core";
import { MyAdapter } from "./adapter.js";

const config = loadConfig(process.argv.slice(2), process.env, { dsnEnvVar: "MYENGINE_DSN" });
await serve(new MyAdapter(config.dsn), config, "0.1.0");
```

Conformance is the definition of done: your package is correct when the shared
suite in the repo passes against it.

## License

MIT
