// Adaptadores de impresora del navegador (T-238, T-239; RF-108, RF-158, AD-16, D-92):
// - usb: WebUSB (Chrome y Edge). El permiso se pide una vez; después imprime sin diálogos.
// - serial: WebSerial, para impresoras que el sistema expone como puerto COM.
// - navegador: impresión del navegador en formato de 80 mm. Muestra el diálogo, salvo que Chrome
//   corra con --kiosk-printing.
// El agente local queda pendiente (D-92): se sumaría como otra implementación de TicketPrinter.
import { encodeTicket, type PrintLine } from './escpos';

export type PrinterKind = 'usb' | 'serial' | 'navegador' | 'ninguna';

export type FailureReason =
  'sin_soporte' | 'sin_permiso' | 'desconectada' | 'error_envio' | 'sin_papel';

export class PrinterError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'PrinterError';
  }
}

export interface TicketPrinter {
  kind: Exclude<PrinterKind, 'ninguna'>;
  // Pide el permiso del dispositivo. Tiene que llamarse desde un toque del usuario.
  connect(): Promise<void>;
  print(lines: readonly PrintLine[]): Promise<void>;
}

// Tipos mínimos de WebUSB y WebSerial: TypeScript no los trae en la librería del DOM.
interface UsbEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
}
interface UsbInterface {
  interfaceNumber: number;
  alternate: { endpoints: UsbEndpoint[] };
}
interface UsbDevice {
  vendorId: number;
  productId: number;
  opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(number: number): Promise<void>;
  releaseInterface(number: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string }>;
  close(): Promise<void>;
}
interface Usb {
  requestDevice(options: { filters: object[] }): Promise<UsbDevice>;
  getDevices(): Promise<UsbDevice[]>;
}
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface Serial {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

const nav = () => navigator as Navigator & { usb?: Usb; serial?: Serial };

const STORAGE_DEVICE = 'pos.impresoraUsb';

function rememberDevice(device: UsbDevice) {
  try {
    localStorage.setItem(
      STORAGE_DEVICE,
      JSON.stringify({ vendorId: device.vendorId, productId: device.productId }),
    );
  } catch {
    // Sin almacenamiento se usa el primer dispositivo autorizado.
  }
}

function rememberedDevice(): { vendorId: number; productId: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_DEVICE);
    return raw === null ? null : (JSON.parse(raw) as { vendorId: number; productId: number });
  } catch {
    return null;
  }
}

function asPrinterError(error: unknown, fallback: FailureReason): PrinterError {
  if (error instanceof PrinterError) return error;
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotFoundError') {
    return new PrinterError('sin_permiso', 'No se eligió ninguna impresora.');
  }
  if (name === 'SecurityError') {
    return new PrinterError('sin_permiso', 'El navegador no dio permiso para usar la impresora.');
  }
  if (name === 'NetworkError' || name === 'InvalidStateError') {
    return new PrinterError(
      'desconectada',
      'La impresora no responde: revisá que esté encendida y conectada.',
    );
  }
  return new PrinterError(fallback, 'No se pudo enviar el ticket a la impresora.');
}

export class UsbPrinter implements TicketPrinter {
  readonly kind = 'usb' as const;

  async connect(): Promise<void> {
    const usb = nav().usb;
    if (!usb) throw new PrinterError('sin_soporte', 'Este navegador no permite impresoras USB.');
    try {
      rememberDevice(await usb.requestDevice({ filters: [] }));
    } catch (error: unknown) {
      throw asPrinterError(error, 'sin_permiso');
    }
  }

  private async device(): Promise<UsbDevice> {
    const usb = nav().usb;
    if (!usb) throw new PrinterError('sin_soporte', 'Este navegador no permite impresoras USB.');
    const devices = await usb.getDevices();
    const wanted = rememberedDevice();
    const device =
      devices.find((d) => d.vendorId === wanted?.vendorId && d.productId === wanted.productId) ??
      devices[0];
    if (!device) {
      throw new PrinterError(
        'desconectada',
        'La impresora no está conectada o falta autorizarla en «Impresora».',
      );
    }
    return device;
  }

