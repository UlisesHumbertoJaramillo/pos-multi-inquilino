// Impresora elegida en este equipo y su estado (T-238, T-239, T-241; RF-108). La elección es una
// comodidad del equipo (localStorage). Cada cambio de estado se informa al backend para el panel
// técnico del SA; una falla nunca cambia el estado de la venta.
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { PrintLine } from './escpos';
import { PrinterError, type PrinterKind, printerFor } from './printers';

const STORAGE_KIND = 'pos.impresora';

function readKind(): PrinterKind {
  try {
    const value = localStorage.getItem(STORAGE_KIND);
    return value === 'usb' || value === 'serial' || value === 'navegador' ? value : 'ninguna';
  } catch {
    return 'ninguna';
  }
}

export type PrinterStatus =
  { state: 'sin_configurar' } | { state: 'lista' } | { state: 'falla'; message: string };

export interface PrinterControl {
  kind: PrinterKind;
  status: PrinterStatus;
  choose: (kind: PrinterKind) => void;
  // Pide el permiso del dispositivo (desde un toque del usuario).
  connect: () => Promise<boolean>;
  // Devuelve si se imprimió; si no, deja el motivo en status.
  print: (lines: readonly PrintLine[]) => Promise<boolean>;
}

export function usePrinter(): PrinterControl {
  const { request } = useAuth();
  const [kind, setKind] = useState<PrinterKind>(readKind);
  const [status, setStatus] = useState<PrinterStatus>(
    readKind() === 'ninguna' ? { state: 'sin_configurar' } : { state: 'lista' },
  );

  const report = useCallback(
    (current: PrinterKind, estado: 'ok' | 'falla', motivo: string | null) => {
      if (current === 'ninguna') return;
      request('/perifericos/estado', {
        method: 'POST',
        body: JSON.stringify({ dispositivo: 'impresora', conexion: current, estado, motivo }),
      }).catch(() => undefined);
    },
    [request],
  );

  const fail = useCallback(
    (current: PrinterKind, error: unknown) => {
      const failure =
        error instanceof PrinterError
          ? error
          : new PrinterError('error_envio', 'No se pudo enviar el ticket a la impresora.');
      setStatus({ state: 'falla', message: failure.message });
      report(current, 'falla', failure.reason);
    },
    [report],
  );

  const choose = useCallback((next: PrinterKind) => {
    try {
      localStorage.setItem(STORAGE_KIND, next);
    } catch {
      // Sin almacenamiento, la elección dura mientras la página esté abierta.
    }
    setKind(next);
    setStatus(next === 'ninguna' ? { state: 'sin_configurar' } : { state: 'lista' });
  }, []);

  const connect = useCallback(async () => {
    const printer = printerFor(kind);
    if (!printer) return false;
    try {
      await printer.connect();
      setStatus({ state: 'lista' });
      return true;
    } catch (error: unknown) {
      fail(kind, error);
      return false;
    }
  }, [kind, fail]);

  const print = useCallback(
    async (lines: readonly PrintLine[]) => {
      const printer = printerFor(kind);
      if (!printer) return false;
      try {
        await printer.print(lines);
        setStatus({ state: 'lista' });
        report(kind, 'ok', null);
        return true;
      } catch (error: unknown) {
        fail(kind, error);
        return false;
      }
    },
    [kind, fail, report],
  );

  return useMemo(
    () => ({ kind, status, choose, connect, print }),
    [kind, status, choose, connect, print],
  );
}
