import time
import os
import re
import json
import csv
from threading import Lock
from flask import Flask, render_template, jsonify, request
import requests

app = Flask(__name__)

_price_cache = {}
_cache_lock = Lock()
CACHE_TTL = 86400  # 24 hours

_review_cache = {}
_review_lock = Lock()

_hltb_csv_data = {}
_hltb_csv_data_by_name = {}

_library_cache = {}
_library_lock = Lock()

_details_cache = {}
_details_lock = Lock()

STEAM_API_KEY = os.environ.get("STEAM_API_KEY", "")

CACHE_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "price_cache.json")
REVIEW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "review_cache.json")
LIBRARY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "library_cache.json")
DETAILS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "details_cache.json")


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


def _load_hltb_csv():
    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hltb_data.csv")
    if not os.path.exists(csv_path):
        return
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers = reader.fieldnames or []
            
            appid_col = next((c for c in headers if c and 'app' in c.lower() and 'id' in c.lower()), None)
            name_col = next((c for c in headers if c and ('name' in c.lower() or 'title' in c.lower())), None)
            
            main_col = next((c for c in headers if c and c.lower() == 'game_comp_all_med'), None)
            is_main_seconds = bool(main_col)
            if not main_col:
                main_col = next((c for c in headers if c and 'main' in c.lower() and 'extra' not in c.lower() and '+' not in c.lower()), None)
            if not main_col: main_col = next((c for c in headers if c and 'main' in c.lower()), None)
                
            extra_col = next((c for c in headers if c and ('extra' in c.lower() or '+' in c.lower())), None)
            comp_col = next((c for c in headers if c and ('comp' in c.lower() or '100' in c.lower())), None)
            
            def parse_time(val, in_seconds=False):
                if not val: return None
                val = str(val).lower().replace(",", "")
                match = re.search(r'([0-9]*\.?[0-9]+)', val)
                if match:
                    v = float(match.group(1))
                    if in_seconds:
                        v /= 3600.0
                    return v if v > 0 else None
                return None

            for row in reader:
                appid = str(row[appid_col]).strip() if appid_col and row.get(appid_col) else None
                name = str(row[name_col]).strip() if name_col and row.get(name_col) else None
                if not appid and not name:
                    continue
                    
                data = {
                    "main": parse_time(row.get(main_col), is_main_seconds) if main_col else None,
                    "extra": parse_time(row.get(extra_col)) if extra_col else None,
                    "complete": parse_time(row.get(comp_col)) if comp_col else None,
                    "matched": name or appid
                }
                
                if appid:
                    _hltb_csv_data[appid] = data
                if name:
                    clean_name = re.sub(r'[^\w\s]', '', name.lower()).strip()
                    _hltb_csv_data_by_name[clean_name] = data
    except Exception as e:
        print(f"Error loading HLTB CSV: {e}")


