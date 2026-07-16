import asyncio
import os
import sys
from importlib.metadata import version as pkg_version

from database_mcp_core import load_config, serve

from .adapter import SqliteAdapter

__all__ = ["SqliteAdapter", "main"]


def main() -> None:
    try:
        config = load_config(sys.argv[1:], os.environ, env_prefix="SQLITE", dsn_env_var="SQLITE_PATH")
        if not config.connection.dsn:
            raise RuntimeError(
                "config: no database given, pass --dsn /path/to.db, set SQLITE_PATH, or use --config"
            )
        asyncio.run(serve(SqliteAdapter(config.connection.dsn), config, pkg_version("database-mcp-sqlite")))
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
