import asyncio
import os
import sys
from importlib.metadata import version as pkg_version

from database_mcp_core import load_config, serve

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
        asyncio.run(
            serve(
                LibsqlAdapter(config.connection.dsn, config.connection.password),
                config,
                pkg_version("database-mcp-libsql"),
            )
        )
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
