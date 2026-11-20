"""The console's backend: one gateway between the browser and the plant.

* ``/api/ws``: the whole namespace on connect, then every message as it arrives.
* ``/api/planta``, ``/api/escenario``: the map and the simulated scenario, from the world.
* ``/api/fotos/<file>``: the robot's photos (the browser cannot reach the world).
* ``/api/historia``: recent values of a numeric topic, for the trends.
* ``/api/reglas``: read and save the rules file (the engine validates and reloads it).
* ``/``: the web app, when it has been built into ``WEB_DIR``.

Configuration is environment only: MQTT_HOST, MQTT_PORT, SITE, WORLD_URL,
RULES_FILE, WEB_DIR, STREAM_TOPICS.
"""

from __future__ import annotations

import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .live import Live, connect
from .rules_file import RulesFile, RulesRejected

log = logging.getLogger("console")

PHOTO_NAME = re.compile(r"^[a-z0-9_.-]+\.jpe?g$")


class Settings:
    def __init__(self, env: dict[str, str] | None = None) -> None:
        env = os.environ if env is None else env
        self.mqtt_host = env.get("MQTT_HOST", "localhost")
        self.mqtt_port = int(env.get("MQTT_PORT", "1883"))
        self.site = env.get("SITE", "planta1")
        self.world_url = env.get("WORLD_URL", "http://localhost:8080").rstrip("/")
        self.rules_file = env.get("RULES_FILE", "")
        self.web_dir = env.get("WEB_DIR", "")
        default_streams = f"{self.site}/robots/+/posicion,{self.site}/exterior/pt-104/presion"
        self.streams = tuple(s for s in env.get("STREAM_TOPICS", default_streams).split(",") if s)


class RulesBody(BaseModel):
    yaml: str


def create_app(settings: Settings | None = None, live: Live | None = None, mqtt: bool = True) -> FastAPI:
    settings = settings or Settings()
    live = live or Live(streams=settings.streams)
    rules = (
        RulesFile(settings.rules_file, live, f"{settings.site}/servicios/rules/config")
        if settings.rules_file
        else None
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = connect(live, settings.mqtt_host, settings.mqtt_port, settings.site) if mqtt else None
        app.state.world = httpx.AsyncClient(base_url=settings.world_url, timeout=5)
        yield
        await app.state.world.aclose()
        if client is not None:
            client.loop_stop()
            client.disconnect()

    app = FastAPI(title="plant-console", lifespan=lifespan)
    app.state.live = live

    async def world(request: Request, method: str, path: str) -> httpx.Response:
        try:
            return await request.app.state.world.request(method, path)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"el simulador no responde: {exc}") from exc

    @app.get("/api/estado")
    def estado() -> dict[str, Any]:
        return {"broker": live.connected, "site": settings.site, "rules_editable": rules is not None}

    @app.get("/api/uns")
    def uns() -> dict[str, Any]:
        return live.snapshot()

    @app.get("/api/historia")
    def historia(topic: str, s: float = 300) -> dict[str, Any]:
        return {"topic": topic, "points": live.history(topic, min(s, live.history_s))}

    @app.get("/api/planta")
    async def planta(request: Request) -> Any:
        if not hasattr(request.app.state, "plant"):
            response = await world(request, "GET", "/planta")
            if response.status_code != 200:
                raise HTTPException(502, "el simulador no da el mapa")
            request.app.state.plant = response.json()  # the map does not change while running
        return request.app.state.plant

    @app.get("/api/escenario")
    async def escenario(request: Request) -> Any:
        response = await world(request, "GET", "/escenario")
        return JSONResponse(response.json(), status_code=response.status_code)

    @app.post("/api/escenario/perturbacion")
    async def perturbacion(request: Request) -> Any:
        response = await world(request, "POST", "/escenario/perturbacion")
        return JSONResponse(response.json(), status_code=response.status_code)

    @app.get("/api/fotos/{name}")
    async def foto(name: str, request: Request) -> Response:
        if not PHOTO_NAME.match(name):
            raise HTTPException(404)
        response = await world(request, "GET", f"/fotos/{name}")
        if response.status_code != 200:
            raise HTTPException(response.status_code)
        return Response(
            response.content,
            media_type=response.headers.get("content-type", "image/jpeg"),
            headers={"Cache-Control": "max-age=3600"},  # a photo never changes
        )

    @app.get("/api/reglas")
    def leer_reglas() -> dict[str, Any]:
        if rules is None:
            raise HTTPException(404, "RULES_FILE no está configurado")
        return {"yaml": rules.read()}

    @app.put("/api/reglas")
    async def guardar_reglas(body: RulesBody) -> Any:
        if rules is None:
            raise HTTPException(404, "RULES_FILE no está configurado")
        try:
            saved = await rules.save(body.yaml)
        except RulesRejected as exc:
            return JSONResponse({"ok": False, "detail": str(exc)}, status_code=422)
        return JSONResponse(
            {"ok": True, "confirmed": saved.confirmed, "detail": saved.detail},
            status_code=200 if saved.confirmed else 202,
        )

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
