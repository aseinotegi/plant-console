"""The console's backend: one gateway between the browser and the plant network.

Everything it shows comes from the UNS (MQTT) or from the robot's own server:

* ``/api/ws``: the whole namespace on connect, then every message as it arrives.
* ``/api/planta``, ``/api/fotos``: the map the robot walks and the photos it took
  (with their credits), from the robot.
* ``/api/escenario``: the simulator's scenario, as published in the UNS.
* ``/api/historia``: recent values of a numeric topic, for the trends.
* ``/api/reglas``: the rules the engine is running; PUT sends new ones to the engine,
  which validates them and answers. The console never writes a file.
* ``/api/escenario/perturbacion``: the demo's disturbance button, through the UNS.
* ``/api/servicios``: health of every container, checked from the console's networks.
* ``/``: the web app, when it has been built into ``WEB_DIR``.

The console's MQTT user can only read, plus those two requests (broker ACL): it
cannot send an order to the plant. Configuration is environment only: MQTT_HOST,
MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD, SITE, ROBOT_URL, GRAFANA_URL, WEB_DIR,
STREAM_TOPICS, SERVICES_FILE.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Protocol

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .live import Live, connect
from .services import check_all, load_services

log = logging.getLogger("console")

PHOTO_NAME = re.compile(r"^[a-z0-9_.-]+\.jpe?g$")


class Settings:
    def __init__(self, env: dict[str, str] | None = None) -> None:
        env = os.environ if env is None else env
        self.mqtt_host = env.get("MQTT_HOST", "localhost")
        self.mqtt_port = int(env.get("MQTT_PORT", "1883"))
        self.mqtt_username = env.get("MQTT_USERNAME") or None
        self.mqtt_password = env.get("MQTT_PASSWORD") or None
        self.site = env.get("SITE", "planta1")
        self.robot_url = env.get("ROBOT_URL", "http://localhost:8081").rstrip("/")
        self.grafana_url = env.get("GRAFANA_URL", "")
        self.web_dir = env.get("WEB_DIR", "")
        self.services_file = env.get("SERVICES_FILE", "")
        s = self.site
        default_streams = ",".join(
            [
                f"{s}/robots/+/posicion",
                f"{s}/simulacion/escenario",
                f"{s}/exterior/pt-104/presion",
                f"{s}/exterior/ft-104/caudal",
                f"{s}/exterior/tt-104/temperatura",
                f"{s}/tanques/lt-101/nivel",
                f"{s}/tanques/p-104/corriente",
                "$SYS/#",
            ]
        )
        self.streams = tuple(p for p in env.get("STREAM_TOPICS", default_streams).split(",") if p)

    @property
    def rules_topic(self) -> str:
        return f"{self.site}/servicios/rules/config"

    @property
    def disturb_topic(self) -> str:
        return f"{self.site}/simulacion/perturbacion"


class Publisher(Protocol):
    def __call__(self, topic: str, payload: dict[str, Any]) -> None: ...


class RulesBody(BaseModel):
    rules: list[dict[str, Any]]


async def answer(live: Live, topic: str, request: str, timeout_s: float) -> dict[str, Any] | None:
    """Waits for the message on ``topic`` that answers ``request``."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        entry = live.last(topic)
        if entry and isinstance(entry.payload, dict) and entry.payload.get("request") == request:
            return entry.payload
        await asyncio.sleep(0.1)
    return None


