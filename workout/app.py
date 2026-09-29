"""Gym log: a small Flask app for the A/B/C strength plan.

Sessions are stored in a SQL database. Set DATABASE_URL to a Postgres URL in
production; without it the app uses a local SQLite file.
"""
import hmac
import json
import os
import re
from datetime import date, datetime, timedelta, timezone

from flask import Flask, abort, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import (Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text,
                        create_engine, inspect, select)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
Base = declarative_base()

SESSION_ID = re.compile(r"^\d{4}-\d{2}-\d{2}-[ABC]$")


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"
    id = Column(String(16), primary_key=True)          # e.g. "2026-10-06-C"
    date = Column(Date, nullable=False, index=True)
    day = Column(String(1), nullable=False)
    note = Column(Text)
    saved_at = Column(DateTime(timezone=True), nullable=False)
    sets = relationship("WorkoutSet", cascade="all, delete-orphan",
                        order_by="WorkoutSet.position", lazy="selectin")

    def to_dict(self):
        exercises, by_key = [], {}
        for s in self.sets:
            ex = by_key.get(s.exercise_key)
            if ex is None:
                ex = by_key[s.exercise_key] = {"key": s.exercise_key, "name": s.exercise_name, "sets": []}
                exercises.append(ex)
            entry = {"w": s.weight, "r": s.reps}
            if s.warm:
                entry["warm"] = True
            ex["sets"].append(entry)
        return {"id": self.id, "date": self.date.isoformat(), "day": self.day, "note": self.note,
                "savedAt": self.saved_at.isoformat() if self.saved_at else None, "exercises": exercises}


class WorkoutSet(Base):
    __tablename__ = "workout_sets"
    id = Column(Integer, primary_key=True)
    session_id = Column(String(16), ForeignKey("workout_sessions.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    position = Column(Integer, nullable=False)
    exercise_key = Column(String(40), nullable=False, index=True)
    exercise_name = Column(String(80), nullable=False)
    weight = Column(Float, nullable=False)
    reps = Column(Integer, nullable=False)
    warm = Column(Boolean, nullable=False, default=False)


def database_url():
    url = os.environ.get("DATABASE_URL") or "sqlite:///" + os.path.join(BASE_DIR, "workout.db")
    # Heroku/Render style URLs, pointed at the psycopg 3 driver
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def parse_session(payload, session_id):
    """Validate a posted session. Returns (date, day, note, sets) or raises ValueError."""
    if not isinstance(payload, dict):
        raise ValueError("Body must be a JSON object.")
    d = date.fromisoformat(session_id[:10])
    day = session_id[-1]
    note = payload.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 500):
        raise ValueError("note must be text under 500 characters.")
    exercises = payload.get("exercises")
    if not isinstance(exercises, list) or not exercises:
        raise ValueError("exercises must be a non-empty list.")
    rows = []
    for ex in exercises:
        key, name, sets = ex.get("key"), ex.get("name") or ex.get("key"), ex.get("sets")
        if not isinstance(key, str) or not re.match(r"^[A-Za-z0-9_]{1,40}$", key):
            raise ValueError("Each exercise needs a key.")
        if not isinstance(name, str) or len(name) > 80:
            raise ValueError("Exercise names must be under 80 characters.")
        if not isinstance(sets, list) or not sets:
            raise ValueError(f"{key} has no sets.")
        for s in sets:
            w, r = s.get("w"), s.get("r")
            if isinstance(w, bool) or not isinstance(w, (int, float)) or not 0 <= w <= 1000:
                raise ValueError(f"{key}: weight must be between 0 and 1000 kg.")
            if isinstance(r, bool) or not isinstance(r, int) or not 1 <= r <= 200:
                raise ValueError(f"{key}: reps must be a whole number from 1 to 200.")
            rows.append((key, name, float(w), r, bool(s.get("warm"))))
    return d, day, note, rows


def create_app(db_url=None):
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or os.urandom(32)
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=90)
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = os.environ.get("COOKIE_SECURE", "1") == "1" and bool(os.environ.get("APP_PASSWORD"))
    password = os.environ.get("APP_PASSWORD", "")

    engine = create_engine(db_url or database_url(), pool_pre_ping=True, future=True)
    fresh = not inspect(engine).has_table(WorkoutSession.__tablename__)
    Base.metadata.create_all(engine)
    Db = sessionmaker(engine, expire_on_commit=False, future=True)
    app.extensions["gymlog_db"] = Db

    def save(db, session_id, payload):
        d, day, note, rows = parse_session(payload, session_id)
        existing = db.get(WorkoutSession, session_id)
        if existing:
            db.delete(existing)
            db.flush()
        ws = WorkoutSession(id=session_id, date=d, day=day, note=note, saved_at=datetime.now(timezone.utc))
        ws.sets = [WorkoutSet(position=i, exercise_key=k, exercise_name=n, weight=w, reps=r, warm=warm)
                   for i, (k, n, w, r, warm) in enumerate(rows)]
        db.add(ws)
        return ws

    if fresh and os.environ.get("SEED", "1") == "1":
        with open(os.path.join(BASE_DIR, "seed_sessions.json")) as f:
            seed = json.load(f)
        with Db.begin() as db:
            for s in seed:
                save(db, f"{s['date']}-{s['day']}", s)

    @app.before_request
    def require_login():
        if not password or request.endpoint in ("login", "static", "health"):
            return None
        if session.get("ok"):
            return None
        if request.path.startswith("/api/"):
            return jsonify(error="Sign in first."), 401
        return redirect(url_for("login"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        error = None
        if request.method == "POST":
            if password and hmac.compare_digest(request.form.get("password", "").encode(), password.encode()):
                session.permanent = True
                session["ok"] = True
                return redirect(url_for("index"))
            error = "That password isn't right."
        return render_template("login.html", error=error)

    @app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/healthz")
    def health():
        return "ok"

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/sessions")
    def list_sessions():
        with Db() as db:
            rows = db.scalars(select(WorkoutSession).order_by(WorkoutSession.date.desc())).all()
            return jsonify([r.to_dict() for r in rows])

    @app.put("/api/sessions/<session_id>")
    def put_session(session_id):
        if not SESSION_ID.match(session_id):
            abort(404)
        try:
            with Db.begin() as db:
                ws = save(db, session_id, request.get_json(silent=True))
                db.flush()
                out = ws.to_dict()
        except ValueError as e:
            return jsonify(error=str(e)), 400
        return jsonify(out)

    @app.delete("/api/sessions/<session_id>")
    def delete_session(session_id):
        with Db.begin() as db:
            ws = db.get(WorkoutSession, session_id)
            if not ws:
                return jsonify(error="No session with that id."), 404
            db.delete(ws)
        return "", 204

    return app


app = create_app() if os.environ.get("GYMLOG_NO_AUTOAPP") != "1" else None

if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5001)))
