"""Health of the demo's containers, as the console sees them from its own networks.

No Docker socket (that would give the web console the keys to the host). For each
service it uses what any client on the network has:

* name resolution: its IP, if it shares a network with the console. A service on a
  network the console is not in (campo, datos) does not resolve: segmentation at work.
* a TCP connection to its port, with the time it took.
* its own signal in the UNS: the Last Will status, or a value that must stay fresh.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import yaml

from .live import Live

# A name on a network the console is not in takes seconds to fail: Docker forwards it
# to the host's DNS. Those lookups get their own threads (uvloop's pool has only four,
# shared with every other connection the console opens) and are remembered for a while,
# so the page asking every few seconds never queues behind them.
_DNS = ThreadPoolExecutor(max_workers=16, thread_name_prefix="dns")
DNS_TTL_S = 30.0
_dns_cache: dict[str, tuple[float, list[str]]] = {}


def load_services(path: str | Path | None) -> list[dict[str, Any]]:
    if not path or not Path(path).is_file():
        return []
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or []
    return [s for s in data if isinstance(s, dict) and "nombre" in s]


async def resolve(host: str) -> list[str]:
    """The IPv4 addresses of ``host``, as this container resolves it (cached)."""
    hit = _dns_cache.get(host)
    if hit and time.monotonic() - hit[0] < DNS_TTL_S:
        return hit[1]
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.run_in_executor(_DNS, lambda: socket.getaddrinfo(host, None, socket.AF_INET))
        ips = sorted({str(info[4][0]) for info in infos})
    except OSError:
        ips = []
    _dns_cache[host] = (time.monotonic(), ips)
    return ips


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


async def connect(target: str, timeout: float = 1.0) -> float | None:
    """Milliseconds to open a TCP connection, or None if it cannot be opened.
    The timeout is for the connection only: the name is resolved first, apart."""
    host, _, port = target.rpartition(":")
    ips = [host] if _is_ip(host) else await resolve(host)
    if not ips or not port.isdigit():
        return None
    start = time.perf_counter()
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(ips[0], int(port)), timeout)
    except (OSError, asyncio.TimeoutError):
        _dns_cache.pop(host, None)  # it may have a new address: look it up again next time
        return None
    writer.close()
    return round((time.perf_counter() - start) * 1000, 1)


def uns_signal(live: Live, topic: str, max_age_s: float | None, now: float) -> dict[str, Any] | None:
    entry = live.last(topic)
    if entry is None:
        return None
    payload = entry.payload
    value = payload.get("value", payload.get("gateway")) if isinstance(payload, dict) else payload
    age = now - entry.received
    if max_age_s is not None:
        ok = age <= max_age_s
    else:
        ok = value in ("online", "ok") or (isinstance(payload, dict) and payload.get("state") == "connected")
    return {"topic": topic, "valor": value, "edad_s": round(age, 1), "ok": ok}


async def check(service: dict[str, Any], live: Live, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    name = service["nombre"]
    ips, tcp_ms = await asyncio.gather(
        resolve(name if name != "console" else socket.gethostname()),
        connect(service["tcp"]) if service.get("tcp") else asyncio.sleep(0, result=None),
    )
    signal = uns_signal(live, service["uns"], service.get("max_age_s"), now) if service.get("uns") else None
    checks = []
    if service.get("tcp"):
        checks.append(tcp_ms is not None)
    if signal is not None:
        checks.append(signal["ok"])
    elif service.get("uns"):
        checks.append(False)
    state = (
        "sin-datos" if not checks else "ok" if all(checks) else "caido" if not any(checks) else "degradado"
    )
    return {
        "nombre": name,
        "imagen": service.get("imagen", ""),
        "redes": service.get("redes", []),
        "puertos": service.get("puertos", []),
        "ips": ips,
        "visible": bool(ips),
        "tcp_ms": tcp_ms,
        "tcp": service.get("tcp"),
        "senal": signal,
        "estado": state,
    }


async def check_all(services: list[dict[str, Any]], live: Live) -> list[dict[str, Any]]:
    now = time.time()
    return list(await asyncio.gather(*(check(s, live, now) for s in services)))
