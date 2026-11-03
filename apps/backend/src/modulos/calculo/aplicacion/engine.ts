// Motor de cálculo (plan §2.9): API pública para ventas, devoluciones y caja. No tiene tablas ni
// puertos; los otros módulos lo usan desde su capa de aplicación (Const. 7, AD-15).
export { allocate, cents, type Cents, money } from '../dominio/rounding.js';
export {
  computeSale,
  discountPercent,
  formatTotals,
  type ManualDiscount,
  type SaleLineInput,
  type SaleTotals,
  vatBreakdown,
  vatIncluded,
} from '../dominio/sale.js';
export {
  adjustFractions,
  type FractionInput,
  type PaymentPlan,
  planPayment,
} from '../dominio/payments.js';
export {
  creditRefund,
  refundByFraction,
  returnedLineValue,
  totalRefund,
} from '../dominio/refunds.js';
