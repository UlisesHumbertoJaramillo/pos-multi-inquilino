// Lector de códigos que funciona como teclado (T-240; RF-054, D-54): escribe el código muy rápido
// y termina con Enter. Se distingue de una persona tecleando por el tiempo entre teclas.

export interface ScanOptions {
  // Más de este tiempo entre dos teclas: es una persona, se empieza de nuevo.
  maxGapMs?: number;
  minLength?: number;
}

// Devuelve una función que recibe cada tecla y su momento; llama a onScan con el código leído.
// Devuelve true si la tecla terminó una lectura (para no tratar ese Enter como otra cosa).
export function createScanDetector(
  onScan: (code: string) => void,
  { maxGapMs = 50, minLength = 4 }: ScanOptions = {},
): (key: string, at: number) => boolean {
  let buffer = '';
  let last = Number.NEGATIVE_INFINITY;
  return (key, at) => {
    if (at - last > maxGapMs) buffer = '';
    last = at;
    if (key === 'Enter') {
      const code = buffer;
      buffer = '';
      if (code.length >= minLength) {
        onScan(code);
        return true;
      }
      return false;
    }
    if (key.length === 1) buffer += key;
    return false;
  };
}
