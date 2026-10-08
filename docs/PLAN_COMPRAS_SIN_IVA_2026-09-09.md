# Plan — Compras que no llevan IVA (traslación del IVA en la factura de compra)

> **Estado:** Fase A y Fase B-7 (UI de Compras) **implementadas** en este candidato;
> Fase B-8 (captura de NortexGPT), Fase C y Fase D siguen pendientes — ver §6 y §10.
> **Corte de código analizado:** `ba9cf30` (main al 2026-09-09).
> **Dueño de edición propuesto:** Compras/Finanzas (`nortex-finance`), con integración de
> libros fiscales coordinada con `nortex-contador` y captura de NortexGPT con `nortex-intelligence`.
> **Alcance:** código, schema aditivo y pruebas. **No** autoriza staging ni producción;
> la promoción sigue `docs/runbooks/release-promotion.md`.

---

## 1. Qué hace hoy el código (evidencia leída, no memoria)

El IVA de una compra **se deriva**, nunca se declara. Hay exactamente dos ejes en el código:

| Eje | Dónde vive | Qué decide |
|---|---|---|
| Exención **del producto** | `backend/services/purchaseRegistrationPreparation.ts:242` → `taxable: !product.ivaExento` | si esa línea genera IVA |
| Régimen **del comprador** | `…Preparation.ts:123-124` → `cuotaFijaPurchase` | si ese IVA es **acreditable** |

Y una sola fórmula:

```ts
// backend/lib/purchaseMoney.ts:60
const lineTax = input.taxable
    ? lineNet.mul('0.15').toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);
// :62 — el régimen del comprador solo apaga la ACREDITABILIDAD, no la traslación
const lineCreditableTax = allowsCreditableTax ? lineTax : new Decimal(0);
```

**Falta el tercer eje: si el proveedor trasladó IVA en esa factura.** No existe campo, ni en
`CreatePurchaseSchema` (`backend/validation/schemas.ts:374-406`), ni en el modelo `Purchase`
(`backend/prisma/schema.prisma:893-930`), ni en la UI. Si el producto está gravado, Nortex
**siempre** cobra 15%, contra el papel que tiene el usuario en la mano.

El cliente espeja la misma constante por separado (`components/Purchases.tsx:1014-1023`), así
que hoy hay dos copias del 15% que pueden divergir.

`Supplier.fiscalCategory` (`schema.prisma:809`) ya ofrece un `datalist` con
`GENERAL | CUOTA_FIJA | EXEMPT | OTHER` (`components/Suppliers.tsx:734`), pero es texto libre
y **no se usa en ningún cálculo** (`supplierService.ts:104,151,229` solo lo copian). Es una
trampa: parece configurable y no configura nada.

---

## 2. Casos reales de Nicaragua que hoy no se pueden registrar

1. **Proveedor de cuota fija.** El régimen simplificado no traslada IVA. Es el caso más común
   comprando a distribuidores chicos, pulperías mayoristas y talleres.
2. **Proveedor no inscrito / recibo simple.** Sin documento fiscal no hay IVA ni crédito.
3. **Importación.** El proveedor extranjero factura sin IVA; el IVA se liquida en aduana con
   otro documento.
4. **Exoneración documentada** (cooperativas, productor agropecuario en régimen especial).
5. **Base mixta.** Hoy *se calcula* bien (línea exenta vs. gravada) pero **no se reporta**
   separada — ver §4.

Los casos 1-4 no tienen representación posible. El operador solo puede: registrar un total
inflado, o falsear el costo unitario para que el total cuadre (rompiendo costo promedio,
Kardex y margen).

---

## 3. Daño medible hoy — es dinero, no cosmética

Factura real de un proveedor de cuota fija: **C$1,000.00**, productos gravados, contado.
Con el código actual Nortex registra:

| Efecto | Valor registrado | Realidad | Referencia |
|---|---|---|---|
| `Purchase.tax` | 150.00 | 0.00 | `purchaseRegistrationService.ts:188` |
| `Purchase.total` | 1,150.00 | 1,000.00 | `…:191` |
| `balanceDue` (crédito) | 1,150.00 | 1,000.00 | `…:200` — la CxP **nunca liquida** contra el pago real |
| Salida de gaveta (contado) | 1,150.00 | 1,000.00 | `…:444` `registrarSalidaDeCajaPorCompra(total)` → **el cierre Z no cuadra** |
| IVA Crédito `1.1.5` | 150.00 | 0.00 | `accounting.ts:buildPurchaseJournalLines` → **crédito fiscal inexistente** |
| Libro de compras / VET | IVA acreditable 150.00 | 0.00 | `fiscalExports.ts:177,301` |
| Constancia de retención | emite `IVA_RETENIDO` 150.00 | no aplica | `retentionCertificate.ts:47-53` (`purchase.tax > 0`) |
| Nota de crédito del proveedor | IVA proporcional fantasma | 0.00 | `supplierCreditNotes.ts:777-789` deriva del ítem |

