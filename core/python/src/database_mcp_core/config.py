"""Multi-source config resolution, mirroring core/typescript/src/config.ts."""

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import unquote, urlsplit

import yaml

from .secret import Secret, redact, register_secret


@dataclass
class Guardrails:
    read_only: bool = True
    max_rows: int = 1000
    query_timeout_ms: int = 30000


@dataclass
class Connection:
    """General enough for a SQLite file path AND a networked engine."""

    dsn: str | None = None
    host: str | None = None
    port: int | None = None
    user: str | None = None
    password: Secret | None = None
    database: str | None = None


@dataclass
class Transport:
    type: str = "stdio"
    # http only; the server binds 127.0.0.1.
    port: int = 8080


@dataclass
class Config:
    connection: Connection = field(default_factory=Connection)
    guardrails: Guardrails = field(default_factory=Guardrails)
    transport: Transport = field(default_factory=Transport)


_VAR = re.compile(r"\$\{(\w+)\}")


def _expand(value: str, env: Mapping[str, str], path: str) -> str:
    """${VAR} in YAML string values resolves from the environment at load time."""

    def sub(m: re.Match[str]) -> str:
        name = m.group(1)
        if name not in env:
            raise ValueError(
                f"config: ${{{name}}} referenced at '{path}' but the environment variable is not set"
            )
        return env[name]

    return _VAR.sub(sub, value)


def _expand_deep(node: Any, env: Mapping[str, str], path: str = "") -> Any:
    if isinstance(node, str):
        return _expand(node, env, path)
    if isinstance(node, list):
        return [_expand_deep(v, env, f"{path}[{i}]") for i, v in enumerate(node)]
    if isinstance(node, dict):
        return {k: _expand_deep(v, env, f"{path}.{k}" if path else k) for k, v in node.items()}
    return node


def _first(*values: Any) -> Any:
    return next((v for v in values if v is not None), None)


def load_config(
    argv: list[str],
    env: Mapping[str, str],
    *,
    env_prefix: str,
    dsn_env_var: str | None = None,
    password_env_var: str | None = None,
) -> Config:
    """Multi-source resolution, highest precedence first:
      1. flags (--dsn, --allow-write, --max-rows, --query-timeout-ms)
      2. --config <path.yaml> (or DB_MCP_CONFIG), with ${VAR} expansion
      3. discrete env vars (<PREFIX>_HOST, ..., plus *_FILE variants)
      4. defaults
    Password specifically: password_file / *_PASSWORD_FILE > password / *_PASSWORD.
    The password is a Secret the moment it is read.
    """

    def flag(name: str) -> str | None:
        try:
            i = argv.index(name)
        except ValueError:
            return None
        return argv[i + 1] if i + 1 < len(argv) else None

    config_path = flag("--config") or env.get("DB_MCP_CONFIG")
    file: dict[str, Any] = {}
    if config_path:
        file = _expand_deep(yaml.safe_load(Path(config_path).read_text()), env) or {}
    fc: dict[str, Any] = file.get("connection") or {}
    fg: dict[str, Any] = file.get("guardrails") or {}
    ft: dict[str, Any] = file.get("transport") or {}
    P = env_prefix

    pw_var = password_env_var or f"{P}_PASSWORD"
    password_file = _first(fc.get("password_file"), env.get(f"{pw_var}_FILE"))
    if password_file:
        raw_password = Path(password_file).read_text().strip()
    else:
        raw_password = _first(fc.get("password"), env.get(pw_var))

    dsn = _first(
        flag("--dsn"),
        fc.get("dsn"),
        env.get(dsn_env_var) if dsn_env_var else None,
        env.get(f"{P}_DSN"),
    )
    # Inline DSN credentials are discouraged but must never leak: register them.
    if dsn:
        try:
            parsed = urlsplit(dsn)
            if parsed.password:
                register_secret(unquote(parsed.password))
        except ValueError:
            pass  # not a URL (e.g. a file path)

    if "--allow-write" in argv:
        read_only = False
    elif isinstance(fg.get("readOnly"), bool):
        read_only = fg["readOnly"]
    elif "ALLOW_WRITE" in env:
        read_only = env["ALLOW_WRITE"] != "true"
    else:
        read_only = True

    port = _first(fc.get("port"), env.get(f"{P}_PORT"))
    config = Config(
        connection=Connection(
            dsn=dsn,
            host=_first(fc.get("host"), env.get(f"{P}_HOST")),
            port=int(port) if port is not None else None,
            user=_first(fc.get("user"), env.get(f"{P}_USER")),
            password=Secret(raw_password) if raw_password else None,
            database=_first(fc.get("database"), env.get(f"{P}_DATABASE")),
        ),
        guardrails=Guardrails(
            read_only=read_only,
            max_rows=int(_first(flag("--max-rows"), fg.get("maxRows"), env.get("MAX_ROWS"), 1000)),
            query_timeout_ms=int(
                _first(flag("--query-timeout-ms"), fg.get("queryTimeoutMs"), env.get("QUERY_TIMEOUT_MS"), 30000)
            ),
        ),
        transport=Transport(
            type=_first(flag("--transport"), ft.get("type"), "stdio"),
            port=int(_first(flag("--port"), ft.get("port"), 8080)),
        ),
    )

    # Debug aid. The password renders as *** and redact() masks DSN-embedded
    # credentials, which are plain strings (issue #18). This print happens
    # before serve() installs the stderr filter, and goes to stdout anyway.
    if "--print-config" in argv:
        print(redact(json.dumps(_dump(config), indent=2)))
        sys.exit(0)

    return config


def _dump(config: Config) -> dict[str, Any]:
    """Redacted, camelCase dump matching the TypeScript --print-config shape."""
    c = config.connection
    connection = {
        "dsn": c.dsn,
        "host": c.host,
        "port": c.port,
        "user": c.user,
        "password": "***" if c.password else None,
        "database": c.database,
    }
    return {
        "connection": {k: v for k, v in connection.items() if v is not None},
        "guardrails": {
            "readOnly": config.guardrails.read_only,
            "maxRows": config.guardrails.max_rows,
            "queryTimeoutMs": config.guardrails.query_timeout_ms,
        },
        "transport": {"type": config.transport.type, "port": config.transport.port},
    }
