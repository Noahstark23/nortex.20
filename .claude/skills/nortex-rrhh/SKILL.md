---
name: nortex-rrhh
description: "Dominio de nómina y RRHH de Nortex — Ley 185 de Nicaragua tal como vive en el código - INSS/IR/aguinaldo/vacaciones/indemnización Art. 45, planilla mensual, liquidaciones, deducciones judiciales, y qué está marcado VERIFICAR. Usar SIEMPRE que se toque nicaLabor.ts, calc-laborales.ts, hr.ts, los endpoints /api/payroll|/api/hrm|/api/me, o cualquier cálculo laboral. El motor puro es la única fuente de fórmulas - no reintroducir cálculos fuera de él."
---

# Nómina y RRHH en Nortex (Ley 185 Nicaragua)

La nómina mueve el dinero más sensible del sistema: salarios de gente real. Las
fórmulas viven en **UN solo motor puro** y todo lo demás orquesta. Leer `AGENTS.md` y `CLAUDE.md`. Esta guía describe el código; las fórmulas y tasas
requieren revisión humana contra fuentes oficiales vigentes. No acredita
cumplimiento legal ni autoriza cambios de dinero por sí misma.

## 1. Mapa del subsistema

**Motor puro (sin Prisma) — la fuente de verdad:**
- `backend/services/nicaLabor.ts` — 3 funciones exportadas: `calculatePayroll`,
  `calculateLaborLiability`, `calculateSettlement`. decimal.js `ROUND_HALF_UP`,
  `precision: 20`. **No importa Prisma a propósito.**
- `utils/calc-laborales.ts` — **espejo client-side puro** para las calculadoras del
  blog (`calcAguinaldo`, `calcVacaciones`, `calcHorasExtras`, `calcINSS`,
  `calcLiquidacion`, `calcIVA`). Doctrina del header: *si cambia una fórmula legal,
  se actualizan AMBOS lados*.
- `utils/tasas.ts` — tasas del blog. El ERP **NO la importa todavía** (deuda
  declarada): la tabla IR y las tasas están **duplicadas** entre `nicaLabor.ts` y
  `tasas.ts` sin import compartido.

**Orquestación:**
- `backend/routes/hr.ts` (montado en `/api/hr`) — asistencia (clock-in/out por
  PIN), adelantos, ausencias, expediente, contratos, judiciales, feriados.
  `requireHRAdmin` = OWNER|ADMIN|SUPER_ADMIN|MANAGER (**no incluye ACCOUNTANT** —
  la planilla tiene su propio contrato de permisos; no unificar roles por suposición).
- `backend/server.ts` — **la nómina real vive acá**, no en hr.ts:
  `POST /api/payroll/calculate` (el corazón), `POST /api/payroll/:id/pay`,
  aguinaldo (`GET|POST /api/payroll/aguinaldo/:year[/run]`), liquidación
  (`/api/hrm/settlement*`), autoservicio (`/api/me/*` vía `findMyEmployee`),
  `salarioBaseLiquidacion` (Art. 78: promedio últimos 6 `Payroll`).
- Asientos (`backend/services/accounting.ts`): `recordPayroll` (Debe 5.2.2/5.2.3/
  5.2.4 · Haber 1.1.1 neto + 2.1.7/2.1.3/2.1.5/2.1.6), `recordLaborProvision`
  (Debe 5.2.6 · Haber 2.1.9/2.1.10/2.1.11), `recordAguinaldoPayment`,
  `recordSettlement`. Todos vía `createJournalEntry` → heredan `assertPeriodOpen`.
- Frontend: `components/HRM.tsx` (planilla/aguinaldo/liquidación/feriados/
  expediente, `printColilla`) y `components/MiEspacio.tsx` (autoservicio).

## 2. Reglas laborales tal como están en el código

### Nómina mensual — `calculatePayroll`
- **Hora ordinaria = salario mensual / 240** (30 días × 8 h); **hora extra al
  doble** (Art. 62).
- **Feriado trabajado**: recargo del 100% = un día extra (`base/30`), Art. 68 (el
  salario mensual ya cubre el día ordinario).
- **Ausencia sin goce**: acotada a `[0, base]`, reduce el devengado y con él la
  base de INSS/IR.
