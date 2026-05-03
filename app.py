import time
import os
import re
import json
from threading import Lock
from flask import Flask, render_template, jsonify, request
import requests

app = Flask(__name__)

_price_cache = {}
_cache_lock = Lock()
CACHE_TTL = 86400  # 24 hours

_review_cache = {}
_review_lock = Lock()

_hltb_cache = {}
_hltb_lock = Lock()
HLTB_CACHE_TTL = 604800  # 7 days — HowLongToBeat data changes rarely

STEAM_API_KEY = os.environ.get("STEAM_API_KEY", "")

CACHE_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "price_cache.json")
REVIEW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "review_cache.json")
HLTB_FILE   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hltb_cache.json")


def _load_cache():
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            _price_cache.update(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _save_cache():
    try:
        with _cache_lock:
            snapshot = dict(_price_cache)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
    except OSError:
        pass


def _load_review_cache():
    try:
        with open(REVIEW_FILE, "r", encoding="utf-8") as f:
            _review_cache.update(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _save_review_cache():
    try:
        with _review_lock:
            snapshot = dict(_review_cache)
        with open(REVIEW_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
    except OSError:
        pass


def _load_hltb_cache():
    try:
        with open(HLTB_FILE, "r", encoding="utf-8") as f:
            _hltb_cache.update(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _save_hltb_cache():
    try:
        with _hltb_lock:
            snapshot = dict(_hltb_cache)
        with open(HLTB_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
    except OSError:
        pass


_load_cache()
_load_review_cache()
_load_hltb_cache()


def _cached_price(appid: str):
    with _cache_lock:
        entry = _price_cache.get(appid)
        if entry and time.time() - entry["ts"] < CACHE_TTL:
            return entry["data"], True
    return None, False


def _store_price(appid: str, data):
    with _cache_lock:
        _price_cache[appid] = {"data": data, "ts": time.time()}


@app.route("/favicon.ico")
def favicon():
    return "", 204


@app.route("/")
def index():
    return render_template("index.html", api_key=STEAM_API_KEY)


@app.route("/api/resolve")
def resolve_id():
    identifier = request.args.get("id", "").strip()
    api_key = request.args.get("key", STEAM_API_KEY).strip()

    if not identifier:
        return jsonify({"error": "No identifier provided"}), 400

    if identifier.isdigit() and len(identifier) == 17:
        return jsonify({"steamid": identifier})

    if not api_key:
        return jsonify({"error": "Steam API key required to resolve a vanity URL"}), 400

    try:
        resp = requests.get(
            "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/",
            params={"key": api_key, "vanityurl": identifier},
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json().get("response", {})
        if body.get("success") == 1:
            return jsonify({"steamid": body["steamid"]})
        return jsonify({"error": "Could not resolve that Steam username"}), 404
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


@app.route("/api/library/<steam_id>")
def get_library(steam_id: str):
    api_key = request.args.get("key", STEAM_API_KEY).strip()

    if not api_key:
        return jsonify({"error": "Steam API key is required"}), 400

    try:
        resp = requests.get(
            "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
            params={
                "key": api_key,
                "steamid": steam_id,
                "include_appinfo": 1,
                "include_played_free_games": 1,
            },
            timeout=20,
        )
        resp.raise_for_status()
        response_body = resp.json().get("response", {})
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    games = response_body.get("games")
    if games is None:
        return jsonify(
            {"error": "No games found — profile may be private or API key is invalid"}
        ), 404

    games.sort(key=lambda g: (g.get("playtime_forever", 0) > 0, g.get("playtime_forever", 0)))
    return jsonify({"games": games, "count": len(games)})


@app.route("/api/prices")
def get_prices():
    appids_raw = request.args.get("appids", "")
    cc = request.args.get("cc", "us")

    if not appids_raw:
        return jsonify({}), 400

    appids = [a.strip() for a in appids_raw.split(",") if a.strip()]
    result = {}
    to_fetch = []

    for appid in appids:
        data, hit = _cached_price(appid)
        if hit:
            result[appid] = data
        else:
            to_fetch.append(appid)

    # Batch fetch from Steam store API (50 at a time to stay under rate limits)
    batch_size = 50
    for i in range(0, len(to_fetch), batch_size):
        batch = to_fetch[i : i + batch_size]
        batch_str = ",".join(batch)
        try:
            resp = requests.get(
                "https://store.steampowered.com/api/appdetails",
                params={"appids": batch_str, "cc": cc, "filters": "price_overview"},
                timeout=20,
            )
            resp.raise_for_status()
            raw = resp.json()
        except requests.RequestException:
            raw = {}

        for appid in batch:
            app_entry = raw.get(str(appid), {})
            price = None
            if app_entry.get("success"):
                data_field = app_entry.get("data", {})
                if isinstance(data_field, dict):
                    price = data_field.get("price_overview")
            result[appid] = price
            _store_price(appid, price)

        if i + batch_size < len(to_fetch):
            time.sleep(0.3)

    if to_fetch:
        _save_cache()

    return jsonify(result)


@app.route("/api/hltb/clear", methods=["POST"])
def clear_hltb_cache():
    with _hltb_lock:
        _hltb_cache.clear()
    try:
        os.remove(HLTB_FILE)
    except FileNotFoundError:
        pass
    return jsonify({"ok": True})


@app.route("/api/hltb", methods=["POST"])
def get_hltb():
    try:
        from howlongtobeatpy import HowLongToBeat
        hltb_available = True
    except ImportError:
        hltb_available = False

    games = request.json or []
    if not games:
        return jsonify({}), 400

    result = {}
    to_fetch = []

    for game in games:
        appid = str(game.get("appid", ""))
        with _hltb_lock:
            entry = _hltb_cache.get(appid)
        if entry and time.time() - entry["ts"] < HLTB_CACHE_TTL:
            result[appid] = entry["data"]
        else:
            to_fetch.append(game)

    for game in to_fetch:
        appid = str(game.get("appid", ""))
        title = game.get("title", "").strip()
        data = None

        if hltb_available and title:
            # Strip symbols Steam puts in names that hurt similarity (™ ® © etc.)
            clean = re.sub(r'[^\w\s\-\'\:\.\,\!\?]', ' ', title)
            clean = re.sub(r'\s+', ' ', clean).strip()
            try:
                results = HowLongToBeat().search(clean, similarity_case_sensitive=False)
                if results is None:
                    app.logger.info("HLTB: request failed (None) for %r", clean)
                elif not results:
                    app.logger.info("HLTB: no matches for %r", clean)
                else:
                    best = max(results, key=lambda g: g.similarity)
                    app.logger.info("HLTB: %r → %r (sim=%.2f, main=%s)",
                                    clean, best.game_name, best.similarity, best.main_story)
                    if best.similarity >= 0.4:
                        def pos(v):
                            return round(v, 1) if (v and v > 0) else None
                        data = {
                            "main":     pos(best.main_story),
                            "extra":    pos(best.main_extra),
                            "complete": pos(best.completionist),
                            "matched":  best.game_name,
                        }
            except Exception as exc:
                app.logger.warning("HLTB error for %r: %s", clean, exc)
                data = None

        result[appid] = data
        with _hltb_lock:
            _hltb_cache[appid] = {"data": data, "ts": time.time()}

        time.sleep(0.5)

    if to_fetch:
        _save_hltb_cache()

    return jsonify(result)


@app.route("/api/reviews")
def get_reviews():
    appids_raw = request.args.get("appids", "")
    if not appids_raw:
        return jsonify({}), 400

    appids = [a.strip() for a in appids_raw.split(",") if a.strip()]
    result = {}
    to_fetch = []

    for appid in appids:
        with _review_lock:
            entry = _review_cache.get(appid)
        if entry and time.time() - entry["ts"] < CACHE_TTL:
            result[appid] = entry["data"]
        else:
            to_fetch.append(appid)

    for appid in to_fetch:
        try:
            resp = requests.get(
                f"https://store.steampowered.com/appreviews/{appid}",
                params={"json": 1, "num_per_page": 0, "language": "all"},
                timeout=10,
            )
            resp.raise_for_status()
            body = resp.json()
            summary = body.get("query_summary", {}) if body.get("success") == 1 else {}
            total    = summary.get("total_reviews", 0)
            positive = summary.get("total_positive", 0)
            data = {
                "score": summary.get("review_score", 0),
                "desc":  summary.get("review_score_desc", ""),
                "positive": positive,
                "total":    total,
                "pct": round(positive / total * 100) if total else 0,
            } if total else None
        except requests.RequestException:
            data = None

        result[appid] = data
        with _review_lock:
            _review_cache[appid] = {"data": data, "ts": time.time()}

        time.sleep(0.15)

    if to_fetch:
        _save_review_cache()

    return jsonify(result)


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    app.logger.setLevel(logging.INFO)
    app.run(debug=True, port=5000)
