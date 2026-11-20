"""Edits the rules file of the rules engine, with the engine as the only judge.

The console does not validate rules itself (that would be a second copy of the
engine's logic that drifts). It writes the file, the engine reloads it and says on
``<site>/servicios/rules/config`` whether it took it. If the engine refuses it, the
console puts the previous file back, so a broken file never stays on disk to break
the next start.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from pathlib import Path

import yaml

from .live import Live


class RulesRejected(ValueError):
    pass


@dataclass
class Saved:
    confirmed: bool  # False: written, but the engine did not answer in time
    detail: str


class RulesFile:
    def __init__(self, path: str | Path, live: Live, status_topic: str, wait_s: float = 6.0) -> None:
        self.path = Path(path)
        self._live = live
        self._status_topic = status_topic
        self._wait_s = wait_s
        self._lock = asyncio.Lock()

    def read(self) -> str:
        return self.path.read_text(encoding="utf-8")

    async def save(self, text: str) -> Saved:
        # Only what can be checked without knowing the rules: that it is YAML with rules.
        try:
            data = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise RulesRejected(f"el YAML no se puede leer: {exc}") from exc
        rules = data.get("rules") if isinstance(data, dict) else data
        if not isinstance(rules, list):
            raise RulesRejected("el fichero tiene que tener una lista 'rules'")

        async with self._lock:
            previous = self.read()
            if text == previous:
                return Saved(True, "sin cambios")
            written_at = time.time()
            self._write(text)
            answer = await self._engine_answer(after=written_at)
            if answer is None:
                return Saved(False, "guardado, pero el motor de reglas no ha confirmado")
            state, detail = answer
            if state == "error":
                self._write(previous)
                raise RulesRejected(detail)
            return Saved(True, detail)

    def _write(self, text: str) -> None:
        # In place, not write-and-rename: the file is usually a bind mount of its own,
        # and a rename over a bind mount fails.
        with self.path.open("w", encoding="utf-8") as f:
            f.write(text)

    async def _engine_answer(self, after: float) -> tuple[str, str] | None:
        deadline = time.monotonic() + self._wait_s
        while time.monotonic() < deadline:
            entry = self._live.last(self._status_topic)
            if entry and entry.received >= after and isinstance(entry.payload, dict):
                state = entry.payload.get("value")
                if state in ("recargadas", "cargadas", "error"):
                    return state, str(entry.payload.get("detail", ""))
            await asyncio.sleep(0.2)
        return None
