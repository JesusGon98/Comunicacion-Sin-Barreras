import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Dibuja "content" dentro de otro lugar de la página (por ejemplo, encima del video
 * de la cámara). Si ese lugar todavía no existe, no dibuja nada.
 */
export function inSlot(el: HTMLElement | null, content: ReactNode) {
  return el ? createPortal(content, el) : null;
}