Los dos últimos convierten el error en **riesgo fiscal declarado ante la DGI**: menos IVA a
pagar del que corresponde, y una constancia emitida sobre un impuesto que nunca se trasladó.

**Además, NortexGPT ya detecta la contradicción y no la puede resolver.** La captura
textual guarda el IVA impreso (`purchaseDocumentContext.ts:74`, `extraction.ts:15`) y
`totalIssues` lo compara contra el cálculo:

```ts
// backend/services/assistant/proposalValidation.ts:54-58
`El ${…} del documento (${draft[field]}) difiere del cálculo de Nortex (${totals[key]})…`
```

Con una factura sin IVA de productos gravados esa discrepancia es **permanente e
irresoluble**: `toPurchaseInput` (`:42-53`) descarta `documentTax`, así que no hay forma de
que el operador le diga a Nortex que el papel tiene razón.

---

## 4. Gap adicional confirmado: el libro fiscal nunca reporta base exenta

```ts
// backend/routes/fiscalExports.ts:305-309
const subtotalD = totalD.minus(ivaD)…
const exentoD = Decimal.max(0, totalD.minus(subtotalD).minus(ivaD))…
```

Por construcción `total = subtotal + tax`, así que **esa columna sale `0.00` siempre**. Una
farmacia que compra medicamento exento lo reporta como base gravada en la VET. El XLSX del
libro de compras (`:190-199`) tampoco tiene columna de exento.

Causa raíz: `Purchase.subtotal` mezcla base gravada y base exenta en un solo número, y
`PurchaseItem` no conserva si la línea era gravada al momento de comprar.

---

## 5. Diseño propuesto

### 5.1 Tercer eje: traslación en el documento

`Purchase.taxTreatment` — **VarChar(32), default `IVA_TRASLADADO`** (los históricos conservan
su significado sin backfill, igual que `fiscalRegimeAtPurchase`):

| Valor | Efecto |
|---|---|
| `IVA_TRASLADADO` | comportamiento actual: 15% sobre las líneas gravadas |
| `SIN_TRASLADO` | `lineTax = 0` en **toda** línea, gravada o no; `total = subtotal` |

`Purchase.noTaxReason` — VarChar(32), **obligatorio** cuando `SIN_TRASLADO`, nulo si no:
`PROVEEDOR_CUOTA_FIJA` · `PROVEEDOR_NO_INSCRITO` · `IMPORTACION_IVA_ADUANA` ·
`EXONERACION_DOCUMENTADA`.

**Reglas fail-closed** (todas verificadas en la función pura y re-verificadas antes de escribir):

- `SIN_TRASLADO` ⇒ `tax = 0` ∧ `creditableTax = 0` ∧ `total = subtotal`.
- `SIN_TRASLADO` sin motivo ⇒ 400. Motivo con `IVA_TRASLADADO` ⇒ 400. Vocabulario cerrado
  por Zod `z.enum`, nunca texto libre.
- El tratamiento **se congela en el documento** (mismo patrón que `fiscalRegimeAtPurchase`):
  jamás se re-deriva del proveedor al leer. Un proveedor que cambia de régimen no reinterpreta
  facturas viejas.
- `Supplier.fiscalCategory` normalizada solo **sugiere** el default en la UI. Nunca es
  autoridad: el backend acepta lo validado que llega, no lo que el proveedor "es" hoy.
- `IMPORTACION_IVA_ADUANA` **no** genera crédito fiscal aquí. El IVA de aduana es otro
  documento y queda **fuera de alcance** (§8).

### 5.2 Bases separadas para el libro fiscal

Aditivo y nullable, para no reinterpretar históricos (mismo patrón que `balanceDue`/`creditableTax`):

- `Purchase.taxableSubtotal Decimal? @db.Decimal(18,4)` — base gravada
- `Purchase.exemptSubtotal Decimal? @db.Decimal(18,4)` — base exenta
- `PurchaseItem.taxableAtPurchase Boolean?` — verdad fiscal de la línea

El campo por línea **no es redundante**: bajo `SIN_TRASLADO` todas las líneas tienen
`taxAmountExact = 0.00`, así que sin él es imposible distinguir *"línea exenta"* de
*"línea gravada que el proveedor no trasladó"* — y la DGI los reporta distinto.

