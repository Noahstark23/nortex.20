# Plan Nortex USA: identidad, distribución y capital

**Fecha:** 2026-09-28  
**Estado:** PROPUESTO  
**Dueño de producto:** Noel Pineda  
**Alcance:** estructura empresarial y de distribución. No crea una entidad, no solicita crédito, no abre cuentas, no compra servicios y no despliega producción.

## 1. Decisión

Nortex deja de tratarse sólo como “una app” y se administra como cuatro activos separados:

1. **Producto/IP:** código, marca, dominio, datos de producto y know-how.
2. **Operación:** clientes, soporte, facturación, hosting y costos de IA.
3. **Distribución:** web, PWA, Google Play y WhatsApp.
4. **Entidad/capital:** EIN, D-U-N-S, banking y crédito empresarial cuando exista una base legal y económica que lo justifique.

La prioridad inmediata no es añadir otra feature. Es convertir infraestructura ya existente en canales distribuibles y medibles.

## 2. Evidencia ya existente en el repositorio

- Android/Capacitor ya existe en `android/`.
- `capacitor.config.ts` usa `com.somosnortex.app` y carga `https://somosnortex.com/login`.
- `docs/BUILD_ANDROID.md` describe build de APK/AAB por GitHub Actions.
- El catálogo público ya soporta modo `QUOTE` y convierte un `PublicOrder` en cotización mayorista.
- Cotizaciones ya pueden compartirse por WhatsApp desde la interfaz interna.
- El canal comercial de WhatsApp ya tiene webhook, sender de Cloud API, búsqueda de catálogo y orquestador, pero la documentación vigente no acredita operación real en producción.

Por tanto, Play Store y WhatsApp son proyectos de **integración, identidad, política y QA**, no reconstrucciones del producto.

## 3. Stack empresarial mínimo

### 3.1 Lo que puede prepararse ya sin formar una entidad

- Libro mayor separado de Nortex.
- Registro de costos: DigitalOcean, dominio, IA, software, marketing, equipo y servicios profesionales.
- Correo de negocio bajo `somosnortex.com`.
- Política de privacidad, soporte, términos y datos de contacto vigentes.
- Inventario de activos de IP y repositorios.
- Métricas: MRR, clientes activos, activación, cotizaciones creadas, cotizaciones convertidas y soporte.

### 3.2 Decisión de entidad

No formar una LLC sólo por estética o “crear business credit”.

La entidad se aprueba cuando desbloquea una o más de estas capacidades con valor superior a su costo:

- documentación organizacional para Google Play;
- D-U-N-S verificable;
- banking empresarial;
- contratos con clientes/proveedores;
- separación de responsabilidad;
- acceso a crédito o programas empresariales;
- estrategia fiscal/equity que haya sido revisada profesionalmente.

Opciones a modelar antes de presentar documentos:

| Opción | Ventaja | Costo/riesgo principal | Uso probable |
|---|---|---|---|
| Sole proprietorship | Menor fricción inicial | Separación legal limitada; documentación organizacional puede no bastar para todos los proveedores | Operar y validar |
| California LLC | Entidad clara para contratos y verificación | Impuesto/costos recurrentes de California | Negocio operativo pequeño/mediano |
| C-Corp | Equity, inversionistas y opciones fiscales corporativas | Más contabilidad y gobierno | SaaS exportador con crecimiento/venta futura |

**Gate:** antes de presentar una entidad, confirmar costo estatal/federal vigente con CPA/EA o fuente oficial y documentar por qué esa forma gana frente a las alternativas.

## 4. Camino de identidad empresarial

Orden propuesto:

1. Definir forma legal.
2. Formar entidad sólo si fue aprobada.
3. Obtener EIN directamente del IRS; el IRS no cobra por emitirlo.
4. Buscar si la organización ya tiene D-U-N-S; si no, solicitarlo a Dun & Bradstreet.
5. Alinear nombre legal, dirección, teléfono, sitio web y correo en todos los proveedores.
6. Crear/verificar cuenta de organización de Google Play.
7. Configurar identidad empresarial de Meta/WhatsApp.
8. Abrir banking empresarial sólo después de tener la identidad legal/tributaria necesaria.
9. Construir historial financiero real: ingresos, gastos y pagos de proveedor separados.

