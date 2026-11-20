import { useLive } from "../live";

/** Grafana, with the history from TimescaleDB, inside the console. */
export function HistoryPage() {
  const live = useLive();
  const base = live.grafanaUrl;
  if (!base) return null;
  return (
    <div className="history-page">
      <iframe
        className="grafana"
        src={`${base}/d/linea-104?orgId=1&kiosk&theme=dark&refresh=10s&from=now-30m&to=now`}
        title="Histórico en Grafana"
      />
      <a className="grafana-link" href={`${base}/d/linea-104`} target="_blank" rel="noreferrer">
        Abrir en Grafana
      </a>
    </div>
  );
}
