// Íconos sencillos en SVG (sin librerías externas, para que funcionen offline).
// aria-hidden porque siempre van acompañados de un texto visible.

const base = {
  width: 32,
  height: 32,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function ChatIcon() {
  return (
    <svg {...base}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

export function HandIcon() {
  return (
    <svg {...base}>
      <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6" />
      <path d="M11 11V3.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11V5a1.5 1.5 0 0 1 3 0v7" />
      <path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a8 8 0 0 1-8 8h-1a7 7 0 0 1-5.6-2.8L3 16a1.6 1.6 0 0 1 2.4-2.1L8 16" />
    </svg>
  );
}

export function CameraIcon() {
  return (
    <svg {...base}>
      <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function MicIcon({ size = 32 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function SpeakerIcon() {
  return (
    <svg {...base}>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

// Cambiar entre cámara frontal y trasera
export function SwitchCameraIcon() {
  return (
    <svg {...base}>
      <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 12.5a3 3 0 0 1 5.2-2" />
      <path d="M14.5 8.5v2h-2" />
      <path d="M15 13.5a3 3 0 0 1-5.2 2" />
      <path d="M9.5 17.5v-2h2" />
    </svg>
  );
}

// Apagar (cámara)
export function PowerIcon() {
  return (
    <svg {...base}>
      <path d="M12 3v9" />
      <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
    </svg>
  );
}

// Borrar una letra
export function BackspaceIcon() {
  return (
    <svg {...base}>
      <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
      <path d="M13 9.5l5 5" />
      <path d="M18 9.5l-5 5" />
    </svg>
  );
}

// Borrar todo
export function TrashIcon() {
  return (
    <svg {...base}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}

// Barra espaciadora
export function SpaceIcon() {
  return (
    <svg {...base}>
      <path d="M4 10v4h16v-4" />
    </svg>
  );
}

// Mostrar en grande
export function ExpandIcon() {
  return (
    <svg {...base}>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

// Ajustes deslizables
export function SlidersIcon() {
  return (
    <svg {...base}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg {...base}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
