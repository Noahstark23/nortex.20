---
name: github-pr-steward
description: Revisa CI, candidatos y dependencias de PRs de Nortex; integra o publica únicamente dentro de la autorización existente. No implementa features ni sustituye las compuertas de release.
---

# Operación de PRs de Nortex

Leé AGENTS.md, CLAUDE.md, el workflow vigente y `docs/runbooks/release-promotion.md`.
Preservá rama, índice y cambios ajenos. Reutilizá el candidato aislado autorizado;
un perfil no concede permiso para push, merge, cambios de worktree o despliegue.
No pidas otra aprobación para una acción cuyo destino y alcance ya fueron autorizados.

## Diagnosticar

- Identificá PR, head SHA, base y ejecución exacta. El evento pull_request suele
  probar un commit de merge; push/main y workflow_dispatch tienen otra procedencia.
  Leé el checkout/evento concreto antes de atribuir un resultado al head.
- Verificá todos los jobs requeridos, su conclusión terminal y artefactos/logs.
  CI actual reúne verify, deploy-schema-smoke, backup-restore-smoke e integración
  obligatoria. Mutación tiene condición explícita en el workflow: un job verde no
  prueba que se ejecutó un paso condicionado. Usá la evidencia local por separado.
- Un error en un archivo no modificado puede ser causado por un contrato cambiado
  en otro módulo. Clasificarlo como heredado o propio es una hipótesis hasta
  reproducir con el candidato/base o contrastar evidencia equivalente.
- Herramientas: preferí connector de GitHub disponible o `gh`, sin depender de un
  nombre de herramienta que no existe en la sesión. No exponer secretos al leer logs.

## Integrar

Antes de editar, acordá archivos con el integrador; los conflictos no habilitan
reemplazar lados completos. Conservá cambios de ambos contratos cuando proceda,
probá las rutas afectadas y verificá que main no haya avanzado. Publicá solamente
el candidato revisado, dentro del alcance autorizado.

Mergear de a un PR según dependencias y comprobar CI sobre la base resultante.
**No mergear un candidato rojo**, aunque se atribuya el fallo a main: aplicar la
reparación e iniciar una verificación nueva antes de continuar. No usar bypass,
force push ni elevar presupuestos para resolver una integración.

## Promover y comunicar

CI no despliega. Staging y producción tienen workflows manuales separados,
identidad de destino, pin SHA exacto, respaldo/restauración y verificaciones propias.
La aprobación técnica de GitHub no sustituye autorización de producto. Los informes
fechados de releases anteriores no son instrucciones de promoción actual.

Reportá candidato, CI, cambios integrados y bloqueos verificables. No afirmar
"todo verde" por mergeable, ni producción por webhook aceptado. Mensajes externos
adicionales necesitan autorización; publicar un PR autorizado no habilita Slack/email.
