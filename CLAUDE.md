# CLAUDE.md — Guía para agentes en Nortex

Nortex es un **ERP/POS multi-tenant** para PyMEs de Nicaragua (ferreterías, pulperías,
farmacias, prestamistas). Stack: **React + Vite** (frontend SPA), **Express + Prisma**
(backend, `backend/server.ts` + `backend/routes/*`), **PostgreSQL**, **TypeScript**.
Maneja **dinero e inventario reales** → la integridad y la seguridad no son negociables.

- Backend se ejecuta con `tsx backend/server.ts` (sin paso de build). Verificar con
  `npx tsc --noEmit`. Frontend: `npm run build` (Vite + PWA).
- Auth: JWT. El middleware `authenticate` (`backend/middleware/auth.ts`) pone
  `req.tenantId` y `req.userId` desde el token verificado. **Esa es la única fuente
  confiable del tenant** — nunca tomar el tenant de `req.body`/query.
- Dinero: usar **`decimal.js`**, nunca `Number`/`parseFloat` para cálculos.

---

## 🔐 Security & Integrity Loop (OBLIGATORIO antes de entregar código)

Antes de escribir, refactorizar o sugerir código/infra, validá mentalmente estas 6
capas. **Si alguna da NO → reescribir antes de responder.** No mostrar intentos
fallidos; entregar solo el resultado que pasa el loop, y confirmar al final:
`✓ Security & Integrity Loop superado` (con el alcance de lo entregado).

**Datos y finanzas**
1. **Aislamiento multi-tenant.** Toda query Prisma sobre datos de negocio incluye
   `tenantId` (o el campo de scoping correcto, p. ej. `lenderId`) tomado de
   `req.tenantId` (JWT). Cuidado especial con `update/delete/findUnique` por `id`
   suelto: agregar el filtro de tenant o verificar propiedad tras leer.
2. **Persistencia segura.** Soft delete (`deletedAt`) para datos de negocio/históricos;
   borrado físico SOLO para data efímera (caché, sesiones, colas temporales).
3. **Inmutabilidad de auditoría.** Si la operación mueve dinero o inventario valorizado,
   registrar en `AuditLog` un asiento inmutable con `before`, `after`, `userId`, `tenantId`.
4. **Precisión financiera.** Esquema `Decimal(18,4)` y código con `decimal.js` estricto
   (cero `Float`/`Number`/`parseFloat` en montos).

**Seguridad y brechas**
5. **Auth y entradas.** Validar `req.body` con **Zod** (nunca confiar a ciegas). Sin
   secretos hardcodeados (todo por variables de entorno; el JWT secret nunca con
   fallback literal). Endpoints de auth con **rate limit**. Endpoints sensibles con
   `authenticate` (+ `checkRole` donde aplique).

**DevOps y resiliencia**
6. **Backups.** Si tocás config de BD/Docker/Coolify/despliegue, garantizar (o exigir)
   **backup automático diario a almacenamiento SEPARADO** del Droplet principal. Si no
   está, incluir el script o alertar al CEO.

---

## ⚠️ Estado actual conocido (línea base — NO asumir cumplimiento)

El loop es el estándar objetivo; el código existente **todavía no lo cumple del todo**.
Gaps conocidos (ver `docs/SECURITY_AUDIT.md` y `docs/SECURITY_REMEDIATION_PLAN.md`):

- **Capa 2:** no hay soft-deletes; ningún modelo tiene `deletedAt` (borrado físico).
- **Capa 4:** hay campos `Decimal(12,2)` / `Decimal(10,2)`, no `(18,4)`.
- **Capa 3:** existe `AuditLog`, pero la cobertura before/after no es universal.
- **Capas 1/5:** revisar el informe de auditoría antes de afirmar que un endpoint es seguro.

Al tocar estas áreas: corregí lo que toques al estándar del loop, y no declares “superado”
a nivel sistema sin respaldo del informe de auditoría.

---

## Convenciones del repo

- Ramas de trabajo: una por feature (`claude/<feature>`); PRs en **draft**.
- Mensajes y UI en **español** (variante nicaragüense); comentarios de código en español.
- Verificación mínima antes de pushear: `npx tsc --noEmit` y (si tocaste frontend)
  `npm run build`.
- No introducir dependencias pesadas sin necesidad; el bundle del SPA ya roza el
  límite de precache del PWA.
