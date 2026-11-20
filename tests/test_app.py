import json

import httpx
import pytest
from fastapi.testclient import TestClient

from plant_console.app import Settings, create_app
from plant_console.live import Live

RULES_TOPIC = "planta1/servicios/rules/config"
RULE = {
    "id": "r1",
    "mode": "notify",
    "when": [{"topic": "planta1/a", "above": 1}],
    "clear_when": [{"topic": "planta1/a", "below": 0}],
}


def fake_robot(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/planta":
        return httpx.Response(200, json={"nombre": "Planta 1", "ruta": [[0, 0], [1, 0]]})
    if request.url.path == "/fotos":
        return httpx.Response(200, json={"pi-610_21.0.jpg": {"autor": "X", "licencia": "CC BY 2.0"}})
    if request.url.path == "/fotos/pi-104_4.25.jpg":
        return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})
    return httpx.Response(404, json={})


class Plant:
    """Plays the rules engine and the simulator: answers what the console publishes."""

    def __init__(self, live: Live) -> None:
        self.live = live
        self.sent: list[tuple[str, dict]] = []
        self.refuse = False

    def __call__(self, topic: str, payload: dict) -> None:
        self.sent.append((topic, payload))
        request = payload["request"]
        if topic == f"{RULES_TOPIC}/set":
            if self.refuse:
                reply = {"value": "error", "detail": "rule 'r1': needs 'when'", "request": request}
            else:
                rules = payload["rules"]
                reply = {"value": "recargadas", "detail": "1 reglas", "rules": rules, "request": request}
            self.live.add(RULES_TOPIC, json.dumps(reply).encode(), retained=False)
        elif topic == "planta1/simulacion/perturbacion":
            result = {"value": "en-marcha", "request": request}
            self.live.add(f"{topic}/resultado", json.dumps(result).encode())


@pytest.fixture
def setup():
    live = Live(streams=("planta1/robots/+/posicion",))
    plant = Plant(live)
    settings = Settings({"ROBOT_URL": "http://robot"})
    app = create_app(settings, live, publish=plant, mqtt=False, answer_timeout_s=1)
    with TestClient(app) as client:
        transport = httpx.MockTransport(fake_robot)
        app.state.robot = httpx.AsyncClient(base_url="http://robot", transport=transport)
        yield client, live, plant


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
        assert msg["type"] == "msg" and msg["payload"]["x"] == 3 and msg["event"] is False


def test_map_photos_and_credits_come_from_the_robot(setup):
    client, _, _ = setup
    assert client.get("/api/planta").json()["nombre"] == "Planta 1"
    assert client.get("/api/fotos").json()["pi-610_21.0.jpg"]["licencia"] == "CC BY 2.0"
    photo = client.get("/api/fotos/pi-104_4.25.jpg")
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    assert client.get("/api/fotos/..%2F..%2Fetc%2Fpasswd").status_code == 404
    assert client.get("/api/fotos/nope.jpg").status_code == 404


def test_rules_are_read_from_the_uns(setup):
    client, live, _ = setup
    assert client.get("/api/reglas").status_code == 503  # the engine has not spoken yet
    state = {"value": "cargadas", "rules": [RULE], "orders": [{"topic": "x/orden", "value": "cerrar"}]}
    live.add(RULES_TOPIC, json.dumps(state).encode(), retained=True)
    body = client.get("/api/reglas").json()
    assert body["reglas"] == [RULE] and body["ordenes"][0]["value"] == "cerrar"


def test_new_rules_go_to_the_engine_and_its_answer_comes_back(setup):
    client, _, plant = setup
    response = client.put("/api/reglas", json={"rules": [RULE]})
    assert response.status_code == 200 and response.json()["ok"] is True
    topic, payload = plant.sent[-1]
    assert topic == f"{RULES_TOPIC}/set" and payload["rules"] == [RULE] and payload["source"] == "console"


def test_rules_refused_by_the_engine_are_reported(setup):
    client, _, plant = setup
    plant.refuse = True
    response = client.put("/api/reglas", json={"rules": [RULE]})
    assert response.status_code == 422 and "needs 'when'" in response.json()["detail"]


def test_no_answer_from_the_engine_is_not_a_success():
    nobody = lambda topic, payload: None  # noqa: E731
    app = create_app(Settings({}), Live(), publish=nobody, mqtt=False, answer_timeout_s=0.3)
    with TestClient(app) as client:
        response = client.put("/api/reglas", json={"rules": [RULE]})
    assert response.status_code == 504 and response.json()["ok"] is False


def test_the_disturbance_button_goes_through_the_uns(setup):
    client, _, plant = setup
    response = client.post("/api/escenario/perturbacion")
    assert response.status_code == 200 and response.json()["estado"] == "en-marcha"
    assert plant.sent[-1][0] == "planta1/simulacion/perturbacion"


def test_scenario_comes_from_the_uns(setup):
    client, live, _ = setup
    assert client.get("/api/escenario").status_code == 503
    scenario = {"value": 12.5, "unit": "s", "ciclo_s": 360, "perfil": [[0, 4.2], [360, 4.2]]}
    live.add("planta1/simulacion/escenario", json.dumps(scenario).encode(), retained=True)
    body = client.get("/api/escenario").json()
    assert body["fase_s"] == 12.5 and body["ciclo_s"] == 360 and "value" not in body


def test_security_check_order_from_the_console(setup):
    client, live, plant = setup
    # the fake broker drops it (nothing comes back): the check passes
    body = client.post("/api/ciber/orden-desde-consola").json()
    assert body["ok"] is True and plant.sent[-1][0] == "planta1/exterior/xv-104/orden"

    # a broker without ACL would deliver it back to the console, which reads everything
    def leaky(topic, payload):
        live.add(topic, json.dumps(payload).encode())

    app = create_app(Settings({}), live, publish=leaky, mqtt=False)
    with TestClient(app) as other:
        assert other.post("/api/ciber/orden-desde-consola").json()["ok"] is False


def test_security_check_rule_that_opens_the_valve(setup):
    client, _, plant = setup
    plant.refuse = True
    assert client.post("/api/ciber/regla-que-abre").json()["ok"] is True
    plant.refuse = False  # an engine without whitelist: the check fails and undoes it
    body = client.post("/api/ciber/regla-que-abre").json()
    assert body["ok"] is False and "deshecha" in body["detalle"]
    assert plant.sent[-1][1]["rules"] == []  # the probe rule was removed again
