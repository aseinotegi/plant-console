import asyncio
import json
import socket
import time

from plant_console.live import Live
from plant_console.services import check, check_all, connect, load_services, uns_signal


def run(coro):
    return asyncio.run(coro)


def test_a_service_seen_on_the_uns_is_ok_and_one_that_died_is_down():
    live = Live(clock=lambda: 100.0)
    live.add("planta1/servicios/rules", json.dumps({"value": "online"}).encode(), retained=True)
    live.add("planta1/servicios/historian", json.dumps({"value": "offline"}).encode(), retained=True)
    ok = run(check({"nombre": "rules", "uns": "planta1/servicios/rules"}, live, now=101))
    down = run(check({"nombre": "historian", "uns": "planta1/servicios/historian"}, live, now=101))
    assert ok["estado"] == "ok" and down["estado"] == "caido"


def test_a_value_that_must_stay_fresh_goes_stale():
    live = Live(clock=lambda: 100.0)
    live.add("planta1/simulacion/escenario", json.dumps({"value": 3.0}).encode())
    assert uns_signal(live, "planta1/simulacion/escenario", 10, now=105)["ok"] is True
    assert uns_signal(live, "planta1/simulacion/escenario", 10, now=130)["ok"] is False


def test_a_service_on_another_network_does_not_resolve():
    result = run(check({"nombre": "nadie-en-esta-red.invalid"}, Live()))
    assert result["visible"] is False and result["ips"] == [] and result["estado"] == "sin-datos"


def test_tcp_check_measures_or_fails():
    async def scenario():
        server = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        open_ms = await connect(f"127.0.0.1:{port}")
        server.close()
        closed = await connect("127.0.0.1:1", timeout=0.5)
        return open_ms, closed

    open_ms, closed = run(scenario())
    assert open_ms is not None and closed is None


def test_slow_names_on_other_networks_do_not_make_a_reachable_service_look_down(monkeypatch):
    """Names that take seconds to fail (Docker asks the host's DNS) used to hold the
    lookups of reachable services past the TCP timeout: Grafana and the console looked down."""
    from plant_console import services

    real = socket.getaddrinfo
    calls: list[str] = []

    def getaddrinfo(host, *args, **kwargs):
        calls.append(host)
        if host.endswith(".lento"):
            time.sleep(1.5)
            raise socket.gaierror("not on this network")
        return real(host, *args, **kwargs)

    monkeypatch.setattr(services.socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(services, "_dns_cache", {})

    async def scenario():
        server = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        catalog = [{"nombre": f"s{i}.lento"} for i in range(8)]
        catalog.append({"nombre": "web", "tcp": f"localhost:{port}"})
        first = await check_all(catalog, Live())
        again = await check_all(catalog, Live())
        server.close()
        return first, again

    first, again = run(scenario())
    assert first[-1]["tcp_ms"] is not None and first[-1]["estado"] == "ok"
    assert again[-1]["estado"] == "ok"
    assert calls.count("s0.lento") == 1  # remembered: the next poll does not wait again


def test_catalog_file(tmp_path):
    path = tmp_path / "servicios.yaml"
    path.write_text("- { nombre: broker, tcp: 'broker:1883' }\n- otra cosa\n")
    assert load_services(path) == [{"nombre": "broker", "tcp": "broker:1883"}]
    assert load_services(None) == []
