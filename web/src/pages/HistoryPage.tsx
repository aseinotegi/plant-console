import { useLive } from "../live";

/** Grafana, with the history from TimescaleDB, inside the console. */
export function HistoryPage() {
  const live = useLive();
  const base = live.grafanaUrl;
  const url = `${base}/d/linea-104?orgId=1&kiosk&theme=dark&refresh=10s&from=now-30m&to=now`;
  return (
    <div className="history-page">
      <header className="panel-head row-between">
        <div>
          <h1>Histórico</h1>
          <p className="muted">
            El historiador guarda cada valor del UNS en TimescaleDB y Grafana lo dibuja. Grafana lee con un usuario de base de datos que solo puede consultar: un panel nunca puede cambiar el histórico.
          </p>
        </div>
        <a className="btn" href={`${base}/d/linea-104`} target="_blank" rel="noreferrer">
          Abrir en Grafana
        </a>
      </header>
      {base ? <iframe className="grafana" src={url} title="Panel de Grafana de la línea 104" /> : <p className="muted">Buscando Grafana…</p>}
    </div>
  );
}
