from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.request_logging import RequestLoggingMiddleware
from app.routers import health, reports

app = FastAPI(title="StockRoom Reports & Jobs Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Added after CORS so it ends up as the outermost layer (Starlette's
# add_middleware makes each new call wrap the previous stack) — the request
# log line should cover the full round trip, CORS handling included, not
# just the router beneath it.
app.add_middleware(RequestLoggingMiddleware)

app.include_router(health.router)
app.include_router(reports.router)
