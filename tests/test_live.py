import json

import pytest

from plant_console.live import Live, matches


def payload(value, **extra):
    return json.dumps({"value": value, **extra}).encode()


@pytest.mark.parametrize(
    ("pattern", "topic", "expected"),
    [
        ("planta1/robots/+/posicion", "planta1/robots/robot-01/posicion", True),
        ("planta1/robots/+/posicion", "planta1/robots/robot-01/foto", False),
        ("planta1/#", "planta1/exterior/pi-104/presion", True),
        ("planta1/exterior/pt-104/presion", "planta1/exterior/pt-104/presion/x", False),
    ],
)
def test_mqtt_wildcards(pattern, topic, expected):
    assert matches(pattern, topic) is expected


def test_last_value_per_topic_and_events_without_streams():
    now = [100.0]
    live = Live(streams=("planta1/robots/+/posicion",), clock=lambda: now[0])
    live.add("planta1/robots/robot-01/posicion", payload("en-ruta", x=1, y=2))
    live.add("planta1/exterior/reglas/r1", payload("activa"))
    live.add("planta1/exterior/reglas/r1", payload("normal"))
    snap = live.snapshot()
    assert snap["topics"]["planta1/exterior/reglas/r1"]["payload"]["value"] == "normal"
    assert [e["payload"]["value"] for e in snap["events"]] == ["activa", "normal"]


def test_retained_messages_are_state_not_events():
    live = Live()
    live.add("planta1/exterior/xv-104/estado", payload("abierta"), retained=True)
    assert live.snapshot()["events"] == []
    assert live.last("planta1/exterior/xv-104/estado").retained


def test_numeric_history_is_kept_for_a_window():
    now = [0.0]
    live = Live(history_s=60, clock=lambda: now[0])
    for t in range(0, 120, 10):
        now[0] = t
        live.add("planta1/exterior/pt-104/presion", payload(4.0 + t / 100))
    points = live.history("planta1/exterior/pt-104/presion", 1000)
    assert points[0][0] == 50 and points[-1] == (110, 5.1)
    assert live.history("planta1/exterior/pt-104/presion", 15) == [(100, 5.0), (110, 5.1)]


def test_retained_values_are_not_points_of_the_trend():
    live = Live()
    live.add("planta1/exterior/pt-104/presion", payload(6.8), retained=True)
    assert live.history("planta1/exterior/pt-104/presion", 60) == []


def test_booleans_and_text_are_not_trends():
    live = Live()
    live.add("planta1/exterior/pt-104/alarma-alta", payload(True))
    live.add("planta1/servicios/x", b"not json")
    assert list(live.history_topics()) == []
    assert live.last("planta1/servicios/x").payload == "not json"


def test_an_empty_retained_message_deletes_the_topic():
    live = Live()
    live.add("planta1/a", payload(1), retained=True)
    live.add("planta1/a", b"", retained=True)
    assert "planta1/a" not in live.snapshot()["topics"]


def test_an_inline_image_is_not_kept_nor_sent_to_browsers():
    live = Live()
    live.add("planta1/ensayos/vision/foto", payload("nueva-1", image_b64="A" * 4000, mime="image/png"))
    kept = live.last("planta1/ensayos/vision/foto").payload
    assert "image_b64" not in kept
    assert kept["image_b64_bytes"] == 3000 and kept["mime"] == "image/png"
    assert "AAAA" not in json.dumps(live.snapshot())
