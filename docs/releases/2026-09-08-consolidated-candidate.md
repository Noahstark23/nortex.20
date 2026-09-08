# Candidato consolidado NortexGPT y ERP/POS

Integra la captura y ejecución controlada de NortexGPT, promociones online, cierre Z, correcciones de venta, cantidades por presentación, recuperación del POS y las compuertas manuales de publicación. Conserva los cambios de PR205/206 y el trabajo local acumulado. La integración se realizó en una copia aislada; el checkout original conserva su rama, índice y cambios.

## Estado de verificación

Prisma generate/validate, TypeScript, build SEO y sistema de diseño aprobados. Auditoría npm de producción: cero vulnerabilidades reportadas. Suite general: 5.731 aprobadas, cero fallidas, 318 omitidas; las omisiones no acreditan flujos financieros. Integración obligatoria MySQL y mutación de 64 módulos con umbral 100% en curso al crear este candidato. La corrida MySQL inicial encontró expectativas HTTP heredadas 409 frente al contrato remoto 400 para dos rechazos de inventario; se preservaron códigos y controles de rollback y se reconciliaron las expectativas con PR206.

La extracción fiscal fue caracterizada con ocho pruebas de conducta antes y después. Servidor: 14.674 → 14.131 líneas; destinos: constancia 244 y exportaciones 330; delta conjunto +31 por composición/imports. Presupuesto servidor: 14.266 → 14.131. POS integrado: 5.924 líneas y 96 referencias textuales useState, presupuesto reducido al resultado.

## Producción pendiente

Existe respaldo externo del 8 de septiembre: metadata y SHA-256 del objeto remoto coinciden. Una restauración vigente aún no está acreditada. El destino observado usa Docker Compose, admitido por las guardas actualizadas de PR205/206. La referencia anterior a un requisito exclusivo de Dockerfile quedó corregida tras verificar código y runbook; faltan confirmar el pin exacto y Auto Deploy desactivado. Faltan identidades y tokens de lectura configurados para los workflows nuevos. No se aprobó el run antiguo de main ni se ejecutó un despliegue.

La publicación del candidato no acredita CI, staging, producción, calidad del modelo real ni resultado de piloto. La autorización de publicar y desplegar fue dada por el usuario; los controles técnicos deben pasar sobre el candidato completo.

## Plan siguiente

El [plan de desarrollo y estabilidad](../PLAN_DESARROLLO_RAG_Y_ESTABILIDAD_2026-09-08.md) incluye la consolidación de los cuatro clientes, métricas, recuperación y modularización por dominio. Capturas locales y archivos personales de auditoría se preservan fuera de la publicación. [Evidencia estructurada](evidence/2026-09-08-consolidated/local-verification.json).
