"""Adapter + config + transport lifecycle: everything an engine entry needs."""

import contextlib
import re
import sys
from urllib.parse import urlsplit

from mcp.server.stdio import stdio_server

from .adapter import DatabaseAdapter
from .config import Config
from .secret import install_log_redaction, redact
from .server import build_server


async def serve(adapter: DatabaseAdapter, config: Config, version: str) -> None:
    """Connects the adapter, registers the tools, and serves over the
    configured transport (stdio by default, Streamable HTTP with
    --transport http)."""
    # stdout is reserved for the MCP stream; stderr carries logs and is
    # masked by the redaction filter before anything reaches the terminal.
    install_log_redaction()

    try:
        adapter.connect(read_only=config.guardrails.read_only)
    except Exception as e:
        # Driver connection errors can echo credentials; never rethrow raw.
        raise RuntimeError(f"connection failed: {redact(str(e))}") from None

    try:
        if config.transport.type == "http":
            await _serve_http(adapter, config, version)
        else:
            server = build_server(adapter, config.guardrails, version)
            async with stdio_server() as (read, write):
                print(
                    f"database-mcp-{adapter.engine} {version} ready "
                    f"(read-only: {str(config.guardrails.read_only).lower()})",
                    file=sys.stderr,
                )
                await server.run(read, write, server.create_initialization_options())
    finally:
        adapter.close()


_HOST_PORT = re.compile(r":\d+$")
_LOCAL_NAMES = {"127.0.0.1", "localhost", "[::1]"}


def _is_local(headers: dict[str, str]) -> bool:
    """DNS rebinding protection: a malicious webpage can point its own domain
    at 127.0.0.1 and make a visitor's browser hit this server. Reject any
    request whose Host or Origin is not local."""
    host = _HOST_PORT.sub("", headers.get("host", ""))
    if host not in _LOCAL_NAMES:
        return False
    origin = headers.get("origin")
    if origin:
        origin_host = urlsplit(origin).hostname or ""
        return origin_host in _LOCAL_NAMES or f"[{origin_host}]" in _LOCAL_NAMES
    return True


async def _serve_http(adapter: DatabaseAdapter, config: Config, version: str) -> None:
    """Streamable HTTP (the current spec transport; SSE is deprecated and not
    implemented). One session manager, all sessions sharing the adapter.
    Binds 127.0.0.1 only; remote auth is deliberately out of scope for now."""
    import uvicorn
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from starlette.applications import Starlette
    from starlette.routing import Mount

    server = build_server(adapter, config.guardrails, version)
    manager = StreamableHTTPSessionManager(app=server)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        async with manager.run():
            print(
                f"database-mcp-{adapter.engine} {version} listening on "
                f"http://127.0.0.1:{config.transport.port}/mcp "
                f"(read-only: {str(config.guardrails.read_only).lower()})",
                file=sys.stderr,
            )
            yield

    app = Starlette(routes=[Mount("/mcp", app=manager.handle_request)], lifespan=lifespan)

    # The guard wraps the whole app so bad Host/Origin is rejected before any
    # routing (Starlette's Mount would otherwise answer /mcp with a redirect
    # first). Lifespan scopes pass through untouched.
    async def guarded(scope, receive, send):
        if scope["type"] == "http":
            headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
            if not _is_local(headers):
                await send({"type": "http.response.start", "status": 403, "headers": []})
                await send({"type": "http.response.body", "body": b""})
                return
        await app(scope, receive, send)

    await uvicorn.Server(
        uvicorn.Config(guarded, host="127.0.0.1", port=config.transport.port, log_level="warning")
    ).serve()
