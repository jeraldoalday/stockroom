from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Same Postgres instance as the Node backend, but this service should
    # connect with a read-only DB role in production — it never writes.
    database_url: str = "postgresql://stockroom:stockroom@localhost:5432/stockroom"
    cors_origin: str = "http://localhost:5173"
    port: int = 8000

    # This service is never called directly by the frontend (the Node API
    # is the only client the browser talks to, per the architecture doc);
    # this shared secret just makes sure it's actually the Node backend
    # calling in, not some other host that can reach this service's port.
    internal_api_key: str = "dev-internal-key"


settings = Settings()
