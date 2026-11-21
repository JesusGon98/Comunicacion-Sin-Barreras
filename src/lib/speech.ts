// Reconocimiento de voz (voz → texto) y síntesis de voz (texto → voz)
// usando la Web Speech API del navegador.
//
// Nota: en Chrome y Edge el reconocimiento de voz se procesa en servidores de
// Google/Microsoft, por eso necesita internet. La síntesis de voz suele
// funcionar sin conexión.

// ---------- Tipos mínimos ----------
// TypeScript no siempre incluye los tipos de SpeechRecognition, así que
// declaramos solo lo que usamos.

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** ¿El navegador puede convertir voz a texto? (Firefox y algunos iPhone, no). */
export function isRecognitionSupported(): boolean {
  return getRecognitionCtor() !== undefined;
}

/** ¿El navegador puede leer texto en voz alta? */
export function isSynthesisSupported(): boolean {
  return 'speechSynthesis' in window;
}

// ---------- Reconocimiento de voz ----------

export type RecognitionErrorCode =
  | 'permiso' // la persona (o el navegador) negó el micrófono
  | 'politica' // el servidor bloquea el micrófono con la cabecera Permissions-Policy
  | 'inseguro' // la página no está en https
  | 'servicio' // el navegador no tiene servicio de reconocimiento de voz (Brave, Chromium, iPhone sin Siri…)
  | 'sin-red'
  | 'sin-microfono'
  | 'otro';

/**
 * ¿La página tiene permitido usar el micrófono?
 * Un servidor puede bloquearlo con la cabecera "Permissions-Policy: microphone=()"
 * aunque la página esté en https. En ese caso el navegador ni siquiera pregunta.
 */
function microphoneAllowedByPolicy(): boolean {
  const d = document as unknown as {
    permissionsPolicy?: { allowsFeature(f: string): boolean };
    featurePolicy?: { allowsFeature(f: string): boolean };
  };
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  try {
    return policy ? policy.allowsFeature('microphone') : true;
  } catch {
    return true;
  }
}

export interface RecognizerOptions {
  lang: string;
  /** Texto provisional mientras la persona sigue hablando. */
  onInterim: (text: string) => void;
  /** Frase terminada. */
  onFinal: (text: string) => void;
  /** "detail" es el código original del navegador (sirve para diagnosticar). */
  onError: (code: RecognitionErrorCode, detail?: string) => void;
  /** Avisa cuando empieza o deja de escuchar. */
  onListeningChange: (listening: boolean) => void;
}

export interface Recognizer {
  start(): void;
  stop(): void;
}

export function createRecognizer(opts: RecognizerOptions): Recognizer {
  const Ctor = getRecognitionCtor();
  if (!Ctor) throw new Error('Reconocimiento de voz no soportado');

  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.interimResults = true;
  // En Android el modo continuo repite frases; ahí usamos frases sueltas
  // y reiniciamos automáticamente (ver onend).
  rec.continuous = !/Android/i.test(navigator.userAgent);

  // "wanted" = el usuario quiere que siga escuchando.
  // El navegador corta solo tras unos segundos de silencio; si wanted es true, reiniciamos.
  let wanted = false;
  let running = false;

  rec.onstart = () => {
    running = true;
    opts.onListeningChange(true);
  };

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;
      if (result.isFinal) opts.onFinal(text);
      else interim += text + ' ';
    }
    opts.onInterim(interim.trim());
  };

  rec.onerror = (e) => {
    console.warn('[voz] error del reconocimiento:', e.error);
    switch (e.error) {
      case 'no-speech':
      case 'aborted':
        return; // silencio o parada normal: no es un error real
      case 'not-allowed':
        wanted = false;
        // Distinguimos por qué: servidor que bloquea, página sin https o permiso negado
        if (!window.isSecureContext) opts.onError('inseguro', e.error);
        else if (!microphoneAllowedByPolicy()) opts.onError('politica', e.error);
        else opts.onError('permiso', e.error);
        return;
      case 'service-not-allowed':
        wanted = false;
        opts.onError('servicio', e.error);
        return;
      case 'network':
        wanted = false;
        opts.onError('sin-red');
        return;
      case 'audio-capture':
        wanted = false;
        opts.onError('sin-microfono');
        return;
      default:
        opts.onError('otro', e.error);
    }
  };

  rec.onend = () => {
    running = false;
    opts.onInterim('');
    if (wanted) {
      // Reinicio automático tras una pausa corta
      setTimeout(() => {
        if (wanted && !running) {
          try {
            rec.start();
          } catch {
            /* ya estaba iniciado */
          }
        }
      }, 250);
    } else {
      opts.onListeningChange(false);
    }
  };

  return {
    start() {
      // Revisamos antes de empezar: así el mensaje explica la causa real
      if (!window.isSecureContext) return opts.onError('inseguro');
      if (!microphoneAllowedByPolicy()) return opts.onError('politica');
      wanted = true;
      if (!running) {
        try {
          rec.start();
        } catch {
          /* ya estaba iniciado */
        }
      }
    },
    stop() {
      wanted = false;
      rec.stop();
    },
  };
}

// ---------- Síntesis de voz ----------

/** Elige la mejor voz disponible para el idioma (p. ej. es-MX, si no, cualquier español). */
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const base = lang.split('-')[0];
  return (
    voices.find((v) => v.lang.replace('_', '-') === lang) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(base))
  );
}

// Algunos navegadores cargan las voces después; pedirlas temprano ayuda.
if (isSynthesisSupported()) speechSynthesis.getVoices();

export interface SpeakOptions {
  lang: string;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
}

/** Lee un texto en voz alta. Cancela cualquier lectura anterior. */
export function speak(text: string, opts: SpeakOptions): void {
  if (!isSynthesisSupported() || !text.trim()) {
    opts.onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.lang;
  u.rate = opts.rate ?? 1;
  const voice = pickVoice(opts.lang);
  if (voice) u.voice = voice;
  u.onstart = () => opts.onStart?.();
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (isSynthesisSupported()) speechSynthesis.cancel();
}

/** Vibración corta como aviso (si el dispositivo lo permite). */
export function vibrate(pattern: number | number[] = 80): void {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}
