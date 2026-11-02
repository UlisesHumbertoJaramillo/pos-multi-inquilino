// Reloj simulado para las pruebas: la hora solo cambia cuando la prueba lo indica.
import type { Clock } from '../../src/compartido/aplicacion/clock.js';

export class ManualClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-11-02T12:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string): void {
    this.current = new Date(at);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
