import { useEffect, useState } from "react";

export type Point = [number, number];

export interface Plant {
  nombre: string;
  ancho: number;
  alto: number;
  zonas: { id: string; nombre: string; x: number; y: number; ancho: number; alto: number }[];
  tuberias: { id: string; desde: Point; hasta: Point }[];
  equipos: { id: string; tipo: string; x: number; y: number; nombre: string; cable?: string }[];
  ruta: Point[];
  paradas: { punto: Point; accion: string; equipo: string }[];
}

let cached: Promise<Plant> | null = null;

/** The plant map, from the same file the robot walks (config/planta.yaml). */
export function usePlant(): Plant | null {
  const [plant, setPlant] = useState<Plant | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      cached ??= fetch("/api/planta").then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
      cached.then(
        (p) => alive && setPlant(p),
        () => {
          cached = null;
          if (alive) setTimeout(load, 3000); // the world may still be starting
        },
      );
    };
    load();
    return () => {
      alive = false;
    };
  }, []);
  return plant;
}
