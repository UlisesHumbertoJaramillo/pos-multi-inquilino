# AD-22 · Endpoints públicos limitados a una lista blanca

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** Const. 16, 17, RF-145

## Decisión

Endpoints públicos limitados a una lista blanca explícita (salud, inicio de sesión, validación de correo, recuperación de contraseña, webhooks de integraciones), con límite de frecuencia. Cualquier ruta nueva queda protegida por defecto.

## Alternativa descartada

Proteger cada ruta a mano.

## Por qué

Proteger por defecto evita olvidos. Una prueba recorre todas las rutas registradas y verifica que las que no están en la lista blanca rechacen la solicitud sin token.
