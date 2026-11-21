"""Showroom mode: the console open to anyone on the internet.

A visitor sees everything, but cannot change the plant's logic, and the few things
it can trigger are rationed so nobody can break the demo or spend its model quota:

* rules are read-only and the security probes are off;
* the disturbance button has a global cooldown and a limit per visitor;
* vision trials have a limit per visitor and a global one, run one at a time, and a
  catalog photo already analyzed is answered from memory; new images are off unless
  enabled;
* request bodies are capped, the API docs are off and the browser gets a strict CSP.

Visitors are told apart by the address Cloudflare reports (``CF-Connecting-IP``), an
IPv6 address by its /64 (one home gets a whole /64). That header is only trustworthy
because, in showroom mode, the console has no published port: the tunnel is the only
way in.
"""

from __future__ import annotations

import ipaddress
import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import Request

SWEEP_AT = 10_000  # visitors remembered before forgetting the idle ones


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "si", "sí", "on")


@dataclass
class Limiter:
    """At most ``per_visitor`` uses per ``window_s`` for each visitor, ``overall`` uses
    per ``window_s`` among all of them, and ``cooldown_s`` between any two uses. Zero
    means no limit."""

    per_visitor: int = 0
    window_s: float = 3600.0
    cooldown_s: float = 0.0
    overall: int = 0
    clock: Callable[[], float] = time.monotonic
    _uses: dict[str, deque[float]] = field(default_factory=lambda: defaultdict(deque))
    _all: deque[float] = field(default_factory=deque)
    _last: float | None = None

    def _expire(self, uses: deque[float], now: float) -> None:
        while uses and uses[0] <= now - self.window_s:
            uses.popleft()

    def wait(self, visitor: str) -> float:
        """Seconds this visitor has to wait. When it is zero the use is counted."""
        now = self.clock()
        waits = []
        if self.cooldown_s and self._last is not None:
            waits.append(self._last + self.cooldown_s - now)
        if self.overall:
            self._expire(self._all, now)
            if len(self._all) >= self.overall:
                waits.append(self._all[0] + self.window_s - now)
        if self.per_visitor:
            if len(self._uses) > SWEEP_AT:
                self._sweep(now)
            uses = self._uses[visitor]
            self._expire(uses, now)
            if len(uses) >= self.per_visitor:
                waits.append(uses[0] + self.window_s - now)
        wait = max([0.0, *waits])
        if wait <= 0:
            self._last = now
            if self.overall:
                self._all.append(now)
            if self.per_visitor:
                self._uses[visitor].append(now)
        return round(wait, 1)

    def _sweep(self, now: float) -> None:
        for key in list(self._uses):
            self._expire(self._uses[key], now)
            if not self._uses[key]:
                del self._uses[key]


@dataclass
class Memo:
    """Answers kept for ``ttl_s`` seconds, so the same question does not cost twice."""

    ttl_s: float = 0.0
    clock: Callable[[], float] = time.monotonic
    _items: dict[Any, tuple[float, Any]] = field(default_factory=dict)

    def get(self, key: Any) -> Any | None:
        item = self._items.get(key)
        if item is None or self.clock() - item[0] > self.ttl_s:
            self._items.pop(key, None)
            return None
        return item[1]

    def put(self, key: Any, value: Any) -> None:
        if self.ttl_s > 0:
            self._items[key] = (self.clock(), value)


def visitor(request: Request) -> str:
    raw = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    try:
        address = ipaddress.ip_address(raw.strip())
    except ValueError:
        return raw
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def security_headers(grafana_url: str) -> dict[str, str]:
    """What the browser is told about the page: nothing from elsewhere but Grafana's
    frames, and only andersein.com may show the console inside its own pages."""
    frames = grafana_url.rstrip("/") if grafana_url.startswith("https://") else "'none'"
    csp = "; ".join(
        [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            f"frame-src {frames}",
            "frame-ancestors 'self' https://andersein.com https://www.andersein.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ]
    )
    return {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    }