- **INSS laboral 7%** sobre el `totalIncome` COMPLETO. ⛔ **No hay techo
  cotizable y no se debe reintroducir uno**: el Decreto Presidencial 06-2019
  eliminó el tope de la remuneración cotizable. El motor aplicaba
  `min(totalIncome, 132071.43)` —una cifra que no corresponde a ningún techo
  nicaragüense documentado— y por eso sub-retenía INSS y, al inflar la renta
  neta, sobre-retenía IR. Hay tests que fijan los valores absolutos.
- **INSS patronal** default 22.5%, **parametrizable por tenant** vía
  `TaxConfig.inssPatronalRate` (regla legal: 21.5% <50 empleados / 22.5% ≥50).
- **INATEC 2%** sobre el ingreso **completo, sin techo** (hay test que lo fija).
- **IR salarial — tabla progresiva anual DGI**: 0–100k → 0% · 100k–200k → 15%
  (base 0) · 200k–350k → 20% (base 15,000) · 350k–500k → 25% (base 45,000) ·
  >500k → 30% (base 82,500). Dos métodos: (a) **acumulado DGI** cuando llega
  `opts.irAcumulado` (proyección anual con retenido previo), (b) fallback **×12**
  para previsualizaciones.
- **Deducciones judiciales Art. 88**: fijo o % del **disponible** (ingreso − INSS
  − IR), en orden de `priority`, acotadas al remanente (neto nunca negativo).
- `netSalary = totalIncome − (INSS+IR) − judicial − adelantos`. Intermedios a 4
  decimales.

### Pasivo devengado — `calculateLaborLiability`
- **Vacaciones**: saldo real `Employee.vacationDays` si viene; el estimado 2.5
  días/mes topado a 30 es solo fallback.
- **Aguinaldo Art. 93**: proporcional desde `max(último 1-dic, hireDate)`,
  días/360, capado a 1 salario. **No desde enero.**
- **Indemnización Art. 45**: 30 días/año los primeros 3 años, 20 días/año desde el
  4º, fracción proporcional, **techo 150 días**. **Sin piso de 1 mes** — deliberado:
  el piso solo cristaliza al liquidar.

### Liquidación final — `calculateSettlement`
- Indemnización **solo** en `DISMISSAL` o `MUTUAL`; `RESIGNATION` no.
- Mismos tramos 30/20 + fracción, luego **piso 1 mes y techo 5 meses**.
- Base salarial: el caller pasa el **promedio de 6 meses** (Art. 78,
  `salarioBaseLiquidacion` — `grossSalary + commissions`, excluye HE y feriado).
- Bloqueo de doble liquidación por `TerminationSettlement.employeeId @unique`.

### Aguinaldo (corrida de diciembre)
Período **dic[año-1] → 30-nov[año]**, desde `hireDate` si es posterior,
`monto = salario × min(1, días/360)`. Fecha límite legal **10 de diciembre**.
**Exento de INSS e IR** (regla implementada en el asiento, no en el motor).
Idempotente por `Aguinaldo @@unique([employeeId, year])`.

### Jornadas y feriados
- `JORNADA_HORAS`: DIURNA 8 / NOCTURNA 7 / MIXTA 7.5 (Art. 51). Exceso en el
  clock-out = HE.
- 9 feriados nacionales sembrados idempotentemente por tenant/año (Semana Santa
  por algoritmo gregoriano). Los `national: true` no se pueden borrar.
- Día calendario **local Nicaragua = UTC-6** al mapear turnos a feriados.

### Vigencia de tasas (verificar cuando el cambio dependa de ellas)
`utils/tasas.ts` declara **`TASAS_VERIFICADAS_AL = null`** → sin verificar, no
publicar cambios de tasas sin revisión. Comprobar primero la fuente oficial vigente
(DGI, INSS o MITRAB), la fecha y el alcance; las verificaciones históricas con
fuentes secundarias no sustituyen esa revisión. El salario mínimo vive en
`TaxConfig.salarioMinimo`; no agregar una cifra universal para todos los sectores.

## 3. Flujos canónicos

