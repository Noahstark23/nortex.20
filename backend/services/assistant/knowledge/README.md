# Publicación de ayuda oficial

Este módulo prepara infraestructura editorial, no una autorización para publicar
los borradores D02. La superficie humana está bajo
`/api/admin/assistant-knowledge` y en «Revisar ayuda de NortexGPT» de SuperAdmin.
No hay herramienta del modelo ni CLI con un rol suministrado por argumento. Las cuatro operaciones de
`lifecycle.ts` reciben un `AssistantPrincipal` confiable y el cliente Prisma
compartido. Revalidan una cuenta SUPER_ADMIN activa en su tenant bajo lock.

## Procedimiento editorial en la superficie autenticada

1. Leer y revisar el texto, roles, capacidades, canales y fuentes de cada sección.
2. `stageAssistantKnowledgeRelease`: entregar `{id, formatVersion: 1,
   documents: [{documentId, version, sectionId, payload}]}`. Devuelve el hash del
   manifiesto y estado DRAFT. El payload contiene `title`, `section`, `body`,
   `roles`, `requiredCapabilities`, `channels` y `keywords`.
3. Presentar al revisor humano el contenido exacto guardado y su hash. Sólo su
   decisión explícita permite llamar a `reviewAssistantKnowledgeRelease` con
   `{releaseId, manifestHash}` y su principal autenticado. Un agente no marca esa
   aprobación a partir de resultados de tests o hashes.
4. `publishAssistantKnowledgeRelease` recibe el mismo identificador y hash.
   Exige revisión vigente y cambia la publicación activa de forma atómica con
   auditoría. Ninguna llamada a un proveedor ocurre dentro de la transacción.
5. Para retirar un pasaje, `retireAssistantKnowledgeVersion` recibe
   `{reference: {documentId, version, sectionId, contentHash}, reason}`. Mantiene
   un tombstone permanente, incluso para los doce textos legacy compilados.

Las identidades y el contenido son inmutables. Una corrección requiere otra
versión. Un manifiesto no admite dos versiones de una misma sección. Repetir una
operación idéntica no genera otra publicación ni incrementa otra vez la revisión.
Publicar un manifiesto anterior sólo es posible si ninguna de sus fuentes fue
retirada. La retirada no se deshace con un rollback del corpus.

La superficie exige JWT y una cuenta SUPER_ADMIN activa comprobada de nuevo en
MySQL al consultar y decidir. Identidad y tenant se obtienen del servidor: ningún
cuerpo admite un revisor elegido por el cliente. Revisar y publicar tienen
confirmaciones separadas, ligadas al hash exacto. Las observaciones se guardan
con clave idempotente y auditoría; no cambian el estado de revisión/publicación.
Los GET no crean el control ni documentos. Las respuestas son `private, no-store`.
No hay importación, revisión ni publicación automática de D02.

El editor importa JSON del formato anterior (hasta 512 KB), conserva el borrador
en memoria al ocultar la pantalla y exige comprobar el estado después de una
respuesta incierta. No guarda datos editoriales en localStorage. Un cierre de
sesión descarta la copia en memoria. La recuperación tras recargar se limita a
operaciones guardadas en el servidor; una observación aún sin enviar necesita
guardarse antes. Ver `docs/NORTEXGPT_EDITORIAL_2026-09-19.md` para alcance y QA.

## Lecturas y compatibilidad

`service.ts` revalida identidad, rol, capacidades y canal al recuperar y entregar.
Consulta sólo versiones publicadas del manifiesto activo. Un pasaje histórico
sigue accesible si conserva publicación y permisos; se indica `historical`.
Una versión retirada responde como fuente no disponible, sin título ni cuerpo.
Los doce artículos anteriores siguen identificados como LEGACY mientras no haya
una publicación activa. No se les inventa revisor ni fecha de aprobación.

Toda lectura comprueba el control persistente; tablas ausentes, manifiestos
incompletos o hashes incoherentes deshabilitan la ayuda. Ningún GET crea tablas o
filas. Se mantiene el ranking léxico anterior para separar publicación de la
evaluación de relevancia. Las referencias se validan en lotes de hasta 64.

El corpus global contiene exclusivamente ayuda oficial. Facturas, historiales,
datos de usuarios y documentación interna no son entradas válidas por el mero
hecho de ser archivos Markdown. El hash fija cuerpo y política de acceso juntos.

Un rollback de **binario anterior a este lector** no conoce tombstones. Ese
destino exige desactivar antes las consultas de ayuda y las salidas privadas;
no es un rollback compatible con la garantía de retirada.

## Evidencia específica

`tests/assistantKnowledgePublication.test.ts` verifica recuperación, fuentes
exactas, disponibilidad, canales, revocación, hashes, retirada y lectura bulk.
`tests/assistantKnowledgeLifecycle.test.ts` verifica etapas, inmutabilidad,
reintentos y uso de la transacción de auditoría con un doble aislado. Estas
pruebas no demuestran locks o rollback reales de InnoDB; esa evidencia necesita
MySQL 8 descartable y datos sintéticos. No se ejecuta IA ni envío externo.

La integración editorial dedicada de `scripts/qa/knowledge-mysql.mjs` aplica la migración exacta y ensaya concurrencia, tombstones y rollback de auditoría en un MySQL 8 temporal. Su resultado se conserva separado de las pruebas con dobles en `docs/evidence/nortexgpt/knowledge-20260919/mysqlworker/result.json`.
