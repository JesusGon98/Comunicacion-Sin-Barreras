import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { currentLanguage } from '../../config/language';
import {
  createRecognizer,
  isRecognitionSupported,
  isSynthesisSupported,
  speak,
  stopSpeaking,
  vibrate,
  type RecognitionErrorCode,
  type Recognizer,
} from '../../lib/speech';
import {
  addHistory,
  clearHistory,
  getHistory,
  getQuickPhrases,
  saveQuickPhrases,
  type HistoryEntry,
  type Speaker,
} from '../../lib/db';
import { MicIcon, SpeakerIcon } from '../../app/icons';
import { QuickPhrases } from './QuickPhrases';
import { ShowOverlay } from './ShowOverlay';
import { History } from './History';

// Mensajes de error que ve el usuario, en lenguaje sencillo.
const ERROR_MESSAGES: Record<RecognitionErrorCode, string> = {
  permiso: 'No hay permiso para usar el micrófono. Actívalo en la configuración del navegador (el candado junto a la dirección).',
  'sin-red': 'El reconocimiento de voz necesita internet y no hay conexión. Puedes seguir usando el modo de texto.',
  'sin-microfono': 'No se encontró ningún micrófono conectado.',
  otro: 'Hubo un problema con el reconocimiento de voz. Intenta de nuevo.',
};