def _load_library_cache():
    try:
        with open(LIBRARY_FILE, "r", encoding="utf-8") as f:
            _library_cache.update(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _save_library_cache():
    try:
        with _library_lock:
            snapshot = dict(_library_cache)
        with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
    except OSError:
        pass


def _load_details_cache():
    try:
        with open(DETAILS_FILE, "r", encoding="utf-8") as f:
            cached = json.load(f)
            # Migration: clear old details cache entries that are missing the new fields
            for k in list(cached.keys()):
                if "tags" not in cached[k].get("data", {}):
                    del cached[k]
            _details_cache.update(cached)
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def _save_details_cache():
    try:
        with _details_lock:
            snapshot = dict(_details_cache)
        with open(DETAILS_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
    except OSError:
        pass


_load_cache()
_load_review_cache()
_load_hltb_csv()
_load_library_cache()
_load_details_cache()


def _cached_price(appid: str, cc: str):
    key = f"{appid}_{cc}"
    with _cache_lock:
        entry = _price_cache.get(key)
        if entry and time.time() - entry["ts"] < CACHE_TTL:
            return entry["data"], True
    return None, False


def _store_price(appid: str, cc: str, data):
    key = f"{appid}_{cc}"
    with _cache_lock:
        _price_cache[key] = {"data": data, "ts": time.time()}


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

    with _library_lock:
        entry = _library_cache.get(steam_id)
        # Cache library for 1 hour (3600 seconds) so new purchases show up relatively soon
        if entry and time.time() - entry["ts"] < 3600:
            return jsonify({"games": entry["games"], "count": len(entry["games"])})

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

    with _library_lock:
        _library_cache[steam_id] = {"games": games, "ts": time.time()}
    _save_library_cache()

    return jsonify({"games": games, "count": len(games)})


@app.route("/api/cache/preload")
def get_all_caches():
    cc = request.args.get("cc", "us")
    
    with _cache_lock:
        prices = {k.split("_")[0]: v["data"] for k, v in _price_cache.items() if k.endswith(f"_{cc}") and time.time() - v["ts"] < CACHE_TTL}
        
    with _review_lock:
        reviews = {k: v["data"] for k, v in _review_cache.items() if time.time() - v["ts"] < CACHE_TTL}
        
    with _details_lock:
        details = {k.split("_")[0]: v["data"] for k, v in _details_cache.items() if k.endswith(f"_{cc}") and time.time() - v["ts"] < 604800}

    return jsonify({
        "prices": prices,
        "reviews": reviews,
        "details": details
    })


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
        data, hit = _cached_price(appid, cc)
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
            _store_price(appid, cc, price)

        if i + batch_size < len(to_fetch):
            time.sleep(0.3)

    if to_fetch:
        _save_cache()

    return jsonify(result)


@app.route("/api/hltb", methods=["POST"])
def get_hltb():
    games = request.json or []
    if not games:
        return jsonify({}), 400

    result = {}
    for game in games:
        appid = str(game.get("appid", ""))
        title = game.get("title", "").strip()
        
        data = None
        if appid in _hltb_csv_data:
            data = _hltb_csv_data[appid]
        elif title:
            clean = re.sub(r'[^\w\s]', '', title.lower()).strip()
            if clean in _hltb_csv_data_by_name:
                data = _hltb_csv_data_by_name[clean]
                
        result[appid] = data

    return jsonify(result)


@app.route("/api/genres")
def get_genres():
    appids_raw = request.args.get("appids", "")
    cc = request.args.get("cc", "us")
    if not appids_raw:
        return jsonify({}), 400

    appids = [a.strip() for a in appids_raw.split(",") if a.strip()]
    result = {}
    to_fetch = []

    for appid in appids:
        with _details_lock:
            entry = _details_cache.get(f"{appid}_{cc}")
        if entry and time.time() - entry["ts"] < 604800:  # Cache for 7 days
            result[appid] = entry["data"]
        else:
            to_fetch.append(appid)

    # Fetch details one-by-one to avoid rate limits and API quirks
    batch_size = 1
    for i in range(0, len(to_fetch), batch_size):
        batch = to_fetch[i : i + batch_size]
        appid = batch[0]
        
        details = _fetch_app_details(appid, cc)
        if details is None:
            continue

        result[appid] = details
        with _details_lock:
            _details_cache[f"{appid}_{cc}"] = {"data": details, "ts": time.time()}

        if i + batch_size < len(to_fetch):
            time.sleep(1.5)

    if to_fetch:
        _save_details_cache()

    return jsonify(result)


def _fetch_app_details(appid, cc):
    try:
        resp = requests.get(
            "https://store.steampowered.com/api/appdetails",
            params={"appids": appid, "cc": cc},
            timeout=10,
        )
        resp.raise_for_status()
        raw = resp.json()
    except requests.RequestException:
        return None

    app_data = raw.get(str(appid), {})
    if not app_data.get("success"):
        return {}

    data = app_data.get("data", {})
    
    user_tags = []
    try:
        spy_resp = requests.get(
            "https://steamspy.com/api.php",
            params={"request": "appdetails", "appid": appid},
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=5,
        )
        if spy_resp.ok:
            spy_data = spy_resp.json()
            tags_dict = spy_data.get("tags", {})
            if isinstance(tags_dict, dict):
                # Grab the top 15 user tags
                user_tags = list(tags_dict.keys())[:15]
    except Exception:
        pass

    return {
        "short_description": data.get("short_description", ""),
        "release_date": data.get("release_date", {}).get("date", "Unknown") if isinstance(data.get("release_date"), dict) else "Unknown",
        "developers": data.get("developers", []),
        "publishers": data.get("publishers", []),
        "genres": [g.get("description") for g in data.get("genres", [])] if isinstance(data.get("genres"), list) else [],
        "categories": [c.get("description") for c in data.get("categories", [])] if isinstance(data.get("categories"), list) else [],
        "metacritic": data.get("metacritic", {}).get("score") if isinstance(data.get("metacritic"), dict) else None,
        "tags": user_tags
    }


@app.route("/api/details/<appid>")
def get_details(appid: str):
    cc = request.args.get("cc", "us")
    cache_key = f"{appid}_{cc}"

    with _details_lock:
        entry = _details_cache.get(cache_key)
        # Cache for a long time (7 days), as core metadata rarely changes
        if entry and time.time() - entry["ts"] < 604800:
            return jsonify(entry["data"])

    result = _fetch_app_details(appid, cc)
    if result is None:
        result = {}

    with _details_lock:
        _details_cache[cache_key] = {"data": result, "ts": time.time()}
    _save_details_cache()

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
