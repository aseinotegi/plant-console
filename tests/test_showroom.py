import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from test_app import RULE, Plant, configure_vision, fake_robot

from plant_console.app import Settings, create_app
from plant_console.live import Live
from plant_console.showroom import Limiter, Memo

TRIAL = {"poi": "PI-104", "file": "pi-104_4.25.jpg"}


def open_showroom(**env: str):
    live = Live()
    plant = Plant(live)
    settings = Settings({"ROBOT_URL": "http://robot", "SHOWROOM": "true", **env})
    app = create_app(settings, live, publish=plant, mqtt=False, answer_timeout_s=1)
    return app, live, plant


@pytest.fixture
def showroom():
    app, live, plant = open_showroom(GRAFANA_URL="https://demo-grafana.andersein.com")
    with TestClient(app) as client:
        robot = httpx.MockTransport(fake_robot)
        app.state.robot = httpx.AsyncClient(base_url="http://robot", transport=robot)
        yield client, live, plant


def trials_sent(plant: Plant) -> int:
    return sum(topic == "planta1/ensayos/vision/foto" for topic, _ in plant.sent)


def test_the_console_says_it_is_a_showroom(showroom):
    client, _, _ = showroom
    state = client.get("/api/estado").json()
    assert state["showroom"] is True and state["uploads"] is False and state["disturb_cooldown_s"] == 180


def test_rules_and_probes_are_read_only(showroom):
    client, _, plant = showroom
    assert client.put("/api/reglas", json={"rules": [RULE]}).status_code == 403
    assert client.post("/api/ciber/orden-desde-consola").status_code == 403
    assert client.post("/api/ciber/regla-que-abre").status_code == 403
    assert plant.sent == []  # nothing reached the broker


def test_the_disturbance_button_has_a_cooldown(showroom):
    client, _, plant = showroom
    assert client.post("/api/escenario/perturbacion").status_code == 200
    again = client.post("/api/escenario/perturbacion", headers={"CF-Connecting-IP": "198.51.100.9"})
    assert again.status_code == 429 and int(again.headers["Retry-After"]) > 100
    assert "disponible de nuevo" in again.json()["detail"]
    assert len(plant.sent) == 1


def test_uploads_are_off(showroom):
    client, live, plant = showroom
    configure_vision(live)
    image = base64.b64encode(b"\xff\xd8photo").decode()
    upload = {"poi": "PI-104", "image_b64": image, "mime": "image/jpeg"}
    assert client.post("/api/vision/ensayos", json=upload).status_code == 403
    assert plant.sent == []


def test_a_catalog_photo_already_analyzed_is_answered_from_memory(showroom):
    client, live, plant = showroom
    configure_vision(live)
    first = client.post("/api/vision/ensayos", json=TRIAL).json()
    again = [client.post("/api/vision/ensayos", json=TRIAL).json() for _ in range(20)]
    assert trials_sent(plant) == 1  # one model call, however many visitors ask
    assert all(a["cached"] and a["result"] == first["result"] for a in again)


def test_trials_are_rationed_per_visitor_and_overall():
    app, live, plant = open_showroom(TRIAL_CACHE_S="0", TRIALS_PER_HOUR="8")
    with TestClient(app) as client:
        robot = httpx.MockTransport(fake_robot)
        app.state.robot = httpx.AsyncClient(base_url="http://robot", transport=robot)
        configure_vision(live)

        def codes(ip: str, n: int) -> list[int]:
            visitor = {"CF-Connecting-IP": ip}
            post = lambda: client.post("/api/vision/ensayos", json=TRIAL, headers=visitor)  # noqa: E731
            return [post().status_code for _ in range(n)]

        assert codes("203.0.113.7", 7) == [200] * 6 + [429]
        assert codes("2001:db8:1:2::a", 1) == [200]
        assert codes("2001:db8:1:2::b", 1) == [200]  # the same /64: the same home
        assert codes("198.51.100.2", 1) == [429]  # eight in the hour, whoever asked
        assert trials_sent(plant) == 8


def test_bodies_are_capped_and_docs_are_off(showroom):
    client, _, plant = showroom
    big = {"poi": "PI-104", "file": "x" * 70_000}
    assert client.post("/api/vision/ensayos", json=big).status_code == 413
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
    assert plant.sent == []


def test_the_browser_gets_a_strict_policy(showroom):
    client, _, _ = showroom
    headers = client.get("/api/estado").headers
    csp = headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp and "frame-src https://demo-grafana.andersein.com" in csp
    assert "frame-ancestors 'self' https://andersein.com" in csp
    assert headers["X-Content-Type-Options"] == "nosniff"


def test_live_connections_are_capped():
    app, _, _ = open_showroom(MAX_SOCKETS="1")
    with TestClient(app) as client, client.websocket_connect("/api/ws") as first:
        assert first.receive_json()["type"] == "snapshot"
        with pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/ws") as second:
            second.receive_json()


def test_limiter_window_cooldown_and_overall():
    now = [0.0]
    limiter = Limiter(per_visitor=2, window_s=60, cooldown_s=10, clock=lambda: now[0])
    assert limiter.wait("a") == 0
    assert limiter.wait("b") == 10  # global cooldown
    now[0] = 11
    assert limiter.wait("a") == 0
    now[0] = 25
    assert limiter.wait("a") == 35  # two uses in the last minute: wait for the first to expire
    assert limiter.wait("b") == 0
    now[0] = 61
    assert limiter.wait("a") == 0

    overall = Limiter(per_visitor=5, window_s=60, overall=2, clock=lambda: now[0])
    assert [overall.wait(v) for v in "abc"] == [0, 0, 60]


def test_memo_forgets_after_its_time():
    now = [0.0]
    memo = Memo(ttl_s=10, clock=lambda: now[0])
    memo.put("k", 1)
    assert memo.get("k") == 1
    now[0] = 11
    assert memo.get("k") is None
    assert Memo(ttl_s=0).get("k") is None


def test_uploads_when_enabled_are_rationed_too_and_never_kept():
    app, live, plant = open_showroom(UPLOADS="true", TRIALS_PER_DAY="2")
    with TestClient(app) as client:
        robot = httpx.MockTransport(fake_robot)
        app.state.robot = httpx.AsyncClient(base_url="http://robot", transport=robot)
        configure_vision(live)
        image = base64.b64encode(b"\xff\xd8" + b"x" * 5000).decode()
        upload = {"poi": "PI-104", "image_b64": image, "mime": "image/jpeg"}
        codes = [
            client.post("/api/vision/ensayos", json=upload, headers={"CF-Connecting-IP": f"203.0.113.{i}"})
            for i in range(3)
        ]
        assert [c.status_code for c in codes] == [200, 200, 429]  # two a day, whoever sends them
        assert "image_b64" in plant.sent[0][1]  # the inspector gets the photo...
        live.add("planta1/ensayos/vision/foto", json.dumps(plant.sent[0][1]).encode())
        kept = json.dumps(client.get("/api/uns").json())
        assert image[:200] not in kept and '"image_b64_bytes"' in kept  # ...other visitors never do