  async print(lines: readonly PrintLine[]): Promise<void> {
    const device = await this.device();
    try {
      if (!device.opened) await device.open();
      if (device.configuration === null) await device.selectConfiguration(1);
      const target = device.configuration?.interfaces.find((i) =>
        i.alternate.endpoints.some((e) => e.direction === 'out' && e.type === 'bulk'),
      );
      const endpoint = target?.alternate.endpoints.find(
        (e) => e.direction === 'out' && e.type === 'bulk',
      );
      if (!target || !endpoint) {
        throw new PrinterError('error_envio', 'El dispositivo elegido no es una impresora.');
      }
      await device.claimInterface(target.interfaceNumber);
      try {
        const result = await device.transferOut(endpoint.endpointNumber, encodeTicket(lines));
        if (result.status !== 'ok') {
          throw new PrinterError('error_envio', 'La impresora no aceptó el ticket.');
        }
      } finally {
        await device.releaseInterface(target.interfaceNumber).catch(() => undefined);
      }
    } catch (error: unknown) {
      throw asPrinterError(error, 'error_envio');
    }
  }
}

export class SerialPrinter implements TicketPrinter {
  readonly kind = 'serial' as const;

  async connect(): Promise<void> {
    const serial = nav().serial;
    if (!serial) throw new PrinterError('sin_soporte', 'Este navegador no permite puertos serie.');
    try {
      await serial.requestPort();
    } catch (error: unknown) {
      throw asPrinterError(error, 'sin_permiso');
    }
  }

  async print(lines: readonly PrintLine[]): Promise<void> {
    const serial = nav().serial;
    if (!serial) throw new PrinterError('sin_soporte', 'Este navegador no permite puertos serie.');
    const [port] = await serial.getPorts();
    if (!port) {
      throw new PrinterError(
        'desconectada',
        'La impresora no está conectada o falta autorizarla en «Impresora».',
      );
    }
    try {
      await port.open({ baudRate: 9600 });
      const writer = port.writable?.getWriter();
      if (!writer) throw new PrinterError('error_envio', 'No se pudo escribir en el puerto.');
      try {
        await writer.write(encodeTicket(lines));
      } finally {
        writer.releaseLock();
      }
    } catch (error: unknown) {
      throw asPrinterError(error, 'error_envio');
    } finally {
      await port.close().catch(() => undefined);
    }
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ticket de 80 mm con el diálogo de impresión del navegador.
export class BrowserPrinter implements TicketPrinter {
  readonly kind = 'navegador' as const;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  print(lines: readonly PrintLine[]): Promise<void> {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const body = lines
      .map((l) => {
        const text = escapeHtml(l.texto) || '&nbsp;';
        if (l.estilo === 'titulo') return `<div class="t">${text}</div>`;
        if (l.estilo === 'negrita') return `<div class="b">${text}</div>`;
        return `<div>${text}</div>`;
      })
      .join('');
    // El documento se carga con srcdoc y se imprime cuando terminó de cargar.
    return new Promise((resolve, reject) => {
      frame.onload = () => {
        const target = frame.contentWindow;
        if (!target) {
          frame.remove();
          reject(new PrinterError('sin_soporte', 'No se pudo preparar la impresión.'));
          return;
        }
        target.focus();
        target.print();
        setTimeout(() => {
          frame.remove();
        }, 1000);
        resolve();
      };
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title><style>
        @page { size: 80mm auto; margin: 3mm; }
        body { margin: 0; font: 12px/1.25 'Courier New', monospace; white-space: pre; }
        .b { font-weight: 700; }
        .t { font-weight: 700; font-size: 24px; line-height: 1.2; }
      </style></head><body>${body}</body></html>`;
    });
  }
}

export function printerFor(kind: PrinterKind): TicketPrinter | null {
  if (kind === 'usb') return new UsbPrinter();
  if (kind === 'serial') return new SerialPrinter();
  if (kind === 'navegador') return new BrowserPrinter();
  return null;
}

export const PRINTER_LABELS: Record<PrinterKind, string> = {
  usb: 'Térmica por USB',
  serial: 'Térmica por puerto serie',
  navegador: 'Impresión del navegador',
  ninguna: 'Sin impresora',
};

export function supportedKinds(): PrinterKind[] {
  const kinds: PrinterKind[] = ['ninguna', 'navegador'];
  if (nav().usb) kinds.push('usb');
  if (nav().serial) kinds.push('serial');
  return kinds;
}
