import { describe, expect, it } from 'vitest';
import { navigationFor } from './navigation';

const labels = (role: 'AC' | 'AS' | 'VO', billingModule: boolean) =>
  navigationFor(role, billingModule).map((item) => item.label);

describe('[RF-165] funciones fiscales en el menú', () => {
  it('sin el módulo de facturación no se muestran', () => {
    expect(labels('AC', false)).not.toContain('Configuración fiscal');
    expect(labels('AC', false)).not.toContain('Comprobantes');
    expect(labels('AS', false)).not.toContain('Comprobantes');
  });

  it('con el módulo activo sí, y el resto del menú no cambia', () => {
    expect(labels('AC', true)).toContain('Configuración fiscal');
    expect(labels('AC', true)).toContain('Comprobantes');
    expect(labels('AS', true)).toContain('Comprobantes');
    expect(labels('AC', false)).toContain('Catálogo');
    expect(labels('VO', false)).toEqual(labels('VO', true));
  });
});
