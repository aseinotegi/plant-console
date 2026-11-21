// The way in: how the plant is built and the plant itself, side by side, and one live
// number per application, each a door to its page.

import { useState } from "react";
import { Badge, Card } from "../components/bits";
import { DisturbanceButton } from "../components/Disturbance";
import { PlantMap } from "../components/PlantMap";
import { dec, show } from "../format";
import { payloadOf, useLive } from "../live";
import { usePlant } from "../plant";
import { T } from "../topics";
import { ArchDiagram, type Mode, ModeToggle, useServices } from "./ArchitecturePage";

export function HomePage() {
  const live = useLive();
  const plant = usePlant();
  const services = useServices();
  const [mode, setMode] = useState<Mode>("todo");
  const healthy = services.filter((s) => s.estado === "ok").length;

  const rules = [...live.topics.values()].filter((e) => e.topic.startsWith(T.rules));
  const active = rules.filter((r) => payloadOf(r).value === "activa").length;
  const pt104 = payloadOf(live.get(T.pt104)).value;
  const vision = payloadOf(live.inspections[live.inspections.length - 1]);
  const topics = [...live.topics.keys()].filter((t) => !t.startsWith("$SYS")).length;
  const historian = payloadOf(live.get(`${T.services}historian`)).value;

  const tiles = [
    { path: "plc", label: "PLC", value: typeof pt104 === "number" ? `${dec(pt104, 1)} bar` : "—" },
    {
      path: "vision",
      label: "Visión",
      value: vision.value === undefined ? "—" : `${show(vision.value)}${typeof vision.confidence === "number" ? ` · ${dec(vision.confidence * 100, 0)} %` : ""}`,
    },
    { path: "reglas", label: "Reglas", value: active ? `${active} alarma${active > 1 ? "s" : ""}` : "sin alarmas", bad: active > 0 },
    { path: "uns", label: "UNS", value: `${topics} topics` },
    { path: "mqtt", label: "MQTT en vivo", value: `${live.rate} msg/s` },
    { path: "historico", label: "Histórico", value: historian === undefined ? "—" : show(historian) },
  ];

  return (
    <div className="home-page">
      <Card
        className="home-arch"
        tour="arquitectura"
        title={<a href="#/arquitectura">Arquitectura</a>}
        aside={
          <>
            <ModeToggle mode={mode} onChange={setMode} />
            <Badge tone={healthy === services.length && services.length ? "ok" : "warn"}>
              {healthy}/{services.length}
            </Badge>
          </>
        }
      >
        <ArchDiagram services={services} mode={mode} />
      </Card>

      <Card className="home-plant" tour="mapa" title={<a href="#/planta">{plant?.nombre ?? "Planta"}</a>} aside={<DisturbanceButton />}>
        {plant ? <PlantMap plant={plant} selected={null} onSelect={() => (location.hash = "#/planta")} /> : <p className="muted pad">…</p>}
      </Card>

      <nav className="home-tiles" data-tour="apps" aria-label="Aplicaciones">
        {tiles.map((t) => (
          <a key={t.path} href={`#/${t.path}`} className={`app-tile ${t.bad ? "bad" : ""}`}>
            <span className="app-value">{t.value}</span>
            <span className="app-label">{t.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
