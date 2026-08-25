# Release de activación y retención — 2026-08-25

## Resultado ejecutivo

Esta release reduce la fuga entre visita orgánica, demo, registro y primera venta.
El código local ya está sincronizado sobre `origin/main` (`87239c5`) y conserva los
cambios del flujo de activación sin copiar datos ficticios al negocio real.

Todavía **no debe promoverse**. Estado comprobado el 25 de agosto de 2026:

- Producción está sana en `https://somosnortex.com/api/health` y sirve
  `87239c5c8d3b7dcd2928b838b3d30beeb17c3b73`, el `origin/main` previo a esta release.
- Staging responde `503` (`no available server`).
- `NORTEX_DEPLOY_ENABLED=false`.
- Los environments `staging` y `production` existen; producción exige aprobación.
- No hay secrets configurados en ninguno de los dos environments.
- El SHA objetivo queda pendiente hasta consolidar este worktree en un commit.

No se disparó ningún webhook ni despliegue desde esta preparación.

## Qué entra

- Demo de venta aislada, con elección de método de pago, efectivo recibido, vuelto
  y confirmación explícita.
- Continuidad demo → registro → POS real sin sembrar `stock`, SKU o costo falsos.
- Registro con validación completa antes de red, errores por campo, foco al primer
  error, etiquetas programáticas y control para mostrar la contraseña.
- Aterrizaje del negocio retail nuevo en `/app/inicio?welcome=1`; quien viene de la
  demo continúa en `/app/pos?first_sale=1`.
- Primera venta guiada, alta rápida de producto y cliente dentro del POS, salida
  clara después de vender y checklist que se refresca con datos reales.
- Caja Nica de menor fricción: catálogo y ticket simultáneos, efectivo como acción
  primaria, recibido/vuelto dentro del ticket y transferencia, tarjeta o fiado bajo
  revelado progresivo.
- Guardas de caja para impedir efectivo vacío o insuficiente antes del modo offline
  o del POST; F9 y Ctrl+Enter abren la captura de efectivo en vez de registrar la
  venta sin confirmación.
- Búsqueda por nombre, código o SKU con Enter, categorías táctiles y superficie POS
  full-bleed sin navegación, onboarding ni avisos que tapen el cobro.
- Landing móvil sin colisiones, con una sola ayuda flotante, sin fotos placeholder,
  testimonios inventados ni métricas sociales no verificadas.
- Atribución de adquisición acotada a un allowlist para evitar fuentes arbitrarias
  en Analytics.
- Nuevos guardrails de activación, routing, registro, demo, diseño público y replay
  offline.
- Caja Nica en `/app/pos`: superficie full-bleed sin chrome lateral, catálogo táctil
  por categorías, venta persistente a la derecha, efectivo directo inline con vuelto
  visible y atajos `F9` / `Ctrl` o `Cmd` + `Enter` amarrados a la misma validación
  segura antes de tocar cola offline o `POST` de venta.

## Evidencia de Caja Nica

- La referencia y la implementación real se compararon juntas en desktop
  `1440 × 1024`; la pasada final no dejó hallazgos P0, P1 ni P2.
- El flujo responsive se verificó además en móvil `390 × 844`.
- Prueba funcional de browser:
  - Buscar `arroz` y agregar con `Enter`.
  - Cobro directo en efectivo con total `C$ 174.00`.
  - `100` no permite confirmar; `C$ 200` habilita el cobro y muestra `Vuelto C$ 26.00`.
  - `Otro pago` solo expone transferencia, tarjeta y fiado.
- Estado actual del QA visual: `passed`.

## Compuerta local

Desde la raíz del repositorio:

```bash
npm ci
npm run release:preflight
```

`release:preflight` ejecuta, en este orden:

1. `git diff --check`.
2. `npm audit --omit=dev --audit-level=moderate`.
3. Prisma generate y TypeScript.
4. Suite Vitest completa.
5. Guardrail del sistema de diseño.
6. Mutación Stryker.
7. Build y prerender SEO.

Esta es deliberadamente la parte local y no destructiva de la compuerta. No
declara un release desplegable por sí sola: el commit candidato todavía debe
pasar en CI `deploy-schema-smoke`, `backup-restore-smoke` y la comprobación de
salud con el SHA exacto. El mensaje final del script lo recuerda explícitamente.

Última evidencia local, 25 de agosto de 2026:

- `release:preflight`: aprobado.
- Vitest: 1,485 pruebas aprobadas y 22 omitidas intencionalmente.
- Mutación: 99.61%, por encima del umbral de 99.60%.
- Sistema de diseño: 61 archivos, 0 violaciones.
- Build SEO: aprobado; 71 rutas prerenderizadas y 72 URLs en sitemap.
- QA manual Caja Nica: desktop 1440 × 1024 y móvil 390 × 844, sin errores de
  consola ni diferencias P0/P1/P2 pendientes frente a la referencia elegida.

El upgrade de schema debe pasar además en MySQL 8. La CI lo ejecuta en el job
`deploy-schema-smoke`; para reproducirlo con una base efímera preparada:

```bash
DATABASE_URL='mysql://...' \
LEGACY_SCHEMA_PATH='/ruta/schema-anterior.prisma' \
NORTEX_ALLOW_DESTRUCTIVE_SCHEMA_SMOKE='issue-159-ci-only' \
npm run deploy:schema-smoke
```

Nunca apuntar ese smoke destructivo a staging ni producción.

## Bloqueadores que deben cerrarse

