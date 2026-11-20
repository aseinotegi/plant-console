// The plant's tags, as named on the P&ID. The console is the HMI of this plant, so it
// knows them, like any HMI knows its tag list. Everything else comes from the UNS.

export const SITE = "planta1";
export const ROBOT = "robot-01";

export const T = {
  pose: `${SITE}/robots/${ROBOT}/posicion`,
  photo: `${SITE}/robots/${ROBOT}/foto`,
  mission: `${SITE}/robots/${ROBOT}/mision`,
  pi104: `${SITE}/exterior/pi-104/presion`,
  pi104Inspection: `${SITE}/exterior/pi-104/presion/inspeccion`,
  pt104: `${SITE}/exterior/pt-104/presion`,
  pt104Alarm: `${SITE}/exterior/pt-104/alarma-alta`,
  xv104: `${SITE}/exterior/xv-104/estado`,
  xv104Order: `${SITE}/exterior/xv-104/orden`,
  ext12: `${SITE}/exterior/ext-12/estado`,
  ext12Inspection: `${SITE}/exterior/ext-12/estado/inspeccion`,
  rules: `${SITE}/exterior/reglas/`,
  rulesConfig: `${SITE}/servicios/rules/config`,
  services: `${SITE}/servicios/`,
} as const;

// Thresholds of the overpressure rule, drawn on the trends (the rule itself lives in
// the rules file: these are only the lines on the chart).
export const HIGH_BAR = 6.0;
export const CLEAR_BAR = 5.5;
