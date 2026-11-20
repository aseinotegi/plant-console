import { useEffect, useState } from "react";

export type Point = [number, number];

export interface Zone {
  id: string;
  nombre: string;
  tipo: "edificio" | "area" | "cubeto" | "vallado";
  x: number;
  y: number;
  ancho: number;
  alto: number;
  puertas?: Point[];
  rotulo?: Point; // where the name goes, when the top-left corner is taken
}

export interface Device {
  id: string;
  tipo: string;
  x: number;
  y: number;
  nombre: string;
  senal?: string;
  rango?: [number, number];
  unidad?: string;
  radio?: number;
  letras?: string;
  cable?: string;
}

export interface Plant {
  nombre: string;
  ancho: number;
  alto: number;
  zonas: Zone[];
  tuberias: { id: string; nombre?: string; linea: string; puntos: Point[] }[];
  equipos: Device[];
  ruta: Point[];
  paradas: { punto: Point; accion: "foto" | "valvula" | "carga"; equipo: string }[];
}

let cached: Promise<Plant> | null = null;

/** The plant map, from the robot: the same file it walks (config/planta.yaml). */
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
          if (alive) setTimeout(load, 3000); // the robot may still be starting
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
