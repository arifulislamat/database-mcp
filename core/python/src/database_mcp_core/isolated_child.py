"""The child side of IsolatedAdapter: owns the adapter and its connection,
answers one JSON line per request on stdout (a private pipe to the parent)."""

import importlib
import json
import sys


def main() -> None:
    channel = sys.stdout
    # Nothing but replies may reach the channel; stray prints go to stderr.
    sys.stdout = sys.stderr
    adapter = None
    for line in sys.stdin:
        request = json.loads(line)
        op, args = request["op"], request["args"]
        try:
            if op == "init":
                module, class_name, ctor_args, read_only = args
                adapter = getattr(importlib.import_module(module), class_name)(*ctor_args)
                adapter.connect(read_only=read_only)
                result = None
            elif op == "query":
                sql, max_rows, timeout_ms = args
                result = adapter.query(sql, max_rows=max_rows, timeout_ms=timeout_ms)
            else:
                result = getattr(adapter, op)(*args)
            channel.write(json.dumps({"result": result}, default=str) + "\n")
        except Exception as e:
            channel.write(json.dumps({"error": str(e)}) + "\n")
        channel.flush()


if __name__ == "__main__":
    main()
