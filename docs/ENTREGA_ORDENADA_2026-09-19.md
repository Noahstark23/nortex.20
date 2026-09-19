# Orden del trabajo local y del candidato — 2026-09-19

Este documento acompaña un **checkpoint local de preservación**, no una versión
aprobada para producción. Se conserva la rama `codex/caja-nica-retention`; no se
reemplaza su contenido por el candidato ni se reescribe historia.

## Qué se conserva

El inventario inicial contiene 1.216 archivos: 164 modificados y 1.052 no seguidos.
Se seleccionaron 806 fuentes, documentos, scripts, configuraciones y fixtures para
registrar; este informe es el archivo adicional de organización. Se incluyen el
script `.tmp-field-style-scan.cjs` y la configuración de auditoría de `.codex`.
El corpus de 100 facturas se identifica como sintético y se contrasta con sus hashes.
La revisión acotada de marcadores conocidos de credenciales no reemplaza una
auditoría de seguridad ni permite afirmar ausencia de datos privados en todo el repo.

Las 410 capturas/salidas/evidencias locales restantes permanecen en sus ubicaciones.
Una copia privada fuera del checkout, verificada archivo por archivo, las conserva
en `~/Developer/Nortex/release-evidence/clean-release-20260919/local-evidence-preserved.tar.gz`.
El inventario completo y sus hashes están en `checkpoint-inventory.json` en ese
directorio. Esos artefactos se excluyen **por ruta exacta** en `.git/info/exclude`;
no se elimina código, no se amplían patrones globales de ignorados y no se suben
capturas al repositorio público. Los nuevos archivos futuros seguirán siendo visibles.

## Dos procedencias distintas

| Entrega | Procedencia | Tratamiento |
|---|---|---|
| Checkpoint de trabajo local | HEAD anterior `d326c589a756db7977d14c94a625b6c895cb3313` más cambios existentes | Preservación recuperable; no integrar directamente a main |
| NortexGPT preparado | Base `67f1832502ee68ef67ac12b0803bdbfce48a4cef`, candidato `~/Developer/Nortex/candidates/nortexgpt-release-ready-20260919` | 191 archivos cambiados, 1.769 fuentes inventariadas; conservar íntegro y dar identidad Git propia |
| Borrador operativo | `promotion-20260919/operations-draft` | Compose validado estáticamente; no integrado ni activado |

En la comparación acotada de 692 rutas locales, 492 coinciden con el candidato,
185 difieren y 15 no están en él. Entre estas últimas hay avances de conteo y
proformas. A la inversa, 108 rutas del delta del candidato no están en este
checkout, incluyendo RAG editorial, presupuesto, W01 y migraciones. Por eso un
checkpoint de este árbol no equivale al candidato ni copiar éste encima sería
una integración correcta. El detalle de identidad Git y bundles se guarda en
`clean-release-20260919/registration.json` después de cada operación comprobada.

## Camino de promoción

1. Conservar el checkpoint y el candidato con sus propias identidades y bundles;
   un commit de preservación no declara pruebas aprobadas.
2. Integrar avances restantes por dominio sobre main vigente, con revisión de
   conflictos y evidencia propia. No juntar a ciegas el snapshot antiguo con main.
3. Resolver el bloqueo de plataforma de la QA heredada. Completar integración
   MySQL, mutación pertinente, upgrade/reintento, recuperación y operación.
4. Crear el candidato final; ejecutar CI y staging del mismo SHA, fijar el pin
   correcto en Coolify y promover según el runbook. La autorización del dueño
   para desplegar está registrada; las compuertas siguen pendientes.

Un push de una rama de preparación, si se realiza, solo registra el trabajo en
GitHub. No crea un PR ni dispara a propósito la QA rechazada, no modifica main y
no acredita un despliegue. No se usan etiquetas de omisión de CI ni se alteran
workflows o protecciones para publicar. Si la configuración viva activase QA por
ese push, se detiene antes de enviarlo.

Estado operativo y motivo exacto de staging:
[diagnóstico de promoción](NORTEXGPT_PROMOCION_DIAGNOSTICO_2026-09-19.md).
Los informes anteriores conservan los resultados de sus propias fechas/candidatos.
