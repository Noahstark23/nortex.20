# Nortex — Programa HRIS completo para Nicaragua

> Estado: **plan maestro actualizado**
>
> Alcance: cumplimiento laboral, operación de personal y gestión de talento
>
> Mercado inicial: PyMEs nicaragüenses multi-tenant
> Regla: cada fase debe entregar valor usable y reducir o mantener la deuda
> técnica; ninguna feature justifica debilitar seguridad, contabilidad, privacidad,
> rendimiento o experiencia de usuario.

## 1. Resumen ejecutivo

Nortex ya tiene empleados, nómina nicaragüense, aguinaldo, liquidación,
vacaciones, adelantos, asistencia por PIN, contratos, deducciones judiciales,
alertas y autoservicio. El siguiente salto consiste en convertir esa base en un
**HRIS modular de ciclo completo**:

1. cerrar riesgos actuales de permisos, contabilidad y consistencia laboral;
2. consolidar la fuente autoritativa de persona, puesto, salario y relación;
3. añadir estructura organizacional, reclutamiento y onboarding;
4. añadir desempeño, aprendizaje, compensación y beneficios;
5. completar relaciones laborales, offboarding y analítica;
6. preparar el dominio para expansión regional sin tratar las reglas de Nicaragua
   como supuestos universales.

Este documento reemplaza el plan anterior, que describía como pendientes varias
capacidades ya implementadas. La ejecución será mediante PRs pequeños,
secuenciales y reversibles. No habrá un cambio masivo de RR. HH.

## 2. Contexto, supuestos y límites

### Contexto confirmado

- Nortex es un ERP/POS multi-tenant para PyMEs de Nicaragua.
- El tenant proviene exclusivamente del JWT autenticado.
- Nómina y beneficios mueven dinero real: usan Decimal, transacciones y auditoría.
- MySQL 8, Prisma 6.4.1, Express y React/Vite son el stack canónico.
- El producto usa español nicaragüense y voseo.
- RR. HH. necesita permisos más finos que los roles generales actuales.

### Supuestos de producto

- La primera versión integral se optimiza para empresas de 5 a 250 colaboradores.
- La relación laboral asalariada es el caso principal; contratistas se modelan
  después sin mezclarlos con nómina laboral.
- Nicaragua es la jurisdicción inicial. Toda tasa, calendario o regla variable se
  configura y versiona.
- Decisiones disciplinarias, despidos, incapacidades y datos médicos requieren
  revisión humana y, cuando corresponda, asesoría laboral local.

### Fuera de alcance inicial

- Envío automático de dinero o declaraciones a terceros.
- Firma electrónica con efecto jurídico sin proveedor y revisión legal aprobados.
- Nómina multinacional dentro del mismo motor nicaragüense.
- Vigilancia invasiva, scoring opaco o decisiones laborales automáticas.

## 3. Línea base real

| Área | Estado | Decisión |
|---|---|---|
| Empleados y vínculo con usuario | Parcial | Convertir en perfil editable con historial |
| Nómina, INSS, IR, horas extra y feriados | Implementado | Blindar; no crear un segundo motor |
| Aguinaldo y liquidación | Implementado | Hacer contabilidad atómica y ampliar documentos |
| Vacaciones, permisos y adelantos | Parcial | Completar incapacidad, maternidad y trazabilidad |
| Asistencia | Básico operativo | Añadir horarios, incidencias, correcciones y aprobación |
| Contratos y expediente | Básico operativo | Añadir documentos e historial salarial |
| Autoservicio | Básico operativo | Añadir constancias, contrato, tareas y notificaciones |
| Estructura organizacional | Ausente | Construir sobre asignaciones versionadas |
| Reclutamiento y onboarding | Ausente | Separados de Employee |
| Desempeño y capacitación | Ausente | Después de estructura y permisos |
| Beneficios y conceptos variables | Ausente | Catálogo configurable conectado a nómina |
| Relaciones laborales | Ausente | Casos privados, evidencias y acciones auditadas |
| Analítica integral | Parcial | Derivada de datos autoritativos |

## 4. Contratos no negociables

### Seguridad y privacidad

- Toda lectura y escritura incluye `tenantId` del JWT.
- Permisos por capacidad: perfil, compensación, expediente, ausencias, nómina,
  desempeño y casos laborales.
