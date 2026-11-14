import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { currentLanguage } from '../../config/language';
import { addSignSample, deleteSign, getOfficialPackageInfo, getSignSamples, type OfficialPackageInfo } from '../../lib/db';
import { ensureBundledPackage } from '../../lib/officialPackage';
import { onSignsChanged } from '../../lib/signData';
import type { HandFrame } from '../../lib/hands';
import { TICK_MS, toSequence, trimStill } from '../../lib/motion';
import { vibrate } from '../../lib/speech';
import { SharePanel } from './SharePanel';
import { inSlot } from './slot';

interface Props {
  frameRef: MutableRefObject<HandFrame | null>;
  cameraOn: boolean;
  /** Espacio encima del video de la cámara */
  overlayEl: HTMLElement | null;
  /** Espacio justo debajo del video de la cámara */
  footerEl: HTMLElement | null;
}

const MIN_RECOMMENDED = 10; // ejemplos mínimos recomendados por seña
const CAPTURE_INTERVAL_MS = 250; // señas quietas: tiempo entre un ejemplo y otro
const COUNTDOWN_SECONDS = 3;
const BETWEEN_SECONDS = 2; // señas con movimiento: pausa entre repeticiones

type Phase =
  | { kind: 'idle' }
  | { kind: 'countdown'; seconds: number; next: number }
  | { kind: 'recording'; done: number }
  | { kind: 'moving'; done: number };

interface SignInfo {
  count: number;
  dynamic: boolean;
}

