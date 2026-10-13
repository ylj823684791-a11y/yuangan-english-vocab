#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal auth + progress API for Yuangan English vocab. Python 3.6+ stdlib only."""
from __future__ import print_function

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

HOST = os.environ.get("YG_HOST", "127.0.0.1")
PORT = int(os.environ.get("YG_PORT", "3001"))
DATA_DIR = os.environ.get("YG_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
DB_PATH = os.path.join(DATA_DIR, "vocab.db")
TOKEN_DAYS = 90

USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fff-]{2,32}$")
_db_lock = threading.Lock()


def ensure_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with _db_lock:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    created_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS progress (
                    user_id INTEGER PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
                """
            )
            conn.commit()
        finally:
            conn.close()


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return base64.b64encode(dk).decode("ascii"), salt


def verify_password(password, password_hash, salt):
    calc, _ = hash_password(password, salt)
    return hmac.compare_digest(calc, password_hash)


def db_execute(fn):
    with _db_lock:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            result = fn(conn)
            conn.commit()
            return result
        finally:
            conn.close()


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    now = time.time()
    expires = now + TOKEN_DAYS * 86400

    def _fn(conn):
        conn.execute(
            "INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, user_id, now, expires),
        )

    db_execute(_fn)
    return token


def user_from_token(token):
    if not token:
        return None
    now = time.time()

    def _fn(conn):
        row = conn.execute(
            """
            SELECT u.id, u.username FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (token, now),
        ).fetchone()
        return row

    return db_execute(_fn)


class Handler(BaseHTTPRequestHandler):
    server_version = "YuanganVocab/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _send(self, code, obj, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 2 * 1024 * 1024:
            raise ValueError("payload too large")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _auth_user(self):
        auth = self.headers.get("Authorization") or ""
        token = ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        return user_from_token(token), token

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self._send(200, {"ok": True})
        if path == "/api/me":
            user, _ = self._auth_user()
            if not user:
                return self._send(401, {"error": "未登录"})
            return self._send(200, {"username": user["username"], "id": user["id"]})
        if path == "/api/progress":
            user, _ = self._auth_user()
            if not user:
                return self._send(401, {"error": "未登录"})

            def _fn(conn):
                row = conn.execute(
                    "SELECT data, updated_at FROM progress WHERE user_id = ?",
                    (user["id"],),
                ).fetchone()
                return row

            row = db_execute(_fn)
            if not row:
                return self._send(200, {"progress": None, "updatedAt": None})
            try:
                progress = json.loads(row["data"])
            except Exception:
                progress = None
            return self._send(200, {"progress": progress, "updatedAt": row["updated_at"]})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            data = self._read_json()
        except Exception:
            return self._send(400, {"error": "无效的 JSON"})

        if path == "/api/register":
            return self._register(data)
        if path == "/api/login":
            return self._login(data)
        if path == "/api/logout":
            user, token = self._auth_user()
            if token:

                def _fn(conn):
                    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))

                db_execute(_fn)
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/progress":
            return self._send(404, {"error": "not found"})
        user, _ = self._auth_user()
        if not user:
            return self._send(401, {"error": "未登录"})
        try:
            data = self._read_json()
        except Exception:
            return self._send(400, {"error": "无效的 JSON"})
        progress = data.get("progress", data)
        if not isinstance(progress, dict):
            return self._send(400, {"error": "progress 必须是对象"})
        now = time.time()
        payload = json.dumps(progress, ensure_ascii=False)

        def _fn(conn):
            conn.execute(
                """
                INSERT INTO progress(user_id, data, updated_at) VALUES (?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
                """,
                (user["id"], payload, now),
            )

        try:
            db_execute(_fn)
        except sqlite3.OperationalError:
            # SQLite on older systems may not support ON CONFLICT DO UPDATE the same way
            def _fn2(conn):
                exists = conn.execute(
                    "SELECT 1 FROM progress WHERE user_id = ?", (user["id"],)
                ).fetchone()
                if exists:
                    conn.execute(
                        "UPDATE progress SET data = ?, updated_at = ? WHERE user_id = ?",
                        (payload, now, user["id"]),
                    )
                else:
                    conn.execute(
                        "INSERT INTO progress(user_id, data, updated_at) VALUES (?,?,?)",
                        (user["id"], payload, now),
                    )

            db_execute(_fn2)
        return self._send(200, {"ok": True, "updatedAt": now})

    def _register(self, data):
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if not USERNAME_RE.match(username):
            return self._send(400, {"error": "用户名需 2–32 位（字母数字中文下划线横线）"})
        if len(password) < 4 or len(password) > 64:
            return self._send(400, {"error": "密码长度需 4–64 位"})

        pw_hash, salt = hash_password(password)
        now = time.time()

        def _fn(conn):
            try:
                cur = conn.execute(
                    "INSERT INTO users(username, password_hash, salt, created_at) VALUES (?,?,?,?)",
                    (username, pw_hash, salt, now),
                )
                return cur.lastrowid
            except sqlite3.IntegrityError:
                return None

        user_id = db_execute(_fn)
        if user_id is None:
            return self._send(409, {"error": "用户名已被占用"})
        token = create_session(user_id)
        return self._send(201, {"token": token, "username": username})

    def _login(self, data):
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        def _fn(conn):
            return conn.execute(
                "SELECT id, username, password_hash, salt FROM users WHERE username = ?",
                (username,),
            ).fetchone()

        row = db_execute(_fn)
        if not row or not verify_password(password, row["password_hash"], row["salt"]):
            return self._send(401, {"error": "用户名或密码错误"})
        token = create_session(row["id"])
        return self._send(200, {"token": token, "username": row["username"]})


def main():
    ensure_db()
    # ThreadingHTTPServer may not exist on very old Python — we shimmed above
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Yuangan vocab API listening on http://%s:%s  db=%s" % (HOST, PORT, DB_PATH))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
