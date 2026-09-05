---
name: run-nortex
description: Ejecutar un smoke aislado de la app real Nortex contra MySQL 8 efímero y datos sintéticos. Úsalo para comprobar un flujo local de API y build, nunca contra una base compartida, staging o producción.
---

# Correr Nortex con smoke aislado

Nortex mueve dinero e inventario. Esta skill verifica una instancia **local y
efímera**, no sustituye la compuerta de integración obligatoria ni acredita un
tenant real, staging o producción.

## Camino seguro del agente

Desde la raíz del repositorio:

```bash
mise exec -- bash .claude/skills/run-nortex/smoke.sh
```

El script falla cerrado si no encuentra Docker local, la imagen local
`mysql:8.0`, Node 22 o las dependencias ya instaladas. No instala paquetes, no
hace `docker pull`, no inicia MySQL del sistema y no acepta una `DATABASE_URL`,
un puerto, credenciales o una carpeta de salida del entorno llamante.

Durante una sola ejecución el script:

1. crea un contenedor MySQL 8 propio en `tmpfs`, con nombre, usuario,
   contraseña, base y puerto loopback aleatorios;
2. aplica el schema solo a esa base descartable con el binario local de Prisma,
   sin `--accept-data-loss`;
3. construye el frontend localmente y arranca un backend propio solo en
   `127.0.0.1` con un JWT aleatorio;
4. desactiva correo, Stripe, WhatsApp, LLM y telemetría al ejecutar el backend
   en un entorno mínimo;
5. prueba datos sintéticos: registro, producto con mayoreo/empaque, login,
   lectura aislada por tenant, landing, prerender y sitemap;
6. detiene exclusivamente el grupo de procesos que creó, borra exclusivamente
   su contenedor etiquetado y elimina sus archivos temporales, incluso ante
   error o señal.

La opción histórica `--keep` queda rechazada a propósito: una prueba aislada no
deja servidor, base, token, capturas ni logs activos. Para una revisión visual
del candidato, abrí una instancia local controlada por la persona operadora y
registra ese recorrido por separado; una captura no prueba todo el ERP.

## Límites y evidencia

- El smoke usa un tenant recién registrado y datos sintéticos. No lee `.env`,
  usuarios, credenciales ni bases existentes.
- El build y las solicitudes HTTP son locales; la imagen debe existir antes de
  empezar. La compuerta no descarga imágenes ni llama servicios externos.
- Si Docker apunta a un contexto que no sea un socket Unix local, el script se
  niega a continuar.
- No sustituye `npm run test:integration:required` para cambios de dinero o
  inventario, ni el QA visual autenticado, ni una compuerta de release.

## Diagnóstico seguro

| Situación | Acción segura |
|---|---|
| Falta Docker, Node 22, dependencias o `mysql:8.0` | Preparar explícitamente el entorno local; no instalar ni descargar desde este script. |
| Docker no es un socket local | Corregir o seleccionar un contexto local; nunca usar un daemon remoto para este smoke. |
| El backend o una aserción falla | El script limpia sus recursos y termina no cero. Investigar con pruebas focales; no reutilizar una BD de desarrollo. |
| Se requiere una pantalla para revisión | Ejecutar el flujo visual autorizado por separado contra un candidato local; no usar `--keep`. |
