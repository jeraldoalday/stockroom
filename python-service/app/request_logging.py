# Request-id stamping and one structured log line per request, the
# Starlette-middleware equivalent of the Node API's
# backend/src/middleware/requestId.ts + requestLogger.ts combined into one
# pass since Starlette's `BaseHTTPMiddleware` only gives one hook per
# middleware rather than Express's separate "runs early" / "runs on finish"
# points.

from __future__ import annotations

import re
import time
import uuid
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app import logger

# Same shape restriction as the Node API's requestId middleware: bounded and
# opaque-token-only so a caller-supplied header can't smuggle a newline or an
# oversized string into a JSON log line — this is the one field on every log
# line that comes from outside our own code.
_SAFE_CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Honours an `X-Request-Id` the Node API already minted for this call
    (see `callPythonService` in the backend), so a single request is
    traceable across both services' logs by one id, and mints one otherwise.
    Echoes it back on the response header and logs one JSON line per request
    once the response is known, carrying the actual outcome rather than just
    "a request started"."""

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming = request.headers.get("x-request-id")
        request_id = incoming if incoming and _SAFE_CLIENT_ID.match(incoming) else uuid.uuid4().hex

        started_at = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - started_at) * 1000

        response.headers["X-Request-Id"] = request_id
        logger.info(
            "request",
            requestId=request_id,
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            durationMs=round(duration_ms, 2),
        )
        return response
