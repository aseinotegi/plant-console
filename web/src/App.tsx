import { useEffect, useState } from "react";
import { Dot } from "./components/bits";
import { useLive } from "./live";
import { ArchitecturePage } from "./pages/ArchitecturePage";
import { HistoryPage } from "./pages/HistoryPage";
import { MqttPage } from "./pages/MqttPage";
import { PlcPage } from "./pages/PlcPage";
import { RobotPage } from "./pages/RobotPage";
import { RulesPage } from "./pages/RulesPage";
import { SecurityPage } from "./pages/SecurityPage";
import { UnsPage } from "./pages/UnsPage";
import { VisionPage } from "./pages/VisionPage";

const PAGES = [
  { path: "", label: "Planta", page: RobotPage },
  { path: "plc", label: "PLC", page: PlcPage },
  { path: "vision", label: "Visión", page: VisionPage },
  { path: "reglas", label: "Reglas", page: RulesPage },
  { path: "uns", label: "UNS", page: UnsPage },
  { path: "mqtt", label: "MQTT en vivo", page: MqttPage },
  { path: "historico", label: "Histórico", page: HistoryPage },
  { path: "arquitectura", label: "Arquitectura", page: ArchitecturePage },
];

// Not in the menu for now, still reachable at #/ciber
const HIDDEN = [{ path: "ciber", label: "Ciberseguridad", page: SecurityPage }];

function useRoute(): string {
  const read = () => location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const live = useLive();
  const current = [...PAGES, ...HIDDEN].find((p) => p.path === route) ?? PAGES[0];
  const Page = current.page;
  return (
    <>
      <header className="top">
        <a className="brand" href="#/" aria-label="Inicio" title="Inicio">
          <svg viewBox="0 0 32 32" aria-hidden className="logo">
            <rect x="7" y="11" width="18" height="11" rx="3" />
            <circle cx="21" cy="16.5" r="2" />
            <path d="M11 25v-3M21 25v-3" />
          </svg>
        </a>
        <nav>
          {PAGES.map((p) => (
            <a key={p.path} href={`#/${p.path}`} className={p === current ? "active" : ""} aria-current={p === current ? "page" : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="status">
          <Dot on={live.socket} label="Consola" />
          <Dot on={live.socket && live.broker} label="Broker" />
        </div>
      </header>
      <main>
        <Page />
      </main>
    </>
  );
}
