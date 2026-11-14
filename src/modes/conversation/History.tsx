import type { HistoryEntry } from '../../lib/db';

interface Props {
  entries: HistoryEntry[];
  onShow: (text: string) => void;
  onSpeak: (text: string) => void;
  onClear: () => void;
}

const LABELS = { oyente: 'Persona oyente', sorda: 'Persona sorda' } as const;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// Historial de la conversación, del mensaje más reciente al más antiguo.
export function History({ entries, onShow, onSpeak, onClear }: Props) {
  const clear = () => {
    if (window.confirm('¿Borrar todo el historial de la conversación?')) onClear();
  };

  return (
    <section className="card" aria-labelledby="titulo-historial">
      <div className="card__header">
        <h2 id="titulo-historial">Historial</h2>
        {entries.length > 0 && (
          <button type="button" className="btn btn--danger" onClick={clear}>
            Borrar historial
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="muted">Todavía no hay mensajes.</p>
      ) : (
        <ol className="history">
          {[...entries].reverse().map((entry) => (
            <li key={entry.id} className={`history__item history__item--${entry.who}`}>
              <div className="history__meta">
                <strong>{LABELS[entry.who]}</strong> · {formatTime(entry.time)}
              </div>
              <p className="history__text">{entry.text}</p>
              <div className="row">
                <button type="button" className="btn btn--small" onClick={() => onShow(entry.text)}>
                  Mostrar
                </button>
                <button type="button" className="btn btn--small" onClick={() => onSpeak(entry.text)}>
                  Decir
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
