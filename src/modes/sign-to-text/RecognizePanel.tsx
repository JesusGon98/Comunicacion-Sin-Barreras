import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { BackspaceIcon, ExpandIcon, SlidersIcon, SpaceIcon, SpeakerIcon, TrashIcon } from '../../app/icons';
import { currentLanguage } from '../../config/language';
import { DtwClassifier, KnnClassifier } from '../../lib/classifier';
import { addHistory, type OfficialPackageInfo } from '../../lib/db';
import { loadAllSamples, onSignsChanged } from '../../lib/signData';
import type { HandFrame } from '../../lib/hands';
import { MOVING_ENERGY, STILL_ENERGY, TICK_MS, motionEnergy, toSequence, trimStill } from '../../lib/motion';
import { isSynthesisSupported, speak, vibrate } from '../../lib/speech';
import { ShowOverlay } from '../conversation/ShowOverlay';
import { inSlot } from './slot';

interface Props {
  frameRef: MutableRefObject<HandFrame | null>;
  cameraOn: boolean;
  onGoTrain: () => void;
  /** Espacio encima del video de la cámara */
  overlayEl: HTMLElement | null;
  /** Espacio justo debajo del video de la cámara */
  footerEl: HTMLElement | null;
}

const STABLE_FRAMES = 5; // la seña quieta debe repetirse ~0.3 s para mostrarla
const HOLD_FRAMES = 15; // y sostenerse ~1 s para agregarla al texto
const STILL_FRAMES_TO_END = 4; // ~0.25 s quieta = terminó el movimiento
const MAX_SEGMENT_FRAMES = 75; // un movimiento dura como máximo ~5 s
const SHOW_DYNAMIC_MS = 1200; // tiempo que se muestra una seña con movimiento reconocida

interface Reading {
  state: 'no-hand' | 'unsure' | 'sure' | 'moving';
  label: string;
  confidence: number;
}