`calculatePurchaseMoney` devuelve además `taxableSubtotal` y `exemptSubtotal`. Con eso
`fiscalExports` deja de derivar el exento por una resta imposible; las filas con NULL siguen
la ruta legacy **declarada explícitamente en el código**, no por accidente.

### 5.3 Una sola copia de la regla

El vocabulario y la resolución del tratamiento van a `shared/purchaseTaxTreatment.ts` (puro,
sin Prisma — mismo patrón que `shared/promotions.ts`, ya importado por
`components/pos/PromotionTotals.ts` y `backend/services/promotions/*`). El dinero sigue siendo
autoridad del servidor: `backend/lib/purchaseMoney.ts` importa el vocabulario, y
`components/Purchases.tsx` deja de duplicar el `'0.15'` (`:1018`).

`buildPurchasePreview` (`purchaseRegistrationPreview.ts`) ya expone `subtotal/tax/creditableTax/
total` autoritativos y los sella en `purchasePayloadHash`. Al entrar `taxTreatment` en `input`,
el hash lo cubre automáticamente — pero **la versión sube a 2** porque cambia la forma de
`effects`: una vista previa aprobada con un tratamiento no puede registrarse con otro.

---

## 6. Fases (PRs secuenciales en draft — mergear A antes de construir B)

### Fase A — Núcleo, schema y registro — **IMPLEMENTADA**
1. `shared/purchaseTaxTreatment.ts`: enum, motivos, `resolveTaxTreatmentSuggestion(fiscalCategory)`.
2. `backend/lib/purchaseMoney.ts`: `calculatePurchaseMoney(inputs, allowsCreditableTax, taxTreatment)`
   + `taxableSubtotal`/`exemptSubtotal` en el retorno.
3. Schema aditivo (`nortex-migration`): los 3 campos de §5.2 + los 2 de §5.1, con migración
   en `backend/prisma/migrations/` y backticks MySQL. Sin `UNIQUE` nuevo ⇒ sin preflight
   state-based. `db push` estrictamente aditivo.
4. `CreatePurchaseSchema`: `taxTreatment` (`z.enum`, default `IVA_TRASLADADO`) + `noTaxReason`,
   con `superRefine` cruzado en ambas direcciones.
5. `…Preparation.ts` + `…Service.ts`: propagar, persistir cabecera y línea, y re-verificar
   la invariante antes del `create`.
6. `buildPurchasePreview`: exponer tratamiento/motivo, `version: 2`.

### Fase B — UI de Compras (**7 implementada**) y captura de NortexGPT (**8 pendiente**)
7. `components/Purchases.tsx`: selector en la cabecera de la factura, default sugerido por
   `fiscalCategory` del proveedor, motivo obligatorio al elegir `SIN_TRASLADO`, y desglose
   *base gravada / base exenta / IVA* en el resumen. Sin cálculo local del 15%.
8. Asistente: `taxTreatment` y `noTaxReason` como hechos capturados. Cuando `documentTax = 0.00`
   con productos gravados, **propone** `SIN_TRASLADO` y **pregunta el motivo** —
   `proposalValidation.toPurchaseInput` los pasa y `totalIssues` compara contra el cálculo
   correcto. El chat sigue **sin confirmar compras**: confirma el operador en Compras
   (contrato vigente de `docs/NORTEXGPT_OPERATIVO_2026-09-05.md`).

### Fase C — Libros fiscales y constancias
9. `fiscalExports.ts`: columna real de base exenta en XLSX y VET desde `exemptSubtotal`
   (NULL ⇒ ruta legacy declarada). Marca de compra sin traslación análoga al
   `# COMPRA CUOTA_FIJA` existente (`:314-316`).
10. `retentionCertificate.ts`: hoy omite `IVA_RETENIDO` por `tax > 0` — correcto **por
    accidente**; fijarlo con una prueba explícita sobre el tratamiento.
11. `accounting.ts / buildPurchaseJournalLines`: **paso separado y decidible.** Con `tax = 0`
    escribe una línea `1.1.5` con `debit 0 / credit 0` — una forma que el normalizador
    estricto vigente **rechaza** (`journalPosting.ts:287`: `debitAmount.isZero() === creditAmount.isZero()`),
    y que además toma un `FOR UPDATE` sobre la cuenta por un movimiento de cero
    (`accounting.ts:239-251`). Omitir la línea nula deja 2 líneas (`1.1.4` + contrapartida),
    así que el asiento sigue siendo válido. **Es un delta de conducta sobre las compras
    exentas que ya existen** y `buildPurchaseJournalLines` está bajo mutación (232/232
    killed): requiere pruebas nuevas que maten los mutantes nuevos. Si el delta no se quiere
    ahora, se difiere sin bloquear el feature — pero entonces `SIN_TRASLADO` multiplica esas
    filas en cero.

