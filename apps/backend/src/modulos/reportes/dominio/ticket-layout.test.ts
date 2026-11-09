import { describe, expect, it } from 'vitest';
import { TICKET_WIDTH, type TicketLayoutInput, ticketLines } from './ticket-layout.js';

const ticket: TicketLayoutInput = {
  state: 'confirmada',
  ticketNumber: 15,
  confirmedAt: new Date('2026-11-03T04:05:00Z'),
  tenant: {
    name: 'Comercio A',
    cuit: '30-12345678-9',
    currency: 'ARS',
    timeZone: 'America/Argentina/Buenos_Aires',
  },
  branch: { name: 'Centro', address: 'Av. Siempre Viva 742' },
  register: 'Caja 1',
  seller: 'Valeria',
  customer: null,
  items: [
    {
      name: 'Agua mineral sin gas de 1,5 litros en botella retornable de vidrio',
      quantity: '2.000',
      unitPrice: '1000.00',
      gross: '2000.00',
      promotion: { name: '10 % en agua', discount: '200.00' },
      manualDiscount: '0.00',
    },
  ],
  payments: [
    {
      method: 'Efectivo',
      type: 'efectivo',
      amount: '1800.00',
      surcharge: '0.00',
      tendered: '2000.00',
      change: '200.00',
    },
  ],
  totals: {
    subtotal: '2000.00',
    promotionDiscount: '200.00',
    manualDiscount: '0.00',
    total: '1800.00',
    surcharges: '0.00',
    charged: '1800.00',
  },
  voucher: null,
  legend: 'Ticket no válido como factura.',
};

// Texto a la izquierda y monto a la derecha, completando el ancho del papel.
const row = (left: string, right: string) =>
  `${left}${' '.repeat(TICKET_WIDTH - left.length - right.length)}${right}`;

const texts = (t: TicketLayoutInput) => ticketLines(t).map((l) => l.text);

describe('[RF-107] [RF-158] diagramación del ticket de 80 mm', () => {
  it('ninguna línea se pasa del ancho del papel', () => {
    for (const line of ticketLines(ticket)) {
      const width = line.style === 'titulo' ? TICKET_WIDTH / 2 : TICKET_WIDTH;
      expect(line.text.length).toBeLessThanOrEqual(width);
    }
  });

  it('trae el encabezado, los ítems con su promoción, los totales y la leyenda', () => {
    const lines = ticketLines(ticket);
    expect(lines[0]).toEqual({
      text: expect.stringContaining('Comercio A') as string,
      style: 'titulo',
    });
    const all = texts(ticket);
    // La fecha va en la zona del comercio: 01:05 del 3 de noviembre.
    expect(all).toContainEqual(expect.stringMatching(/^Ticket 15 +03\/11\/2026,? 01:05$/));
    expect(all).toContainEqual(row('  2 x $ 1.000,00', '$ 2.000,00'));
    expect(all).toContainEqual(row('  10 % en agua', '-$ 200,00'));
    expect(lines).toContainEqual({ text: row('TOTAL', '$ 1.800,00'), style: 'negrita' });
    expect(all).toContainEqual(row('  Vuelto', '$ 200,00'));
    expect(all.some((l) => l.includes('Ticket no válido como factura.'))).toBe(true);
  });

  it('un nombre largo se recorta al ancho', () => {
    const name = texts(ticket).find((l) => l.startsWith('Agua mineral'));
    expect(name).toHaveLength(TICKET_WIDTH);
    expect(name?.endsWith('.')).toBe(true);
  });

  it('una venta facturada muestra el comprobante y una anulada lo indica', () => {
    const billed = texts({
      ...ticket,
      state: 'anulada',
      voucher: {
        voucherClass: 'B',
        pointOfSale: 1,
        number: '7',
        cae: '12345678901234',
        caea: null,
      },
    });
    expect(billed).toContain('Factura B 00001-00000007');
    expect(billed).toContain('CAE 12345678901234');
    expect(billed.some((l) => l.includes('VENTA ANULADA'))).toBe(true);
  });

  it('usa solo caracteres que la impresora puede imprimir', () => {
    for (const line of texts(ticket)) expect(line).not.toMatch(/[\u00a0\u2026\u2014]/);
  });
});
