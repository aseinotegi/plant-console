import { useEffect, useState } from "react";
import { Dot } from "./components/bits";
import { useLive } from "./live";
import { PlcPage } from "./pages/PlcPage";
import { RobotPage } from "./pages/RobotPage";
import { RulesPage } from "./pages/RulesPage";
import { UnsPage } from "./pages/UnsPage";
import { VisionPage } from "./pages/VisionPage";

const PAGES = [
  { path: "", label: "Robot", page: RobotPage },
  { path: "plc", label: "PLC", page: PlcPage },
  { path: "uns", label: "UNS", page: UnsPage },
  { path: "reglas", label: "Reglas", page: RulesPage },
  { path: "vision", label: "Visión", page: VisionPage },
];

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
  const current = PAGES.find((p) => p.path === route) ?? PAGES[0];
  const Page = current.page;
  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▣
          </span>
          Consola de planta
          <span className="muted"> · planta1</span>
        </div>
        <nav>
          {PAGES.map((p) => (
            <a key={p.path} href={`#/${p.path}`} className={p === current ? "active" : ""}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="status">
          <Dot on={live.socket} label="consola" />
          <Dot on={live.socket && live.broker} label="broker" />
        </div>
      </header>
      <main>
        <Page />
      </main>
    </>
  );
}
