"""Secret handling: secrets must never appear in plaintext output."""

import re
import sys

# Registered secret literals, masked by redact() just before output.
_secrets: set[str] = set()


def register_secret(value: str) -> None:
    if value:
        _secrets.add(value)


# Matches the password in credential-bearing URIs: proto://user:pass@
_URI_CREDENTIALS = re.compile(r"([a-z][a-z0-9+.-]*://[^:@/\s]+):[^@/\s]+@", re.IGNORECASE)


def redact(text: str) -> str:
    """Masks every registered secret and anything shaped like URI credentials.

    Belt and suspenders for logs from dependencies we don't control.
    """
    out = _URI_CREDENTIALS.sub(r"\1:***@", text)
    for s in _secrets:
        out = out.replace(s, "***")
    return out


def sanitize_dsn(dsn: str) -> str:
    """A full DSN embeds the password; log this form instead."""
    return _URI_CREDENTIALS.sub(r"\1@", dsn)


class Secret:
    """A password that cannot be printed by accident.

    Every render path (str, repr, f-string) yields "***". The raw value is
    available only through reveal(), used at the single point of driver
    connection. Constructing one also registers it with the log redactor.
    """

    def __init__(self, value: str) -> None:
        self.__value = value
        register_secret(value)

    def reveal(self) -> str:
        return self.__value

    def __str__(self) -> str:
        return "***"

    def __repr__(self) -> str:
        return "***"


class _RedactingStream:
    def __init__(self, wrapped):
        self.__wrapped = wrapped

    def write(self, s):
        return self.__wrapped.write(redact(s) if isinstance(s, str) else s)

    def __getattr__(self, name):
        return getattr(self._RedactingStream__wrapped, name)


_installed = False


def install_log_redaction() -> None:
    """Installs the redaction filter at the log boundary: everything written
    to stderr is masked just before output. stdout is the MCP stream and
    never carries logs."""
    global _installed
    if _installed:
        return
    _installed = True
    sys.stderr = _RedactingStream(sys.stderr)
