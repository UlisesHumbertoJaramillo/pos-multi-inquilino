// Adaptador del puerto Clock con la hora del sistema.
import type { Clock } from '../../aplicacion/clock.js';

export const systemClock: Clock = {
  now: () => new Date(),
};