Fuentes oficiales de referencia:
- IRS EIN: https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number
- D-U-N-S: https://www.dnb.com/en-us/smb/duns/get-a-duns.html
- Google Play account types: https://support.google.com/googleplay/android-developer/answer/13634885
- Google Play organization information: https://support.google.com/googleplay/android-developer/answer/13628312

## 5. Distribución como multiplicador

### Web
`somosnortex.com` continúa como superficie canónica. Debe medir:
- visitas al catálogo;
- producto visto;
- carrito;
- solicitud de cotización;
- cotización enviada;
- aceptación/conversión;
- registro/trial.

### Google Play
No reescribir la app. Publicar el shell Capacitor existente después de:
- identidad de organización;
- AAB firmado;
- QA física;
- Data Safety;
- política de privacidad;
- ficha de tienda;
- credenciales de revisión si aplica.

### WhatsApp
No duplicar inicialmente todo el catálogo en Meta. El catálogo web de Nortex queda como fuente de verdad.

WhatsApp se usa para:
- descubrir intención;
- buscar producto;
- aclarar cantidad/presentación;
- preparar una cotización;
- enviar un enlace de revisión al catálogo/cotización;
- seguimiento dentro de las reglas de Meta;
- handoff humano.

Ver `PLAN_WHATSAPP_CATALOGO_COTIZACIONES_2026-09-28.md`.

## 6. Business credit: secuencia, no atajo

Business credit se construye después de identidad y flujo real:

1. EIN/D-U-N-S coherentes.
2. Cuenta bancaria separada.
3. Proveedores reales a nombre de la empresa.
4. Ingresos depositados en la empresa.
5. Estados financieros simples y consistentes.
6. Sólo entonces evaluar productos de crédito.

No se compra inventario ni software innecesario “para crear crédito”. No se usa deuda empresarial para vivienda personal, inversiones o apuestas.

## 7. Trabajo que la IA puede absorber

La IA debe preparar y mantener:

- backlog;
- documentos de publicación;
- borradores de store listing;
- matriz Data Safety;
- checklist D-U-N-S/Play/Meta;
- QA;
- especificaciones;
- PRs/documentación de código;
- análisis de métricas;
- plantillas de soporte;
- catálogo de pruebas.

Noel sólo debe intervenir en:
- identidad/documentos legales;
- pagos;
- aceptación de términos;
- apertura de cuentas;
- firma/keystore;
- credenciales;
- promoción a producción;
- decisiones de riesgo/capital.

## 8. Orden de ejecución

### P0 — esta semana
- Aprobar arquitectura catálogo + WhatsApp.
- Terminar documentos de Play Organization.
- Verificar datos legales que necesitaría D-U-N-S.
- Preparar lista de activos/costos de Nortex.
- No presentar todavía entidad, EIN ni Play.

### P1 — identidad
- Elegir forma legal.
- D-U-N-S.
- EIN.
- Play Organization.
- Meta Business.

### P2 — distribución
- AAB release.
- Play Store.
- WhatsApp piloto.
- Catálogo/cotización conectado.

### P3 — comercial
- Medir primera cotización WhatsApp→web.
- Medir primera cotización convertida.
- Medir primer cliente recurrente.
- Sólo después ampliar automatización.

## 9. Métricas de éxito

No contar documentos o agentes como progreso económico.

Métricas:
- clientes pagos;
- MRR neto;
- margen después de hosting/IA;
- cotizaciones creadas;
- tasa cotización→venta;
- tiempo de respuesta;
- costo de IA por negocio;
- retención;
- saldo de caja Nortex;
- business credit disponible **sólo cuando exista**, no como objetivo nominal.

## 10. Condiciones de parada

Detener expansión si:
- Play exige una estructura que aún no tenemos;
- Meta prohíbe la categoría de un tenant/producto;
- el canal WhatsApp no conserva autoridad de precios/stock;
- la cotización puede crear venta, mover inventario o dinero sin confirmación;
- el costo fijo empresarial supera el beneficio esperado sin un desbloqueo concreto.