- **Correr planilla** (`POST /api/payroll/calculate`): trae empleados del tenant →
  comisiones por `Sale.groupBy` × `commissionRate` → HE por `Shift.groupBy` →
  ausencias UNPAID → **IR acumulado del año en Decimal** (hacerlo en float
  arrastraba error a la retención declarada — bug real corregido) → judiciales por
  `priority` → feriados trabajados (UTC-6) → `calculatePayroll` → adelantos solo
  si caben íntegros en el remanente (los que no, se difieren al mes siguiente) →
  **`$transaction`**: `payroll.upsert` por `@@unique([employeeId, month, year])` +
  adelantos a `DEDUCTED`/diferidos. Sin la tx habría doble descuento al
  trabajador. Un `Payroll` `PAGADO` **no se recalcula**. Calcular NO genera
  asiento ni AuditLog — el dinero se mueve al pagar.
- **Pagar nómina** (`POST /api/payroll/:id/pay`): anti-IDOR por tenant +
  idempotencia (PAGADO → 400) → seed contable fuera de la tx → `$transaction`:
  status + `Expense` NOMINA + `recordPayroll` (fail-soft) + `recordLaborProvision`
  (cuota `grossSalary/12` por concepto, fail-soft) + `vacationDays += 2.5`
  (Art. 76) + **AuditLog `PAYROLL_PAID`** con before/after. Si un asiento se
  omitió: AuditLog `PAYROLL_JOURNAL_SKIPPED` + `advertencia` en la respuesta.
  **Conducta legacy pendiente de endurecimiento, no patrón normativo.** La traza
  `PAYROLL_JOURNAL_SKIPPED` se escribe después de la transacción. El control previo
  `PAGADO` no prueba idempotencia concurrente: caracterizar doble pago y fallo de
  asiento/auditoría antes de cambiar este flujo.
- **Liquidar** (`GET settlement-preview` → `POST settlement`): empleado por
  `{id, tenantId}` → promedio 6 meses → `calculateSettlement` → `$transaction`:
  `TerminationSettlement` + `recordSettlement` (fail-soft) + `TERMINATED` +
  `vacationDays: 0` + rechazo de PENDING colgantes + AuditLog.
- **Ausencias**: `validarAusencia` corre **dentro del tx** (solapamiento + saldo
  VACATION). Aprobar VACATION decrementa `vacationDays`. Vía admin queda APPROVED
  directo; vía `/api/me/leave` queda PENDING.

## 4. Invariantes (no negociables)

1. **Dinero en Decimal, nunca Float.** Al leer de Prisma se pasa por string:
   `new Decimal(p.monto.toString())`. Nunca `Number()` intermedio.
2. **Tenant siempre del JWT**; updates con `findFirst({id, tenantId})` previo o
   `updateMany({where:{id, tenantId}})` (anti-IDOR).
3. **Cálculo puro separado de Prisma.** La fórmula va al motor puro; la
   orquestación a servicios y rutas; los monolitos solo componen módulos. **No meter I/O en el motor. No reintroducir
   cálculos laborales fuera de `nicaLabor.ts`** (los endpoints demo que lo hacían
   fueron eliminados a propósito).
4. **Espejo blog ↔ ERP**: cambiar una fórmula en `nicaLabor.ts` obliga a cambiar
   `utils/calc-laborales.ts` y viceversa.
5. **Mutation testing — el umbral SOLO SUBE** (`stryker.config.json`, ver configuración
   vigente). Si un cambio hunde el score, se arregla el test, no el umbral. Los
   rangos de línea del `mutate` se desfasan con refactors **y Stryker no avisa**
   (rango inválido = NaN = éxito falso): al mover funciones, actualizá los rangos
   en el mismo PR. `scripts/check-mutation-scope.cjs` fija pisos de mutantes por
   archivo.
6. **Los tests deben MATAR mutantes, no solo pasar**: valores absolutos, nunca
   asertos tautológicos (el techo INSS y el IVA tuvieron exactamente ese
   antipatrón, documentado en `tests/calc-laborales.test.ts`). Cubrir años
   fraccionarios en indemnización.
7. **Idempotencia del dinero**: no re-pagar (`PAGADO` → 400), no recalcular una
   pagada, no re-liquidar (unique), aguinaldo único por `(employeeId, year)`.
8. **Los nuevos efectos financieros y su auditoría deben ser atómicos.** El
   fail-soft legacy descrito arriba es deuda; no copiarlo a otros flujos.

## 5. Gotchas y deuda conocida (no "arreglar" a ciegas)