// Modo 1: Conversación (voz ⇄ texto).
export function ConversationMode() {
  const lang = currentLanguage.speechLocale;
  const recognitionSupported = isRecognitionSupported();
  const synthesisSupported = isSynthesisSupported();

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [phrases, setPhrases] = useState<string[] | null>(null); // null = cargando

  // Estado del micrófono
  const [wantListening, setWantListening] = useState(false); // el usuario lo activó
  const [listening, setListening] = useState(false); // realmente está escuchando
  const [interim, setInterim] = useState(''); // texto provisional
  const [lastHeard, setLastHeard] = useState(''); // última frase completa
  const [error, setError] = useState<string | null>(null);

  // Respuesta de la persona sorda
  const [draft, setDraft] = useState('');
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [showText, setShowText] = useState<string | null>(null); // texto fijo en grande
  const [showLive, setShowLive] = useState(false); // pantalla grande en vivo (se actualiza al hablar)

  const recognizerRef = useRef<Recognizer | null>(null);
  const wantListeningRef = useRef(false); // copia para usar dentro de callbacks
  const speechIdRef = useRef(0); // identifica la última frase que se mandó a decir

  // Cargar historial y frases guardadas al abrir la pantalla
  useEffect(() => {
    getHistory().then(setHistory);
    getQuickPhrases().then(setPhrases);
  }, []);

  // Al salir de la pantalla, apagar micrófono y voz
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      recognizerRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  const addEntry = useCallback(async (who: Speaker, text: string) => {
    const entry = await addHistory({ who, text, time: Date.now() });
    setHistory((h) => [...h, entry]);
  }, []);

  const setWant = (value: boolean) => {
    wantListeningRef.current = value;
    setWantListening(value);
  };

  // ---------- Micrófono ----------

  const toggleListening = () => {
    if (wantListening) {
      setWant(false);
      recognizerRef.current?.stop();
      vibrate(40);
      return;
    }
    // Creamos el reconocedor la primera vez que se usa
    if (!recognizerRef.current) {
      recognizerRef.current = createRecognizer({
        lang,
        onInterim: setInterim,
        onFinal: (text) => {
          setLastHeard(text);
          addEntry('oyente', text);
          vibrate(60); // aviso de que llegó texto nuevo
        },
        onError: (code) => {
          setError(ERROR_MESSAGES[code]);
          if (code !== 'otro') setWant(false);
          vibrate([100, 60, 100]);
        },
        onListeningChange: setListening,
      });
    }
    setError(null);
    setWant(true);
    recognizerRef.current.start();
    vibrate(40);
  };

  // ---------- Voz de la app ----------

  /** Dice un texto en voz alta. Si "record" es true, lo guarda en el historial. */
  const say = (text: string, record: boolean) => {
    const clean = text.trim();
    if (!clean) return;
    if (record) addEntry('sorda', clean);
    if (!synthesisSupported) return;

    // Pausamos el micrófono mientras habla la app, para que no se escuche a sí misma
    if (wantListeningRef.current) recognizerRef.current?.stop();

    // Si se manda otra frase antes de terminar, solo la última reactiva el micrófono
    const id = ++speechIdRef.current;
    speak(clean, {
      lang,
      onStart: () => setSpeakingText(clean),
      onEnd: () => {
        if (id !== speechIdRef.current) return;
        setSpeakingText(null);
        if (wantListeningRef.current) recognizerRef.current?.start();
      },
    });
  };

  const submitReply = (e: FormEvent) => {
    e.preventDefault();
    say(draft, true);
    setDraft('');
  };

  // Enter envía; Shift + Enter hace un salto de línea
  const onDraftKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitReply(e);
    }
  };

  const savePhrases = (list: string[]) => {
    setPhrases(list);
    saveQuickPhrases(list);
  };

  const closeShow = useCallback(() => {
    setShowText(null);
    setShowLive(false);
  }, []);

  const clearAll = async () => {
    await clearHistory();
    setHistory([]);
    setLastHeard('');
  };

  // ---------- Texto de estado del micrófono ----------

  let micStatus = 'Toca el micrófono para empezar a escuchar.';
  if (wantListening) {
    if (speakingText) micStatus = 'En pausa mientras la app habla…';
    else if (listening) micStatus = 'Escuchando… la persona oyente puede hablar.';
    else micStatus = 'Conectando el micrófono…';
  }

  const liveText = interim || lastHeard;

  return (
    <section className="mode" aria-labelledby="titulo-conversacion">
      <h1 id="titulo-conversacion">Conversación</h1>

      {/* Aviso visible cuando la app está hablando (la persona sorda no lo escucha) */}
      {speakingText && (
        <div className="banner banner--speaking" role="status">
          <SpeakerIcon />
          <span>
            Diciendo en voz alta: <strong>«{speakingText}»</strong>
          </span>
          <button type="button" className="btn btn--small" onClick={stopSpeaking}>
            Detener
          </button>
        </div>
      )}

      {/* ---------- Lo que dice la persona oyente ---------- */}
      <section className="card" aria-labelledby="titulo-escuchar">
        <h2 id="titulo-escuchar">Lo que dice la persona oyente</h2>

        {recognitionSupported ? (
          <div className="mic-area">
            <button
              type="button"
              className={`mic-btn${wantListening ? ' mic-btn--on' : ''}`}
              onClick={toggleListening}
              aria-pressed={wantListening}
            >
              <MicIcon size={56} />
              <span>{wantListening ? 'Dejar de escuchar' : 'Escuchar'}</span>
            </button>
            <p className="mic-status" role="status">
              {wantListening && listening && !speakingText && <span className="pulse" aria-hidden="true" />}
              {micStatus}
            </p>
          </div>
        ) : (
          <div className="banner banner--warning">
            Este navegador no puede convertir voz a texto (pasa en Firefox y en algunos iPhone). Puedes usar el modo de
            solo texto: pide a la persona oyente que escriba abajo. Para usar la voz, abre la app en Chrome o Edge.
          </div>
        )}

        {error && (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        )}

        {recognitionSupported && (
          <div className="live" aria-live="polite">
            {liveText ? (
              <p className={`live__text${interim ? ' live__text--interim' : ''}`}>{liveText}</p>
            ) : (
              <p className="live__placeholder">Aquí aparecerá lo que diga la persona oyente.</p>
            )}
          </div>
        )}
        {recognitionSupported && (
          <button type="button" className="btn btn--secondary" onClick={() => setShowLive(true)}>
            Mostrar en grande (en vivo)
          </button>
        )}
      </section>

      {/* ---------- Respuesta ---------- */}
      <section className="card" aria-labelledby="titulo-responder">
        <h2 id="titulo-responder">Responder</h2>
        {!synthesisSupported && (
          <div className="banner banner--warning">
            Este navegador no puede leer texto en voz alta. Usa "Mostrar en grande" para enseñar tu respuesta.
          </div>
        )}

        <form onSubmit={submitReply} className="reply">
          <label htmlFor="respuesta" className="sr-only">
            Escribe tu respuesta
          </label>
          <textarea
            id="respuesta"
            className="input reply__input"
            rows={3}
            placeholder="Escribe aquí…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKeyDown}
          />
          <div className="row">
            <button type="submit" className="btn btn--primary btn--big" disabled={!draft.trim()}>
              <SpeakerIcon />
              {synthesisSupported ? 'Decir en voz alta' : 'Guardar'}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--big"
              disabled={!draft.trim()}
              onClick={() => setShowText(draft.trim())}
            >
              Mostrar en grande
            </button>
          </div>
        </form>

        <h3>Frases rápidas</h3>
        {phrases && <QuickPhrases phrases={phrases} onSelect={(p) => say(p, true)} onChange={savePhrases} />}
      </section>

      <History
        entries={history}
        onShow={setShowText}
        onSpeak={(text) => say(text, false)}
        onClear={clearAll}
      />

      {/* Pantalla grande en vivo: el texto se va actualizando mientras la persona oyente habla */}
      {showLive && (
        <ShowOverlay
          text={liveText}
          onClose={closeShow}
          live={{
            interim: Boolean(interim),
            listening: wantListening,
            status: micStatus,
            onToggleMic: toggleListening,
          }}
        />
      )}
      {showText && !showLive && <ShowOverlay text={showText} onClose={closeShow} />}
    </section>
  );
}
