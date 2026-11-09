import { describe, expect, it, vi } from 'vitest';
import { createScanDetector } from './barcode';
import { encodeText, encodeTicket } from './escpos';

describe('[RF-158] comandos ESC/POS del ticket', () => {
  it('inicializa, elige la página de códigos y corta el papel', () => {
    const bytes = Array.from(encodeTicket([{ texto: 'Hola', estilo: 'normal' }]));
    expect(bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(bytes.slice(5, 10)).toEqual([0x48, 0x6f, 0x6c, 0x61, 0x0a]);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0]);
  });

  it('resalta la negrita y agranda el título', () => {
    const bold = Array.from(encodeTicket([{ texto: 'A', estilo: 'negrita' }]));
    expect(bold.slice(5, 11)).toEqual([0x1b, 0x45, 1, 0x41, 0x0a, 0x1b]);
    const title = Array.from(encodeTicket([{ texto: 'A', estilo: 'titulo' }]));
    expect(title.slice(5, 10)).toEqual([0x1d, 0x21, 0x11, 0x41, 0x0a]);
  });

  it('traduce acentos y eñes a PC858; lo que no existe sale como «?»', () => {
    expect(encodeText('ñÑáéíóú¿¡')).toEqual([0xa4, 0xa5, 0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xa8, 0xad]);
    expect(encodeText('😀')).toEqual([0x3f]);
  });
});

describe('[RF-054] lector de códigos como teclado', () => {
  const type = (detect: (key: string, at: number) => boolean, text: string, gap: number) => {
    let at = 1000;
    let finished = false;
    for (const key of [...Array.from(text), 'Enter']) {
      at += gap;
      finished = detect(key, at);
    }
    return finished;
  };

  it('reconoce un código tecleado muy rápido y terminado en Enter', () => {
    const onScan = vi.fn();
    expect(type(createScanDetector(onScan), '7790001', 10)).toBe(true);
    expect(onScan).toHaveBeenCalledWith('7790001');
  });

  it('una persona tecleando no es una lectura', () => {
    const onScan = vi.fn();
    expect(type(createScanDetector(onScan), '7790001', 200)).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('un Enter suelto o un código muy corto no cuentan', () => {
    const onScan = vi.fn();
    expect(type(createScanDetector(onScan), '12', 10)).toBe(false);
    expect(onScan).not.toHaveBeenCalled();
  });
});
