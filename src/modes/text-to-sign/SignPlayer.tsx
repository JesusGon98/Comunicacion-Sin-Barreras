import { useEffect, useRef, useState } from 'react';
import type { Hand3D } from '../../lib/hand3d';
import { TICK_MS } from '../../lib/motion';
import { lerpPose, type SignToken } from '../../lib/signs';
import type { SignSource } from '../../lib/signData';
import { drawSkeleton, type Bounds } from '../../lib/skeleton';
import { DEFAULT_SKIN, SKIN_TONES, skinColor } from '../../lib/skinTones';

/** Cómo se dibuja la mano. */
type HandStyle = '3d' | 'skeleton';

/** Lee una preferencia guardada (puede fallar en modo privado: entonces usamos el valor por defecto). */
function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento: la preferencia solo dura esta sesión
  }
}

export interface MediaInfo {
  type: 'image' | 'video';
  url: string;
}

/** Cómo se anima una seña grabada. */
export type SignAnimation = {
  /** De dónde salió: grabada por el usuario o del paquete oficial. */
  source: SignSource;
  /** false = seña del paquete oficial que aún no revisa una persona que sepa LSM. */
  reviewed: boolean;
} & (
  /** Seña quieta: una sola pose. */
  | { kind: 'static'; pose: number[] }
  /** Seña con movimiento: una pose por cuadro y la zona que ocupa todo el movimiento. */
  | { kind: 'dynamic'; frames: number[][]; bounds: Bounds }
);

interface Props {
  tokens: SignToken[];
  /** Animación de cada seña grabada. */
  animations: Map<string, SignAnimation>;
  /** Versión del paquete oficial guardado (para mostrarla junto a sus señas). */
  packageVersion: number | null;
  /** Fotos y videos propios (seña → archivo). */
  media: Map<string, MediaInfo>;
  /** Si es true, se muestran las fotos/videos propios en vez del esqueleto cuando existen. */
  useMedia: boolean;
  /** Avisa qué seña se está mostrando (para poder asociarle una foto o video). */
  onCurrentChange: (token: SignToken | null) => void;
}

// Duración de cada paso a velocidad normal (milisegundos)
const LETTER_MS = 1100;
const WORD_MS = 1700;
const SPACE_MS = 500;
const TRANSITION_MS = 350; // tiempo que tarda la mano en pasar de una seña a otra
const DYNAMIC_END_MS = 500; // pausa al final de una seña con movimiento

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

/** Nombre de la seña de un paso (o null si no tiene). */
function labelOf(token: SignToken | undefined): string | null {
  return token && (token.kind === 'letter' || token.kind === 'word') ? token.label : null;
}

/** Suavizado de la animación (empieza y termina despacio). */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Pose con la que empieza una seña. */
const firstPose = (a: SignAnimation) => (a.kind === 'static' ? a.pose : a.frames[0]);
/** Pose con la que termina una seña (de aquí parte la transición a la siguiente). */
const lastPose = (a: SignAnimation) => (a.kind === 'static' ? a.pose : a.frames[a.frames.length - 1]);

/** Pose de una seña con movimiento en un momento dado (mezclando cuadros vecinos para que sea fluido). */
function poseAt(frames: number[][], ms: number): number[] {
  const pos = Math.max(0, ms / TICK_MS);
  const i = Math.min(frames.length - 1, Math.floor(pos));
  const j = Math.min(frames.length - 1, i + 1);
  return lerpPose(frames[i], frames[j], Math.min(1, pos - i));
}

