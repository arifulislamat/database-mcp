"""The MCP protocol layer: registers the two contract tools on a server."""

import json
import re
from typing import Any

import mcp.types as types
from mcp.server.lowlevel import Server

from .adapter import DatabaseAdapter
from .config import Guardrails
from .secret import redact
from .sql_guard import guard_sql

_PREFIXED = re.compile(r"timeout:|read-only:|multi-statement:|unknown table:")
# SQLite: "readonly database"/query_only; MySQL: "READ ONLY transaction";
# Postgres: "read-only transaction".
_LAYER2_READONLY = re.compile(r"readonly database|query_only|read.only transaction", re.IGNORECASE)
_LAYER2_TIMEOUT = re.compile(r"inactivity timeout|PROTOCOL_SEQUENCE_TIMEOUT|statement timeout", re.IGNORECASE)


def _sanitize_error(e: Exception) -> str:
    """Maps session-level write rejections (layer two) to the stable prefix."""
    message = str(e)
    if _PREFIXED.search(message):
        return message
    if _LAYER2_READONLY.search(message):
        return "read-only: statement blocked by the database session (start the server with --allow-write to enable writes)"
    if _LAYER2_TIMEOUT.search(message):
        return "timeout: query exceeded the configured queryTimeoutMs"
    # Tool results travel over stdout (the MCP stream), which the stderr
    # redaction filter cannot cover; mask driver messages here too.
    return redact(message)


class _ToolError(Exception):
    """Raised with the exact tool error text; the SDK returns str(e) with isError."""


def build_server(adapter: DatabaseAdapter, guardrails: Guardrails, version: str) -> Server:
    server: Server = Server(f"database-mcp-{adapter.engine}", version=version)

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name="execute_sql",
                description=(
                    f"Run a single SQL statement against the {adapter.engine} database. "
                    "Returns a summary line followed by compact JSON {columns, rows}. "
                    + ("The connection is read-only. " if guardrails.read_only else "")
                    + f"Results are capped at {guardrails.max_rows} rows."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {"sql": {"type": "string", "description": "A single SQL statement"}},
                    "required": ["sql"],
                },
            ),
            types.Tool(
                name="search_objects",
                description=(
                    "Explore the schema progressively. Without arguments: list all tables with "
                    "estimated row counts. With a table name: full detail, columns, indexes, "
                    "and foreign keys."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "table": {"type": "string", "description": "Table name for detail; omit to list tables"}
                    },
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
        if name == "execute_sql":
            text = _execute_sql(adapter, guardrails, arguments["sql"])
        elif name == "search_objects":
            text = _search_objects(adapter, arguments.get("table"))
        else:
            raise _ToolError(f"unknown tool: {name}")
        return [types.TextContent(type="text", text=text)]

    return server


def _execute_sql(adapter: DatabaseAdapter, guardrails: Guardrails, sql: str) -> str:
    blocked = guard_sql(sql, guardrails.read_only)
    if blocked:
        raise _ToolError(blocked)
    try:
        r = adapter.query(sql, max_rows=guardrails.max_rows, timeout_ms=guardrails.query_timeout_ms)
    except Exception as e:
        raise _ToolError(_sanitize_error(e)) from None
    if not r["columns"]:
        summary = f"OK ({r['rowCount']} affected)"
    elif r["truncated"]:
        summary = f"truncated to {r['rowCount']} rows"
    else:
        summary = f"{r['rowCount']} rows"
    payload = json.dumps({"columns": r["columns"], "rows": r["rows"]}, separators=(",", ":"))
    return f"{summary}\n{payload}"


def _search_objects(adapter: DatabaseAdapter, table: str | None) -> str:
    try:
        result = adapter.describe_table(table) if table else {"tables": adapter.list_tables()}
    except Exception as e:
        raise _ToolError(str(e)) from None
    return json.dumps(result, separators=(",", ":"))