- Salario, banco, salud, disciplina, documentos y evaluaciones no se incluyen por
  defecto en listados.
- Descargas y vistas sensibles dejan auditoría cuando el riesgo lo amerita.
- Datos laborales nuevos usan soft delete, retención configurable y minimización.

### Dinero e integridad

- `nicaLabor.ts` sigue siendo el motor autoritativo nicaragüense.
- Todo dinero nuevo usa `Decimal(18,4)` y `decimal.js`.
- Nómina, aguinaldo, liquidación, bonos y reembolsos confirman movimiento, asiento
  y `AuditLog` en una transacción; se elimina el éxito fail-soft.
- Cambios salariales se versionan y no reescriben el pasado.
- Corridas confirmadas son inmutables; se corrigen con reversión autorizada.

### Escalabilidad

- Todo módulo nuevo usa el Prisma singleton.
- Listados paginados y dashboards agregados en BD.
- Cada consulta llega con sus índices compuestos.
- Exportes grandes se generan en background o por streaming.
- Ninguna regla crítica depende de memoria de proceso.
- Las políticas laborales se versionan por jurisdicción.

### Experiencia y accesibilidad

- El alta laboral es un flujo guiado y reanudable.
- Toda pantalla tiene carga, vacío, error recuperable y confirmación.
- Acciones irreversibles explican su impacto antes de confirmar.
- Flujos críticos funcionan con teclado, foco visible, etiquetas programáticas,
  reflow móvil y mensajes que no dependen solo del color.
- Cada estado usa lenguaje comprensible para dueño, responsable y colaborador.

## 5. Arquitectura objetivo

El HRIS no crecerá dentro de `backend/server.ts` ni de `components/HRM.tsx`.

```text
backend/
  routes/hr/
    people.ts
    organization.ts
    recruiting.ts
    onboarding.ts
    attendance.ts
    leave.ts
    payroll.ts
    performance.ts
    learning.ts
    compensation.ts
    employee-relations.ts
    analytics.ts
  services/hr/
  validation/hr/

components/hr/
  shell/
  people/
  organization/
  recruiting/
  onboarding/
  attendance/
  payroll/
  performance/
  learning/
  compensation/
  relations/
  analytics/

types/hr/
```

Los nombres son fronteras, no una obligación de crear archivos vacíos. Cada
módulo nace cuando su fase lo necesita. `server.ts` solo monta routers y
`HRM.tsx` se convierte gradualmente en un shell.

### Fuente autoritativa de la relación laboral

`Employee` conserva la identidad. Una asignación versionada conecta colaborador,
puesto, departamento, jefatura, centro de costo, jornada y compensación. El
contrato referencia esa asignación o guarda un snapshot. La nómina lee la
asignación efectiva del período, evitando que contrato y salario diverjan.

### Dominios previstos

| Dominio | Entidades principales |
|---|---|
| Organización | Department, Position, CostCenter, EmploymentAssignment, ReportingLine |
| Reclutamiento | JobRequisition, Candidate, Application, Interview, Scorecard, Offer |
| Onboarding | ChecklistTemplate, OnboardingInstance, OnboardingTask, AssetAssignment |
| Documentos | EmployeeDocument, DocumentVersion, Acknowledgement |
| Asistencia | WorkSchedule, ScheduleAssignment, AttendanceIncident, TimeAdjustment |
| Desempeño | ReviewCycle, Goal, Review, ReviewResponse, Competency |
| Aprendizaje | Course, Enrollment, Certification, CertificationRequirement |
| Compensación | CompensationChange, PayrollConcept, EmployeeBenefit, Reimbursement |
| Relaciones | EmployeeCase, CaseEvent, CorrectiveAction, CaseAttachment |
| Offboarding | OffboardingInstance, OffboardingTask, ExitInterview, AssetReturn |

Todos los modelos incluyen `tenantId`, timestamps, índices y trazabilidad.

## 6. Roadmap por fases

### Fase 0 — Blindaje y presupuesto de deuda

**Objetivo:** hacer segura la base antes de ampliarla.

- Permisos explícitos en dashboard, pasivos, aguinaldo, liquidación, alertas y
  expedientes.
