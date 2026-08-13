from fastapi import APIRouter

from app.db import check_database_connection

router = APIRouter()


@router.get("/health")
def health():
    db_ok = check_database_connection()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "unreachable",
    }
