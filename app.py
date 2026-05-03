import time
import os
from threading import Lock
from flask import Flask, render_template, jsonify, request
import requests

app = Flask(__name__)

_price_cache: dict = {}
_cache_lock = Lock()
CACHE_TTL = 3600

STEAM_API_KEY = os.environ.get("STEAM_API_KEY", "")


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

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
