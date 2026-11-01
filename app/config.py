import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

APP_NAME = os.getenv("APP_NAME", "Anicore")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
SECRET_KEY = os.getenv("SECRET_KEY", "change_this_to_a_long_random_string_at_least_32_chars")
MONGODB_URI = os.getenv("MONGODB_URI", "")
DATABASE_NAME = os.getenv("DATABASE_NAME", "anicore")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
IS_PRODUCTION = ENVIRONMENT == "production"

# Feature Flags
ENABLE_AI_RECAPS = os.getenv("ENABLE_AI_RECAPS", "false").lower() == "true"
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "") # For external notifications
