from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import PyMongoError

from .config import MONGODB_URI, DATABASE_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
from .security import hash_password

client = None
db = None


def connect_database():
    global client, db
    if not MONGODB_URI:
        raise RuntimeError("MONGODB_URI is missing. Configure it in your .env file.")
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    db = client[DATABASE_NAME]
    db.users.create_index("email", unique=True)
    db.anime.create_index([("title", ASCENDING)])
    db.anime.create_index([("created_at", DESCENDING)])
    db.episodes.create_index([("anime_id", ASCENDING), ("season", ASCENDING), ("episode_number", ASCENDING)])
    db.watchlist.create_index([("user_id", ASCENDING), ("anime_id", ASCENDING)], unique=True)
    db.progress.create_index([("user_id", ASCENDING), ("episode_id", ASCENDING)], unique=True)

    if ADMIN_EMAIL and ADMIN_PASSWORD and not db.users.find_one({"email": ADMIN_EMAIL}):
        db.users.insert_one({
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "created_at": __import__("datetime").datetime.utcnow(),
        })
        print(f"Created initial admin account: {ADMIN_EMAIL}")

    return db


def close_database():
    global client
    if client is not None:
        client.close()
        client = None
