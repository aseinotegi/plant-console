"""The console's backend: one gateway between the browser and the plant network.

Everything it shows comes from the UNS (MQTT) or from the robot's own server:

* ``/api/ws``: the whole namespace on connect, then every message as it arrives.
* ``/api/planta``, ``/api/fotos``: the map the robot walks and the photos it took
  (with their credits), from the robot.
* ``/api/escenario``: the simulator's scenario, as published in the UNS.
* ``/api/historia``: recent values of a numeric topic, for the trends.
* ``/api/reglas``: the rules the engine is running; PUT sends new ones to the engine,
  which validates them and answers. The console never writes a file.
* ``/api/vision/ensayos``: analyze a catalog photo or a new image in the isolated
  trial branch; it never writes a plant value or order.
* ``/api/escenario/perturbacion``: the demo's disturbance button, through the UNS.
* ``/api/servicios``: health of every container, checked from the console's networks.
* ``/``: the web app, when it has been built into ``WEB_DIR``.

The console's MQTT user can only read, plus rules, disturbance and trial requests
(broker ACL): it cannot send an order to the plant. Configuration is environment
only: MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD, SITE, ROBOT_URL,
GRAFANA_URL, WEB_DIR, STREAM_TOPICS, SERVICES_FILE, MAX_SOCKETS, and for the public demo
SHOWROOM with its limits (see showroom.py): DISTURB_COOLDOWN_S, DISTURB_PER_VISITOR_HOUR,
TRIALS_PER_VISITOR_HOUR, TRIALS_PER_HOUR, TRIALS_AT_ONCE, TRIAL_CACHE_S, UPLOADS.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .live import Live, connect
from .services import check_all, load_services
from .showroom import Limiter, Memo, security_headers, truthy, visitor

log = logging.getLogger("console")

PHOTO_NAME = re.compile(r"^[a-z0-9_.-]+\.jpe?g$")
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_BODY_BYTES = MAX_IMAGE_BYTES * 4 // 3 + 64 * 1024  # an image in base64, plus the JSON
SMALL_BODY_BYTES = 64 * 1024  # without uploads nothing needs more
IMAGE_MIME = {"image/jpeg", "image/png"}


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
        # Showroom: open to anyone. Read-only rules, no probes, rationed buttons.
        self.showroom = truthy(env.get("SHOWROOM"))
        on = self.showroom
        self.disturb_cooldown_s = float(env.get("DISTURB_COOLDOWN_S", "180" if on else "0"))
        self.disturb_per_visitor = int(env.get("DISTURB_PER_VISITOR_HOUR", "3" if on else "0"))
        self.trials_per_visitor = int(env.get("TRIALS_PER_VISITOR_HOUR", "6" if on else "0"))
        self.trials_per_hour = int(env.get("TRIALS_PER_HOUR", "60" if on else "0"))
        self.trials_at_once = int(env.get("TRIALS_AT_ONCE", "1" if on else "0"))
        self.trial_cache_s = float(env.get("TRIAL_CACHE_S", "21600" if on else "0"))
        self.uploads = truthy(env.get("UPLOADS", "false" if on else "true"))
        self.max_sockets = int(env.get("MAX_SOCKETS", "200"))
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

    @property
    def vision_trial_topic(self) -> str:
        return f"{self.site}/ensayos/vision"


class Publisher(Protocol):
    def __call__(self, topic: str, payload: dict[str, Any]) -> None: ...


class RulesBody(BaseModel):
    rules: list[dict[str, Any]]


class VisionTrialBody(BaseModel):
    poi: str
    file: str | None = None
    image_b64: str | None = None
    mime: str | None = None
    request: str | None = None


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
    vision_timeout_s: float = 180.0,
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

    docs = {} if not settings.showroom else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="plant-console", lifespan=lifespan, **docs)
    app.state.live = live
    disturb_limit = Limiter(settings.disturb_per_visitor, 3600, settings.disturb_cooldown_s)
    trial_limit = Limiter(settings.trials_per_visitor, 3600, overall=settings.trials_per_hour)
    trial_answers = Memo(settings.trial_cache_s)
    running = {"trials": 0, "sockets": 0}
    max_body = MAX_BODY_BYTES if settings.uploads else SMALL_BODY_BYTES
    headers = security_headers(settings.grafana_url) if settings.showroom else {}

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            length = request.headers.get("content-length", "")
            if not length.isdigit() and "transfer-encoding" in request.headers:
                return JSONResponse({"detail": "falta Content-Length"}, status_code=411)
            if length.isdigit() and int(length) > max_body:
                return JSONResponse({"detail": "la petición es demasiado grande"}, status_code=413)
        response = await call_next(request)
        response.headers.update(headers)
        return response

    def not_in_showroom(what: str) -> None:
        if settings.showroom:
            raise HTTPException(403, f"{what} no está disponible en la demo pública")

    def ration(limiter: Limiter, request: Request, what: str) -> JSONResponse | None:
        wait = limiter.wait(visitor(request))
        if wait <= 0:
            return None
        detail = f"{what} disponible de nuevo en {int(wait) + 1} s"
        body = {"ok": False, "detail": detail, "retry_after_s": wait}
        return JSONResponse(body, status_code=429, headers={"Retry-After": str(int(wait) + 1)})

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
        return {
            "broker": live.connected,
            "site": settings.site,
            "grafana_url": settings.grafana_url,
            "showroom": settings.showroom,
            "uploads": settings.uploads,
            "disturb_cooldown_s": settings.disturb_cooldown_s,
        }

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

    @app.post("/api/vision/ensayos")
    async def vision_trial(body: VisionTrialBody, request: Request) -> Any:
        if bool(body.file) == bool(body.image_b64):
            raise HTTPException(400, "indica una foto del catálogo o una imagen nueva, no ambas")
        if body.image_b64 and not settings.uploads:
            raise HTTPException(403, "subir imágenes no está disponible en la demo pública")
        config_entry = live.last(f"{settings.site}/servicios/inspector/config")
        config = config_entry.payload if config_entry and isinstance(config_entry.payload, dict) else {}
        if body.poi not in config.get("pois", {}):
            raise HTTPException(400, "el inspector no tiene configurado ese punto de interés")

        if body.request and not re.fullmatch(r"[a-zA-Z0-9-]{8,64}", body.request):
            raise HTTPException(400, "el identificador de solicitud no es válido")
        request_id = body.request or uuid.uuid4().hex
        if body.file:
            if not PHOTO_NAME.match(body.file):
                raise HTTPException(400, "nombre de imagen no válido")
            credits_response = await robot(request, "/fotos")
            if credits_response.status_code != 200:
                raise HTTPException(502, "el robot no da los créditos de las fotos")
            credit = credits_response.json().get(body.file)
            if credit is None:
                raise HTTPException(404, "la foto no está en el catálogo")
            if credit.get("poi") != body.poi:
                raise HTTPException(400, "la foto no pertenece al punto de interés indicado")
            if (known := trial_answers.get((body.file, body.poi))) is not None:
                return {"ok": known.get("state") == "completada", "result": known, "cached": True}
            photo_response = await robot(request, f"/fotos/{body.file}")
            if photo_response.status_code != 200:
                raise HTTPException(502, "el robot no puede recuperar la foto")
            image = photo_response.content
            mime = photo_response.headers.get("content-type", "image/jpeg").split(";")[0]
            image_id = body.file
            image_file = body.file
        else:
            mime = body.mime or ""
            if mime not in IMAGE_MIME:
                raise HTTPException(415, "solo se admiten imágenes JPEG o PNG")
            assert body.image_b64 is not None
            if len(body.image_b64) > (MAX_IMAGE_BYTES * 4 // 3) + 4:
                raise HTTPException(413, "la imagen supera el límite de 8 MiB")
            try:
                image = base64.b64decode(body.image_b64, validate=True)
            except binascii.Error:
                raise HTTPException(400, "la imagen no es base64 válido") from None
            image_id = f"nueva-{request_id[:12]}"
            image_file = None

        if len(image) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "la imagen supera el límite de 8 MiB")
        if mime not in IMAGE_MIME:
            raise HTTPException(415, "solo se admiten imágenes JPEG o PNG")
        if mime == "image/jpeg" and not image.startswith(b"\xff\xd8"):
            raise HTTPException(400, "el contenido no es una imagen JPEG")
        if mime == "image/png" and not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(400, "el contenido no es una imagen PNG")
        if settings.trials_at_once and running["trials"] >= settings.trials_at_once:
            busy = {"ok": False, "detail": "El inspector está con otro análisis: prueba en unos segundos"}
            return JSONResponse(busy, status_code=429, headers={"Retry-After": "10"})
        if limited := ration(trial_limit, request, "El análisis"):
            return limited

        captured = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        payload = {
            "value": image_id,
            "poi": body.poi,
            "image_b64": base64.b64encode(image).decode(),
            "mime": mime,
            "ts": captured,
            "captured_at": captured,
            "source": "console",
            "mode": "ensayo",
            "request": request_id,
        }
        if image_file:
            payload["image_file"] = image_file
        running["trials"] += 1
        try:
            send(f"{settings.vision_trial_topic}/foto", payload)
            topic = f"{settings.vision_trial_topic}/resultado"
            result = await answer(live, topic, request_id, vision_timeout_s)
        finally:
            running["trials"] -= 1
        if result is None:
            return JSONResponse(
                {"ok": False, "detail": "el inspector no ha contestado", "request": request_id},
                status_code=504,
            )
        if image_file and result.get("state") == "completada":
            trial_answers.put((image_file, body.poi), result)
        return {"ok": result.get("state") == "completada", "result": result}

    @app.get("/api/escenario")
    def escenario() -> Any:
        entry = live.last(f"{settings.site}/simulacion/escenario")
        if entry is None or not isinstance(entry.payload, dict):
            raise HTTPException(503, "el simulador todavía no ha publicado su escenario")
        p = entry.payload
        return {"fase_s": p.get("value"), **{k: v for k, v in p.items() if k not in ("value", "ts", "unit")}}

    @app.post("/api/escenario/perturbacion")
    async def perturbacion(http: Request) -> Any:
        if limited := ration(disturb_limit, http, "La perturbación"):
            return limited
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
        not_in_showroom("Editar reglas")
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
        not_in_showroom("Esta prueba")
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
        not_in_showroom("Esta prueba")
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
        if running["sockets"] >= settings.max_sockets:
            await socket.close(code=1013)  # try again later
            return
        await socket.accept()
        running["sockets"] += 1
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
            running["sockets"] -= 1
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
