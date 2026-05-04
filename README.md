# Steam Backlog Store

A gamified, fast, and feature-rich local web application that turns a user's Steam library into a personal "storefront." It calculates the total financial value of unplayed games, estimated time to beat, provides robust sorting/filtering, and includes a smart recommendation engine to help users tackle their backlog.

## 🏗 Architecture Overview

The application uses a lightweight **Python/Flask backend** and a **Vanilla JS/HTML/CSS frontend**.

To bypass Steam's strict API rate limits (and the impossibility of fetching deep metadata for hundreds of games instantly), the app relies on a **Background Staggered-Batch Architecture**:
1. **Immediate Hydration**: On page load, the frontend asks the backend for all currently cached data (`/api/cache/preload`) and instantly paints the UI.
2. **Progressive Loading**: The frontend spawns several asynchronous background loops (`backgroundLoadPrices`, `backgroundLoadDetails`, etc.) that incrementally ask the backend for missing data in tiny batches.
3. **Backend Throttling**: The backend queries the official Steam APIs, caches the results to local JSON files, and enforces `time.sleep()` delays to ensure the user's IP is never rate-limited.

---

## 📂 File Structure

* `app.py` - The core Flask server. Handles API proxying, thread-safe JSON caching, and merging data from Steam and SteamSpy.
* `templates/index.html` - The single-page application UI. Contains the Grid, Table, Details Modal, and Recommendation Modal structures.
* `static/css/style.css` - Custom styling with CSS Variables. Handles the responsive grid, complex table layouts, and card states (Ignored, Played, Completed).
* `static/js/app.js` - The frontend engine. Manages state, sorting/filtering math, `localStorage` persistence, DOM rendering, and the staggered background API queues.
* `hltb_data.csv` - A local dataset mapping Steam AppIDs/Names to HowLongToBeat completion times.
* `*_cache.json` - Local caching files generated dynamically by the backend (`library_cache.json`, `price_cache.json`, `review_cache.json`, `details_cache.json`).

---

## ⚙️ Data Sources & API Integrations

1. **Steam Web API** (`api.steampowered.com`):
   * Used for resolving Vanity URLs and fetching the user's owned games (`GetOwnedGames/v1`). Requires the user's API Key.
2. **Steam Storefront API** (`store.steampowered.com/api`):
   * `appdetails`: Used to fetch Prices (`filters=price_overview`) and Metadata (Genres, Categories, Release Date, Metacritic).
   * `appreviews`: Used to fetch the total review count and positive percentage (Steam Score).
3. **SteamSpy API** (`steamspy.com/api.php`):
   * Used to fetch granular User Tags (e.g., "Metroidvania", "Choices Matter").
4. **HowLongToBeat** (Local):
   * Resolves completion times strictly locally via `hltb_data.csv` to avoid web-scraping blocks.

---

## ⚠️ Critical Engineering Quirks (For AI Agents / Maintainers)

If you are modifying this codebase, you **must** be aware of the following API constraints:

### 1. The `appdetails` Multi-AppID Bug
Steam's `appdetails` endpoint accepts comma-separated AppIDs (e.g., `appids=10,20`). **However**, unless you are strictly asking for `filters=price_overview`, Steam will silently ignore all games in the list except the very first one.
* **Workaround**: In `app.py` -> `get_genres()`, the batch size is strictly set to `1`. It fetches games individually and sleeps for `1.5s` between each request to respect the 200 requests / 5 minutes rate limit.

### 2. SteamSpy Cloudflare Blocks
SteamSpy aggressively blocks programmatic Python requests.
* **Workaround**: The backend explicitly spoofs a standard browser `User-Agent` inside `_fetch_app_details` in `app.py`.

### 3. Missing Data Poisoning
When hitting rate limits or edge-case unavailable games, APIs return empty results. If cached blindly, the app will never retry fetching them.
* **Workaround**: The backend strictly checks `if not raw:` and `if not app_data.get("success")`. It skips caching entirely upon failure so the frontend's background loaders will naturally retry on the next pass.

### 4. DOM Manipulation & Reflows
Because data streams in continuously in the background, fully re-rendering the grid on every data arrival causes massive performance drops and ruins user interaction (e.g., opening modals).
* **Workaround**: `app.js` renders the grid structure *once* during filtering. Background loaders rely on specific element selectors (e.g., `.card-price[data-appid="10"]`) to surgically update text and badges in place without triggering DOM reflows.

---

## 💾 State Management (`app.js`)

The frontend relies on two storage methodologies:

### `state` Object (Volatile / Session)
Stores the current runtime data fetched from the backend.
* `allGames`: Array of game objects from `GetOwnedGames`.
* `prices`, `reviews`, `details`, `hltb`: Dictionaries mapping `appid -> data`. When a background loader starts, it sets the value to `'loading'` to prevent duplicate simultaneous fetches.

### `localStorage` (Persistent)
Stores user-mutated data so the app feels snappy and personal.
* `sbs_profile`: The user's Steam ID, API Key, and Currency preference.
* `sbs_completed`: `Set` of AppIDs marked as "Completed".
* `sbs_playing`: `Set` of AppIDs marked as "Playing".
* `sbs_ignored`: `Set` of AppIDs hidden from view and excluded from financial totals.
* `sbs_extra_hours`: Dictionary of `appid -> integer` mapping manual playtime additions (e.g., hours played on a console).
* `sbs_controls`: Preserves the user's active View Mode, Sort, Filter, Genres, Tags, and Variance configurations.

---

## 🎲 Recommendation Engine (`getRecommendationScore`)

The "What to Play" engine scores every uncompleted game in the library based on several weighted factors:
1. **Base Score**: Starts at 0.
2. **Reviews (+/-)**: High percentage and high total reviews grant massive boosts (up to +50).
3. **Length (+/-)**: Heavily favors games in the 3–15 hour "Sweet Spot" (+20 to +30). Penalizes extremely long games or games missing data.
4. **Playtime (+/-)**: Highly favors completely unplayed games (+15). Penalizes games the user has already played for dozens of hours but never finished.
5. **Era (+/-)**: Uses the `appid` integer sequence as a proxy for release year to skew towards "Newer" (>1,000,000) or "Older" (<400,000) games if requested.
6. **Target Tag/Genre (+/-)**: Applies a ±50 point modifier if the user explicitly requests a genre/tag.
7. **Variance (Noise)**: Injects a randomized Math value based on the "Variance" dropdown (Low: 1, Medium: 5, High: 40) to shuffle the results.

---

## 🚀 How to Run

1. Install dependencies:
   ```bash
   pip install flask requests
   ```
2. Start the server:
   ```bash
   python app.py
   ```
3. Navigate to `http://127.0.0.1:5000` in any modern web browser.