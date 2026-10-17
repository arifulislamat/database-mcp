"""Runs an adapter in a child process, for drivers that cannot interrupt a
running statement (the libsql package has no interrupt or progress handler).

A statement stuck in native code cannot be stopped from another thread, so no
in-process timeout can enforce queryTimeoutMs (issue #38). Here the server
stays responsive: at the deadline the child is killed and replaced on next
use. The child speaks JSON lines over its stdin/stdout pipes, never the
server's stdout (the MCP stream); its stderr is forwarded through this
process's redacting stderr. Mirrors core/typescript/src/isolate.ts.
"""

import json
import queue
import subprocess
import sys
import threading
from typing import Any


class IsolatedAdapter:
    def __init__(self, engine: str, module: str, class_name: str, args: list[Any]) -> None:
        self.engine = engine
        self._target = [module, class_name, args]
        self._read_only = True
        self._proc: subprocess.Popen[str] | None = None
        self._replies: queue.Queue[dict[str, Any] | None] = queue.Queue()

    def connect(self, *, read_only: bool) -> None:
        self._read_only = read_only
        self._start()

    def close(self) -> None:
        if self._proc is not None:
            self._proc.kill()
            self._proc = None

    def query(self, sql: str, *, max_rows: int, timeout_ms: int) -> dict[str, Any]:
        return self._call("query", [sql, max_rows, timeout_ms], timeout_ms)

    def list_tables(self) -> list[dict[str, Any]]:
        return self._call("list_tables", [])

    def describe_table(self, table: str) -> dict[str, Any]:
        return self._call("describe_table", [table])

    def _start(self) -> None:
        proc = subprocess.Popen(
            [sys.executable, "-m", "database_mcp_core.isolated_child"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        # A queue per child: a killed child's late output must never be read
        # as a reply from its replacement.
        replies: queue.Queue[dict[str, Any] | None] = queue.Queue()

        def read_replies() -> None:
            assert proc.stdout is not None
            for line in proc.stdout:
                replies.put(json.loads(line))
            replies.put(None)  # child exited

        def forward_stderr() -> None:
            assert proc.stderr is not None
            for line in proc.stderr:
                sys.stderr.write(line)  # through the redaction filter

        threading.Thread(target=read_replies, daemon=True).start()
        threading.Thread(target=forward_stderr, daemon=True).start()
        self._proc, self._replies = proc, replies
        try:
            self._call("init", [*self._target, self._read_only])
        except Exception:
            self.close()
            raise

    def _call(self, op: str, args: list[Any], timeout_ms: int | None = None) -> Any:
        if self._proc is None:
            self._start()
        proc, replies = self._proc, self._replies
        assert proc is not None and proc.stdin is not None
        proc.stdin.write(json.dumps({"op": op, "args": args}) + "\n")
        proc.stdin.flush()
        try:
            reply = replies.get(timeout=None if timeout_ms is None else timeout_ms / 1000)
        except queue.Empty:
            # The only way to stop a statement stuck in native code.
            proc.kill()
            self._proc = None
            raise RuntimeError(f"timeout: query exceeded {timeout_ms}ms") from None
        if reply is None:
            self._proc = None
            raise RuntimeError("database process exited")
        if "error" in reply:
            raise RuntimeError(reply["error"])
        return reply["result"]
