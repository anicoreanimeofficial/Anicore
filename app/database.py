from pymongo import MongoClient, ASCENDING, DESCENDING
from .config import MONGODB_URI, DATABASE_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
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
    db.anime.create_index([("views", DESCENDING)]) # For trending
    
    db.tv_shows.create_index([("title", ASCENDING)])
    db.tv_shows.create_index([("created_at", DESCENDING)])

    db.movies.create_index([("title", ASCENDING)])
    
    db.episodes.create_index([("anime_id", ASCENDING), ("season", ASCENDING), ("episode_number", ASCENDING)])
    
    db.watchlist.create_index([("user_id", ASCENDING), ("content_id", ASCENDING), ("content_type", ASCENDING)], unique=True)
    
    db.comments.create_index([("content_id", ASCENDING), ("created_at", DESCENDING)])
    
    db.requests.create_index([("user_id", ASCENDING), ("status", ASCENDING)])

    # Seed Admin
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
