import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { currentLanguage } from '../../config/language';
import { getAllMedia } from '../../lib/db';
import { loadAllSamples, onSignsChanged, samplesForDisplay } from '../../lib/signData';
import { sequenceToPoses } from '../../lib/motion';
import { representativePose, representativeSequence, textToSigns, type SignToken } from '../../lib/signs';
import { poseBounds } from '../../lib/skeleton';
import { MediaEditor } from './MediaEditor';
import { SignPlayer, type MediaInfo, type SignAnimation } from './SignPlayer';

// Modo 2: Texto → Señas.
export function TextToSignMode() {
  const lang = currentLanguage;
  const [loaded, setLoaded] = useState(false);
  const [animations, setAnimations] = useState<Map<string, SignAnimation>>(new Map());
  const [media, setMedia] = useState<Map<string, MediaInfo>>(new Map());
  const [input, setInput] = useState('');
  const [tokens, setTokens] = useState<SignToken[]>([]);
  const [useMedia, setUseMedia] = useState(true);
  const [current, setCurrent] = useState<SignToken | null>(null);
  const [packageVersion, setPackageVersion] = useState<number | null>(null);

  // Cargar las señas: de cada una elegimos su ejemplo más típico (o la "referencia" del paquete).
  // Si una seña está en el paquete oficial y también la grabó el usuario, se muestra la del usuario.
  useEffect(() => {
    const load = () => loadAllSamples(lang.id).then((loaded) => {
      const samples = samplesForDisplay(loaded);
      const statics = new Map<string, number[][]>();
      const dynamics = new Map<string, number[][][]>();
      const origin = new Map<string, Pick<SignAnimation, 'source' | 'reviewed'>>();
      for (const s of samples) {
        if (s.kind === 'dynamic' && s.frames) dynamics.set(s.label, [...(dynamics.get(s.label) ?? []), s.frames]);
        else if (s.kind === 'static') statics.set(s.label, [...(statics.get(s.label) ?? []), s.points]);
        if (!origin.has(s.label)) origin.set(s.label, { source: s.source, reviewed: s.source === 'personal' || !!s.reviewed });
      }
      const map = new Map<string, SignAnimation>();
      for (const [label, examples] of statics) {
        map.set(label, { kind: 'static', pose: representativePose(examples), ...origin.get(label)! });
      }
      // Si una seña tiene grabaciones con movimiento, preferimos esas
      for (const [label, examples] of dynamics) {
        const frames = sequenceToPoses(representativeSequence(examples));
        map.set(label, { kind: 'dynamic', frames, bounds: poseBounds(frames), ...origin.get(label)! });
      }
      setAnimations(map);
      setPackageVersion(loaded.packageInfo?.version ?? null);
      setLoaded(true);
    });
    load();
    return onSignsChanged(load); // si llega un paquete nuevo, recargamos
  }, [lang.id]);

  // Cargar fotos y videos propios
  const loadMedia = useCallback(async () => {
    const list = await getAllMedia(lang.id);
    setMedia(new Map(list.map((m) => [m.label, { type: m.type, url: URL.createObjectURL(m.blob) }])));
  }, [lang.id]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  // Cuando se reemplazan (o al salir de la pantalla) liberamos la memoria de los archivos anteriores
  useEffect(() => () => media.forEach((m) => URL.revokeObjectURL(m.url)), [media]);

  // Las señas que no son letras del alfabeto son palabras del diccionario
  const wordLabels = useMemo(() => {
    const labels = new Set([...animations.keys(), ...media.keys()]);
    return [...labels].filter((l) => !lang.alphabet.includes(l));
  }, [animations, media, lang.alphabet]);
  const letterCount = useMemo(
    () => [...animations.keys()].filter((l) => lang.alphabet.includes(l)).length,
    [animations, lang.alphabet],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTokens(textToSigns(input, wordLabels, lang));
  };

  const currentLabel = current && (current.kind === 'letter' || current.kind === 'word') ? current.label : null;

  return (
    <section className="mode" aria-labelledby="titulo-texto-senas">
      <h1 id="titulo-texto-senas">Texto → Señas</h1>
      <p className="mode__intro">
        Escribe una palabra o frase y la app la muestra en {lang.name}. Si no conoce la seña de una palabra, la deletrea
        letra por letra.
      </p>

      {loaded && animations.size === 0 && media.size === 0 && (
        <div className="banner banner--warning">
          Todavía no hay señas grabadas. Las señas se graban en{' '}
          <Link to="/senas-a-texto" className="link">
            Señas → Texto › Entrenar
          </Link>
          , y aquí se muestran con una mano animada.
        </div>
      )}

      <form className="card" onSubmit={submit}>
        <label htmlFor="texto-senas" className="label">
          Texto
        </label>
        <div className="row">
          <input
            id="texto-senas"
            className="input input--grow"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Por ejemplo: hola"
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary" disabled={!input.trim()}>
            Mostrar en señas
          </button>
        </div>
        <p className="muted small">
          Tengo grabadas {letterCount} de {lang.alphabet.length} letras y {wordLabels.length}{' '}
          {wordLabels.length === 1 ? 'palabra' : 'palabras'}.
        </p>
        {media.size > 0 && (
          <label className="check">
            <input type="checkbox" checked={useMedia} onChange={(e) => setUseMedia(e.target.checked)} />
            Mostrar mis fotos y videos en vez de la mano esqueleto (cuando existan)
          </label>
        )}
      </form>

      {tokens.length > 0 && (
        <>
          <section className="card">
            <SignPlayer
              tokens={tokens}
              animations={animations}
              packageVersion={packageVersion}
              media={media}
              useMedia={useMedia}
              onCurrentChange={setCurrent}
            />
          </section>
          {currentLabel && <MediaEditor label={currentLabel} current={media.get(currentLabel)} onChanged={loadMedia} />}
        </>
      )}
    </section>
  );
}
