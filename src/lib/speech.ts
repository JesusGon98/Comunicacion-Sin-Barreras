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

export type RecognitionErrorCode = 'permiso' | 'sin-red' | 'sin-microfono' | 'otro';

export interface RecognizerOptions {
  lang: string;
  /** Texto provisional mientras la persona sigue hablando. */
  onInterim: (text: string) => void;
  /** Frase terminada. */
  onFinal: (text: string) => void;
  onError: (code: RecognitionErrorCode) => void;
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
    switch (e.error) {
      case 'no-speech':
      case 'aborted':
        return; // silencio o parada normal: no es un error real
      case 'not-allowed':
      case 'service-not-allowed':
        wanted = false;
        opts.onError('permiso');
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
        opts.onError('otro');
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
