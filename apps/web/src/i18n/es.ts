export const es = {
  "common.brand": "BC Launcher Server",
  "common.close": "Cerrar",
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.loading": "Cargando…",
  "common.language": "Idioma",
  "common.unexpectedError": "Algo ha fallado. Inténtalo de nuevo.",
  "language.es": "Español",
  "language.en": "English",
} as const;

export type MessageKey = keyof typeof es;
export type Messages = Record<MessageKey, string>;
