"""Tiny SQLite data layer.

A single connection guarded by a lock keeps things simple and perfectly
adequate for an ephemeral room with a handful to a few dozen participants.
WAL mode lets reads stay snappy while a write is in flight.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any, Iterable, Optional

from . import config

_lock = threading.RLock()
_conn: Optional[sqlite3.Connection] = None


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    name          TEXT PRIMARY KEY,
    password_hash TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    color         TEXT NOT NULL DEFAULT '#6366f1',
    reserved      INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT '',
    created_at    REAL NOT NULL,
    last_seen     REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    topic       TEXT NOT NULL DEFAULT '',
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS dms (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a    TEXT NOT NULL,
    user_b    TEXT NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE(user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id      INTEGER,
    dm_id           INTEGER,
    conversation_id INTEGER,                    -- private agent thread (owner-scoped)
    author      TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'text',   -- text | system | bot
    content     TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',     -- json: list of file ids/meta
    previews    TEXT NOT NULL DEFAULT '[]',     -- json: list of link previews
    reply_to    INTEGER,                        -- parent message id (quote-reply)
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL,
    edited_at   REAL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(dm_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS reactions (
    message_id  INTEGER NOT NULL,
    author      TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    created_at  REAL NOT NULL,
    PRIMARY KEY (message_id, author, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

CREATE TABLE IF NOT EXISTS files (
    id            TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    uploaded_by   TEXT NOT NULL,
    created_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint    TEXT PRIMARY KEY,
    author      TEXT NOT NULL,
    data        TEXT NOT NULL,
    created_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_author ON push_subscriptions(author);

CREATE TABLE IF NOT EXISTS boards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,   -- canvas | whiteboard | kanban
    name        TEXT NOT NULL,
    created_at  REAL NOT NULL
);

-- Sidebar folders that group channels and boards (shared across the room).
CREATE TABLE IF NOT EXISTS folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS collab_updates (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    doc  TEXT NOT NULL,
    data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_doc ON collab_updates(doc, id);

CREATE TABLE IF NOT EXISTS bots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    base_url      TEXT NOT NULL,
    api_key       TEXT NOT NULL DEFAULT '',
    model         TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    system_prompt TEXT NOT NULL DEFAULT '',
    trigger       TEXT NOT NULL DEFAULT 'mention',  -- mention | all
    channels      TEXT NOT NULL DEFAULT '[]',       -- json list of channel ids, [] = all
    color         TEXT NOT NULL DEFAULT '#10b981',
    avatar        TEXT NOT NULL DEFAULT '',         -- emoji or image URL
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    REAL NOT NULL
);

-- The room's single configurable Assistant (one row, id = 1). Powers private
-- conversations, the channel @mention trigger, live-doc completion and kanban fill.
CREATE TABLE IF NOT EXISTS agent (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    name          TEXT NOT NULL DEFAULT 'Assistant',
    base_url      TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    api_key       TEXT NOT NULL DEFAULT '',
    model         TEXT NOT NULL DEFAULT 'openai/gpt-oss-120b',
    model_type    TEXT NOT NULL DEFAULT 'standard',  -- standard | reasoning
    system_prompt TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL DEFAULT '#8b5cf6',
    avatar        TEXT NOT NULL DEFAULT '✨',
    enabled       INTEGER NOT NULL DEFAULT 0
);

-- Private 1:1 threads between a user and the Assistant (ChatGPT-style).
CREATE TABLE IF NOT EXISTS conversations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner         TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT 'New conversation',
    system_prompt TEXT NOT NULL DEFAULT '',      -- per-thread override of the agent base prompt
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner, id);
"""