def create_app(
    settings: Settings | None = None,
    live: Live | None = None,
    publish: Publisher | None = None,
    mqtt: bool = True,
    answer_timeout_s: float = 6.0,
) -> FastAPI:
    settings = settings or Settings()
    live = live or Live(streams=settings.streams)
    state: dict[str, Any] = {"publish": publish}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = None
        if mqtt:
            client = connect(
                live,
                settings.mqtt_host,
                settings.mqtt_port,
                settings.site,
                settings.mqtt_username,
                settings.mqtt_password,
            )
            if state["publish"] is None:
                state["publish"] = lambda topic, payload: client.publish(
                    topic, json.dumps(payload, ensure_ascii=False), qos=1
                )
        app.state.robot = httpx.AsyncClient(base_url=settings.robot_url, timeout=5)
        yield
        await app.state.robot.aclose()
        if client is not None:
            client.loop_stop()
            client.disconnect()

    app = FastAPI(title="plant-console", lifespan=lifespan)
    app.state.live = live

    def send(topic: str, payload: dict[str, Any]) -> None:
        if state["publish"] is None:
            raise HTTPException(503, "sin conexión con el broker")
        state["publish"](topic, payload)

    async def robot(request: Request, path: str) -> httpx.Response:
        try:
            return await request.app.state.robot.get(path)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"el robot no responde: {exc}") from exc

    @app.get("/api/estado")
    def estado() -> dict[str, Any]:
        return {"broker": live.connected, "site": settings.site, "grafana_url": settings.grafana_url}

    services = load_services(settings.services_file)

    @app.get("/api/servicios")
    async def servicios() -> Any:
        return {"servicios": await check_all(services, live)}

    @app.get("/api/uns")
    def uns() -> dict[str, Any]:
        return live.snapshot()

    @app.get("/api/historia")
    def historia(topic: str, s: float = 300) -> dict[str, Any]:
        return {"topic": topic, "points": live.history(topic, min(s, live.history_s))}

    @app.get("/api/planta")
    async def planta(request: Request) -> Any:
        if not hasattr(request.app.state, "plant"):
            response = await robot(request, "/planta")
            if response.status_code != 200:
                raise HTTPException(502, "el robot no da su mapa")
            request.app.state.plant = response.json()  # the map does not change while running
        return request.app.state.plant

    @app.get("/api/fotos")
    async def creditos(request: Request) -> Any:
        response = await robot(request, "/fotos")
        if response.status_code != 200:
            raise HTTPException(502, "el robot no da los créditos de las fotos")
        return response.json()

    @app.get("/api/fotos/{name}")
    async def foto(name: str, request: Request) -> Response:
        if not PHOTO_NAME.match(name):
            raise HTTPException(404)
        response = await robot(request, f"/fotos/{name}")
        if response.status_code != 200:
            raise HTTPException(response.status_code)
        return Response(
            response.content,
            media_type=response.headers.get("content-type", "image/jpeg"),
            headers={"Cache-Control": "max-age=3600"},  # a photo never changes
        )

    @app.get("/api/escenario")
    def escenario() -> Any:
        entry = live.last(f"{settings.site}/simulacion/escenario")
        if entry is None or not isinstance(entry.payload, dict):
            raise HTTPException(503, "el simulador todavía no ha publicado su escenario")
        p = entry.payload
        return {"fase_s": p.get("value"), **{k: v for k, v in p.items() if k not in ("value", "ts", "unit")}}

    @app.post("/api/escenario/perturbacion")
    async def perturbacion() -> Any:
        request = uuid.uuid4().hex
        send(settings.disturb_topic, {"value": "provocar", "source": "console", "request": request})
        result = await answer(live, f"{settings.disturb_topic}/resultado", request, answer_timeout_s)
        if result is None:
            return JSONResponse({"ok": False, "estado": "sin-respuesta"}, status_code=504)
        started = result.get("value") == "en-marcha"
        body = {"ok": started, "estado": result.get("value")}
        return JSONResponse(body, status_code=200 if started else 409)

    @app.get("/api/reglas")
    def leer_reglas() -> Any:
        entry = live.last(settings.rules_topic)
        if entry is None or not isinstance(entry.payload, dict):
            raise HTTPException(503, "el motor de reglas todavía no ha publicado sus reglas")
        p = entry.payload
        return {
            "estado": p.get("value"),
            "detalle": p.get("detail"),
            "reglas": p.get("rules", []),
            "ordenes": p.get("orders", []),
        }

    @app.put("/api/reglas")
    async def guardar_reglas(body: RulesBody) -> Any:
        request = uuid.uuid4().hex
        send(
            f"{settings.rules_topic}/set",
            {"value": "aplicar", "source": "console", "request": request, "rules": body.rules},
        )
        result = await answer(live, settings.rules_topic, request, answer_timeout_s)
        if result is None:
            body = {"ok": False, "detail": "el motor de reglas no ha contestado"}
            return JSONResponse(body, status_code=504)
        if result.get("value") == "error":
            return JSONResponse({"ok": False, "detail": result.get("detail")}, status_code=422)
        return {"ok": True, "detail": result.get("detail")}

    # -- live security checks: they try what must fail, and say what happened ------

    @app.post("/api/ciber/orden-desde-consola")
    async def orden_desde_consola() -> Any:
        """Publishes an order to XV-104 with the console's own user. The broker's ACL must
        drop it: if it ever comes back to the console (which reads everything), it got through.
        The value is not an order the robot knows, so even then nothing would move."""
        topic = f"{settings.site}/exterior/xv-104/orden"
        request = uuid.uuid4().hex
        send(topic, {"value": "prueba-acl", "source": "console", "request": request})
        leaked = await answer(live, topic, request, 2.0)
        return {
            "ok": leaked is None,
            "detalle": "el broker ha descartado la orden: la consola no puede mandar a la planta"
            if leaked is None
            else "LA ORDEN HA LLEGADO: revisa la ACL del broker",
        }

    @app.post("/api/ciber/regla-que-abre")
    async def regla_que_abre() -> Any:
        """Proposes a rule that would open XV-104, an order outside the whitelist. The engine
        must refuse it. Its condition can never hold, and if it were taken, it is undone."""
        current = live.last(settings.rules_topic)
        rules = current.payload.get("rules", []) if current and isinstance(current.payload, dict) else []
        probe = {
            "id": "prueba-ciber-abrir-xv-104",
            "description": "Prueba de la consola: una regla que intenta abrir la válvula",
            "mode": "act",
            "when": [{"topic": f"{settings.site}/ciber/nunca", "above": 1e12}],
            "clear_when": [{"topic": f"{settings.site}/ciber/nunca", "below": 0}],
            "on_trigger": [{"topic": f"{settings.site}/exterior/xv-104/orden", "value": "abrir"}],
        }
        request = uuid.uuid4().hex
        send(
            f"{settings.rules_topic}/set",
            {"value": "aplicar", "source": "console", "request": request, "rules": [*rules, probe]},
        )
        result = await answer(live, settings.rules_topic, request, answer_timeout_s)
        if result is None:
            silent = {"ok": False, "detalle": "el motor de reglas no ha contestado"}
            return JSONResponse(silent, status_code=504)
        if result.get("value") == "error":
            return {"ok": True, "detalle": f"el motor la ha rechazado: {result.get('detail')}"}
        undo = uuid.uuid4().hex
        send(
            f"{settings.rules_topic}/set",
            {"value": "aplicar", "source": "console", "request": undo, "rules": rules},
        )
        await answer(live, settings.rules_topic, undo, answer_timeout_s)
        return {"ok": False, "detalle": "EL MOTOR LA HA ACEPTADO (ya deshecha): revisa RULES_ORDERS"}

    @app.websocket("/api/ws")
    async def ws(socket: WebSocket) -> None:
        await socket.accept()
        queue = live.listen()
        try:
            await socket.send_json({"type": "snapshot", **live.snapshot()})
            while True:
                entry = await queue.get()
                event = not entry.retained and not live.is_stream(entry.topic)
                await socket.send_json({"type": "msg", **entry.as_dict(), "event": event})
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            live.forget(queue)

    if settings.web_dir and Path(settings.web_dir, "index.html").exists():
        app.mount("/", StaticFiles(directory=settings.web_dir, html=True), name="web")

    return app


def main() -> int:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(create_app(), host="0.0.0.0", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