/** Limpia el nombre de la seña: las letras del alfabeto van en mayúscula. */
function cleanLabel(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ');
  const upper = text.toUpperCase();
  return currentLanguage.alphabet.includes(upper) ? upper : text.toLowerCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Modo entrenar: el usuario hace una seña frente a la cámara y se graban varios ejemplos.
export function TrainPanel({ frameRef, cameraOn, overlayEl, footerEl }: Props) {
  const lang = currentLanguage.id;
  const [label, setLabel] = useState('');
  const [wordMotion, setWordMotion] = useState(false); // la palabra escrita lleva movimiento
  const [target, setTarget] = useState(MIN_RECOMMENDED);
  const [seconds, setSeconds] = useState(2); // duración de cada repetición con movimiento
  const [signs, setSigns] = useState<Map<string, SignInfo>>(new Map());
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [warning, setWarning] = useState('');
  const [packageInfo, setPackageInfo] = useState<OfficialPackageInfo | null>(null);
  const cancelRef = useRef(false);

  const refreshCounts = async () => {
    const samples = await getSignSamples(lang);
    const map = new Map<string, SignInfo>();
    for (const s of samples) {
      const info = map.get(s.label) ?? { count: 0, dynamic: false };
      map.set(s.label, { count: info.count + 1, dynamic: info.dynamic || s.kind === 'dynamic' });
    }
    setSigns(map);
  };

  useEffect(() => {
    refreshCounts();
    const loadPackage = () => ensureBundledPackage(currentLanguage).then(() => getOfficialPackageInfo(lang).then(setPackageInfo));
    loadPackage();
    const stopListening = onSignsChanged(loadPackage);
    return () => {
      cancelRef.current = true; // si se sale de la pantalla, se detiene la grabación
      stopListening();
    };
  }, []);

  const name = cleanLabel(label);
  const isLetter = currentLanguage.alphabet.includes(name);
  const isDynamicLetter = currentLanguage.dynamicLetters.includes(name);
  // Las letras con movimiento siempre se graban con movimiento; las otras letras, quietas
  const withMotion = isLetter ? isDynamicLetter : wordMotion;
  const busy = phase.kind !== 'idle';
  const targets = withMotion ? [5, 10, 15] : [10, 20, 30];
  // Cantidad a grabar (si la elegida no aplica a este tipo de seña, usamos la recomendada)
  const count = targets.includes(target) ? target : targets[1];

  /** Cuenta regresiva visible, con vibración. Devuelve false si se canceló. */
  const countdown = async (secs: number, next: number) => {
    for (let s = secs; s > 0; s--) {
      setPhase({ kind: 'countdown', seconds: s, next });
      vibrate(50);
      await sleep(1000);
      if (cancelRef.current) return false;
    }
    return true;
  };

  /** Seña quieta: graba "count" fotos de la mano, una cada 250 ms. */
  const recordStatic = async () => {
    let done = 0;
    let lastTime = 0;
    setPhase({ kind: 'recording', done });
    while (done < count && !cancelRef.current) {
      await sleep(CAPTURE_INTERVAL_MS);
      const frame = frameRef.current;
      // Solo guardamos si hay una mano y es un cuadro nuevo
      if (!frame || frame.time === lastTime) {
        setWarning('No veo tu mano. Ponla frente a la cámara.');
        continue;
      }
      setWarning('');
      lastTime = frame.time;
      await addSignSample({ lang, label: name, kind: 'static', points: frame.vector, createdAt: Date.now() });
      done++;
      setPhase({ kind: 'recording', done });
    }
  };

  /** Seña con movimiento: graba "count" repeticiones de unos segundos cada una. */
  const recordDynamic = async () => {
    let done = 0;
    let attempts = 0;
    while (done < count && attempts < count * 2 && !cancelRef.current) {
      attempts++;
      if (attempts > 1 && !(await countdown(BETWEEN_SECONDS, done + 1))) return;
      setPhase({ kind: 'moving', done });
      vibrate(120); // ¡ahora!

      // Tomamos un cuadro cada TICK_MS durante los segundos elegidos
      const frames: HandFrame[] = [];
      const start = performance.now();
      let lastTime = 0;
      while (performance.now() - start < seconds * 1000 && !cancelRef.current) {
        await sleep(TICK_MS);
        const f = frameRef.current;
        if (f && f.time !== lastTime) {
          frames.push(f);
          lastTime = f.time;
        }
      }
      if (cancelRef.current) return;

      // Quitamos la parte quieta del principio y del final
      const moving = frames.length > 5 ? trimStill(frames) : null;
      if (!moving || moving.length < 5) {
        setWarning(
          frames.length < 5
            ? 'No vi tu mano durante la grabación. Repitamos.'
            : 'No detecté movimiento. Haz la seña completa mientras dice "¡Ahora!".',
        );
        vibrate([100, 60, 100]);
        continue;
      }
      setWarning('');
      await addSignSample({
        lang,
        label: name,
        kind: 'dynamic',
        points: moving[Math.floor(moving.length / 2)].vector,
        frames: toSequence(moving),
        createdAt: Date.now(),
      });
      done++;
      setPhase({ kind: 'moving', done });
    }
  };

  const record = async () => {
    if (!name) return;
    cancelRef.current = false;
    setWarning('');
    if (await countdown(COUNTDOWN_SECONDS, 1)) {
      if (withMotion) await recordDynamic();
      else await recordStatic();
    }
    setWarning('');
    setPhase({ kind: 'idle' });
    vibrate([80, 60, 80]); // aviso de que terminó
    refreshCounts();
  };

  const remove = async (signLabel: string) => {
    if (!window.confirm(`¿Borrar todos los ejemplos de "${signLabel}"?`)) return;
    await deleteSign(lang, signLabel);
    refreshCounts();
  };

  const trained = [...signs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  const progress = phase.kind === 'recording' || phase.kind === 'moving' ? phase.done : 0;

  // ENCIMA del video: cuenta regresiva y avance, en grande, para no tener que mirar a otro lado.
  const overlay = busy && (
    <div className={`rec-overlay${phase.kind === 'moving' ? ' rec-overlay--now' : ''}`} role="status">
      {phase.kind === 'countdown' && (
        <>
          <span className="rec-overlay__small">
            {withMotion && phase.next > 1 ? `Repetición ${phase.next}` : `Prepárate para "${name}"`}
          </span>
          <span className="rec-overlay__big">{phase.seconds}</span>
        </>
      )}
      {phase.kind === 'recording' && (
        <>
          <span className="rec-overlay__small">Grabando "{name}"… mantén la mano quieta</span>
          <span className="rec-overlay__big">
            {phase.done} / {count}
          </span>
        </>
      )}
      {phase.kind === 'moving' && (
        <>
          <span className="rec-overlay__big">¡Ahora!</span>
          <span className="rec-overlay__small">
            Haz la seña · listas {phase.done} / {count}
          </span>
        </>
      )}
      {warning && <span className="rec-overlay__warn">{warning}</span>}
    </div>
  );

  // JUSTO DEBAJO del video: el botón para grabar (o cancelar y el avance).
  const footer =
    phase.kind === 'idle' ? (
      <button
        type="button"
        className="btn btn--primary btn--big s2t-record"
        onClick={record}
        disabled={!cameraOn || !name}
      >
        {!cameraOn
          ? 'Enciende la cámara para grabar'
          : name
            ? `Grabar ${count} ${withMotion ? 'repeticiones' : 'ejemplos'} de "${name}"`
            : 'Elige abajo una letra o escribe una seña'}
      </button>
    ) : (
      <div className="s2t-recording">
        <progress className="progress" value={progress} max={count} aria-label="Avance de la grabación" />
        <button type="button" className="btn btn--secondary" onClick={() => (cancelRef.current = true)}>
          Cancelar
        </button>
      </div>
    );

  return (
    <div className="panel">
      {inSlot(overlayEl, overlay)}
      {inSlot(footerEl, footer)}

      <section className="card" aria-labelledby="titulo-grabar">
        <h2 id="titulo-grabar">Grabar una seña</h2>

        <label htmlFor="nombre-sena" className="label">
          Nombre de la seña (una letra o una palabra)
        </label>
        <input
          id="nombre-sena"
          className="input"
          placeholder='Por ejemplo "A" u "hola"'
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />

        <p className="label">O elige una letra:</p>
        <div className="letters">
          {currentLanguage.alphabet.map((letter) => {
            const n = signs.get(letter)?.count ?? 0;
            const dynamic = currentLanguage.dynamicLetters.includes(letter);
            return (
              <button
                key={letter}
                type="button"
                className={`letter${name === letter ? ' letter--selected' : ''}${n >= MIN_RECOMMENDED ? ' letter--done' : ''}`}
                onClick={() => setLabel(letter)}
                disabled={busy}
                title={`${n} ejemplos${dynamic ? ' (lleva movimiento)' : ''}`}
              >
                <span>{letter}</span>
                <small>
                  {dynamic && '↻ '}
                  {n}
                </small>
              </button>
            );
          })}
        </div>
        <p className="muted small">El número es cuántos ejemplos tiene cada letra. ↻ = lleva movimiento.</p>

        {name && !isLetter && (
          <label className="check">
            <input
              type="checkbox"
              checked={wordMotion}
              onChange={(e) => setWordMotion(e.target.checked)}
              disabled={busy}
            />
            Esta seña lleva movimiento
          </label>
        )}

        {withMotion && (
          <div className="banner banner--info">
            <strong>Seña con movimiento.</strong> Se grabarán varias repeticiones. En cada una, espera a que diga{' '}
            <strong>"¡Ahora!"</strong> y haz la seña completa.
          </div>
        )}

        <div className="row row--center">
          <label htmlFor="cantidad" className="label label--inline">
            {withMotion ? 'Repeticiones:' : 'Ejemplos por grabación:'}
          </label>
          <select
            id="cantidad"
            className="input input--auto"
            value={count}
            onChange={(e) => setTarget(Number(e.target.value))}
            disabled={busy}
          >
            {targets.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {withMotion && (
            <>
              <label htmlFor="duracion" className="label label--inline">
                Segundos por repetición:
              </label>
              <select
                id="duracion"
                className="input input--auto"
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
                disabled={busy}
              >
                {[1.5, 2, 3].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <details className="tips">
          <summary>Consejos para que aprenda mejor</summary>
          <ul>
            <li>Señas quietas: mantén la mano quieta mientras se graba.</li>
            <li>Señas con movimiento: haz el movimiento completo, a velocidad normal, en cada repetición.</li>
            <li>Mueve un poco la mano entre grabaciones: más cerca, más lejos, un poco girada.</li>
            <li>Graba la misma seña con varias personas y con buena luz.</li>
            <li>Graba al menos {MIN_RECOMMENDED} ejemplos por seña.</li>
          </ul>
        </details>

        {packageInfo && (
          <p className="muted small">
            La app ya incluye el <strong>paquete oficial v{packageInfo.version}</strong> con el alfabeto
            {packageInfo.origen === 'sintetico' && ' (datos sintéticos, todavía sin revisar)'}. Lo que grabes aquí son
            tus <strong>señas personales</strong>: se suman al paquete y ayudan a que reconozca mejor tu mano. Los
            números de las letras son solo tus ejemplos.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="titulo-entrenadas">
        <h2 id="titulo-entrenadas">Señas entrenadas</h2>
        {trained.length === 0 ? (
          <p className="muted">Todavía no hay señas entrenadas.</p>
        ) : (
          <ul className="trained">
            {trained.map(([signLabel, info]) => (
              <li key={signLabel} className="trained__item">
                <strong className="trained__label">{signLabel}</strong>
                <span className={info.count < MIN_RECOMMENDED ? 'trained__count--low' : 'muted'}>
                  {info.count} ejemplos{info.dynamic && ' · con movimiento'}
                  {info.count < MIN_RECOMMENDED && ` (faltan ${MIN_RECOMMENDED - info.count})`}
                </span>
                <button type="button" className="btn btn--danger btn--small-danger" onClick={() => remove(signLabel)}>
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SharePanel onImported={refreshCounts} />
    </div>
  );
}
