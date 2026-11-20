import json
import threading
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from plant_console.app import Settings, create_app
from plant_console.live import Live

RULES = "rules:\n  - id: r1\n    mode: notify\n    when: []\n    clear_when: []\n"
STATUS = "planta1/servicios/rules/config"


def fake_world(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/planta":
        return httpx.Response(200, json={"nombre": "Planta 1", "ruta": [[0, 0], [1, 0]]})
    if request.url.path == "/escenario/perturbacion":
        return httpx.Response(200, json={"ok": True})
    if request.url.path == "/fotos/pi-104_4.25.jpg":
        return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})
    return httpx.Response(404, json={})


@pytest.fixture
def setup(tmp_path):
    rules = tmp_path / "rules.yaml"
    rules.write_text(RULES)
    live = Live(streams=("planta1/robots/+/posicion",))
    settings = Settings({"RULES_FILE": str(rules), "WORLD_URL": "http://world"})
    app = create_app(settings, live, mqtt=False)
    with TestClient(app) as client:
        transport = httpx.MockTransport(fake_world)
        app.state.world = httpx.AsyncClient(base_url="http://world", transport=transport)
        yield client, live, rules


def engine_answers(live, state, detail="", delay=0.3):
    """Plays the rules engine: answers on its status topic after a moment."""

    def answer():
        time.sleep(delay)
        live.add(STATUS, json.dumps({"value": state, "detail": detail}).encode())

    threading.Thread(target=answer, daemon=True).start()


def test_namespace_snapshot_over_http_and_websocket(setup):
    client, live, _ = setup
    live.add("planta1/exterior/pi-104/presion", b'{"value": 6.8, "unit": "bar"}', retained=True)
    topics = client.get("/api/uns").json()["topics"]
    assert topics["planta1/exterior/pi-104/presion"]["payload"]["value"] == 6.8
    with client.websocket_connect("/api/ws") as ws:
        first = ws.receive_json()
        assert first["type"] == "snapshot" and "planta1/exterior/pi-104/presion" in first["topics"]
        live.add("planta1/robots/robot-01/posicion", b'{"value": "en-ruta", "x": 3, "y": 4}')
        msg = ws.receive_json()
        assert msg["type"] == "msg" and msg["payload"]["x"] == 3


def test_world_is_proxied_and_photo_names_are_checked(setup):
    client, _, _ = setup
    assert client.get("/api/planta").json()["nombre"] == "Planta 1"
    assert client.post("/api/escenario/perturbacion").json() == {"ok": True}
    photo = client.get("/api/fotos/pi-104_4.25.jpg")
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    assert client.get("/api/fotos/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/fotos/nope.jpg").status_code == 404


def test_rules_saved_when_the_engine_takes_them(setup):
    client, live, rules = setup
    new = RULES.replace("notify", "act")
    engine_answers(live, "recargadas", "1 reglas")
    response = client.put("/api/reglas", json={"yaml": new})
    assert response.status_code == 200 and response.json()["confirmed"] is True
    assert rules.read_text() == new


def test_rules_put_back_when_the_engine_refuses_them(setup):
    client, live, rules = setup
    engine_answers(live, "error", "rule 'r1': needs 'when'")
    response = client.put("/api/reglas", json={"yaml": "rules:\n  - id: r1\n"})
    assert response.status_code == 422 and "needs 'when'" in response.json()["detail"]
    assert rules.read_text() == RULES


def test_rules_that_are_not_yaml_never_reach_the_file(setup):
    client, _, rules = setup
    assert client.put("/api/reglas", json={"yaml": "rules: [unclosed"}).status_code == 422
    assert client.put("/api/reglas", json={"yaml": "hello: 1"}).status_code == 422
    assert rules.read_text() == RULES
