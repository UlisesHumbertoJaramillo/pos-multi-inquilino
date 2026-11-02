# Diagrama de contexto

Quién usa el sistema y con qué sistemas externos se comunica. Deriva del [spec](../../sdd/spec.md) (§2, actores) y del [plan](../../sdd/plan.md) (§1).

```mermaid
flowchart TB
  SA["Super Administrador (SA)<br/>Alta y suspensión de comercios, soporte"]
  AC["Administrador de Comercio (AC)<br/>Estructura, catálogo, precios, reportes"]
  AS["Administrador de Sucursal (AS)<br/>Stock, cajas, autorizaciones"]
  VO["Vendedor (VO)<br/>Ventas en el POS, cobros, turnos"]

  POS["Sistema POS Multi-Inquilino<br/>Ventas, inventario, caja, facturación"]

  ARCA["ARCA<br/>Factura electrónica (CAE y CAEA)<br/>módulo opcional"]
  MP["Mercado Pago<br/>Terminales Point y QR"]
  MAIL["Servicio de correo<br/>Validación y recuperación"]
  PERI["Periféricos del puesto<br/>Impresora térmica, lector de códigos"]

  SA -->|Administra la plataforma| POS
  AC -->|Administra su comercio| POS
  AS -->|Opera su sucursal| POS
  VO -->|Vende y cobra| POS

  POS -->|Emite comprobantes| ARCA
  POS -->|Cobra y consulta pagos| MP
  MP -.->|Notifica pagos por webhook firmado| POS
  POS -->|Envía correos| MAIL
  POS -->|Imprime y lee códigos desde el navegador| PERI
```

## Límites

- **Aislamiento:** cada comercio ve solo sus datos. El SA administra la plataforma pero no accede a datos comerciales (Const. 3 y 4).
- **Integraciones:** ARCA y Mercado Pago quedan detrás de puertos explícitos. Sus fallas nunca hacen figurar una venta como exitosa (Const. 11). Las notificaciones de Mercado Pago nunca se toman como verdaderas: solo disparan una consulta a su API (AD-24).
- **Periféricos:** están conectados al equipo del vendedor, así que los maneja el frontend (AD-16).
- **Fuera de alcance:** fidelización de clientes, e-commerce y conversión multimoneda (Const. 12).
