from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "CONSTRUCTA"
    DEBUG: bool = False

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24h

    DATABASE_URL: str

    # Phase 2 — Twilio
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_WHATSAPP_NUMBER: str = ""  # e.g. "whatsapp:+14155238886"
    # Full public URL of this server (needed for Twilio signature validation behind ngrok)
    PUBLIC_BASE_URL: str = ""  # e.g. "https://abc123.ngrok.io"
    # URL of the frontend app — used to build invite links
    FRONTEND_URL: str = "http://localhost:5173"

    # Internal API key for service-to-service calls (e.g. n8n scheduled jobs)
    INTERNAL_API_KEY: str = ""

    # Brevo — transactional email API
    BREVO_API_KEY: str = ""
    BREVO_SENDER_EMAIL: str = "noreply@constructa.com"
    BREVO_SENDER_NAME: str = "Constructa"

    # Phase 3 — AI (not active yet)
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-6"
    WHISPER_MODEL: str = "base"

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
