// Puerto Reloj (T-020). Los casos de uso nunca leen la hora del sistema directamente:
// así las pruebas controlan el tiempo (vencimientos, jornadas, plazos).
export interface Clock {
  now(): Date;
}
