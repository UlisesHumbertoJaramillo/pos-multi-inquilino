// Codifica el ticket que arma el backend en comandos ESC/POS para una impresora térmica
// (T-238; RF-158, AD-16). No decide qué se imprime: solo traduce las líneas a bytes.

export type PrintStyle = 'normal' | 'negrita' | 'titulo';

export interface PrintLine {
  texto: string;
  estilo: PrintStyle;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Página de códigos PC858 (PC850 con €): la que traen casi todas las térmicas para español.
const PC858: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  É: 0x90,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  Ö: 0x99,
  Ü: 0x9a,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  '¿': 0xa8,
  '¡': 0xad,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  '€': 0xd5,
  Ê: 0xd2,
  Í: 0xd6,
  Ó: 0xe0,
  Ú: 0xe9,
  '°': 0xf8,
  '·': 0xfa,
};

// Lo que la impresora no puede mostrar sale como «?».
export function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else bytes.push(PC858[char] ?? 0x3f);
  }
  return bytes;
}

export function encodeTicket(lines: readonly PrintLine[]): Uint8Array {
  const bytes: number[] = [
    ESC,
    0x40, // inicializar
    ESC,
    0x74,
    19, // página de códigos PC858
  ];
  for (const line of lines) {
    if (line.estilo === 'titulo') bytes.push(GS, 0x21, 0x11); // doble ancho y alto
    if (line.estilo === 'negrita') bytes.push(ESC, 0x45, 1);
    bytes.push(...encodeText(line.texto), LF);
    if (line.estilo === 'titulo') bytes.push(GS, 0x21, 0x00);
    if (line.estilo === 'negrita') bytes.push(ESC, 0x45, 0);
  }
  bytes.push(
    ESC,
    0x64,
    4, // avanzar 4 líneas
    GS,
    0x56,
    0x42,
    0, // corte parcial
  );
  return Uint8Array.from(bytes);
}