---

## 7. Pruebas exigidas (no alcanza con que pasen: tienen que matar bugs)

**Mutación obligatoria.** `backend/lib/purchaseMoney.ts` está en `stryker.config.json:65`.
El umbral **solo sube**: si el cambio lo hunde, se arregla el test. Nunca se baja el umbral
ni se debilita una aserción. Igual para los rangos de `accounting.ts` si se hace el paso 11.

| Prueba | Qué caracteriza |
|---|---|
| `tests/purchaseMoney.test.ts` (extender) | `SIN_TRASLADO` ⇒ 0 en línea gravada y exenta; `taxableSubtotal + exemptSubtotal = subtotal` a centavos; liquidación por línea preservada (C$0.10 → 0.02 / 0.12) |
| `tests/purchaseSchema.test.ts` | motivo faltante ⇒ 400; motivo con `IVA_TRASLADADO` ⇒ 400; valor fuera del enum ⇒ 400 |
| `tests/purchaseRegistration.test.ts` | tratamiento congelado en `Purchase`; `taxableAtPurchase` por línea; invariante re-verificada antes del `create` |
| `tests/purchaseRegistration.integration.test.ts` (**HTTP + MySQL real**, `npm run test:integration:required`) | factura C$1,000 `SIN_TRASLADO`: `total = 1,000`, `balanceDue = 1,000`, salida de gaveta 1,000, `1.1.5 = 0`, `AuditLog` `before//after` en la misma tx, costo promedio y Kardex intactos |
| `tests/fiscalFlow.integration.test.ts` | libro de compras y VET con base exenta real y crédito 0 |
| `tests/returnAccounting.test.ts` / `supplierCreditNoteService.test.ts` | la nota de crédito de una compra sin traslación deriva IVA 0 |
| `tests/assistantPurchaseIntake.test.ts` / `assistantInvoiceReview.test.tsx` | `documentTax = 0.00` con producto gravado ⇒ propone `SIN_TRASLADO`, exige motivo, `totalIssues` queda vacío; el chat no confirma |
| `tests/purchaseSupplierPaymentsUx.test.tsx` | el pago liquida exactamente la CxP sin traslación |

Compuerta local antes de pushear: `npx tsc --noEmit` y `npm run build` (Fase B toca frontend),
más `sh scripts/ci-local-safe.sh`.

---

## 8. Límites declarados (lo que este plan NO hace)

- **No** implementa el IVA de importación en aduana (documento y crédito propios).
- **No** toca `Product.price/cost` Float legacy ni la transición a Decimal (Capa 4 pendiente).
- **No** representa descuentos, flete ni otros cargos — `proposalValidation.ts:32-35` ya los
  rechaza explícitamente y siguen fuera de alcance.
- **No** hace backfill de compras históricas. Quedan como `IVA_TRASLADADO` porque eso es lo
  que se les cobró. Corregir una compra ya posteada es **anulación + reemisión**, no un
  `UPDATE`; si producto quiere reparar el histórico, es su propio expediente con
  reconciliación de mayor, CxP y libros.
- **No** decide si a un proveedor de cuota fija se le retiene IR 2% / IMI 1%.
  `retentionCertificate.ts:44-47` los calcula sobre `subtotal` sin mirar el régimen del
  proveedor. **Pregunta abierta para `nortex-contador`**, no para resolver en código sin
  criterio contable escrito.
- No certifica nada del sistema: `Security & Integrity Loop` se declarará superado sólo con
  los controles efectivamente ejecutados de §7, y con su alcance nombrado.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un operador marca `SIN_TRASLADO` por error y se pierde crédito fiscal legítimo | Motivo obligatorio de vocabulario cerrado, default sugerido por el proveedor, y el tratamiento visible en el detalle de la compra y en el libro |
| Divergencia cliente/servidor del 15% | El cliente deja de calcular: regla en `shared/`, dinero autoritativo del servidor y sellado en el hash del preview (v2) |
| Vista previa aprobada con un tratamiento y registrada con otro | `purchasePayloadHash` ya cubre `input`; subir a `version: 2` invalida previews de forma vieja |
| El paso 11 rompe asientos existentes de compras exentas | Es un delta declarado, con pruebas propias y mutación; diferible sin bloquear las Fases A-C |

