# Nortex

ERP/POS multi-tenant para comercios de Nicaragua: ventas, inventario, caja, fiado, compras y contabilidad, con capacidades por tipo de negocio. La aplicación usa React/PWA, Express, Prisma y MySQL 8.

La prioridad del ciclo iniciado el 2026-09-04 es validar activación y recurrencia en ferreterías y farmacias, consolidar el núcleo y preparar asistencia RAG por web/WhatsApp. El código existente no equivale a una capacidad validada en producción.

## Empezar por aquí

- [Plan de transformación](docs/PLAN_TRANSFORMACION_TOTAL_2026.md): prioridades, fases, responsables, métricas y aceptación.
- [Auditoría general del 4 de septiembre](docs/AUDITORIA_GENERAL_2026-09-04.md): evidencia local, hallazgos y límites.
- [Índice de documentación](docs/README.md): planes de dominio, historial y estados de verificación.
- [Reglas de trabajo](AGENTS.md) y [guía de dominio](CLAUDE.md): leer antes de modificar el producto.

## Desarrollo local

Runtime canónico Node 22.23.2 mediante mise; npm y package-lock.json; Prisma 6.4.1. MySQL 8 es la base transaccional. No usar PostgreSQL para el core ni cambiar lockfile.

```sh
mise install
mise exec -- npm ci
```

En la estación configurada de Nortex, los servicios locales se administran desde `~/Developer/Nortex`:

```sh
nortex db-up
nortex backend
nortex frontend
```

Backend: `127.0.0.1:3210`; frontend seguro: `127.0.0.1:4174`. El comando `nortex` es una herramienta de esa estación; no viene instalado automáticamente por npm. En otro equipo, preparar MySQL y configuración local mediante el responsable del entorno antes de iniciar backend. No usar el Compose de producción como entorno general.

## Comprobaciones

```sh
mise exec -- sh scripts/ci-local-safe.sh
```

La compuerta genera Prisma, verifica tipos, ejecuta Vitest, diseño y build. Requiere configuración exclusivamente local. Si cambia lógica monetaria, ejecutar también la mutación con `NORTEX_CI_MUTATION=1`. Las suites HTTP/MySQL condicionadas necesitan un entorno QA efímero explícito: un `npm test` verde con omisiones no las reemplaza.

Build normal: `npm run build`; build público con prerender: `npm run build:seo`. No ejecutar estos comandos con secretos de producción en el entorno: revisar las variables de build y mantener cualquier proveedor IA en backend.

## Mapa de código

| Área | Ubicación |
|---|---|
| Aplicación y navegación | App.tsx, components/Layout.tsx, utils/navigation.ts |
| POS y venta | components/POS.tsx, components/pos/, backend/services/salesService.ts |
| Inventario | backend/services/stockService.ts, componentes y servicios de lotes/bodegas |
| API y dominio | backend/server.ts, backend/routes/, backend/services/ |
| Persistencia | backend/prisma/schema.prisma, backend/prisma/migrations/ |
| WhatsApp | backend/services/whatsapp/ |
| Pruebas y CI | tests/, .github/workflows/ci.yml |

## Estado de WhatsApp/RAG

Hay webhook firmado, routing por canal, menú/LLM opcional y búsqueda FULLTEXT de productos. Están pendientes identidad privada fuerte, recepción/salida durable, bandeja humana y RAG documental con permisos/citas. Consultar [infraestructura actual](docs/WHATSAPP_INFRA.md) y [plan de migración](docs/PLAN_MIGRACION_RAG_WHATSAPP_ESCALA.md) antes de activar un canal.

## Integridad y releases

El tenant se deriva del contexto autenticado; dinero nuevo usa Decimal; stock usa applyStockDelta; auditoría y efectos financieros permanecen atómicos. Preservar cambios locales existentes. La documentación no autoriza deploy, push, merge, DNS ni mensajes externos. Una release debe conservar evidencia de CI, SHA exacto, backup/restore, staging y verificaciones del dominio.