// Modo reconocer: compara la mano de la cámara con las señas entrenadas.
//  - Señas quietas → k-NN, cuadro por cuadro.
//  - Señas con movimiento → cuando la mano se mueve, se graba el movimiento; cuando se
//    detiene, se compara con DTW.
export function RecognizePanel({ frameRef, cameraOn, onGoTrain, overlayEl, footerEl }: Props) {
  const [knn, setKnn] = useState<KnnClassifier | null>(null);
  const [dtw, setDtw] = useState<DtwClassifier | null>(null);
  const [labelCount, setLabelCount] = useState(0);
  const [packageInfo, setPackageInfo] = useState<OfficialPackageInfo | null>(null);
  const [unreviewed, setUnreviewed] = useState(false); // hay señas oficiales sin revisar
  const [threshold, setThreshold] = useState(0.7); // confianza mínima para aceptar una seña
  const [reading, setReading] = useState<Reading>({ state: 'no-hand', label: '', confidence: 0 });
  const [text, setText] = useState('');
  const [showText, setShowText] = useState<string | null>(null);

  // Variables del "estabilizador" (no necesitan redibujar la pantalla)
  const candidateRef = useRef({ label: '', frames: 0 });
  const lastAddedRef = useRef(''); // evita agregar la misma seña muchas veces seguidas
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  // Cargar las señas (personales + paquete oficial) y crear los dos clasificadores.
  // Se repite si llega un paquete nuevo mientras la pantalla está abierta.
  useEffect(() => {
    const load = () => loadAllSamples(currentLanguage.id).then(({ recognition: samples, official, packageInfo }) => {
      setPackageInfo(packageInfo);
      setUnreviewed(official.some((s) => !s.reviewed));
      const statics = samples.filter((s) => s.kind === 'static');
      const dynamics = samples.filter((s) => s.kind === 'dynamic' && s.frames);
      setLabelCount(new Set(samples.map((s) => s.label)).size);
      setKnn(new KnnClassifier(statics.map((s) => ({ label: s.label, vector: s.points }))));
      setDtw(new DtwClassifier(dynamics.map((s) => ({ label: s.label, frames: s.frames! }))));
    });
    load();
    return onSignsChanged(load);
  }, []);

  const addToText = useCallback((label: string) => {
    setText((t) => {
      // Una letra se pega a lo anterior; una palabra se separa con espacios
      if (label.length <= 2 && currentLanguage.alphabet.includes(label)) return t + label;
      const sep = t && !t.endsWith(' ') ? ' ' : '';
      return `${t}${sep}${label} `;
    });
    vibrate(60);
  }, []);

  // Bucle de reconocimiento
  useEffect(() => {
    if (!cameraOn || !knn || !dtw || knn.size + dtw.size === 0) return;

    const candidate = candidateRef.current;
    let prev: HandFrame | null = null;
    let recent: HandFrame[] = []; // últimos cuadros, para no perder el inicio del movimiento
    let segment: HandFrame[] | null = null; // movimiento en curso
    let stillCount = 0;
    let showUntil = 0; // mientras tanto, se sigue mostrando la seña con movimiento reconocida

    const resetStatic = () => {
      candidate.label = '';
      candidate.frames = 0;
    };

    /** Terminó un movimiento: lo comparamos con las señas con movimiento (DTW). */
    const finishSegment = () => {
      const frames = segment ? (trimStill(segment) ?? segment) : [];
      segment = null;
      stillCount = 0;
      if (frames.length < 5) return;
      const prediction = dtw.predict(toSequence(frames));
      if (prediction && prediction.confidence >= thresholdRef.current) {
        setReading({ state: 'sure', label: prediction.label, confidence: prediction.confidence });
        showUntil = performance.now() + SHOW_DYNAMIC_MS;
        lastAddedRef.current = prediction.label;
        addToText(prediction.label);
      } else {
        setReading({ state: 'unsure', label: prediction?.label ?? '', confidence: prediction?.confidence ?? 0 });
      }
    };

    const id = setInterval(() => {
      const frame = frameRef.current;
      const now = performance.now();

      if (!frame) {
        // Sin mano: si se estaba moviendo, termina el movimiento.
        // Reiniciamos todo, así se puede repetir la misma letra.
        if (segment) finishSegment();
        resetStatic();
        lastAddedRef.current = '';
        prev = null;
        recent = [];
        if (now > showUntil) setReading({ state: 'no-hand', label: '', confidence: 0 });
        return;
      }
      if (frame.time === prev?.time) return; // todavía no hay un cuadro nuevo

      // ---- Señas con movimiento ----
      if (dtw.size > 0) {
        const energy = prev ? motionEnergy(prev, frame) : 0;
        if (!segment && energy > MOVING_ENERGY) {
          segment = [...recent, frame]; // empezó un movimiento
          stillCount = 0;
        } else if (segment) {
          segment.push(frame);
          stillCount = energy < STILL_ENERGY ? stillCount + 1 : 0;
          if (stillCount >= STILL_FRAMES_TO_END || segment.length > MAX_SEGMENT_FRAMES) finishSegment();
        }
        recent = [...recent.slice(-2), frame];
      }
      prev = frame;

      if (segment) {
        resetStatic();
        if (now > showUntil) setReading({ state: 'moving', label: '', confidence: 0 });
        return;
      }
      if (now < showUntil) return;

      // ---- Señas quietas ----
      const prediction = knn.predict(frame.vector);
      if (!prediction || prediction.confidence < thresholdRef.current) {
        resetStatic();
        setReading({ state: 'unsure', label: prediction?.label ?? '', confidence: prediction?.confidence ?? 0 });
        return;
      }

      // Contamos cuántas veces seguidas sale la misma seña
      if (candidate.label === prediction.label) candidate.frames++;
      else {
        candidate.label = prediction.label;
        candidate.frames = 1;
      }

      if (candidate.frames >= STABLE_FRAMES) {
        setReading({ state: 'sure', label: prediction.label, confidence: prediction.confidence });
      } else {
        setReading((r) => ({ ...r, state: r.state === 'sure' ? 'sure' : 'unsure', confidence: prediction.confidence }));
      }

      if (candidate.frames === HOLD_FRAMES && lastAddedRef.current !== prediction.label) {
        lastAddedRef.current = prediction.label;
        addToText(prediction.label);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [cameraOn, knn, dtw, frameRef, addToText]);

  // ---------- Acciones del texto ----------

  const deleteLast = () => setText((t) => t.replace(/\s+$/, '').slice(0, -1));

  const sayAloud = () => {
    const clean = text.trim();
    if (!clean) return;
    // Reutilizamos el modo Conversación: se dice en voz alta y queda en su historial
    addHistory({ who: 'sorda', text: clean, time: Date.now() });
    speak(clean, { lang: currentLanguage.speechLocale });
  };

  const closeShow = useCallback(() => setShowText(null), []);

  // ---------- Pantalla ----------

  if (!knn || !dtw) return inSlot(footerEl, <p className="muted">Cargando señas entrenadas…</p>);

  if (knn.size + dtw.size === 0) {
    return inSlot(
      footerEl,
      <section className="card s2t-empty">
        <h2>Primero hay que entrenar</h2>
        <p>Todavía no hay señas entrenadas. Graba algunos ejemplos para que la app pueda reconocerlas.</p>
        <button type="button" className="btn btn--primary" onClick={onGoTrain}>
          Ir a entrenar
        </button>
      </section>,
    );
  }

  const percent = Math.round(reading.confidence * 100);
  const showBar = reading.state === 'sure' || reading.state === 'unsure';

  // Lo que se ve ENCIMA del video: la seña detectada, grande, sin tener que mirar a otro lado.
  const overlay = cameraOn && (
    <div className={`detected detected--${reading.state}`} aria-live="polite">
      {reading.state === 'sure' ? (
        <div className="detected__row">
          <span className="detected__label">{reading.label}</span>
          <span className="detected__confidence">{percent}%</span>
        </div>
      ) : (
        <span className="detected__message">
          {reading.state === 'no-hand'
            ? 'Pon tu mano frente a la cámara'
            : reading.state === 'moving'
              ? 'Movimiento…'
              : 'No estoy seguro'}
        </span>
      )}
      {showBar && (
        <div className="confidence" aria-hidden="true">
          <div className="confidence__bar" style={{ width: `${percent}%` }} data-ok={reading.confidence >= threshold} />
          <div className="confidence__threshold" style={{ left: `${threshold * 100}%` }} />
        </div>
      )}
    </div>
  );

  // Lo que se ve JUSTO DEBAJO del video: el texto que se va armando y sus botones.
  const footer = (
    <section className="s2t-text" aria-labelledby="titulo-texto">
      <h2 id="titulo-texto" className="sr-only">
        Texto reconocido
      </h2>
      <textarea
        className="input recognized"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Aquí se va armando el texto…"
        aria-labelledby="titulo-texto"
      />
      <div className="toolbar">
        <button type="button" className="tool-btn" onClick={() => setText((t) => t + ' ')}>
          <SpaceIcon />
          <span>Espacio</span>
        </button>
        <button type="button" className="tool-btn" onClick={deleteLast} disabled={!text}>
          <BackspaceIcon />
          <span>Borrar</span>
        </button>
        <button type="button" className="tool-btn" onClick={() => setText('')} disabled={!text}>
          <TrashIcon />
          <span>Todo</span>
        </button>
        <button
          type="button"
          className="tool-btn tool-btn--primary"
          onClick={sayAloud}
          disabled={!text.trim()}
        >
          <SpeakerIcon />
          <span>{isSynthesisSupported() ? 'Decir' : 'Guardar'}</span>
        </button>
        <button type="button" className="tool-btn" onClick={() => setShowText(text.trim())} disabled={!text.trim()}>
          <ExpandIcon />
          <span>Mostrar</span>
        </button>
      </div>
    </section>
  );

  return (
    <div className="panel">
      {inSlot(overlayEl, overlay)}
      {inSlot(footerEl, footer)}

      {/* Lo demás (ajustes e información) va más abajo: se usa poco */}
      <details className="card s2t-settings">
        <summary>
          <SlidersIcon />
          Ajustes del reconocimiento
        </summary>
        <p className="muted small">
          Sostén una seña quieta un segundo para agregarla al texto; las señas con movimiento se agregan al terminar el movimiento. Conozco {labelCount}{' '}
          {labelCount === 1 ? 'seña' : 'señas'}; las demás no las puedo reconocer.
        </p>

        {packageInfo && (
          <p className="muted small">
            Incluye el paquete oficial v{packageInfo.version}
            {packageInfo.origen === 'sintetico' && ' (datos sintéticos, generados por computadora)'}
            {unreviewed && ', que todavía no revisa una persona que sepa LSM'}. Si no reconoce bien tu mano, graba tus
            propios ejemplos en Entrenar: se suman al paquete.
          </p>
        )}

        <label htmlFor="umbral" className="label">
          Confianza mínima: {Math.round(threshold * 100)}%
        </label>
        <input
          id="umbral"
          type="range"
          className="range"
          min={0.4}
          max={0.95}
          step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
        <p className="muted small">
          Más alto = se equivoca menos, pero reconoce menos señas. Más bajo = reconoce más, pero se equivoca más.
        </p>
      </details>

      {showText && <ShowOverlay text={showText} onClose={closeShow} />}
    </div>
  );
}
