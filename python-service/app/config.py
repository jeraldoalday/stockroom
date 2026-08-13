from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Same Postgres instance as the Node backend, but this service should
    # connect with a read-only DB role in production — it never writes.
    database_url: str = "postgresql://stockroom:stockroom@localhost:5432/stockroom"
    cors_origin: str = "http://localhost:5173"
    port: int = 8000


settings = Settings()
