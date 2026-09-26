# Contrato · activación administrativa de los dos pilotos NortexGPT

Fecha local: 2026-09-25. Base: `f538d1a57c49755840656395aa17be1e2bf53187`.
Responsable de producto y revisor humano: Noel. La edición de código y la
integración corresponden a Codex en una copia aislada. Esta ficha no equivale a
autorización de publicación o a prueba de producción.

## Resultado y autoridad

- Objetivo: activar exactamente dos cuentas `ADMIN` de negocios distintos, una
  por vez, con ayuda web publicada y límite de US$2 por negocio al mes.
- Autoridad: sesión vigente `SUPER_ADMIN` de otro tenant, revalidada bajo lock;
  identidad exacta `tenantId/userId` configurada en el entorno de aplicación.
  La lista debe contener exactamente dos pares distintos o la ruta falla cerrada.
- Consentimiento: ya confirmado para el primer cliente; la persona administradora
  revisa negocio, cuenta, rol, estado y hash antes de enviar cada decisión.
- Efecto: configuración auxiliar del asistente y `AuditLog` en una transacción.
  No crea compras, movimientos de stock, cobros, operaciones, extracción ni canal
  privado. La ruta de desactivación conserva el límite y audita la revocación.
- Fuente de ayuda: `nortexgpt-primer-corte-20260923`, manifiesto
  `debdabb3eafa5f4433df61bbfd56ce94c72bc2dddcfffa014389a1bce260ed5c`,
  `PUBLISHED` con revisión autenticada. Otro hash bloquea la activación.
- Condiciones de runtime: flags web y lenguaje activos; flags de operaciones,
  acciones, ejecución, extracción, promociones y WhatsApp apagados; proveedor
  configurado; latido de worker vigente y del mismo SHA.
- Presupuesto: US$2 por tenant y techo compartido US$20 ya impuesto por la
  política de reserva. Esta ruta no llama al modelo ni reserva consumo.

## Identidad, recuperación y QA

- La inspección no muta datos. La activación es idempotente para el mismo estado.
  Ante una respuesta incierta, volver a inspeccionar antes de intentar de nuevo.
- La allowlist reside en Coolify, no en Git; no se guardan correos ni IDs de
  producción en este expediente. Un tercer tenant o una cuenta alterada se
  rechazan. La cuenta de revisión no puede aprobarse a sí misma.
- El estado del worker y el manifiesto se vuelven a comprobar al activar; el
  rol, cuenta, tenant y configuración se vuelven a comprobar dentro de la
  transacción. Desactivar no depende de que el worker esté sano.
- QA local: TypeScript, sistema de diseño y build. La prueba MySQL sintética
  queda integrada en CI; sus resultados corresponden al SHA de su ejecución.
- La prueba de navegador en staging y el smoke de producción quedan pendientes
  hasta desplegar el candidato. No se repetirá la llamada pagada a Haiku.

| Responsable | Archivos |
|---|---|
| Codex | `backend/services/assistant/pilotActivation.ts`, `backend/routes/assistantPilotAdmin.ts`, `backend/routes/assistantMounts.ts`, `components/admin/AssistantPilotActivation.tsx`, `components/SuperAdmin.tsx`, `docker-compose.yml`, `scripts/qa/test-nortexgpt-pilot-admin.ts`, `.github/workflows/ci.yml` |

El integrador de rutas, Compose y CI es Codex. No se extraen monolitos; el
montaje y el panel sólo componen módulos nuevos. Sin efecto sobre carrito,
lector, navegación u operaciones financieras.
