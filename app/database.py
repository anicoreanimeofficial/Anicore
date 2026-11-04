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

    # Indexes
    db.users.create_index("email", unique=True)

    for coll_name in ("anime", "tv_shows", "movies"):
        coll = db[coll_name]
        coll.create_index([("title", ASCENDING)])
        coll.create_index([("created_at", DESCENDING)])
        coll.create_index([("views", DESCENDING)])
        coll.create_index([("genres", ASCENDING)])
        coll.create_index([("status", ASCENDING)])
        coll.create_index([("year", ASCENDING)])
        coll.create_index([("avg_rating", DESCENDING)])

    db.watchlist.create_index(
        [("user_id", ASCENDING), ("content_id", ASCENDING), ("content_type", ASCENDING)],
        unique=True,
    )

    db.comments.create_index([("content_id", ASCENDING), ("created_at", DESCENDING)])

    db.requests.create_index([("user_id", ASCENDING), ("status", ASCENDING)])
    db.requests.create_index([("created_at", DESCENDING)])

    # Progress (Continue Watching)
    db.progress.create_index(
        [("user_id", ASCENDING), ("content_type", ASCENDING), ("content_id", ASCENDING)],
        unique=True,
    )
    db.progress.create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])

    # Ratings
    db.ratings.create_index(
        [("user_id", ASCENDING), ("content_type", ASCENDING), ("content_id", ASCENDING)],
        unique=True,
    )
    db.ratings.create_index([("content_type", ASCENDING), ("content_id", ASCENDING)])

    # Notifications (auto-expire after 90 days)
    db.notifications.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    db.notifications.create_index([("user_id", ASCENDING), ("read", ASCENDING)])
    db.notifications.create_index("created_at", expireAfterSeconds=60 * 60 * 24 * 90)
    db.watchlist.create_index([("content_type", ASCENDING), ("content_id", ASCENDING)])

    # Moderation
    db.comments.create_index([("report_count", DESCENDING)])
    db.mod_log.create_index([("created_at", DESCENDING)])

    # Browse filters
    for coll_name in ("anime", "tv_shows", "movies"):
        db[coll_name].create_index([("season", ASCENDING)])
        db[coll_name].create_index([("studio", ASCENDING)])

    # Seed admin
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
