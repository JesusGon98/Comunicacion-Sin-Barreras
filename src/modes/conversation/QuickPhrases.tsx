import { useState } from 'react';
import { DEFAULT_PHRASES } from '../../lib/db';

interface Props {
  phrases: string[];
  /** Se llama al tocar una frase (para decirla en voz alta). */
  onSelect: (phrase: string) => void;
  /** Se llama al guardar cambios en la lista. */
  onChange: (phrases: string[]) => void;
}

// Botones de frases rápidas, con un modo para editarlas.
export function QuickPhrases({ phrases, onSelect, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const startEditing = () => {
    setDraft([...phrases]);
    setEditing(true);
  };

  const save = () => {
    // Quitamos frases vacías antes de guardar
    onChange(draft.map((p) => p.trim()).filter(Boolean));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="phrases-edit">
        <ul className="phrases-edit__list">
          {draft.map((phrase, i) => (
            <li key={i} className="phrases-edit__row">
              <input
                className="input"
                value={phrase}
                aria-label={`Frase ${i + 1}`}
                onChange={(e) => setDraft(draft.map((p, j) => (j === i ? e.target.value : p)))}
              />
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                aria-label={`Borrar la frase "${phrase}"`}
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={() => setDraft([...draft, ''])}>
            + Agregar frase
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setDraft([...DEFAULT_PHRASES])}>
            Volver a las originales
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            Guardar
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {phrases.length === 0 ? (
        <p className="muted">No hay frases rápidas. Toca "Editar frases" para agregar algunas.</p>
      ) : (
        <div className="phrases">
          {phrases.map((phrase, i) => (
            <button key={i} type="button" className="btn btn--phrase" onClick={() => onSelect(phrase)}>
              {phrase}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn btn--link" onClick={startEditing}>
        Editar frases
      </button>
    </div>
  );
}