---

## 10. Lo entregado en este candidato (Fase A + Fase B-7)

**Archivos.** `utils/purchaseTaxTreatment.ts` (regla pura nueva, compartida) ·
`utils/purchaseTaxTreatmentLabels.ts` (copy, deliberadamente fuera de la red de mutación) ·
`backend/lib/purchaseMoney.ts` · `backend/prisma/schema.prisma` +
`migrations/20260909_purchase_tax_treatment/` · `backend/validation/schemas.ts` ·
`backend/services/purchaseRegistration{Preparation,Service,Preview}.ts` ·
`components/Purchases.tsx` · `stryker.config.json` · `scripts/check-mutation-scope.cjs`.

**Decisión de diseño frente al plan original:** la tasa y la regla de traslación viven en
`utils/`, no en `shared/`, para espejar `utils/fiscalRegime.ts` — que ya es la regla fiscal
pura compartida por frontend y backend y ya está bajo mutación. `components/Purchases.tsx`
importa `purchaseLineTax` y perdió su copia literal del `'0.15'`.

**QA ejecutado localmente (Node 22.22.2, Prisma 6.4.1 pineado):**

| Verificación | Resultado |
|---|---|
| `prisma validate` + `generate` | OK |
| `tsc --noEmit` | Limpio salvo el bloqueo de `xlsx` (§11) |
| Suite completa Vitest | 5.798 pasan · 3 fallan, **todas** por `xlsx` (§11) |
| Mutación dirigida `utils/purchaseTaxTreatment.ts` | **100.00%** (65/65) |
| Mutación dirigida `backend/lib/purchaseMoney.ts` | **100.00%** (24/24, subió de 21) |
| Pruebas nuevas | 57 puras + 9 de servicio + 5 de conducta UI en jsdom |

Los 9 mutantes que sobrevivieron en la primera corrida se resolvieron **sin bajar el umbral**:
8 eran etiquetas de presentación —se movieron a `purchaseTaxTreatmentLabels.ts`, porque una red
de mutación sobre *copy* solo congela la redacción y no caza ningún bug— y 1 era el centinela
`?? ''` de `suggestPurchaseTaxTreatment`, un **mutante equivalente** que se eliminó
reformulando con encadenamiento opcional en vez de documentarlo como aceptable.

`stryker.config.json` movió el rango `schemas.ts:838-850` → `868-880`: la edición de
`CreatePurchaseSchema` desplazó `canonicalizeCloseShiftPayload` exactamente +30 líneas, y el
rango viejo habría mutado otro código. Los pisos de `check-mutation-scope.cjs` subieron
(21 → 24) y se agregó el del módulo nuevo (65). **Ningún umbral bajó.**

## 11. Bloqueos externos de este entorno (acción pendiente, no PASS)

Ambos son del entorno remoto, ajenos al diff, y **CI los cubre**:

1. **`xlsx` no instalable.** `package.json` lo pinea a `https://cdn.sheetjs.com/...`, host
   denegado por la política de egress (`403 CONNECT`). Sin él `npm ci` no completa, así que
   se instaló el resto y quedaron rojos 13 archivos de prueba —todos por
   `Cannot find package 'xlsx'`, ninguno de compras ni fiscal— y `npm run build` muere al
   resolver `xlsx` desde `components/HRM.tsx` **después** de transformar 1.893 módulos,
   incluido `Purchases.tsx`. `tests/posVentaCritica.test.tsx` es parte de ese bloqueo: **la
   conducta del POS no pudo ejecutarse acá**. El diff no toca POS.
2. **`npm run test:integration:required` no ejecutable.** El wrapper exige Docker y el daemon
   no está disponible (`/var/run/docker.sock` ausente). Este cambio **mueve dinero**
   (CxP, gaveta, mayor), así que la evidencia HTTP + MySQL real es obligatoria y queda a
   cargo del job `integration-required` del PR.

Por eso **no se declara `Security & Integrity Loop superado` a nivel de sistema**. Lo que sí
está comprobado y con qué alcance está en §10.

## 12. Pendiente inmediato de Fase B-8 (declarado, falla cerrado)

La captura de NortexGPT **todavía no envía** `taxTreatment`: `toPurchaseInput` no lo incluye,
así que una factura sin IVA capturada por chat cae en el default `IVA_TRASLADADO` y
`totalIssues` reporta la discrepancia contra el `documentTax = 0.00` impreso. Es decir, el
asistente **bloquea** en vez de registrar una compra inflada —falla cerrado— y el operador la
registra correctamente en Compras. Cerrar B-8 elimina esa fricción.
