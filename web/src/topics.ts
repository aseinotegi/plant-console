// The plant's tags, as named on the P&ID. The console is the HMI of this plant, so it
// knows the ones it draws specially, like any HMI knows its tag list. Everything else
// (the rule builder's variables, the UNS tree) comes from the UNS itself.

export const SITE = "planta1";
export const ROBOT = "robot-01";

export const T = {
  pose: `${SITE}/robots/${ROBOT}/posicion`,
  photo: `${SITE}/robots/${ROBOT}/foto`,
  mission: `${SITE}/robots/${ROBOT}/mision`,
  pi104: `${SITE}/exterior/pi-104/presion`,
  pt104: `${SITE}/exterior/pt-104/presion`,
  pt104Alarm: `${SITE}/exterior/pt-104/alarma-alta`,
  ft104: `${SITE}/exterior/ft-104/caudal`,
  tt104: `${SITE}/exterior/tt-104/temperatura`,
  lt101: `${SITE}/tanques/lt-101/nivel`,
  lt101Alarm: `${SITE}/tanques/lt-101/alarma-alta`,
  p104Run: `${SITE}/tanques/p-104/marcha`,
  p104Current: `${SITE}/tanques/p-104/corriente`,
  p104Starts: `${SITE}/tanques/p-104/arranques`,
  xv104: `${SITE}/exterior/xv-104/estado`,
  xv104Order: `${SITE}/exterior/xv-104/orden`,
  rules: `${SITE}/reglas/`,
  rulesConfig: `${SITE}/servicios/rules/config`,
  services: `${SITE}/servicios/`,
  scenario: `${SITE}/simulacion/escenario`,
  simulation: `${SITE}/simulacion/`,
} as const;

/** DB1 of PLC-1, as the gateway reads it (config/plc-gateway.yaml of the demo). */
export const DB1 = [
  { address: "DB1.DBD0", type: "REAL", tag: "PT-104", name: "Presión de línea", topic: T.pt104 },
  { address: "DB1.DBX4.0", type: "BOOL", tag: "PT-104", name: "Alarma de alta presión", topic: T.pt104Alarm },
  { address: "DB1.DBX4.1", type: "BOOL", tag: "P-104", name: "Bomba en marcha", topic: T.p104Run },
  { address: "DB1.DBX4.2", type: "BOOL", tag: "LT-101", name: "Alarma de nivel alto", topic: T.lt101Alarm },
  { address: "DB1.DBD6", type: "REAL", tag: "FT-104", name: "Caudal", topic: T.ft104 },
  { address: "DB1.DBD10", type: "REAL", tag: "TT-104", name: "Temperatura", topic: T.tt104 },
  { address: "DB1.DBD14", type: "REAL", tag: "LT-101", name: "Nivel del depósito", topic: T.lt101 },
  { address: "DB1.DBD18", type: "REAL", tag: "P-104", name: "Corriente del motor", topic: T.p104Current },
  { address: "DB1.DBW22", type: "INT", tag: "P-104", name: "Arranques", topic: T.p104Starts },
];

// Thresholds of the overpressure rule, drawn on the trends (the rule itself lives in
// the rules engine: these are only the lines on the chart).
export const HIGH_BAR = 6.0;
export const CLEAR_BAR = 5.5;
