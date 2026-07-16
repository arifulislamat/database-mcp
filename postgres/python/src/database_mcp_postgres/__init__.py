import asyncio
import os
import sys
from importlib.metadata import version as pkg_version

from database_mcp_core import load_config, serve

from .adapter import PostgresAdapter

__all__ = ["PostgresAdapter", "main"]


def main() -> None:
    try:
        config = load_config(sys.argv[1:], os.environ, env_prefix="POSTGRES", dsn_env_var="DATABASE_URL")
        c = config.connection
        # psycopg also honors libpq's native PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
        if not (c.dsn or c.host or c.database or os.environ.get("PGHOST") or os.environ.get("PGDATABASE")):
            raise RuntimeError(
                "config: no database given, pass --dsn postgres://user@host/db, "
                "set DATABASE_URL or POSTGRES_HOST/POSTGRES_USER/POSTGRES_DATABASE "
                "(or libpq PG* vars), or use --config"
            )
        asyncio.run(
            serve(
                PostgresAdapter(c, config.guardrails.query_timeout_ms),
                config,
                pkg_version("database-mcp-postgres"),
            )
        )
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
