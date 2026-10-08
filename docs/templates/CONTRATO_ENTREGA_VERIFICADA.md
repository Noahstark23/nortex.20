# Contrato de entrega verificada — Nortex

Plantilla v1, 2026-09-04. Estado inicial: PROPUESTO. Completar los campos; un vacío significa pendiente, no aprobado. Se utiliza junto al [plan de dirección y validación](../PLAN_DIRECCION_UX_Y_VALIDACION_2026.md).

## 1. Identidad de la entrega

| Campo | Valor |
|---|---|
| ID / versión del brief | PENDIENTE |
| Problema y tarea que mejora | PENDIENTE |
| Segmento / rol / dispositivo | PENDIENTE |
| Dueño humano de producto | PENDIENTE |
| Responsable de política del dominio | PENDIENTE |
| Editor / integrador | PENDIENTE |
| Revisor del candidato | PENDIENTE |
| SHA base | PENDIENTE |
| SHA candidato o hash del snapshot exacto probado | PENDIENTE |
| Manifiesto y hash de archivos cambiados/nuevos | PENDIENTE |
| Ambiente y origen de datos | PENDIENTE: fixture / DB efímera / staging / producción |
| Modelo/runtime efectivos y versiones de skills | PENDIENTE; no inferir capacidades por el nombre |
| Autorización vigente / límites de lectura y escritura | PENDIENTE |

## 2. Contrato de producto y UX

- Hecho observado, fecha y evidencia:
- Autorreporte del usuario:
- Hipótesis todavía sin comprobar:
- Resultado deseado y criterio observable:
- Fuera de alcance:
- Rutas, estados y accesos por rol:
- Dirección visual, tokens/componentes a reutilizar:
- Acción principal, ayuda, carga, vacío, error, éxito y retorno:
- Teclado, foco, lector, targets, contraste y movimiento reducido:
- Datos que nunca deben inferirse ni transformarse para simplificar la pantalla:
- Whitelist de archivos por editor; integrador de archivos compartidos:

## 3. Contrato de integridad

| Dato / operación | Fuente de verdad | Unidad/moneda/precisión | Regla y versión | Quién puede ejecutarlo |
|---|---|---|---|---|
| PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |

- Política de redondeo y momento de aplicación:
- Tenant, actor efectivo, permiso y revocación:
- Precondiciones, versión e idempotencia:
- Efectos esperados en dinero, stock, deuda, documentos, asientos y auditoría:
- Rechazo: estado que debe conservarse y ausencia de efectos parciales:
- Respuesta perdida / reintento / reconexión:
- Reglas profesionales aún pendientes y responsable que las resolverá:

## 4. Casos y prueba independiente

El esperado se escribe antes de ejecutar el candidato y no se obtiene invocando el mismo calculador del producto. La revisión matemática conserva fuente y versión de política.

| Caso | Estado inicial y acción | Esperado independiente | Observado | Nivel y evidencia | Estado |
|---|---|---|---|---|---|
| Principal | PENDIENTE | PENDIENTE | NO EJECUTADO | PENDIENTE | PENDIENTE |
| Límite / precisión | PENDIENTE | PENDIENTE | NO EJECUTADO | PENDIENTE | PENDIENTE |
| Rol/tenant denegado | PENDIENTE | Sin fuga ni efecto lateral | NO EJECUTADO | PENDIENTE | PENDIENTE |
| Doble acción / replay | PENDIENTE | Un conjunto de efectos por intento lógico | NO EJECUTADO | PENDIENTE | PENDIENTE |
| Falla / recuperación | PENDIENTE | PENDIENTE | NO EJECUTADO | PENDIENTE | PENDIENTE |
| Concurrencia si aplica | PENDIENTE | PENDIENTE | NO EJECUTADO | PENDIENTE | PENDIENTE |

Nivel: regla pura / componente simulado / HTTP+MySQL / navegador con API real / hardware / usuario observado. Un NO APLICA lleva justificación y revisor; no se usa para esconder una prueba fallida.

Registrar comando real, fecha, duración, pruebas descubiertas/aprobadas/fallidas/omitidas y razón de cada omisión obligatoria. Para las capturas, incluir ruta/estado, viewport, tema, datos y candidato; una imagen de otra versión no prueba el estado actual. No incluir credenciales ni datos personales innecesarios.

## 5. Conciliación y arquitectura

| Capa | Identificador/correlación | Resultado esperado vs persistido | Evidencia |
|---|---|---|---|
| Venta / pago / documento | PENDIENTE | PENDIENTE | PENDIENTE |
| Stock / bodega / lote / Kardex | PENDIENTE | PENDIENTE | PENDIENTE |
| Caja / deuda / saldo a favor | PENDIENTE | PENDIENTE | PENDIENTE |
| Asiento / auditoría | PENDIENTE | PENDIENTE | PENDIENTE |
| Pantalla / reporte / comprobante | PENDIENTE | PENDIENTE | PENDIENTE |

- Contratos públicos preservados o migración compatible:
- Delta de líneas/estado del origen, destinos y total afectado:
- Presupuesto anterior y nuevo; excepciones añadidas/eliminadas:
- Rendimiento medido, condición de red/dispositivo y límites:
- Compatibilidad con datos históricos, upgrade y reversión cuando corresponda:

## 6. Observación de usuarios

| Participante anonimizado | Segmento/dispositivo | Tarea/versión | Sin ayuda | Tiempo/errores/ayuda | Resultado |
|---|---|---|---|---|---|
| PENDIENTE | PENDIENTE | PENDIENTE | NO OBSERVADO | PENDIENTE | PENDIENTE |

Fijar antes de observar el grupo elegible, selección, tarea y criterio de éxito; no escoger resultados favorables después. Separar habituales de nuevos/reactivados; práctica de venta legítima; primera venta de segunda sesión y regreso otro día. Guardar el denominador elegible y ventana. No atribuir causalidad a una muestra pequeña ni dar una intención de pago por cobro real.

## 7. Decisión y continuidad

| Puerta | Estado | Quién revisó | Evidencia / bloqueo / siguiente paso |
|---|---|---|---|
| Alcance y política | PENDIENTE | PENDIENTE | PENDIENTE |
| UX y accesibilidad | PENDIENTE | PENDIENTE | PENDIENTE |
| Integridad | PENDIENTE | PENDIENTE | PENDIENTE |
| Ingeniería | PENDIENTE | PENDIENTE | PENDIENTE |
| Candidato CI/staging | PENDIENTE | PENDIENTE | PENDIENTE |
| Publicación autorizada y verificada | PENDIENTE | PENDIENTE | PENDIENTE |
| Resultado de uso/pago | PENDIENTE | PENDIENTE | PENDIENTE |

NO APLICA puede utilizarse por sección o puerta cuando esté fuera del riesgo/alcance de la entrega, con motivo y revisor. No exigir pruebas financieras completas para un texto independiente ni validación comercial antes de reparar un defecto crítico. Cuando el contrato de dinero/stock/permisos cambia, su gate correspondiente sí aplica.

Decisión: continuar / corregir / reducir alcance / bloquear flujo. Registrar motivo breve, alternativas consideradas, evidencia, responsable, fecha y condición para reabrir la decisión. No almacenar razonamiento interno de los modelos.

Si el revisor edita el candidato, deja de ser revisor independiente de ese parche y se asigna otra revisión. No pedir otra vez autorizaciones vigentes; pedir la información material que falta y continuar lo que no dependa de ella. Esta ficha no concede permisos de producción, mensajes externos ni mutaciones de datos reales.