// Reproduce una lista de señas con la mano esqueleto animada (o con fotos/videos propios).
export function SignPlayer({ tokens, animations, packageVersion, media, useMedia, onCurrentChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [mirror, setMirror] = useState(true);
  // Mano 3D realista (por defecto) o esqueleto de colores
  const [style, setStyle] = useState<HandStyle>(() => (loadPref('handStyle', '3d') === 'skeleton' ? 'skeleton' : '3d'));
  const [skin, setSkin] = useState(() => loadPref('skinTone', DEFAULT_SKIN));
  const [rotated, setRotated] = useState(false); // la persona giró la mano 3D
  const [error3d, setError3d] = useState(''); // el dispositivo no puede dibujar en 3D
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const handRef = useRef<Hand3D | null>(null);
  const use3d = style === '3d' && !error3d;

  // Estado de la animación en una "ref" para no redibujar React 60 veces por segundo
  const anim = useRef({ index: 0, elapsed: 0, playing: true });
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;

  // Crear la mano 3D. three.js se descarga solo cuando hace falta (y queda guardado para usarse sin internet).
  useEffect(() => {
    if (!use3d) return;
    let cancelled = false;
    let hand: Hand3D | null = null;
    import('../../lib/hand3d')
      .then(({ Hand3D }) => {
        if (cancelled || !canvas3dRef.current) return;
        hand = new Hand3D(canvas3dRef.current, skinColor(loadPref('skinTone', DEFAULT_SKIN)));
        hand.onRotatedChange = setRotated;
        handRef.current = hand;
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError3d('Este dispositivo no puede mostrar la mano 3D. Se muestra el esqueleto.');
      });
    return () => {
      cancelled = true;
      handRef.current = null;
      hand?.dispose();
      setRotated(false);
    };
  }, [use3d]);

  // Cambiar el tono de piel
  useEffect(() => {
    handRef.current?.setSkin(skinColor(skin));
  }, [skin]);

  const mediaFor = (token: SignToken | undefined) => {
    const label = labelOf(token);
    return useMedia && label ? media.get(label) : undefined;
  };

  /** Cuánto dura un paso. Los videos duran lo que dure el video. */
  const durationOf = (token: SignToken | undefined): number => {
    if (!token) return 0;
    if (mediaFor(token)?.type === 'video') return Infinity; // avanza al terminar el video
    if (token.kind === 'space') return SPACE_MS;
    const animation = animations.get(labelOf(token) ?? '');
    if (animation?.kind === 'dynamic') return TRANSITION_MS + animation.frames.length * TICK_MS + DYNAMIC_END_MS;
    if (token.kind === 'word') return WORD_MS;
    return LETTER_MS;
  };
  const durationRef = useRef(durationOf);
  durationRef.current = durationOf;

  /** Salta a un paso concreto. */
  const goTo = (i: number, play = anim.current.playing) => {
    const clamped = Math.max(0, Math.min(tokens.length - 1, i));
    // En pausa nos saltamos la transición: si no, se quedaría mostrando la seña anterior
    anim.current = { index: clamped, elapsed: play ? 0 : TRANSITION_MS, playing: play };
    setIndex(clamped);
    setPlaying(play);
  };

  // Al cambiar el texto, empezamos desde el principio
  useEffect(() => {
    anim.current = { index: 0, elapsed: 0, playing: tokens.length > 0 };
    setIndex(0);
    setPlaying(tokens.length > 0);
  }, [tokens]);

  useEffect(() => {
    onCurrentChange(tokens[index] ?? null);
  }, [index, tokens, onCurrentChange]);

  // Bucle de animación
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      const a = anim.current;
      const canvas = canvasRef.current;

      // Avanzar el tiempo
      if (a.playing && tokens.length) {
        a.elapsed += dt * speedRef.current;
        if (a.elapsed >= durationRef.current(tokens[a.index])) {
          if (a.index < tokens.length - 1) {
            a.index++;
            a.elapsed = 0;
            setIndex(a.index);
          } else {
            a.playing = false; // terminó
            setPlaying(false);
          }
        }
      }

      // ¿Qué pose toca mostrar ahora?
      let pose: number[] | null = null;
      let bounds: Bounds | undefined;
      const animation = animations.get(labelOf(tokens[a.index]) ?? '');
      if (animation) {
        bounds = animation.kind === 'dynamic' ? animation.bounds : undefined;
        if (a.elapsed < TRANSITION_MS) {
          // Transición desde la seña anterior (saltando espacios)
          let prev: number[] | undefined;
          for (let i = a.index - 1; i >= 0; i--) {
            if (tokens[i].kind === 'space') continue;
            const prevAnim = animations.get(labelOf(tokens[i]) ?? '');
            if (prevAnim) prev = lastPose(prevAnim);
            break;
          }
          const start = firstPose(animation);
          const t = ease(a.elapsed / TRANSITION_MS);
          pose = prev ? lerpPose(prev, start, t) : start;
        } else if (animation.kind === 'dynamic') {
          pose = poseAt(animation.frames, a.elapsed - TRANSITION_MS);
        } else {
          pose = animation.pose;
        }
      }

      // Dibujar: mano 3D o esqueleto 2D
      const hand = handRef.current;
      if (hand) {
        hand.render(pose, mirrorRef.current, bounds);
      } else if (canvas) {
        // Ajustar la resolución del lienzo a su tamaño en pantalla
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(canvas.clientWidth * dpr);
        const h = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, w, h);
        if (pose) drawSkeleton(ctx, pose, mirrorRef.current, bounds);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tokens, animations]);

  // Videos: pausar/reanudar con el botón y ajustar velocidad
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, speed, index]);

  // ---------- Controles ----------

  /** Siguiente/anterior seña, saltando los espacios. */
  const step = (dir: 1 | -1) => {
    let i = anim.current.index + dir;
    while (tokens[i]?.kind === 'space') i += dir;
    if (i >= 0 && i < tokens.length) goTo(i);
  };

  const togglePlay = () => {
    const a = anim.current;
    const atEnd = !a.playing && a.index === tokens.length - 1 && a.elapsed >= durationOf(tokens[a.index]);
    if (atEnd) goTo(0, true);
    else {
      a.playing = !a.playing;
      setPlaying(a.playing);
    }
  };

  // ---------- Pantalla ----------

  const token = tokens[index];
  const label = labelOf(token);
  const currentMedia = mediaFor(token);
  const hasAnimation = label ? animations.has(label) : false;

  let caption = '';
  if (token?.kind === 'letter') caption = token.label;
  else if (token?.kind === 'word') caption = token.text;
  else if (token?.kind === 'other') caption = token.text;

  // Mensaje honesto cuando no hay seña grabada
  let missing: string | null = null;
  if (token?.kind === 'other') missing = 'Este carácter no tiene seña en el alfabeto.';
  else if (label && !hasAnimation && !currentMedia) {
    missing = 'No tengo esta seña grabada. Grábala en "Señas → Texto" › Entrenar.';
  }

  return (
    <div className="player">
      <div className="player__caption" aria-live="polite">
        {caption || ' '}
      </div>
      {/* De dónde sale la seña que se ve (honestidad: las del paquete pueden no estar revisadas) */}
      <p className="player__origin">
        {currentMedia
          ? 'Tu foto o video'
          : label && animations.get(label)?.source === 'personal'
            ? 'Grabada por ti'
            : label && animations.get(label)
              ? `Paquete oficial${packageVersion ? ` v${packageVersion}` : ''}${animations.get(label)!.reviewed ? '' : ' · sin revisar'}`
              : ' '}
      </p>

      <div className={`player__stage${use3d ? ' player__stage--3d' : ''}`}>
        {use3d ? (
          // "key" para que el lienzo 3D sea nuevo cada vez (un lienzo 2D no se puede volver 3D)
          <canvas
            key="3d"
            ref={canvas3dRef}
            className="player__canvas player__canvas--3d"
            role="img"
            aria-label={caption ? `Seña: ${caption}. Desliza para girar la mano.` : 'Espacio entre palabras'}
          />
        ) : (
          <canvas
            key="2d"
            ref={canvasRef}
            className="player__canvas"
            role="img"
            aria-label={caption ? `Seña: ${caption}` : 'Espacio entre palabras'}
          />
        )}
        {use3d && rotated && !currentMedia && (
          <button type="button" className="btn btn--small player__reset" onClick={() => handRef.current?.resetView()}>
            ↺ Vista de frente
          </button>
        )}
        {currentMedia?.type === 'image' && <img className="player__media" src={currentMedia.url} alt={`Seña ${caption}`} />}
        {currentMedia?.type === 'video' && (
          <video
            key={`${index}-${currentMedia.url}`}
            ref={videoRef}
            className="player__media"
            src={currentMedia.url}
            autoPlay
            muted
            playsInline
            onEnded={() => {
              if (anim.current.playing) {
                if (anim.current.index < tokens.length - 1) step(1);
                else {
                  anim.current.playing = false;
                  setPlaying(false);
                }
              }
            }}
          />
        )}
        {missing && (
          <div className="player__missing">
            <span className="player__missing-letter">{caption}</span>
            <span>{missing}</span>
          </div>
        )}
        {token?.kind === 'space' && <div className="player__space">(espacio)</div>}
      </div>

      {/* Lista de pasos: el actual se resalta; se puede tocar para saltar */}
      <ol className="steps" aria-label="Señas del texto">
        {tokens.map((t, i) => {
          if (t.kind === 'space') return <li key={i} className="steps__space" aria-hidden="true" />;
          const l = labelOf(t);
          const ok = l ? animations.has(l) || Boolean(useMedia && media.get(l)) : false;
          const text = t.kind === 'letter' ? t.label : t.text;
          return (
            <li key={i}>
              <button
                type="button"
                className={`steps__item${i === index ? ' steps__item--current' : ''}${ok ? '' : ' steps__item--missing'}${t.kind === 'word' ? ' steps__item--word' : ''}`}
                onClick={() => goTo(i)}
                aria-current={i === index ? 'step' : undefined}
                title={ok ? undefined : 'Sin seña grabada'}
              >
                {text}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="player__controls">
        <button type="button" className="btn btn--secondary" onClick={() => step(-1)} aria-label="Seña anterior">
          ◀ Anterior
        </button>
        <button type="button" className="btn btn--primary player__play" onClick={togglePlay}>
          {playing ? '❚❚ Pausa' : '▶ Reproducir'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => step(1)} aria-label="Seña siguiente">
          Siguiente ▶
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => goTo(0, true)}>
          ↺ Repetir
        </button>
      </div>

      <div className="row row--center">
        <label htmlFor="velocidad" className="label label--inline">
          Velocidad:
        </label>
        <select
          id="velocidad"
          className="input input--auto"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s === 1 ? 'Normal' : `${s}×`}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
          Vista de espejo (para imitar la seña)
        </label>
      </div>

      {/* Cómo se ve la mano */}
      <div className="row row--center">
        <label htmlFor="estilo-mano" className="label label--inline">
          Mano:
        </label>
        <select
          id="estilo-mano"
          className="input input--auto"
          value={style}
          onChange={(e) => {
            const value = e.target.value as HandStyle;
            setStyle(value);
            savePref('handStyle', value);
          }}
        >
          <option value="3d">3D realista</option>
          <option value="skeleton">Esqueleto de colores</option>
        </select>
      </div>
      {error3d && <p className="muted small">{error3d}</p>}

      {use3d && (
        <>
          <div className="skin-picker" role="radiogroup" aria-label="Tono de piel">
            <span className="label label--inline">Piel:</span>
            {SKIN_TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={skin === t.id}
                aria-label={t.name}
                title={t.name}
                className="skin-picker__swatch"
                style={{ background: t.color }}
                onClick={() => {
                  setSkin(t.id);
                  savePref('skinTone', t.id);
                }}
              />
            ))}
          </div>
          <p className="muted small">Desliza el dedo sobre la mano para verla de lado. Doble toque: vista de frente.</p>
        </>
      )}
    </div>
  );
}