**Autorización por ruta (lectura de código, no prueba dinámica nueva):**
`settlement-preview`, `hrm/dashboard` y `GET aguinaldo/:year` usan
`HR_READ_ROLES`. `GET /api/labor-liabilities` y `GET /api/hr/alerts` conservan
`authenticate` sin ese guard explícito. Verificar el montaje, reproducir el
alcance por rol y corregirlo antes de declarar aislamiento intra-tenant completo.
`clock-in/out` en `backend/routes/hr.ts` usa PIN sin un limitador explícito en la
ruta; no confundirlo con `/api/employees/verify-pin`, que tiene su propio limiter.

**Validación**: Zod solo en 3 lugares (`AdvanceRequestSchema`,
`CreateEmployeeSchema`, `PayrollCalculateSchema`); el resto valida a mano.
`POST .../contract` guarda `salary: Number(salary)` sin validar signo/NaN.

**Reglas divergentes / incompletas:**
- **Vacaciones acumulan sin tope** (`increment: 2.5` por pago, sin capar a 30)
  mientras el estimador y el blog sí topan. Decidir si el tope es legalmente
  correcto **antes** de "arreglarlo". La acumulación está atada al PAGO, no al mes
  trabajado.
- `POST /api/payroll/calculate` **no filtra `status: 'ACTIVE'`** (aguinaldo,
  dashboard y asistencia sí filtran).
- La corrida de aguinaldo usa `baseSalary`, no el ordinario promedio (ignora
  HE/comisiones).
- Provisión aproximada: `grossSalary/12` por concepto, no el devengo real por
  tramo. Piso de indemnización divergente entre `calculateSettlement` (piso 1 mes)
  y `calculateLaborLiability` (sin piso, deliberado, "pendiente de decisión del
  contador").
- `Employee.accumulatedThirteenth` es campo muerto (cero writes).
- `PayrollRun`/`PayrollLine` huérfanos (deprecated, **no borrar** — schema
  aditivo). `TerminationSettlement.reason`: el schema documenta
  `RESIGNATION|DISMISSAL|JUSTIFIED` pero el código usa
  `DISMISSAL|RESIGNATION|MUTUAL`.
- **Campos Float que deberían ser Decimal/Int**: `Employee.vacationDays` (error
  binario acumulable que multiplica en la liquidación), `Payroll.horasExtra/
  diasFeriados/diasAusencia`, `Shift.*Hours`, `JudicialDeduction.percentage`. Los
  montos sí son Decimal — correcto.

**Backlog histórico en `docs/PLAN_RRHH_NICARAGUA.md`, por revalidar en código y
pruebas antes de afirmar que falta:** subsidio INSS 60% por enfermedad desde el día 4, maternidad Art. 141
(4+8 semanas + complemento), constancia anual de retenciones por empleado, alerta
del tope 3 h extra/día, séptimo día/descanso semanal remunerado, adjuntos en el
expediente.

**Tests del motor** (ya existen, no re-hacer): `tests/nicaLabor.test.ts` cubre
`irAnualDeTabla`, `calculatePayroll` (INSS sin techo, IR acumulado, horas extra,
feriados, ausencias, deducciones judiciales) y `calculateSettlement` con valores
absolutos derivados de la ley. Los tres están en el `mutate` de Stryker por rango
de líneas — **los rangos se desfasan si movés las funciones y Stryker NO avisa**;
`scripts/check-mutation-scope.cjs` es el que grita.

**Zona ciega declarada**: `calculateLaborLiability` llama `new Date()` adentro,
así que no es determinista y queda FUERA del scope de mutación. Para cubrirla hay
que inyectarle la fecha.

## 6. Checklist al tocar este subsistema

1. ¿La fórmula nueva vive en `nicaLabor.ts` (pura) y su espejo en
   `calc-laborales.ts` si aplica al blog?
2. ¿Decimal end-to-end, con `.toString()` al salir de Prisma?
3. ¿Tenant del JWT + anti-IDOR en todo update?
4. ¿Idempotencia respetada (pagos, liquidaciones, aguinaldo)?
5. ¿Efectos y auditoría atómicos? ¿Las excepciones legacy quedan caracterizadas
   sin copiar ni ocultar sus riesgos?
6. ¿Tests con valores absolutos que matan mutantes; rangos de Stryker
   actualizados si moviste funciones?
7. ¿Tasas nuevas verificadas contra fuente oficial y actualizadas en AMBOS lados
   del espejo?
