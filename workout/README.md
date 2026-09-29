# Gym log

A phone-first workout tracker for the A/B/C strength plan. It suggests each set's weight from your last session (double progression, squat +2.5 kg on Day A, Day C repeats Friday, 10% drop after a two-session stall), runs a rest timer per lift, and shows progress against the Strength Level bands and the 10 Nov / 18 Dec goals.

It's a Flask app with a SQL database: Postgres in the cloud, SQLite on your laptop. On first start with an empty database it loads the four sessions logged before the holiday (18–25 Sep), so set `SEED=0` if you don't want them.

## Run it locally

```bash
cd workout
pip install -r requirements.txt
python app.py            # http://localhost:5001, data in workout/workout.db
python -m pytest tests   # needs pytest
```

## Settings

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres URL, e.g. `postgresql://user:pass@host/db`. `postgres://` URLs work too. Without it the app uses SQLite, which is wiped on most cloud hosts at each deploy. |
| `APP_PASSWORD` | Password for the sign-in page. Leave it unset only when running locally. |
| `SECRET_KEY` | Long random string that signs the login cookie. Without it you're signed out whenever the server restarts. |
| `SEED` | `0` stops the pre-holiday sessions loading into an empty database. |
| `PORT` | Set by the host; the Docker image defaults to 8080. |

## Deploy on Render with a Neon database (free tiers)

1. Create a free Postgres database at [neon.tech](https://neon.tech) and copy its connection string.
2. On [render.com](https://render.com), choose **New → Web Service**, connect this GitHub repo and the branch.
3. Set **Root Directory** to `workout` and **Language** to Docker (it uses the `Dockerfile` here).
4. Add the environment variables `DATABASE_URL` (the Neon string), `APP_PASSWORD` and `SECRET_KEY`.
5. Set the health check path to `/healthz` and deploy. Open the URL on your phone, sign in, and use **Add to Home Screen**.

Render's free web services sleep after 15 minutes idle, so the first load of a session can take up to a minute. Render's own Postgres works in place of Neon, but its free database expires after 30 days.

The same Docker image runs on Fly.io, Railway or Google Cloud Run: build from `workout/` and set the same variables.

## API

All routes need the login cookie when `APP_PASSWORD` is set.

- `GET /api/sessions`: every session, newest first.
- `PUT /api/sessions/<date>-<day>`: save or replace a session, e.g. `/api/sessions/2026-10-06-C` with `{"note": null, "exercises": [{"key": "squat", "name": "Squat", "sets": [{"w": 72.5, "r": 5}, {"w": 40, "r": 5, "warm": true}]}]}`.
- `DELETE /api/sessions/<date>-<day>`: remove one.

Sets are stored one row each in `workout_sets` (session, exercise, weight, reps, warm-up flag), so you can query them directly with SQL.
