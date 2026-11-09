// Diagramación del ticket para la impresora térmica (T-238; RF-107, RF-158, AD-16, D-92).
// El backend arma el documento línea por línea y el frontend solo lo envía a la impresora: así el
// ticket impreso dice lo mismo en cualquier equipo. Papel de 80 mm: 48 caracteres por línea.

export const TICKET_WIDTH = 48;

// normal: una línea de hasta 48 caracteres. negrita: igual, resaltada. titulo: doble ancho y alto,
// hasta 24 caracteres.
export type LineStyle = 'normal' | 'negrita' | 'titulo';

export interface PrintLine {
  text: string;
  style: LineStyle;
}

export interface TicketLayoutInput {
  state: string;
  ticketNumber: number | null;
  confirmedAt: Date | null;
  tenant: { name: string; cuit: string | null; currency: string; timeZone: string };
  branch: { name: string; address: string | null };
  register: string;
  seller: string;
  customer: { name: string; document: string | null } | null;
  items: {
    name: string;
    quantity: string;
    unitPrice: string;
    gross: string;
    promotion: { name: string; discount: string } | null;
    manualDiscount: string;
  }[];
  payments: {
    method: string;
    type: string;
    amount: string;
    surcharge: string;
    tendered: string;
    change: string;
  }[];
  totals: {
    subtotal: string;
    promotionDiscount: string;
    manualDiscount: string;
    total: string;
    surcharges: string;
    charged: string;
  };
  voucher: {
    voucherClass: string | null;
    pointOfSale: number | null;
    number: string | null;
    cae: string | null;
    caea: string | null;
  } | null;
  legend: string;
}

const isZero = (amount: string) => Number(amount) === 0;

function money(amount: string, currency: string): string {
  // El espacio duro de Intl no existe en la página de códigos de la impresora.
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency })
    .format(Number(amount))
    .replace(/\u00a0/g, ' ');
}

// Cantidad sin ceros de más: 2.000 → 2, 1.500 → 1,5.
function quantity(value: string): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Number(value));
}

// Recorta para que nunca se pase del ancho del papel.
function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}.`;
}

function center(text: string, width = TICKET_WIDTH): string {
  const clipped = fit(text, width);
  const left = Math.floor((width - clipped.length) / 2);
  return `${' '.repeat(left)}${clipped}`.trimEnd();
}

// Texto a la izquierda y monto a la derecha, en una sola línea.
function columns(left: string, right: string, width = TICKET_WIDTH): string {
  const room = width - right.length - 1;
  const text = fit(left, Math.max(room, 1));
  return `${text}${' '.repeat(Math.max(width - text.length - right.length, 1))}${right}`;
}

// Parte un texto largo en líneas del ancho del papel, sin cortar palabras si se puede.
function wrap(text: string, width = TICKET_WIDTH): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      if (current !== '') lines.push(current);
      current = fit(word, width);
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

function dateTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

const RULE = '-'.repeat(TICKET_WIDTH);

export function ticketLines(t: TicketLayoutInput): PrintLine[] {
  const lines: PrintLine[] = [];
  const add = (text: string, style: LineStyle = 'normal') => {
    lines.push({ text, style });
  };
  const $ = (amount: string) => money(amount, t.tenant.currency);

  add(center(t.tenant.name, TICKET_WIDTH / 2), 'titulo');
  for (const line of wrap(
    [t.branch.name, t.branch.address].filter((x): x is string => x !== null).join(' · '),
  )) {
    add(center(line));
  }
  if (t.tenant.cuit !== null) add(center(`CUIT ${t.tenant.cuit}`));
  add(RULE);
  add(
    columns(
      `Ticket ${t.ticketNumber === null ? '-' : String(t.ticketNumber)}`,
      t.confirmedAt === null ? '' : dateTime(t.confirmedAt, t.tenant.timeZone),
    ),
  );
  add(fit(`Caja: ${t.register} · Vendedor: ${t.seller}`, TICKET_WIDTH));
  if (t.customer !== null) {
    add(
      fit(
        `Cliente: ${t.customer.name}${t.customer.document === null ? '' : ` (${t.customer.document})`}`,
        TICKET_WIDTH,
      ),
    );
  }
  if (t.state === 'anulada') add(center('*** VENTA ANULADA ***'), 'negrita');
  add(RULE);

  for (const item of t.items) {
    add(fit(item.name, TICKET_WIDTH));
    add(columns(`  ${quantity(item.quantity)} x ${$(item.unitPrice)}`, $(item.gross)));
    if (item.promotion !== null) {
      add(columns(`  ${item.promotion.name}`, `-${$(item.promotion.discount)}`));
    }
    if (!isZero(item.manualDiscount)) {
      add(columns('  Descuento', `-${$(item.manualDiscount)}`));
    }
  }
  add(RULE);

  add(columns('Subtotal', $(t.totals.subtotal)));
  if (!isZero(t.totals.promotionDiscount)) {
    add(columns('Promociones', `-${$(t.totals.promotionDiscount)}`));
  }
  if (!isZero(t.totals.manualDiscount)) {
    add(columns('Descuento', `-${$(t.totals.manualDiscount)}`));
  }
  add(columns('TOTAL', $(t.totals.total)), 'negrita');
  for (const p of t.payments) {
    add(columns(p.method, $(p.amount)));
    if (!isZero(p.surcharge)) add(columns('  Recargo', $(p.surcharge)));
    if (p.type === 'efectivo' && !isZero(p.change)) {
      add(columns('  Entregado', $(p.tendered)));
      add(columns('  Vuelto', $(p.change)));
    }
  }
  if (!isZero(t.totals.surcharges)) add(columns('Total cobrado', $(t.totals.charged)), 'negrita');
  add(RULE);

  const v = t.voucher;
  if (v?.number != null) {
    add(
      fit(
        `Factura ${v.voucherClass ?? ''} ${String(v.pointOfSale ?? 0).padStart(5, '0')}-${v.number.padStart(8, '0')}`,
        TICKET_WIDTH,
      ),
    );
    if (v.cae !== null) add(fit(`CAE ${v.cae}`, TICKET_WIDTH));
    if (v.caea !== null) add(fit(`CAEA ${v.caea}`, TICKET_WIDTH));
  }
  for (const line of wrap(t.legend)) add(center(line), 'negrita');
  add(center('¡Gracias por su compra!'));
  return lines;
}
