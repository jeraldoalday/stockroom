# A structured (JSON-lines) logger, matching the Node API's
# backend/src/lib/logger.ts field-for-field so a log aggregator can filter
# both services' output with the same rule instead of a parser per language.

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any


def _write(level: str, message: str, fields: dict[str, Any]) -> None:
    line = {
        "time": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "message": message,
        **fields,
    }
    # `default=str` covers the one field type `json.dumps` can't handle on
    # its own here — a datetime slipping through from a route that logs a
    # raw DB value — without the logging call itself becoming another thing
    # that can raise.
    stream = sys.stderr if level == "error" else sys.stdout
    print(json.dumps(line, default=str), file=stream)


def info(message: str, **fields: Any) -> None:
    _write("info", message, fields)


def error(message: str, **fields: Any) -> None:
    _write("error", message, fields)