- Eliminar fail-soft contable en nómina, aguinaldo y liquidación.
- Unificar salario contractual y nómina mediante una fuente versionada.
- Integración HTTP para nómina, liquidación, asistencia, ausencias, adelantos,
  contratos, alertas y autoservicio.
- Migrar `backend/routes/hr.ts` al Prisma singleton.
- Clasificar `PayrollRun`, `PayrollLine`, `repaymentPayrollId` y
  `accumulatedThirteenth` como activos o legacy.
- Crear trinquetes: `server.ts` y `HRM.tsx` no crecen por trabajo HRIS.

**Salida:** cero endpoints sensibles sin permiso, movimientos laborales atómicos,
pruebas de rol/cross-tenant y línea base de deuda versionada.

### Fase 1 — Personas, organización y expediente

**Objetivo:** saber quién trabaja, dónde, en qué puesto y bajo qué condiciones.

- Departamentos, cargos, centros de costo, jefaturas y organigrama.
- Asignación laboral versionada y edición integral del perfil.
- Historial salarial, jornada, puesto, departamento y estado.
- Expediente documental con versiones, vencimientos y permisos.
- Alta guiada: persona → relación → contrato → usuario → horario → documentos.
- Autoservicio: perfil, contrato/acuse, documentos y constancia laboral.

**Salida:** contrato, asignación y nómina son coherentes; el alta es reanudable y
el organigrama funciona con aislamiento por tenant.

### Fase 2 — Cumplimiento y operación diaria

**Objetivo:** cerrar ausencias especiales y profesionalizar asistencia.

- Incapacidad y maternidad con política INSS versionada, orden de reposo, subsidio
  y complemento patronal revisados localmente.
- Horarios, rotaciones, tardanzas, ausencias parciales y descansos.
- Solicitud, corrección y aprobación de marcas con auditoría.
- Calendario nacional/local versionado.
- Constancia anual de retenciones y documentos laborales.
- Bandeja unificada de aprobaciones.

**Salida:** asistencia aprobada alimenta nómina; incapacidad/maternidad aparecen en
colilla y contabilidad; el empleado descarga constancias.

### Fase 3 — Reclutamiento y onboarding

**Objetivo:** cubrir desde la necesidad de una plaza hasta un colaborador activo.

- Requisición ligada a puesto, presupuesto y aprobadores.
- Pipeline de candidatos y fuentes.
- Entrevistas estructuradas, scorecards 1–5 y debrief objetivo.
- Oferta versionada y conversión explícita a empleado.
- Checklist por puesto: documentos, acceso, equipo y capacitación.
- Plan 30/60/90, buddy y seguimientos.

**Salida:** trazabilidad desde requisición hasta alta, retención limitada de datos
de candidato y onboarding con avance y bloqueos visibles.

### Fase 4 — Desempeño y aprendizaje

**Objetivo:** gestionar resultados y desarrollo con criterios transparentes.

- Ciclos, metas SMART, competencias y check-ins.
- Autoevaluación, evaluación del responsable y feedback permitido.
- Calibración con evidencia y registro de cambios.
- Planes de mejora orientados a coaching.
- Cursos, inscripciones, certificaciones y vencimientos.
- Requisitos de aprendizaje por puesto.

**Salida:** evaluaciones explicables y certificaciones críticas trazables.

### Fase 5 — Compensación, beneficios y gastos

**Objetivo:** soportar remuneración real sin hardcodear cada caso.

- Conceptos versionados: bono, comisión, viático, reembolso, beneficio y deducción.
- Viáticos/reembolsos con aprobación y comprobantes.
- Beneficios por plan, elegibilidad, vigencia y costo.
- Bandas salariales y cambios con aprobación y fecha efectiva.
- Preview del impacto antes de confirmar dinero.

**Salida:** cada concepto explica impacto en bruto, INSS, IR, neto y contabilidad;
ningún monto usa float y los cambios son auditables.

### Fase 6 — Relaciones laborales y offboarding

**Objetivo:** administrar situaciones sensibles con privacidad y evidencia.

