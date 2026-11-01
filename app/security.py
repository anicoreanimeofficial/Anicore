import base64
import hashlib
import hmac
import os
import time
import jwt
from .config import SECRET_KEY, IS_PRODUCTION

COOKIE_NAME = "anicore_session"
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 # 7 Days

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$" + base64.urlsafe_b64encode(salt).decode() + "$" + base64.urlsafe_b64encode(derived).decode()

def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_text, hash_text = stored.split("$", 2)
        if scheme != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(hash_text.encode())
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False

def create_session_token(user_id: str, email: str, role: str) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def decode_session_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])

def get_cookie_options():
    return {
        "key": COOKIE_NAME,
        "httponly": True,
        "secure": IS_PRODUCTION,
        "samesite": "lax",
        "max_age": TOKEN_TTL_SECONDS,
        "path": "/",
    }
