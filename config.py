import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

APP_NAME = os.getenv("APP_NAME", "Anicore")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
SECRET_KEY = os.getenv("SECRET_KEY", "")
MONGODB_URI = os.getenv("MONGODB_URI", "")
DATABASE_NAME = os.getenv("DATABASE_NAME", "anicore")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
IS_PRODUCTION = ENVIRONMENT == "production"
