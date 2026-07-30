import sys
from functools import lru_cache
from pydantic_settings import BaseSettings

# Valores conocidos débiles que no deben usarse en producción
_WEAK_SECRET_KEYS = {
    "secret", "changeme", "insecure", "dev", "development",
    "test", "testing", "password", "12345678", "constructa",
}


class Settings(BaseSettings):
    APP_NAME: str = "CONSTRUCTA"
    APP_DEBUG: bool = False

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24h

    DATABASE_URL: str

    # CORS — lista de orígenes permitidos (separados por coma en el .env)
    # Default cubre dev local; en producción setear solo el dominio real.
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"

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

    # IA — bitácora de obra (análisis con Claude + transcripción Whisper)
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-haiku-4-5-20251001"  # barato y suficiente para extraer acciones
    OPENAI_API_KEY: str = ""   # para transcripción de audios
    WHISPER_MODEL: str = "gpt-4o-mini-transcribe"    # más barato y preciso que whisper-1 en español

    class Config:
        env_file = ".env"
        case_sensitive = True

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


def validate_startup(s: Settings) -> None:
    """Valida secretos críticos al arranque. Aborta con mensaje claro si algo está mal."""
    errors: list[str] = []
    warnings: list[str] = []

    # SECRET_KEY débil — riesgo de seguridad en cualquier entorno
    if s.SECRET_KEY.lower() in _WEAK_SECRET_KEYS or len(s.SECRET_KEY) < 32:
        if s.APP_DEBUG:
            warnings.append("SECRET_KEY es débil o corta (< 32 chars). Aceptable en dev, NO en prod.")
        else:
            errors.append("SECRET_KEY es débil o demasiado corta (< 32 chars). Generá una con: openssl rand -hex 32")

    # En producción, advertir sobre integraciones vacías que degradan funcionalidad
    if not s.APP_DEBUG:
        if not s.BREVO_API_KEY:
            warnings.append("BREVO_API_KEY no configurada — los emails (invitaciones, reseteo) no se enviarán.")
        if not s.TWILIO_AUTH_TOKEN:
            warnings.append("TWILIO_AUTH_TOKEN no configurado — el chatbot de WhatsApp estará inactivo.")
        if "localhost" in s.ALLOWED_ORIGINS:
            warnings.append("ALLOWED_ORIGINS incluye localhost — no recomendado en producción.")

    if warnings:
        for w in warnings:
            print(f"[CONSTRUCTA] ⚠️  {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(f"[CONSTRUCTA] ❌ {e}", file=sys.stderr)
        print("[CONSTRUCTA] Corregí los errores anteriores antes de arrancar.", file=sys.stderr)
        sys.exit(1)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
