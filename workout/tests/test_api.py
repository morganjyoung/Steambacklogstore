import os
import sys

import pytest

os.environ["GYMLOG_NO_AUTOAPP"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as gymlog  # noqa: E402

SESSION = {"note": None, "exercises": [
    {"key": "squat", "name": "Squat", "sets": [{"w": 70, "r": 5, "warm": True}, {"w": 72.5, "r": 5}, {"w": 72.5, "r": 6}]},
    {"key": "pulldown", "name": "Lat pulldown", "sets": [{"w": 60, "r": 8}]},
]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("APP_PASSWORD", raising=False)
    app = gymlog.create_app("sqlite:///" + str(tmp_path / "t.db"))
    return app.test_client()


def test_seeds_plan_history_on_first_start(client):
    ids = [s["id"] for s in client.get("/api/sessions").get_json()]
    assert ids == ["2026-09-25-A", "2026-09-22-C", "2026-09-20-B", "2026-09-18-A"]


def test_save_replace_and_delete(client):
    r = client.put("/api/sessions/2026-10-06-C", json=SESSION)
    assert r.status_code == 200
    body = r.get_json()
    assert body["exercises"][0]["sets"][0] == {"w": 70.0, "r": 5, "warm": True}
    assert [e["key"] for e in body["exercises"]] == ["squat", "pulldown"]

    SESSION2 = {"exercises": [{"key": "squat", "name": "Squat", "sets": [{"w": 75, "r": 5}]}]}
    client.put("/api/sessions/2026-10-06-C", json=SESSION2)
    saved = [s for s in client.get("/api/sessions").get_json() if s["id"] == "2026-10-06-C"]
    assert len(saved) == 1 and saved[0]["exercises"][0]["sets"] == [{"w": 75.0, "r": 5}]

    assert client.delete("/api/sessions/2026-10-06-C").status_code == 204
    assert client.delete("/api/sessions/2026-10-06-C").status_code == 404


@pytest.mark.parametrize("sid,payload", [
    ("2026-10-06-D", SESSION),
    ("2026-13-40-A", SESSION),
    ("2026-10-06-A", {"exercises": []}),
    ("2026-10-06-A", {"exercises": [{"key": "squat", "sets": [{"w": -5, "r": 5}]}]}),
    ("2026-10-06-A", {"exercises": [{"key": "squat", "sets": [{"w": 50, "r": 0}]}]}),
])
def test_rejects_bad_sessions(client, sid, payload):
    assert client.put(f"/api/sessions/{sid}", json=payload).status_code in (400, 404)


def test_password_protects_everything(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "squat95")
    monkeypatch.setenv("COOKIE_SECURE", "0")
    c = gymlog.create_app("sqlite:///" + str(tmp_path / "p.db")).test_client()
    assert c.get("/api/sessions").status_code == 401
    assert c.get("/").status_code == 302
    assert c.get("/healthz").status_code == 200
    assert "password isn&#39;t right" in c.post("/login", data={"password": "nope"}).get_data(as_text=True)
    assert c.post("/login", data={"password": "squat95"}).status_code == 302
    assert c.get("/api/sessions").status_code == 200
    assert c.get("/").status_code == 200
