// Configuración de la lengua de señas.
// Todo lo que depende del idioma vive aquí, para que en el futuro
// se pueda agregar ASL (u otra lengua) sin tocar el resto de la app.

export interface SignLanguageConfig {
  /** Identificador corto, se usa al guardar datos en IndexedDB y al exportar. */
  id: string;
  /** Nombre que ve el usuario. */
  name: string;
  /** Idioma para reconocimiento y síntesis de voz (Web Speech API). */
  speechLocale: string;
  /** Alfabeto manual, en el orden en que se muestra. */
  alphabet: string[];
  /** Letras que llevan movimiento (se reconocen con DTW, no con k-NN). */
  dynamicLetters: string[];
  /**
   * Paquete oficial de señas que viene incluido con la app (en public/).
   * Se instala la primera vez que se abre la app, o si este número de versión es
   * más nuevo que el guardado. Después, la Fase 6 lo actualizará desde Google Drive.
   */
  bundledPackage?: { file: string; version: number };
}

export const LSM: SignLanguageConfig = {
  id: 'lsm',
  name: 'Lengua de Señas Mexicana (LSM)',
  speechLocale: 'es-MX',
  alphabet: [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LL', 'M', 'N', 'Ñ',
    'O', 'P', 'Q', 'R', 'RR', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  ],
  dynamicLetters: ['J', 'K', 'Ñ', 'Q', 'X', 'Z', 'LL', 'RR'],
  bundledPackage: { file: 'signs/lsm-senas-v1.json', version: 1 },
};

// Lenguas disponibles. Para agregar ASL: crear su objeto y añadirlo aquí.
export const LANGUAGES: Record<string, SignLanguageConfig> = {
  lsm: LSM,
};

// Lengua activa de la app.
export const currentLanguage: SignLanguageConfig = LSM;