- Casos privados con eventos, participantes y adjuntos.
- Incidencias y acciones correctivas con lenguaje factual.
- Plantillas y acuses de políticas.
- Offboarding por causa: liquidación, accesos, activos, documentos y entrevista.
- Revocación de acceso sin borrar historia laboral.

**Salida:** acceso por necesidad; liquidación y baja no quedan parciales; activos y
accesos quedan conciliados.

### Fase 7 — Analítica y preparación regional

**Objetivo:** convertir datos confiables en decisiones y desacoplar jurisdicción.

- Headcount, antigüedad, rotación, ausentismo, overtime y costo por área.
- Embudo de reclutamiento, tiempo de contratación y onboarding.
- Adherencia a desempeño, capacitación y certificaciones.
- Equidad interna por banda con privacidad y grupos mínimos.
- Agregaciones incrementales para evitar reportes N+1.
- Interfaz de políticas laborales por país.

**Salida:** métricas reconciliables y una segunda jurisdicción puede agregar reglas
sin copiar la aplicación.

## 7. Política de deuda técnica

La deuda se administra como presupuesto, no como limpieza futura.

### Trinquetes

1. `backend/server.ts` no recibe handlers HRIS nuevos.
2. `components/HRM.tsx` no recibe flujos HRIS nuevos.
3. El número de `new PrismaClient()` solo puede bajar.
4. No hay `findMany` nuevo sin `take` o paginación.
5. La lógica monetaria no nace en handlers o componentes.
6. Toda migración es aditiva y agrega índices necesarios.
7. Todo módulo tiene contrato de dominio y tests.
8. TODO/FIXME nuevo requiere issue o referencia de fase.

### Registro y priorización

Cada deuda se clasifica como código, arquitectura, pruebas, dependencias,
documentación o infraestructura. Prioridad:

```text
(impacto + riesgo) × (6 - esfuerzo)
```

Cada factor se puntúa de 1 a 5. Cada fase reserva 15%–25% de capacidad para deuda
del área tocada. La deuda P0/P1 encontrada se corrige antes de la siguiente fase.

### Métricas de salud

- Tamaño de `server.ts` y `HRM.tsx`.
- Clientes Prisma directos restantes.
- Endpoints HRIS sin prueba de rol y tenant.
- Mutaciones monetarias sin auditoría atómica.
- p95 de listados y dashboards con dataset objetivo.
- Regresiones escapadas por fase.
- Deuda abierta/cerrada y tendencia mensual.

Línea base observada el 2026-08-30 (incluye cambios locales preexistentes):

| Señal | Valor inicial |
|---|---:|
| `backend/server.ts` | 15,276 líneas |
| `backend/routes/hr.ts` | 764 líneas |
| `components/HRM.tsx` | 2,177 líneas |
| Archivos backend que crean un `PrismaClient` | 14 |
| Suites dedicadas al motor laboral puro | 2 |
| Suites HTTP/UI dedicadas al ciclo HRIS | 0 identificadas |

Estos valores son referencias para el primer trinquete, no objetivos universales.
Se recalculan al iniciar la Fase 0 sobre una rama limpia.

`tech-debt-tracker` genera inventario y tendencia, pero sus hallazgos automáticos
son señales: la aceptación requiere revisión semántica y evidencia.

## 8. Estrategia de pruebas y QA

### Pirámide mínima

- **Funciones puras:** dinero, fechas, elegibilidad, scoring y transiciones.
- **Servicios:** permisos, invariantes, idempotencia y errores.
- **HTTP/Prisma:** tenant A/B, roles, transacciones y concurrencia.
- **Componentes:** carga, vacío, error, validación, teclado y acción principal.
- **Flujos renderizados:** alta, aprobación, nómina, reclutamiento, onboarding,
  evaluación y baja.

### Casos obligatorios por mutación

1. happy path;
2. body inválido;
3. rol insuficiente;
4. ID de otro tenant;
5. reintento/idempotencia;
6. concurrencia o doble aprobación;
7. auditoría before/after;
8. fallo contable/dependencia sin estado parcial.

### Compuerta por PR

- Prisma validate + generate si cambia schema.
- TypeScript sin errores nuevos.
- Vitest e integración del dominio.
- Mutation testing cuando cambia dinero puro.
- Sistema de diseño y accesibilidad.
- Build de producción.
- Dataset de escala para listados, búsqueda o dashboards.
- Revisión manual desktop/móvil y reduced motion cuando corresponda.

