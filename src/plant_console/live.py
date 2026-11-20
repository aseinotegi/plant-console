"""What the console knows about the plant right now, built only from the UNS.

Every message under the site lands here: the last one of each topic (the namespace
as it is), a short history of the numeric values (for the trends) and a log of the
events that matter (photos, inspections, rules, orders, missions). Position and the
fast PLC values are streams: they update the picture but stay out of the log.

The MQTT client runs in its own thread; the web side reads with ``snapshot()`` and
gets every new message through ``listen()``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
import time
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("live")


def matches(pattern: str, topic: str) -> bool:
    """MQTT wildcard match: ``+`` is one level, ``#`` is the rest."""
    p, t = pattern.split("/"), topic.split("/")
    for i, part in enumerate(p):
        if part == "#":
            return True
        if i >= len(t) or (part != "+" and part != t[i]):
            return False
    return len(p) == len(t)


@dataclass
class Entry:
    topic: str
    payload: Any  # the decoded JSON, or the raw text for messages that are not JSON
    retained: bool
    received: float  # wall clock of this console, not the publisher's

    def as_dict(self) -> dict[str, Any]:
        return {"topic": self.topic, "payload": self.payload, "retained": self.retained, "t": self.received}


def decode(raw: bytes) -> Any:
    text = raw.decode("utf-8", errors="replace")
    try:
        payload = json.loads(text)
    except ValueError:
        return text
    # An inline image (a vision trial) can be megabytes: it is not kept in memory nor
    # sent to every browser. Only its size stays, so the message still says it had one.
    if isinstance(payload, dict) and isinstance(payload.get("image_b64"), str):
        payload["image_b64_bytes"] = len(payload.pop("image_b64")) * 3 // 4
    return payload


@dataclass
class Live:
    streams: tuple[str, ...] = ()
    history_s: float = 900
    events_max: int = 400
    clock: Any = time.time
    topics: dict[str, Entry] = field(default_factory=dict)
    connected: bool = False

    def __post_init__(self) -> None:
        self._lock = threading.Lock()
        self._history: dict[str, deque[tuple[float, float]]] = {}
        self._events: deque[Entry] = deque(maxlen=self.events_max)
        self._listeners: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()

    # -- input (MQTT thread) ------------------------------------------------------

    def add(self, topic: str, raw: bytes, retained: bool = False) -> Entry | None:
        if not raw:  # an empty retained message deletes the topic
            with self._lock:
                self.topics.pop(topic, None)
            return None
        entry = Entry(topic, decode(raw), retained, self.clock())
        with self._lock:
            self.topics[topic] = entry
            value = entry.payload.get("value") if isinstance(entry.payload, dict) else None
            # A retained value is old state, not a point in time: only live values trend.
            if not retained and isinstance(value, (int, float)) and not isinstance(value, bool):
                series = self._history.setdefault(topic, deque())
                series.append((entry.received, float(value)))
                while series and series[0][0] < entry.received - self.history_s:
                    series.popleft()
            if not retained and not self.is_stream(topic):
                self._events.append(entry)
            listeners = list(self._listeners)
        for loop, q in listeners:
            loop.call_soon_threadsafe(_offer, q, entry)
        return entry

    def is_stream(self, topic: str) -> bool:
        return any(matches(p, topic) for p in self.streams)

    # -- output (web side) --------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "connected": self.connected,
                "topics": {t: e.as_dict() for t, e in sorted(self.topics.items())},
                "events": [e.as_dict() for e in self._events],
            }

    def history(self, topic: str, seconds: float) -> list[tuple[float, float]]:
        since = self.clock() - seconds
        with self._lock:
            return [p for p in self._history.get(topic, ()) if p[0] >= since]

    def last(self, topic: str) -> Entry | None:
        with self._lock:
            return self.topics.get(topic)

    def listen(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        with self._lock:
            self._listeners.add((asyncio.get_running_loop(), q))
        return q

    def forget(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._listeners = {item for item in self._listeners if item[1] is not q}

    def history_topics(self) -> Iterable[str]:
        with self._lock:
            return sorted(self._history)


def _offer(q: asyncio.Queue, entry: Entry) -> None:
    # A browser that cannot keep up loses messages, not the server its memory.
    if q.full():
        with contextlib.suppress(asyncio.QueueEmpty):
            q.get_nowait()
    q.put_nowait(entry)


def connect(
    live: Live,
    host: str,
    port: int,
    site: str,
    username: str | None = None,
    password: str | None = None,
    client_id: str = "plant-console",
):
    """Subscribes ``<site>/#`` (and the broker's ``$SYS`` statistics) and feeds ``live``.
    Returns the client, already looping. Its user can only read, plus the rule,
    disturbance and isolated vision-trial requests (see the broker's ACL)."""
    import paho.mqtt.client as mqtt

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    if username:
        client.username_pw_set(username, password)

    def on_connect(client, userdata, flags, reason_code, properties) -> None:
        live.connected = not reason_code.is_failure
        if live.connected:
            log.info("connected to %s:%d, subscribing %s/#", host, port, site)
            client.subscribe([(f"{site}/#", 0), ("$SYS/broker/#", 0)])

    def on_disconnect(client, userdata, flags, reason_code, properties) -> None:
        live.connected = False
        log.warning("disconnected from the broker (%s), retrying", reason_code)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = lambda c, u, msg: live.add(msg.topic, msg.payload, bool(msg.retain))
    client.reconnect_delay_set(1, 15)
    client.connect_async(host, port)
    client.loop_start()
    return client
