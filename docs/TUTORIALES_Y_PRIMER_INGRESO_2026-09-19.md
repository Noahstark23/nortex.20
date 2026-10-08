# Tutoriales y primer ingreso — candidato local del 19/09/2026

Candidato: `/Users/stark/Developer/Nortex/candidates/alta-camara-20260919`, rama `codex/alta-camara-20260919`, base `67f1832502ee68ef67ac12b0803bdbfce48a4cef`. Conserva la entrega de alta con cámara; los cambios de este informe son posteriores y no están desplegados ni publicados.

## Auditoría del recorrido

Objetivo: que una persona nueva pueda ensayar y después operar con datos propios, distinguiendo una indicación leída de un movimiento confirmado.

1. **Descubrimiento:** el primer ingreso ya ofrecía primera venta y práctica, pero los tutoriales estaban separados y el checklist se reducía a un contador en móvil. Ahora Inicio incluye una entrada visible a aprender; el contador tiene nombre accesible. Se verificó con un negocio sintético sin productos ni ventas en 390 × 844.
2. **Ayuda:** había cuatro recorridos; POS, compras y fiado eran popovers centrados sin objetivos en pantalla. Inventario referenciaba `data-tour="inv-new"` y `inv-search`, inexistentes en el catálogo actual. Ahora hay práctica explícita y guía para trabajar, con contenido complementario plegable.
3. **Práctica:** Dashboard e Inventario ofrecían sembrar un catálogo en el negocio desde una acción de prueba. Ambos accesos ahora llevan a aprender sin ese POST. Venta reutiliza GuestPOS aislado. Productos, recepción y abono tienen ejercicios con fixtures fijos, errores recuperables, revisión y resultado. No usan APIs de negocio ni calculan movimientos financieros reales.
4. **Trabajo real:** cuatro guías en Layout, fuera de los monolitos. No son overlays ni disparan controles. “Mostrar dónde” enfoca únicamente un control visible y se abstiene si hay un modal abierto. Una indicación ausente informa el motivo posible. Pausar/retomar no navega ni toca el carrito. El índice leído se conserva por tenant + usuario + guía y se recupera al volver a abrirla desde Ayuda. La práctica no marca hitos de activación.

Fortalezas conservadas: progreso real desde GET /api/onboarding; la caja de práctica existente; roles de los flujos de negocio; protección del carrito; alta con cámara y marca. Los botones de guía no sustituyen autorización del backend.

## Implementación

- `components/learning/TaskGuide.tsx` y `utils/learningGuides.ts`: instrucciones contextuales, foco y progreso de lectura. Navegar de módulo oculta la guía. Los enlaces antiguos siguen funcionando y conservan otros parámetros/hash al consumir `tour`.
- `components/learning/PracticeExercise.tsx`: ejercicios de producto, recepción y abono. Son ejemplos educativos de alcance acotado, no réplicas completas de los formularios reales.
- `components/HelpCenter.tsx`: entrada de aprendizaje y ejercicios; referencias secundarias plegables. Reactiva primeros pasos sin recargar la aplicación.
- Inicio, Dashboard e Inventario: acceso al aprendizaje sin sembrar productos por probar.
- `utils/tours.ts`: compatibilidad por eventos, sin driver.js ni temporizador para overlays.
- Eventos de apertura, lectura, pausa/reanudación y práctica completada contienen solo IDs fijos de tutorial/paso. No confundir práctica completada con primera venta real.

## Evidencia ejecutada

- Línea base antes de cambios: 28 pruebas de Ayuda, Inicio y storage aprobadas.
- Pruebas focales: 68 aprobadas (guías, práctica, Ayuda, temas, Inicio, Layout y activación POS).
- Compuerta general: Prisma generate, TypeScript, Vitest, diseño y build. Resultado: 6318 pruebas aprobadas, 407 omitidas; 448 archivos de pruebas aprobados y 46 omitidos. Diseño: 118 archivos revisados. Resultado final en `reports/tutorials/quality.log`. Las suites de integración omitidas en Vitest general no cuentan como aprobadas.
- Navegador: error de marca en ejercicio conserva nombre; corregir marca/precio termina la práctica sin crear productos; entrada desde Inicio de negocio nuevo; guía enfoca buscador real; móvil día/noche; carrito de un martillo por 100 córdobas idéntico antes y después de avanzar, pausar y retomar. No se confirmó una venta para esta prueba.
- Se reparó una espera de la prueba de cámara: comprobar el segundo inicio del lector exige esperar su efecto; se mantiene la misma aserción de dos inicios y descarte del código anterior.

Capturas en `reports/tutorials/`: `before-help.png`, `after-help.png`, `before-inventory-guide.png`, `after-inventory-guide.png`, `after-practice-product.png`, `first-login-mobile.png`, `help-mobile.png`, `mobile-guide.png`, `mobile-guide-dark.png`, `pos-cart-preserved.png`. El antes/después comparable de Ayuda usa el mismo negocio sintético y viewport de escritorio. Las capturas móviles del primer ingreso son otra cuenta sintética, no evidencia de una cohorte.

## Límites y siguiente validación

- Implementado y verificado localmente. Sin deploy, push, merge ni cambios de base de usuarios.
- No cambia lógica de dinero/stock ni schema respecto al candidato de cámara. No se volvió a ejecutar MySQL transaccional por este cambio educativo. La entrega previa de cámara mantiene su evidencia separada.
- El registro de la cuenta de QA se hizo por API local; el navegador verificó login y primer ingreso. No se revalidó el formulario público completo de registro.
- No se ejecutó auditoría WCAG completa ni prueba física de lector/cámara por esta entrega.
- La guía recuerda instrucciones en este navegador; no sincroniza aprendizaje entre dispositivos. Los ejercicios se reinician al salir: no guardan datos de negocio ni acreditan operaciones.
- El diagnóstico de churn sigue siendo una hipótesis. Medir en piloto: entrada a aprendizaje, práctica completada, primer producto real, primera venta confirmada y regreso otro día. Comparar cohortes equivalentes y observar a usuarios intentando estas tareas sin asistencia antes de atribuir retención al rediseño.
- Los temas de balanzas, equipo, contabilidad y entregas conservan referencias plegables; no se afirma una práctica interactiva nueva para cada módulo del ERP.
