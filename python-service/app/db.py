from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

from app.config import settings

# Engine is created lazily on first use, not at import time, so importing
# this module (e.g. in tests) never requires a live database.
_engine: Optional[Engine] = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(settings.database_url, pool_pre_ping=True)
    return _engine


@contextmanager
def get_connection() -> Iterator:
    engine = get_engine()
    with engine.connect() as conn:
        yield conn


def check_database_connection() -> bool:
    try:
        with get_connection() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# FastAPI dependency version of get_connection: report/export routes take
# `conn: Connection = Depends(get_db)` so tests can override this one
# dependency with a fake connection instead of needing a real database.
def get_db() -> Iterator[Connection]:
    with get_connection() as conn:
        yield conn
