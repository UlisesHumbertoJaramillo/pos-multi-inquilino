// Reglas del dominio de inventario (T-089 a T-095).
import { describe, expect, it } from 'vitest';
import { adjustmentOperation, normalizeMinimum, OPERATIONS, thresholdTransition } from './stock.js';
import { normalizeItems, settleReception, settleRejection, type Transfer } from './transfers.js';

describe('[RF-039] operaciones entre estados', () => {
  it.each([
    ['reservar', 'disponible', 'reservado'],
    ['liberar', 'reservado', 'disponible'],
    ['consumir', 'reservado', null],
    ['pasarARevision', null, 'en_revision'],
    ['pasarATransito', 'disponible', 'en_transito'],
    ['rechazarTransferencia', 'en_transito', 'disponible'],
  ] as const)('%s mueve de %s a %s', (name, from, to) => {
    expect(OPERATIONS[name]).toMatchObject({ from, to });
  });
});

describe('[RF-040] ajustes con signo', () => {
  it.each([
    ['5', 'ajustarSuma', '5.000'],
    ['+2.5', 'ajustarSuma', '2.500'],
    ['-0.25', 'ajustarResta', '0.250'],
  ])('%s → %s de %s', (delta, operation, quantity) => {
    expect(adjustmentOperation(delta.replace('+', ''))).toStrictEqual({ operation, quantity });
  });

  it.each(['0', 'abc', '1.0001'])('rechaza el ajuste %s', (delta) => {
    expect(() => adjustmentOperation(delta)).toThrow();
  });

  it('un umbral vacío lo quita', () => {
    expect(normalizeMinimum('')).toBeNull();
    expect(normalizeMinimum('5')).toBe('5.000');
    expect(() => normalizeMinimum('-1')).toThrow();
  });
});

describe('[RF-041] alerta una vez por cruce del umbral', () => {
  it.each([
    ['4.000', '5.000', false, 'emit'],
    ['3.000', '5.000', true, 'none'],
    ['5.000', '5.000', true, 'rearm'],
    ['9.000', '5.000', false, 'none'],
    ['0.000', null, false, 'none'],
    ['0.000', null, true, 'rearm'],
  ] as const)('disponible %s, umbral %s, alerta %s → %s', (available, minimum, active, result) => {
    expect(thresholdTransition(available, minimum, active)).toBe(result);
  });
});

const transfer = (): Transfer => ({
  id: 't',
  tenantId: 'c',
  originId: 'o',
  destinationId: 'd',
  state: 'enviada',
  items: [
    { productId: 'leche', sent: '4.000', received: null, rejected: null, missing: null },
    { productId: 'galle', sent: '6.000', received: null, rejected: null, missing: null },
  ],
});

describe('[RF-045] [RF-046] [RF-150] recepción de una transferencia', () => {
  it('recepción completa', () => {
    const result = settleReception(transfer(), [
      { productId: 'leche', received: '4', rejected: '0' },
      { productId: 'galle', received: '6', rejected: '0' },
    ]);
    expect(result.state).toBe('recibida');
    expect(result.items.map((i) => i.missing)).toStrictEqual(['0.000', '0.000']);
  });

  it('el faltante es lo que no se recibió ni se rechazó', () => {
    const result = settleReception(transfer(), [
      { productId: 'leche', received: '3', rejected: '0.5' },
    ]);
    expect(result.state).toBe('parcial');
    expect(result.items).toStrictEqual([
      { productId: 'leche', sent: '4.000', received: '3.000', rejected: '0.500', missing: '0.500' },
      // No informado: faltante entero.
      { productId: 'galle', sent: '6.000', received: '0.000', rejected: '0.000', missing: '6.000' },
    ]);
  });

  it('rechazar todo deja la transferencia rechazada', () => {
    expect(
      settleReception(transfer(), [
        { productId: 'leche', received: '0', rejected: '4' },
        { productId: 'galle', received: '0', rejected: '6' },
      ]).state,
    ).toBe('rechazada');
    expect(settleRejection(transfer()).items.map((i) => i.rejected)).toStrictEqual([
      '4.000',
      '6.000',
    ]);
  });

  it.each([
    [[{ productId: 'leche', received: '4.001', rejected: '0' }], 'RECEPCION_EXCEDIDA'],
    [[{ productId: 'leche', received: '3', rejected: '2' }], 'RECEPCION_EXCEDIDA'],
    [[{ productId: 'otro', received: '1', rejected: '0' }], 'RECEPCION_INVALIDA'],
    [
      [
        { productId: 'leche', received: '1', rejected: '0' },
        { productId: 'leche', received: '1', rejected: '0' },
      ],
      'RECEPCION_INVALIDA',
    ],
  ])('rechaza %j', (lines, code) => {
    expect(() => settleReception(transfer(), lines)).toThrow(expect.objectContaining({ code }));
  });

  it('una transferencia cerrada no se vuelve a recibir', () => {
    expect(() => settleReception({ ...transfer(), state: 'cancelada' }, [])).toThrow(
      expect.objectContaining({ code: 'TRANSFERENCIA_CERRADA' }),
    );
  });
});

describe('[RF-044] ítems de una transferencia', () => {
  it('normaliza las cantidades y rechaza repetidos y vacíos', () => {
    expect(normalizeItems([{ productId: 'a', quantity: '2' }])).toStrictEqual([
      { productId: 'a', quantity: '2.000' },
    ]);
    expect(() => normalizeItems([])).toThrow();
    expect(() =>
      normalizeItems([
        { productId: 'a', quantity: '1' },
        { productId: 'a', quantity: '1' },
      ]),
    ).toThrow();
    expect(() => normalizeItems([{ productId: 'a', quantity: '0' }])).toThrow();
  });
});