Un hallazgo confirmado se corrige en el mismo PR. No se acumula como "conocido"
salvo decisión explícita y priorizada.

## 9. Experiencia objetivo

| Persona | Resultado |
|---|---|
| Dueño | Entender costo, riesgos y pendientes sin calcular manualmente |
| RR. HH. | Administrar el ciclo completo desde una bandeja y expediente confiable |
| Contador | Revisar, confirmar y reconciliar nómina y obligaciones |
| Responsable | Aprobar, planificar, dar feedback y ver solo su equipo |
| Colaborador | Consultar, solicitar y descargar sin depender de RR. HH. |
| Candidato | Completar un proceso claro, respetuoso y accesible |

## 10. Métricas del programa

### Producto

- tiempo para completar alta laboral;
- expedientes completos;
- nóminas sin ajuste posterior;
- solicitudes resueltas dentro del SLA;
- tiempo de contratación y conversión por etapa;
- onboarding completado a tiempo;
- ciclos de evaluación completados;
- certificaciones vigentes;
- offboarding cerrado antes de la baja efectiva.

### Calidad

- cero incidentes cross-tenant;
- cero movimientos monetarios parciales;
- cero crecimiento de monolitos HRIS;
- reducción de clientes Prisma directos;
- mutation score y cobertura crítica sin retroceso;
- p95 estable con 250 colaboradores por tenant y volumen histórico acordado.

## 11. Secuencia de entrega

Cada fase se divide en PRs verticales y usables:

1. contrato de dominio, permisos y migración aditiva;
2. servicio y endpoints con integración;
3. UI y accesibilidad;
4. flujo renderizado, escala y regresión;
5. documentación, métricas e inventario de deuda.

Una fase no empieza hasta que la anterior esté mergeada y su migración sea segura.
No se mezclan reclutamiento, desempeño y nómina en un mismo PR.

## 12. Decisiones pendientes

- ¿Quién ejerce RR. HH. en negocios sin departamento dedicado?
- ¿Se requieren sindicatos o convenios colectivos en la primera versión?
- ¿Qué contratistas deben convivir sin entrar a nómina?
- ¿Qué almacenamiento y firma se aprobarán para documentos sensibles?
- ¿Qué retención tendrá cada categoría de documento y candidato?
- ¿Qué formatos se validarán con contador y abogado laboral?
- ¿La expansión usará configuración por país o módulos desplegables?

Estas preguntas se resuelven antes de la fase afectada; no bloquean la Fase 0.

## 13. Checklist

- [ ] Fase 0: blindaje y línea base de deuda.
- [ ] Fase 1: personas, organización y expediente.
- [ ] Fase 2: cumplimiento y operación diaria.
- [ ] Fase 3: reclutamiento y onboarding.
- [ ] Fase 4: desempeño y aprendizaje.
- [ ] Fase 5: compensación, beneficios y reembolsos.
- [ ] Fase 6: relaciones laborales y offboarding.
- [ ] Fase 7: analítica y preparación regional.

## 14. Comunicación por fase

> Nortex ahora te ayuda a **{{resultado principal}}** desde un solo flujo. Podés
> **{{acción 1}}**, **{{acción 2}}** y revisar **{{evidencia/estado}}** sin llevar
> controles paralelos. La información queda protegida por permisos y vinculada al
> expediente del colaborador.

## 15. Definition of Done del programa

Nortex será HRIS completo para su mercado objetivo cuando:

- cubra requisición → contratación → alta → operación → desarrollo → baja;
- nómina y obligaciones nicaragüenses sigan íntegras y auditables;
- permisos protejan compensación, salud, desempeño y disciplina;
- empleados y responsables tengan autoservicio útil;
- las métricas se reconcilien con datos autoritativos;
- otra jurisdicción pueda añadirse sin duplicar el producto;
- la tendencia de deuda técnica sea estable o descendente.

---

Este plan define producto y arquitectura, no sustituye revisión legal. Reglas,
tasas, formatos y plazos se verifican contra fuentes oficiales vigentes y con
asesoría local antes de activar capacidades con efecto jurídico.
