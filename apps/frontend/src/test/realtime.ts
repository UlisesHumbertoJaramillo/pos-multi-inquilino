// WebSocket simulado para las pruebas: se conecta solo, responde "listo" al autenticarse y deja
// que la prueba envíe avisos o corte la conexión.
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  // Falso: las conexiones nuevas fallan (el servidor no responde).
  static reachable = true;

  readyState = FakeWebSocket.CONNECTING;
  sent: Record<string, unknown>[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      if (!FakeWebSocket.reachable) {
        this.close(1006);
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string) {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    if (message.tipo === 'autenticar') {
      setTimeout(() => {
        this.receive({ tipo: 'listo', sucursalId: message.sucursalId ?? null });
      }, 0);
    }
  }

  receive(message: Record<string, unknown>) {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code }));
  }

  // La conexión abierta más reciente.
  static latest(): FakeWebSocket | undefined {
    return [...FakeWebSocket.instances].reverse().find((s) => s.readyState === FakeWebSocket.OPEN);
  }

  static reset() {
    FakeWebSocket.instances = [];
    FakeWebSocket.reachable = true;
  }
}
