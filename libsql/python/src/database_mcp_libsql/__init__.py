import asyncio
import os
import sys
from importlib.metadata import version as pkg_version

from database_mcp_core import IsolatedAdapter, load_config, serve

from .adapter import LibsqlAdapter

__all__ = ["LibsqlAdapter", "main"]


def main() -> None:
    try:
        config = load_config(
            sys.argv[1:],
            os.environ,
            env_prefix="LIBSQL",
            dsn_env_var="LIBSQL_URL",
            password_env_var="LIBSQL_AUTH_TOKEN",
        )
        if not config.connection.dsn:
            raise RuntimeError(
                "config: no database given, pass --dsn <file-or-libsql-url>, set LIBSQL_URL, or use --config"
            )
        # The libsql driver cannot interrupt a running statement, local or
        # remote; a child process is the only way to stop a runaway one at
        # queryTimeoutMs (issue #38). The token reaches the child over its
        # stdin pipe, never argv or the environment.
        token = config.connection.password.reveal() if config.connection.password else None
        adapter = IsolatedAdapter(
            "libsql", "database_mcp_libsql.adapter", "LibsqlAdapter", [config.connection.dsn, token]
        )
        asyncio.run(serve(adapter, config, pkg_version("database-mcp-libsql")))
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
