# @database-mcp/core

[![npm](https://img.shields.io/npm/v/%40database-mcp%2Fcore)](https://www.npmjs.com/package/@database-mcp/core) [![CI](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arifulislamat/database-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/arifulislamat/database-mcp)](https://github.com/arifulislamat/database-mcp/blob/main/LICENSE)

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
import { createRequire } from "node:module";
import { MyAdapter } from "./adapter.js";

const { version } = createRequire(import.meta.url)("../package.json");
const config = loadConfig(process.argv.slice(2), process.env, {
  envPrefix: "MYENGINE",
  dsnEnvVar: "MYENGINE_DSN",
});
await serve(new MyAdapter(config.connection), config, version);
```

Conformance is the definition of done: your package is correct when the shared
suite in the repo passes against it.

## License

MIT
