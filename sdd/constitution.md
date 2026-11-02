Constitución del Proyecto

1. **Stack:** Backend en Node.js con Express, frontend en React y PostgreSQL como base de datos y fuente de verdad; la aplicación funciona conectada.
2. **Contingencia:** solo la emisión fiscal admite cola temporal; no hay operación offline de catálogo o ventas.
3. **Aislamiento:** cada consulta y escritura valida el tenant en el servidor; ocultar datos en la interfaz no cuenta como protección.
4. **Permisos:** cada acción verifica rol y ámbito (comercio/sucursal); el Super Administrador no accede a datos comerciales.
5. **Retención:** las bajas son lógicas; las operaciones y auditorías no se eliminan físicamente.
6. **Integridad:** cambios de stock, ventas y caja se guardan de forma consistente, incluso ante concurrencia.
7. **Reglas de negocio:** precios, IVA, pagos mixtos, devoluciones y cierres se calculan en lógica verificable del dominio del backend, nunca en la interfaz.
8. **Calidad:** todo cambio debe pasar formato/lint y compilación o verificación de tipos antes de integrarse.
9. **Tests:** toda regla de negocio nueva o modificada incluye pruebas automatizadas.
10. **Seguridad probada:** los tests cubren accesos entre tenants y permisos insuficientes.
11. **Integraciones:** facturación y periféricos se mantienen detrás de límites explícitos; sus fallas no deben falsear una venta como exitosa.
12. **Límites:** quedan fuera de alcance fidelización, e-commerce y conversión multimoneda.
13. **Segregación de funciones:** quien autoriza una operación con PIN o credencial nunca puede ser quien la solicitó, aunque tenga ambos roles.
14. **Arquitectura hexagonal:** el backend sigue una arquitectura hexagonal (puertos y adaptadores). El dominio no depende de frameworks, de la base de datos ni de integraciones externas, que se conectan mediante adaptadores. La arquitectura, sus capas, puertos y adaptadores están documentados y la documentación se mantiene al día con el código.
15. **Separación frontend/backend:** el frontend y el backend son aplicaciones separadas que se comunican solo a través de endpoints del backend. El frontend no contiene lógica de negocio: solo presenta datos, captura entradas y hace validaciones de formato. Toda excepción a esta regla se consulta y se aprueba antes de implementarse.
16. **Endpoints protegidos:** todo endpoint exige autenticación con un token de API válido y vigente, que se verifica en el servidor. Solo son públicos el de salud del sistema, que no expone datos internos, los del flujo de acceso (inicio de sesión, validación de correo y recuperación de contraseña) y los de notificaciones de integraciones externas. Estos últimos se autentican con la firma del proveedor, tienen límite de frecuencia y nunca toman su contenido como verdadero: solo disparan una consulta a la API del proveedor.
17. **Ciberseguridad básica:** la comunicación usa siempre HTTPS. Todas las entradas se validan en el servidor y las consultas se parametrizan. Los intentos de acceso tienen límite de frecuencia. Los tokens vencen y se pueden revocar. Los secretos no se guardan en el código ni en el repositorio. Los registros nunca contienen contraseñas, PIN, tokens ni datos de pago. Las respuestas de error no exponen detalles internos. Las dependencias se mantienen sin vulnerabilidades conocidas.
