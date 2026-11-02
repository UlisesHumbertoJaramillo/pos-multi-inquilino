// Puerto GeneradorDeId (T-020). Los identificadores son UUID generados por el backend (plan §3.1).
export interface IdGenerator {
  next(): string;
}
