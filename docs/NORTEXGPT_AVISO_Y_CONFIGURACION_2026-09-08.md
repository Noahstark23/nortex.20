# NortexGPT: aviso preparado y configuración pendiente

El aviso está implementado localmente en **Avisos importantes**, después de los pendientes operativos. No aumenta el contador de incidencias, no aparece como popup y no envía consultas de IA al abrirlo. Solo aparece al comprobar que el negocio tiene NortexGPT y ayuda habilitados. Un fallo de consulta o una sesión cambiada lo oculta. El botón **Conocer NortexGPT** cierra Avisos y abre el asistente sin navegar fuera de caja.

## Texto para el usuario

**Conocé NortexGPT**

Tu asistente dentro de Nortex. Preguntá cómo usar el sistema y consultá la información disponible para tu rol.

- Con acceso a inventario: «Revisá existencias y vencimientos con datos de tu negocio».
- Con permiso de preparación de compras: «Escribí “compré 50 bolsas de cemento” y completá los datos para preparar una compra».

Preparar no registra cambios. Las operaciones disponibles requieren revisión y confirmación antes de afectar dinero o inventario.

Botón: **Conocer NortexGPT**.

No anuncia extracción, promociones ni WhatsApp como disponibles universalmente. El backend sigue siendo la autoridad de permisos y ejecución.

## Configuración

La API key se crea en Claude Console, dentro de `Nortex-QA`. Coolify guarda esa clave como variable privada **de runtime del backend**, llamada `ANTHROPIC_API_KEY`; no es una variable `VITE_*` ni un valor para el bundle del navegador. No hay que crear otra aplicación para el panel.

La clave sola no publica la implementación ni habilita negocios. Antes de activar un entorno se debe verificar el candidato, schema compatible, flags globales (`NORTEX_ASSISTANT_ENABLED` y `NORTEX_ASSISTANT_OPERATIONS_ENABLED` para la primera etapa) y `AssistantTenantConfig` por negocio con presupuesto. El adaptador de lenguaje tiene su interruptor separado. Ejecución, extracción, acciones, promociones y WhatsApp siguen siendo capacidades independientes.

El `docker-compose.yml` del repositorio no declara actualmente las variables de IA del servicio `app`: si ese es el recurso usado en Coolify, hay que conectarlas al entorno del contenedor. No se verificó ni modificó la configuración remota en esta entrega. Para fases con documentos y trabajos durables, también hacen falta el worker, almacenamiento privado persistente y su respaldo. No se debe anunciar esas fases por haber agregado una clave.

La prueba local puede usar el llavero de macOS; un backend alojado en Coolify usa su propia variable de runtime. La clave debe entrar de forma privada, nunca por el chat. La evaluación real, el piloto y la autorización de producción conservan sus pasos pendientes.

## Evidencia de esta entrega

61 pruebas enfocadas y 4.821 generales aprobadas. Las 286 omitidas en la corrida general no se cuentan aprobadas. Prisma generate, TypeScript, sistema de diseño y build aprobados. La comprobación visual local abrió NortexGPT desde el aviso y conservó una bolsa de cemento por C$265 en el carrito; el contador permaneció en dos incidencias.

Se ajustó una prueba de Avisos para comprobar la última petición de su endpoint, en lugar de asumir que ninguna otra consulta de capacidades puede ocurrir después. Conserva la comprobación de identidad, caché y descarte de respuestas de otro negocio.

[Evidencia, hashes y logs](evidence/nortexgpt/aviso-20260908/summary.json). No cambió lógica financiera, schema ni los monolitos. No hubo llamadas pagadas, despliegue ni publicación a usuarios de producción.
