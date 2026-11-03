// Reglas del dominio de proveedores y compras (T-105 a T-109).
import { describe, expect, it } from 'vitest';
import { parseCatalogCsv } from './catalog-import.js';
import {
  assertNoBalance,
  assertPaymentWithinBalance,
  normalizeCuit,
  purchaseLines,
  settlePurchaseReception,
  type Supplier,
} from './suppliers.js';

describe('[RF-034] CUIT', () => {
  it.each([
    ['30712345671', '30712345671'],
    ['20-12345678-6', '20123456786'],
    ['', null],
  ])('%s → %s', (value, expected) => {
    expect(normalizeCuit(value)).toBe(expected);
  });

  it.each(['30712345672', '3071234567', 'abcdefghijk'])('rechaza %s', (value) => {
    expect(() => normalizeCuit(value)).toThrow(expect.objectContaining({ code: 'CUIT_INVALIDO' }));
  });
});

describe('[RF-036] total de una compra', () => {
  it.each([
    [[{ quantity: '12', unitCost: '150' }], '1800.00'],
    [[{ quantity: '2.5', unitCost: '199.99' }], '499.98'],
    [[{ quantity: '0.333', unitCost: '10' }], '3.33'],
    [[{ quantity: '1', unitCost: '0.005' }], 'error'],
  ])('%j → %s', (items, total) => {
    const lines = items.map((item, i) => ({ productId: String(i), ...item }));
    if (total === 'error') {
      expect(() => purchaseLines(lines)).toThrow();
    } else {
      expect(purchaseLines(lines).total).toBe(total);
    }
  });

  it('rechaza una compra vacía o con productos repetidos', () => {
    expect(() => purchaseLines([])).toThrow();
    expect(() =>
      purchaseLines([
        { productId: 'a', quantity: '1', unitCost: '1' },
        { productId: 'a', quantity: '1', unitCost: '1' },
      ]),
    ).toThrow();
  });
});

describe('[RF-133] recepción de una compra', () => {
  const items = [
    { itemId: 'i1', productId: 'agua', quantity: '12.000' },
    { itemId: 'i2', productId: 'soda', quantity: '6.000' },
  ];

  it('registra la diferencia; lo no informado no se recibió', () => {
    expect(settlePurchaseReception(items, [{ productId: 'agua', quantity: '10' }])).toStrictEqual([
      { itemId: 'i1', productId: 'agua', received: '10.000', difference: '2.000' },
      { itemId: 'i2', productId: 'soda', received: '0.000', difference: '6.000' },
    ]);
  });

  it.each([
    [[{ productId: 'agua', quantity: '12.001' }], 'RECEPCION_EXCEDIDA'],
    [[{ productId: 'otro', quantity: '1' }], 'RECEPCION_INVALIDA'],
    [[{ productId: 'agua', quantity: '-1' }], 'CANTIDAD_INVALIDA'],
  ])('rechaza %j', (received, code) => {
    expect(() => settlePurchaseReception(items, received)).toThrow(
      expect.objectContaining({ code }),
    );
  });
});

describe('[RF-038] pagos que superan la deuda', () => {
  it.each([
    ['1000.00', '400.00', false, false],
    ['1000.00', '1000.00', false, false],
    ['1000.00', '1000.01', true, true],
  ])('saldo %s, pago %s, confirmado %s → excede %s', (balance, amount, confirmed, exceeds) => {
    expect(assertPaymentWithinBalance(balance, amount, confirmed)).toStrictEqual({ exceeds });
  });

  it('sin confirmación, un pago de más se rechaza', () => {
    expect(() => assertPaymentWithinBalance('10.00', '10.01', false)).toThrow(
      expect.objectContaining({ code: 'PAGO_EXCEDE_DEUDA' }),
    );
  });

  it('[RF-148] un proveedor con saldo no se da de baja', () => {
    const supplier: Supplier = {
      id: 's',
      tenantId: 't',
      name: 'Sur',
      cuit: null,
      contact: null,
      balance: '-0.01',
      isActive: true,
    };
    expect(() => {
      assertNoBalance(supplier);
    }).toThrow();
    expect(() => {
      assertNoBalance({ ...supplier, balance: '0.00' });
    }).not.toThrow();
  });
});

describe('[RF-035] lectura del CSV de catálogo', () => {
  it('lee comas, comillas y filas incompletas', () => {
    const csv = [
      'codigo_barras,nombre,costo,categoria',
      '1,"Vino ""tinto"", 750 ml",900,Vinos',
      '',
      '2,Soda',
    ].join('\n');
    expect(parseCatalogCsv(csv)).toStrictEqual({
      rows: [
        { line: 2, barcode: '1', name: 'Vino "tinto", 750 ml', cost: '900', category: 'Vinos' },
      ],
      errors: [{ line: 4, barcode: '2', reason: 'La fila no tiene todas las columnas.' }],
    });
  });

  it.each([
    ['1.250,50', '1250.50'],
    ['1250.50', '1250.50'],
    ['90', '90'],
  ])('con punto y coma, el costo %s es %s', (cost, expected) => {
    const csv = `Código de barras;Nombre;Costo;Categoría\n1;Agua;${cost};Bebidas`;
    expect(parseCatalogCsv(csv).rows[0]?.cost).toBe(expected);
  });

  it('exige el encabezado', () => {
    expect(() => parseCatalogCsv('a,b,c\n1,2,3')).toThrow(
      expect.objectContaining({ code: 'CSV_INVALIDO' }),
    );
  });
});
