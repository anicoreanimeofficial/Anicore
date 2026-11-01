import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

APP_NAME = os.getenv("APP_NAME", "Anicore")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"

_DEFAULT_SECRET = "change_this_to_a_long_random_string_at_least_32_chars"
SECRET_KEY = os.getenv("SECRET_KEY", _DEFAULT_SECRET)

# A known or short secret lets anyone forge a login token (including an admin one),
# so refuse to start in production without a real key.
if IS_PRODUCTION and (SECRET_KEY == _DEFAULT_SECRET or len(SECRET_KEY) < 32):
    raise RuntimeError(
        "SECRET_KEY must be set to a random string of at least 32 characters in production. "
        'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
    )

MONGODB_URI = os.getenv("MONGODB_URI", "")
DATABASE_NAME = os.getenv("DATABASE_NAME", "anicore")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

# Feature Flags
ENABLE_AI_RECAPS = os.getenv("ENABLE_AI_RECAPS", "false").lower() == "true"
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")  # For external notifications
