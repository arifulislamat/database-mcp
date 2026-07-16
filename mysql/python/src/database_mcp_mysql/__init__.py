import asyncio
import os
import sys
from importlib.metadata import version as pkg_version

from database_mcp_core import load_config, serve

from .adapter import MysqlAdapter

__all__ = ["MysqlAdapter", "main"]


def main() -> None:
    try:
        config = load_config(sys.argv[1:], os.environ, env_prefix="MYSQL", dsn_env_var="MYSQL_DSN")
        c = config.connection
        if not (c.dsn or c.host or c.database):
            raise RuntimeError(
                "config: no database given, pass --dsn mysql://user@host/db, "
                "set MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE, or use --config"
            )
        asyncio.run(
            serve(
                MysqlAdapter(c, config.guardrails.query_timeout_ms),
                config,
                pkg_version("database-mcp-mysql"),
            )
        )
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