- [ ] Recuperar `https://staging.somosnortex.com` y confirmar HTTPS + `/api/health`.
- [ ] Configurar `COOLIFY_STAGING_WEBHOOK` en el environment `staging`.
- [ ] Configurar `COOLIFY_PROD_WEBHOOK` en el environment `production`.
- [ ] Configurar `COOLIFY_TOKEN` por environment solo si el webhook lo exige.
- [ ] Mantener Auto Deploy apagado en ambas apps de Coolify.
- [ ] Activar Include Source Commit in Build en ambas apps.
- [ ] Verificar un backup reciente y una restauración de prueba antes de producción.
- [ ] Consolidar el worktree, abrir PR y registrar el SHA exacto aprobado por CI.
- [ ] Cambiar `NORTEX_DEPLOY_ENABLED=true` solo cuando todo lo anterior esté listo.

## Promoción

1. Integrar el commit candidato en `main`.
2. Ejecutar el workflow `CI` sobre ese `main`.
3. Esperar `verify` y `deploy-schema-smoke` verdes.
4. Confirmar que staging responde con `ok:true`, `db:"up"` y el SHA objetivo:

   ```bash
   npm run deploy:health -- https://staging.somosnortex.com <SHA>
   ```

5. Ejecutar el smoke funcional de staging de la siguiente sección.
6. Aprobar manualmente el environment `production`.
7. Confirmar producción con el mismo SHA:

   ```bash
   npm run deploy:health -- https://somosnortex.com <SHA>
   ```

## Smoke funcional obligatorio

### Público y móvil (390 × 844)

- `/`: logo, Entrar y Probar una venta no se solapan ni parten en dos líneas.
- `/demo?source=landing_html`: agregar un producto y completar efectivo, tarjeta y
  transferencia; efectivo insuficiente no permite confirmar.
- El éxito del demo aclara que no modificó caja ni inventario.
- `/register?source=demo&intent=completed_sale`: errores vacíos aparecen antes de
  llamar al backend; mostrar/ocultar contraseña funciona.
- Un registro desde demo llega al POS real sin productos de ejemplo en el carrito.
- Un registro directo retail llega a Mi Negocio; un prestamista llega a su panel.
- `/login`: etiquetas accesibles, sesión vencida comprensible y contraseña visible
  solo cuando el usuario lo pide.

### Negocio nuevo

- Agregar el primer producto con nombre, precio, costo y stock reales.
- Buscar por nombre y presionar Enter; debe agregarse el primer resultado visible.
- Con una venta en curso, F9 y Ctrl+Enter deben abrir `Efectivo recibido` sin crear
  la venta todavía.
- Ingresar menos que el total: debe mostrarse `Falta`, la confirmación debe seguir
  deshabilitada y no debe existir request de venta ni cola offline.
- Elegir una denominación sugerida: debe mostrarse el vuelto correcto antes de
  habilitar `Registrar efectivo y seguir`.
- En 390 × 844, abrir el ticket y confirmar que total, recibido, vuelto y CTA no se
  solapan ni quedan debajo de navegación o avisos globales.
- Crear un cliente dentro del POS y volver al cobro sin perder el carrito.
- Completar una venta en efectivo y verificar caja, inventario y ticket.
- Repetir con tarjeta o transferencia.
- Probar fiado: exige cliente y límite; no crea deuda sin confirmación válida.
- Desconectar la red, guardar una venta offline y reconectar; el replay crea una
  sola venta y una sola disminución de stock.
- El checklist se actualiza después de la primera venta y ofrece una salida clara.

### Regresiones incluidas desde `main`

- Apertura de caja sin PIN cuando `requireCashierPin=false`.
- Menú de acciones de caja visible y cerrable con Escape.
- Anulación fiscal conserva el comprobante, no reutiliza el número y revierte los
  efectos una sola vez.
- Backup diario termina con archivo verificable y restauración probada.

## Observación posterior

Durante 30 minutos como mínimo:

- Vigilar Sentry, logs del contenedor, reinicios y respuestas `5xx`.
- Confirmar `/api/health` con el SHA objetivo cada cinco minutos.
- Revisar los eventos `demo_started`, `practice_sale_completed`,
  `register_started`, `sign_up`, `begin_trial` y `first_sale`.
- Confirmar que no aumenta el replay offline fallido ni aparecen ventas duplicadas.
- Registrar por cohorte: visita → demo completada → registro → primera venta en
  24 horas. La retención real se valida con D7 y D14, no por la estética sola.

## Disparadores de rollback

- El SHA esperado no aparece sano en ocho minutos.
- Registro o login devuelve errores generalizados o deja una sesión incompleta.
- Un negocio nuevo recibe productos, stock o costo del demo.
- La primera venta duplica cobro, movimiento de caja o descuento de inventario.
- El replay offline duplica una venta.
- La anulación fiscal o el upgrade de schema falla.
- Aumentan los `5xx` o reinicios después de la promoción.

## Rollback

1. Si falla staging, detener la promoción y no aprobar producción.
2. Si falla producción, volver en Coolify al último deployment sano. Antes de esta
   release, el SHA confirmado es `87239c5c8d3b7dcd2928b838b3d30beeb17c3b73`.
3. No revertir columnas ni índices: las migraciones de anulación y configuración
   de PIN son aditivas y compatibles con la aplicación anterior.
4. Repetir `/api/health`, login, registro, POS, inventario y un replay offline tras
   volver a la versión anterior.
5. Conservar logs, SHA fallido y evidencia del smoke para corregir sin perder causa.
