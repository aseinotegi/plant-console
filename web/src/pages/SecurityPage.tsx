// What protects this demo, mapped to IEC 62443-3-3 system requirements, and two
// checks that try what must fail, live, against the real broker and rules engine.

import { useState } from "react";
import { Badge, Card } from "../components/bits";

interface Control {
  sr: string;
  title: string;
  how: string;
  done: boolean;
}

const CONTROLS: Control[] = [
  {
    sr: "SR 5.1",
    title: "Segmentación de red",
    how: "Cuatro redes de Docker como zonas: campo, uns, datos y publica. El PLC solo está en campo; para llegar a él hay que pasar por la pasarela.",
    done: true,
  },
  {
    sr: "SR 5.2",
    title: "Frontera de zona",
    how: "Campo y datos son redes internas, sin salida a internet. Solo se publican la consola (8000) y Grafana (3000); el broker, solo en localhost.",
    done: true,
  },
  {
    sr: "SR 1.2",
    title: "Cada servicio se identifica",
    how: "Sin acceso anónimo al broker. Cada servicio entra con su usuario; las contraseñas se guardan con hash dentro del broker.",
    done: true,
  },
  {
    sr: "SR 2.1",
    title: "Mínimo privilegio en el UNS",
    how: "Una ACL por usuario: cada servicio solo escribe sus temas. La consola solo puede leer, más dos peticiones: reglas nuevas y el botón de la demo.",
    done: true,
  },
  {
    sr: "SR 3.5",
    title: "Validación de lo que entra",
    how: "El motor de reglas valida cada regla antes de aplicarla y solo admite órdenes de una lista blanca que no se puede tocar desde la consola.",
    done: true,
  },
  {
    sr: "SR 7.7",
    title: "Lo mínimo para funcionar",
    how: "Contenedores sin capacidades de Linux, sin escalada de privilegios y con el sistema de ficheros en solo lectura. La pasarela del PLC no sabe escribir.",
    done: true,
  },
  {
    sr: "SR 2.1",
    title: "El histórico no se toca desde fuera",
    how: "Grafana consulta con un usuario de base de datos que solo puede leer. El único que escribe es el historiador.",
    done: true,
  },
  {
    sr: "SR 4.1",
    title: "Cifrado de las comunicaciones",
    how: "MQTT con TLS y HTTPS delante de la consola. En local no aporta; en el servidor público, con Caddy y certificados.",
    done: false,
  },
  {
    sr: "SR 1.5",
    title: "Gestión de secretos",
    how: "Las contraseñas de esta demo están en el repositorio para que arranque con un comando. En el servidor irán como secretos, fuera del código.",
    done: false,
  },
  {
    sr: "SR 6.1",
    title: "Registro de auditoría",
    how: "El broker ya registra quién se conecta y quién es rechazado. Falta llevar esos registros a un sitio donde se puedan revisar y alertar.",
    done: false,
  },
];

const CHECKS = [
  {
    id: "orden-desde-consola",
    title: "La consola intenta dar una orden a la planta",
    what: "Publica «cerrar XV-104» con su propio usuario MQTT. Si la ACL funciona, el broker la descarta y no llega a nadie.",
  },
  {
    id: "regla-que-abre",
    title: "Alguien propone una regla que abre la válvula",
    what: "Envía al motor una regla cuya orden es «abrir XV-104», que no está en la lista blanca. El motor debe rechazarla entera.",
  },
];

export function SecurityPage() {
  const done = CONTROLS.filter((c) => c.done).length;
  return (
    <div className="security-page">
      <header className="panel-head">
        <h1>Ciberseguridad</h1>
        <p className="muted">
          Una planta conectada es una planta expuesta. Esta demo aplica lo básico de IEC 62443 a escala de portátil: zonas separadas, cada servicio con su identidad y sus permisos justos, y nada que la web pueda mandar a los equipos. {done} de {CONTROLS.length} controles hechos; los que faltan son los del servidor público.
        </p>
      </header>

      <section className="checks">
        {CHECKS.map((c) => (
          <LiveCheck key={c.id} {...c} />
        ))}
      </section>

      <div className="controls">
        {CONTROLS.map((c) => (
          <article key={c.title} className={`control ${c.done ? "done" : "todo"}`}>
            <header>
              <span className="sr">{c.sr}</span>
              <h3>{c.title}</h3>
              <Badge tone={c.done ? "ok" : "warn"}>{c.done ? "Hecho" : "Para el servidor"}</Badge>
            </header>
            <p>{c.how}</p>
          </article>
        ))}
      </div>
      <p className="muted small">
        SR: requisito de sistema de IEC 62443-3-3. Los detalles están en config/mosquitto/acl y en docker-compose.yml del repositorio industrial-uns-demo.
      </p>
    </div>
  );
}

function LiveCheck({ id, title, what }: { id: string; title: string; what: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setState(null);
    try {
      const r = await fetch(`/api/ciber/${id}`, { method: "POST" });
      const body = await r.json();
      setState({ ok: body.ok === true, text: body.detalle ?? "sin detalle" });
    } catch {
      setState({ ok: false, text: "La consola no responde." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="check-card" title={title}>
      <p>{what}</p>
      <div className="actions">
        <button className="btn primary" onClick={run} disabled={busy}>
          {busy ? "Probando…" : "Probar ahora"}
        </button>
        {state && <p className={`result ${state.ok ? "ok" : "bad"}`}>{state.ok ? `Bloqueado: ${state.text}` : state.text}</p>}
      </div>
    </Card>
  );
}
