# Nortex — Plan «RRHH Definitivo Nicaragüense»

> Objetivo: que Nortex pase de *calcular una planilla* a **administrar personas conforme a la ley** — Ley 185 (Código del Trabajo), Ley 539 (Seguridad Social) y Ley 822 (rentas del trabajo) — sin que el dueño tenga que saberse un solo artículo.
> Auditoría realizada sobre `main` (nicaLabor.ts, routes/hr.ts, 8 endpoints de nómina, HRM.tsx, 7 modelos HR).

---

## 1 · Lo que Nortex YA hace bien (no tocar, capitalizar)

| Capacidad | Evidencia |
|---|---|
| **Motor de nómina Ley 185/539/822**: INSS laboral 7% con techo, IR tabla progresiva proyectada, INSS patronal parametrizable (21.5/22.5 vía `TaxConfig`), INATEC 2%, costo empresa — todo en Decimal | `nicaLabor.ts → calculatePayroll` |
| **Nómina mensual persistida** por empleado con comisiones automáticas (ventas del mes × tasa) | `/api/payroll/calculate` + modelo `Payroll` |
| **Pasivo laboral** (vacaciones 2.5 d/mes, aguinaldo proporcional, indemnización con tope 5 meses) | `calculateLaborLiability` + tab LIABILITIES |
| **Salida INSS (SIE)** consolidada + export Excel | `/api/payroll/sie/:m/:y` (B5) |
| **Colilla de pago** imprimible | `HRM.tsx → printColilla` |
| **Asiento contable de planilla** (gasto, INSS/INATEC por pagar) protegido por el lock de períodos | `accounting.ts → recordPayroll` |
| **Asistencia básica**: clock-in/out por PIN sobre `Shift` (horas regulares/extra) | `routes/hr.ts` |
| **Adelantos de salario** con solicitud/aprobación y tope 30% | `SalaryAdvance` + `/api/hr/advance/*` |
| **INSS/INATEC en el Cierre Mensual** con vencimiento (día 17) | Panel del Contador (#20) |
| Modelos ya creados esperando lógica: `LeaveRequest`, `TerminationSettlement`, `PayrollRun/Line` | schema.prisma |

## 2 · Las debilidades (lo que un inspector del MITRAB o un contador ve el día 1)

**El veredicto duro:** Nortex calcula bien el *caso feliz* (salario fijo + comisiones), pero la vida real de una planilla nicaragüense — horas extra, ausencias, adelantos, vacaciones, aguinaldo de diciembre, liquidaciones — o no existe o vive en código demo que contradice al motor bueno.

| # | Hueco | Por qué duele | Confirmación |
|---|---|---|---|
| D1 | **Dos motores de nómina contradictorios** | `/api/hr/payroll/preview` ignora el IR ("para simplificar la demo"), no aplica techo INSS y no usa `nicaLabor.ts`. Dos pantallas pueden mostrar dos netos distintos para el mismo empleado. `PayrollRun/PayrollLine` están huérfanos (nada los persiste). | `routes/hr.ts:230` |
| D2 | **Horas extra registradas pero NUNCA pagadas** | El clock-out calcula `overtimeHours` y ahí mueren: `/api/payroll/calculate` paga solo base+comisiones. La HE es al **doble** (Art. 62 Ley 185) — hoy Nortex literalmente le paga de menos al empleado. | `Shift.overtimeHours` sin consumidor |
| D3 | **Adelantos aprobados que no se descuentan** | `SalaryAdvance` APPROVED nunca pasa a DEDUCTED en la nómina real: el empleado recibe el adelanto **y** el salario completo. Pérdida directa de caja. | `repaymentPayrollId` siempre null |
| D4 | **Vacaciones: saldo muerto** | `Employee.vacationDays` no se acumula (2.5 d/mes, Art. 76) ni se descuenta al gozar. `LeaveRequest` VACATION/UNPAID/SICK no afecta la nómina ni el saldo. | 0 writes a `vacationDays` |
| D5 | **Aguinaldo: ni acumula ni se paga** | `accumulatedThirteenth` nunca se actualiza; no existe la corrida de diciembre (pagar antes del **10 de diciembre**, multa de un día de salario por día de retraso, Art. 93-95). El aguinaldo es **exento de INSS e IR** — regla que hoy no está codificada en ningún lado. | 0 writes; 0 endpoints |
| D6 | **Liquidación final: dos cálculos, ambos incorrectos** | `hr.ts/termination` aplica 1 mes/año **sin tope** (10 años = 10 meses, ilegal) y solo en despido; `calculateLaborLiability` aplica tope 5 pero 1 mes/año uniforme. La regla real (Art. 45): 1 mes/año los **primeros 3 años**, **20 días/año** del 4º en adelante, tope 5 meses; y con salario variable la base es el **promedio de los últimos 6 meses** (Art. 78). Nada se persiste en `TerminationSettlement`, no hay finiquito imprimible ni asiento contable. | `hr.ts:279`, `nicaLabor.ts:176` |
| D7 | **IR con salario variable mal proyectado** | La proyección ×12 del mes corriente distorsiona la retención cuando hay comisiones: la metodología DGI es **acumulada** (renta acumulada real + proyección de meses restantes − IR ya retenido). Diciembre trae sustos. | `calculatePayroll:106` |
| D8 | **El IR retenido a empleados no aparece en el Cierre Mensual** | La empresa debe **enterar a la DGI** las retenciones de rentas del trabajo (primeros 5 días hábiles del mes siguiente). El Panel del Contador (#20) lista IVA/IR/IMI/INSS/INATEC pero no esta obligación — multa segura. | `OBLIGATION_KEYS` |
| D9 | **Sin provisión contable del pasivo laboral** | Aguinaldo+vacaciones+indemnización devengan ~25% extra del salario cada mes y el P&L no lo registra (no existen cuentas "Aguinaldo por Pagar", etc.). El negocio cree que gana más de lo real y diciembre lo golpea. | catálogo sin 2.1.9+ |
| D10 | **Ausencias, subsidios e incapacidades sin lógica** | SICK no aplica el subsidio INSS (60% desde el día 4), MATERNITY no implementa el reposo 4+8 semanas (Art. 141) ni el complemento patronal. UNPAID no descuenta días. | `LeaveRequest` decorativo |
| D11 | **Sin feriados ni séptimo día** | No hay tabla de feriados nacionales (Art. 66-68: trabajo en feriado = doble) ni control del descanso semanal remunerado. | 0 |
| D12 | **Expediente laboral inexistente** | Sin contrato (tipo, período de prueba, vencimiento de plazo determinado — el MITRAB exige contrato escrito), sin cargo formal, sin historial salarial, sin documentos adjuntos. | `Employee` mínimo |
| D13 | **Nómina solo OWNER** | El contador (rol ACCOUNTANT) no puede correr ni revisar la planilla — en la vida real es quien la hace. | `checkRole(['OWNER'])` |

## 3 · El plan — 3 fases

### FASE A — «Una sola nómina, la correcta» · ~1.5 semanas
*Matar el motor demo, y que la planilla pague TODO lo que la ley manda: horas, ausencias, adelantos, IR exacto.*

| RF | Requerimiento | Detalle técnico |
|---|---|---|
| **A1** | **Unificar el motor** | Deprecar `/api/hr/payroll/preview` y el cálculo de liquidación de `hr.ts`; todo pasa por `nicaLabor.ts`. Extender el modelo `Payroll` (aditivo): `overtimePay, holidayPay, bonuses, absenceDeduction, advanceDeduction, subsidioInss, diasTrabajados, horasExtra`. `PayrollRun/PayrollLine` se marcan deprecated (no se borran). |
| **A2** | **Horas extra y feriados pagados** | Tabla de feriados nacionales precargada (Art. 66; editable para fiestas locales). Al calcular nómina: suma `Shift.overtimeHours` del mes → **HE al doble** (Art. 62, tope legal 3h/día visible como alerta); día feriado trabajado → doble (Art. 68). Panel de revisión editable antes de confirmar (el dueño ajusta horas mal marcadas). |
| **A3** | **Adelantos descontados de verdad** | Al calcular: adelantos APPROVED → `advanceDeduction`, status DEDUCTED + `repaymentPayrollId`. Si el neto no alcanza, arrastra saldo al mes siguiente. |
| **A4** | **Ausencias que afectan** | `LeaveRequest` aprobada entra a la nómina: UNPAID descuenta días (base/30); SICK aplica subsidio INSS 60% desde el día 4 (los 3 primeros configurables a cargo del patrono); VACATION paga normal y descuenta saldo (B1). |
| **A5** | **IR metodología acumulada DGI** | Recalcular cada mes con renta acumulada real + proyección de meses restantes − IR ya retenido en el año. Aguinaldo **exento de IR e INSS** como regla del motor. |
| **A6** | **Retenciones laborales al Cierre Mensual** | Nueva obligación `IR_LABORAL` en el Panel del Contador: Σ `irLaboral` del mes, entidad DGI (VET), vencimiento primeros 5 días hábiles del mes siguiente. |
| **A7** | **El contador corre la nómina** | `checkRole(['OWNER','ADMIN','ACCOUNTANT'])` en calculate/pay/SIE. |

### FASE B — «El ciclo de vida del empleado» · ~2 semanas
*Vacaciones, aguinaldo, liquidación y provisiones: lo que convierte diciembre y los despidos en un botón, no en un juicio laboral.*

| RF | Requerimiento | Detalle técnico |
|---|---|---|
| **B1** | **Vacaciones de verdad** | Acumulación automática 2.5 d/mes al correr nómina (Art. 76: 15 días por semestre). Solicitud → aprobación → descuento del saldo al gozar. Saldo y proyección visibles en HRM y en el autoservicio (C3). |
| **B2** | **Corrida de aguinaldo (diciembre)** | Botón «Correr aguinaldo»: 1/12 del salario ordinario por mes trabajado (dic-1 → nov-30), proporcional para ingresos del año (Art. 93). Exento INSS/IR. Persistido + colilla + asiento (cancela la provisión B3). Countdown al **10 de diciembre** con alerta de multa (Art. 95: un día de salario por día de retraso). |
| **B3** | **Provisión mensual del pasivo laboral** | Cuentas nuevas (seed auto-sanable): `2.1.9 Aguinaldo por Pagar`, `2.1.10 Vacaciones por Pagar`, `2.1.11 Indemnización por Pagar`, gasto `5.2.6 Prestaciones Sociales`. Al correr nómina, asiento automático ≈8.33% del devengado por cada concepto. El P&L deja de mentir ~25%. |
| **B4** | **Liquidación final definitiva** | Un solo motor (Art. 42-48): indemnización 1 mes/año (años 1-3) + **20 días/año** (año 4+), tope 5 meses, solo en despido injustificado/mutuo acuerdo según causa; base = **promedio últimos 6 meses** si salario variable (Art. 78); + vacaciones del saldo real + aguinaldo proporcional. Persistir `TerminationSettlement`, finiquito imprimible, asiento contable (cancela provisiones), empleado → TERMINATED. Exención de IR sobre la indemnización legal (exceso convencional: retención definitiva — verificar tasa vigente Art. 24 Ley 822 al implementar). |
| **B5** | **Maternidad y subsidios INSS** | MATERNITY: reposo 4 semanas pre + 8 post (Art. 141), subsidio INSS 60% con complemento patronal al 100%; el sistema calcula qué paga quién. Registro de orden de reposo INSS en incapacidades. |
| **B6** | **Constancia anual de retenciones** | Por empleado, año fiscal: renta bruta, INSS, IR retenido — el documento que el empleado pide para su declaración. PDF/print como la colilla. |

### FASE C — «RRHH que se administra solo» · ~2 semanas
*Expediente, asistencia pro y autoservicio: que el negocio crezca sin contratar un departamento de RRHH.*

| RF | Requerimiento | Detalle técnico |
|---|---|---|
| **C1** | **Expediente digital** | Contrato (indeterminado/determinado/por obra; período de prueba 30 días; alerta de vencimiento), cargo, historial salarial auditado (quién/cuándo/cuánto), beneficiarios INSS, adjuntos (cédula, contrato firmado). |
| **C2** | **Asistencia pro** | Jornadas asignadas por empleado (diurna 8h / nocturna 7h / mixta 7.5h, Art. 51), tardanzas, reporte mensual de asistencia que **alimenta la nómina automáticamente** (cierra el ciclo de A2), calendario de feriados editable. |
| **C3** | **Autoservicio del empleado** | Sobre el link `Employee.userId` existente: ver colillas e historial, saldo de vacaciones, solicitar vacaciones/permisos/adelantos (el flujo de aprobación ya existe), constancia laboral autogenerada. |
| **C4** | **Deducciones judiciales** | Pensión alimenticia / embargos: deducción recurrente por empleado (monto o %), prioridad legal sobre otras deducciones, visible en colilla. |
| **C5** | **Tablero gerencial RRHH** | Costo laboral real mensual (incluyendo provisiones B3), ausentismo, rotación, alerta de salario < mínimo vigente por sector (`TaxConfig.salarioMinimo` ya existe). |
| **C6** | **Alertas proactivas** | Contratos por vencer, períodos de prueba terminando, aguinaldo (countdown), INSS día 17, empleados sin número INSS/cédula (bloquea SIE). |

## 4 · Priorización y dependencias

```
A1 (motor único) ──→ A2..A5 (cálculo completo) ──→ B1/B2/B3 (ciclo + provisiones)
                                                      └─→ B4 (liquidación usa saldos reales)
A6/A7: independientes, día 1.        B5/B6: tras A4/A5.        C: tras B (consume sus datos).
```

- **Empezar por la Fase A**: hoy la nómina **paga de menos** (HE) y **cobra de menos** (adelantos) — eso es riesgo legal y pérdida de caja *activa*, no deuda técnica.
- **B antes de diciembre**: la corrida de aguinaldo (B2) tiene fecha legal dura (10-dic). Las provisiones (B3) necesitan correr varios meses antes para suavizar el golpe.
- Todo cambio de esquema es **aditivo** (`prisma db push` en deploy, patrón ya probado en Fases A-C del Contador).
- Los asientos nuevos (provisiones, aguinaldo, liquidación) pasan por `createJournalEntry` → heredan el **lock de períodos** y el libro firmado gratis.

## 5 · Quick wins (se pueden hacer ya, en cualquier orden)

| QW | Esfuerzo | Impacto |
|---|---|---|
| A6 — IR laboral al Cierre Mensual | horas | Evita una multa DGI recurrente |
| A7 — ACCOUNTANT corre nómina | minutos | El contador trabaja sin pedirle el usuario al dueño |
| A3 — Descontar adelantos | ~1 día | Detiene pérdida de caja activa |
| Tope legal en `hr.ts/termination` (mientras muere en A1) | minutos | Elimina un cálculo ilegal visible |

---

*Plan generado a partir de auditoría del código en `main` (commit d9274c8). Las referencias legales (Ley 185, Ley 539, Ley 822) se citan a nivel de artículo para validación del contador del negocio; las tasas/montos parametrizables (techo INSS, salario mínimo, tasa sobre excesos de indemnización) se verifican contra las tablas vigentes al momento de implementar cada RF.*