# Lightweight additive migrations for databases created by older versions.
MIGRATIONS = [
    ("bots", "avatar", "TEXT NOT NULL DEFAULT ''"),
    ("messages", "reply_to", "INTEGER"),
    ("messages", "pinned", "INTEGER NOT NULL DEFAULT 0"),
    ("messages", "conversation_id", "INTEGER"),
    ("agent", "model_type", "TEXT NOT NULL DEFAULT 'standard'"),
    ("users", "status", "TEXT NOT NULL DEFAULT ''"),
    ("users", "avatar", "TEXT NOT NULL DEFAULT ''"),
    ("channels", "folder_id", "INTEGER"),
    ("boards", "folder_id", "INTEGER"),
]


def _migrate(conn: sqlite3.Connection) -> None:
    for table, column, decl in MIGRATIONS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        config.ensure_dirs()
        _conn = sqlite3.connect(
            config.DB_PATH, check_same_thread=False, isolation_level=None
        )
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL;")
        # NORMAL is durable under WAL and far faster than the FULL default.
        _conn.execute("PRAGMA synchronous=NORMAL;")
        _conn.execute("PRAGMA temp_store=MEMORY;")
        _conn.execute("PRAGMA cache_size=-16000;")  # ~16 MB page cache
        _conn.execute("PRAGMA busy_timeout=5000;")
        _conn.execute("PRAGMA foreign_keys=ON;")
        _conn.executescript(SCHEMA)
        _migrate(_conn)
    return _conn


def init() -> None:
    """Create the schema and seed a default channel + admin user."""
    with _lock:
        conn = connect()
        now = time.time()
        existing = conn.execute("SELECT COUNT(*) AS n FROM channels").fetchone()["n"]
        if existing == 0:
            conn.execute(
                "INSERT INTO channels(name, topic, is_default, created_at) "
                "VALUES (?, ?, 1, ?)",
                ("general", "Welcome to Conventus 👋", now),
            )
        if conn.execute("SELECT COUNT(*) AS n FROM boards").fetchone()["n"] == 0:
            conn.execute(
                "INSERT INTO boards(kind, name, created_at) VALUES ('canvas', 'Live document', ?)",
                (now,),
            )
            conn.execute(
                "INSERT INTO boards(kind, name, created_at) VALUES ('whiteboard', 'Whiteboard', ?)",
                (now,),
            )
        # The single Assistant row (disabled until an admin configures it).
        conn.execute("INSERT OR IGNORE INTO agent(id) VALUES (1)")
        # Optionally point the Assistant at an endpoint from the environment so a
        # fresh deploy ships with it ready. Env manages only the endpoint + token
        # (+ enabled); model/type/name stay admin-controlled in Settings and are
        # only touched here when their env vars are explicitly provided — so an
        # admin's Settings choices are never clobbered on restart.
        if config.AGENT_ENDPOINT and config.AGENT_TOKEN:
            conn.execute(
                "UPDATE agent SET base_url = ?, api_key = ?, enabled = 1 WHERE id = 1",
                (config.AGENT_ENDPOINT, config.AGENT_TOKEN),
            )
            if config.AGENT_NAME:
                conn.execute("UPDATE agent SET name = ? WHERE id = 1", (config.AGENT_NAME,))
            if config.AGENT_MODEL:
                conn.execute("UPDATE agent SET model = ? WHERE id = 1", (config.AGENT_MODEL,))
            if config.AGENT_MODEL_TYPE in ("standard", "reasoning"):
                conn.execute(
                    "UPDATE agent SET model_type = ? WHERE id = 1", (config.AGENT_MODEL_TYPE,)
                )


def _exec(query: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
    with _lock:
        return connect().execute(query, tuple(params))


def query_all(query: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    cur = _exec(query, params)
    return [dict(row) for row in cur.fetchall()]


def query_one(query: str, params: Iterable[Any] = ()) -> Optional[dict[str, Any]]:
    row = _exec(query, params).fetchone()
    return dict(row) if row else None


def execute(query: str, params: Iterable[Any] = ()) -> int:
    """Run a write and return lastrowid."""
    return _exec(query, params).lastrowid


# --- JSON helpers ---------------------------------------------------------

def loads(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return fallback


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def now() -> float:
    return time.time()
