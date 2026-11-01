from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, MongoClient

from .config import ADMIN_EMAIL, ADMIN_PASSWORD, DATABASE_NAME, MONGODB_URI
from .security import hash_password

client = None
db = None


def connect_database():
    global client, db
    if not MONGODB_URI:
        raise RuntimeError("MONGODB_URI is missing.")

    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    db = client[DATABASE_NAME]

    # Indexes for performance
    db.users.create_index("email", unique=True)

    db.anime.create_index([("title", ASCENDING)])
    db.anime.create_index([("created_at", DESCENDING)])
    db.anime.create_index([("views", DESCENDING)])  # For trending

    db.tv_shows.create_index([("title", ASCENDING)])
    db.tv_shows.create_index([("created_at", DESCENDING)])

    db.movies.create_index([("title", ASCENDING)])
    db.movies.create_index([("created_at", DESCENDING)])

    db.watchlist.create_index(
        [("user_id", ASCENDING), ("content_id", ASCENDING), ("content_type", ASCENDING)],
        unique=True,
    )

    db.comments.create_index([("content_id", ASCENDING), ("created_at", DESCENDING)])

    db.requests.create_index([("user_id", ASCENDING), ("status", ASCENDING)])
    db.requests.create_index([("created_at", DESCENDING)])

    # Seed admin. Login lowercases emails, so store it lowercased too.
    admin_email = (ADMIN_EMAIL or "").strip().lower()
    if admin_email and ADMIN_PASSWORD and not db.users.find_one({"email": admin_email}):
        db.users.insert_one(
            {
                "email": admin_email,
                "password_hash": hash_password(ADMIN_PASSWORD),
                "role": "admin",
                "created_at": datetime.now(timezone.utc),
            }
        )
        print(f"Created initial admin account: {admin_email}")

    return db


def close_database():
    global client, db
    if client is not None:
        client.close()
        client = None
    db = None
