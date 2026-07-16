import asyncio
import os
import sys
from importlib.metadata import version as pkg_version

from database_mcp_core import load_config, serve

from .adapter import MariadbAdapter

__all__ = ["MariadbAdapter", "main"]


def main() -> None:
    try:
        config = load_config(sys.argv[1:], os.environ, env_prefix="MARIADB", dsn_env_var="MARIADB_DSN")
        c = config.connection
        if not (c.dsn or c.host or c.database):
            raise RuntimeError(
                "config: no database given, pass --dsn mysql://user@host/db, "
                "set MARIADB_HOST/MARIADB_USER/MARIADB_DATABASE, or use --config"
            )
        asyncio.run(
            serve(
                MariadbAdapter(c, config.guardrails.query_timeout_ms),
                config,
                pkg_version("database-mcp-mariadb"),
            )
        )
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
