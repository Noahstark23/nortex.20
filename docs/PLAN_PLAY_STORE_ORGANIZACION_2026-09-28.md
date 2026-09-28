# Plan Google Play — Nortex como organización

**Fecha:** 2026-09-28  
**Estado:** PROPUESTO  
**Alcance:** preparar publicación Android. No crea cuenta, no paga la cuota de Google, no acepta términos y no sube un AAB.

## 1. Estado técnico verificado en el repo

- Shell Android: listo en `android/`.
- Capacitor: versión 6 en el corte documentado.
- Package/application id: `com.somosnortex.app`.
- App name: `Nortex`.
- URL: `https://somosnortex.com/login`.
- Workflow CI de Android: documentado en `docs/BUILD_ANDROID.md`.
- El AAB de release requiere keystore y secrets de firma.
- No hay evidencia en este plan de publicación real en Google Play.

## 2. Corrección de documentación

La guía histórica del repo todavía menciona **20 testers** para cuentas personales nuevas.

La regla oficial vigente de Google Play indica que las cuentas **personales** creadas después del 13 de noviembre de 2023 deben completar una prueba cerrada con **al menos 12 testers durante 14 días continuos** antes de solicitar acceso a producción.

La página oficial formula esa obligación para cuentas personales. Una cuenta de organización tiene un flujo de verificación distinto y exige D-U-N-S.

Fuentes:
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/13634885

No usar “organización” como truco para evadir políticas. Nortex es una actividad comercial, por lo que una cuenta de organización es coherente si existe una organización verificable.

## 3. Requisitos de cuenta de organización

Google pide, entre otros:

- D-U-N-S;
- nombre de organización;
- dirección;
- teléfono;
- sitio web;
- nombre/contacto;
- email y teléfono de contacto;
- email y teléfono públicos de desarrollador;
- verificación de identidad y, según el caso, documento oficial de la organización.

Google advierte que obtener un D-U-N-S nuevo puede tardar hasta 30 días.

Fuente:
https://support.google.com/googleplay/android-developer/answer/13628312

## 4. Camino crítico

### G0 — identidad
- [ ] Decidir forma legal de Nortex.
- [ ] Confirmar nombre legal exacto.
- [ ] Confirmar dirección empresarial utilizable.
- [ ] Confirmar teléfono empresarial.
- [ ] Confirmar `somosnortex.com` y correo de dominio.
- [ ] Buscar D-U-N-S existente.
- [ ] Solicitar D-U-N-S si no existe.

### G1 — cuenta Play
- [ ] Crear cuenta como organización cuando la documentación esté lista.
- [ ] Verificar identidad.
- [ ] Verificar web/contactos.
- [ ] Guardar recibos y datos de la cuenta en almacenamiento seguro.

### G2 — firma
- [ ] Generar keystore de release una sola vez.
- [ ] Hacer backup cifrado fuera del repo.
- [ ] Registrar alias y procedimiento de recuperación.
- [ ] Añadir secrets a GitHub Actions sin exponer valores.
- [ ] Generar AAB.
- [ ] Registrar SHA del código y checksum del AAB.

### G3 — QA física
Mínimo dos dispositivos Android cuando sea posible:
- [ ] login;
- [ ] sesión persistente;
- [ ] POS;
- [ ] catálogo;
- [ ] cotizaciones;
- [ ] modo avión después de carga previa;
- [ ] volver a red;
- [ ] cámara si se incluye;
- [ ] deep links;
- [ ] enlaces externos abren navegador/sistema;
- [ ] no existe tráfico HTTP claro;
- [ ] cierre/reapertura.

El APK debug nunca se distribuye a clientes.

### G4 — ficha
- [ ] título y short description;
- [ ] full description;
- [ ] icono 512;
- [ ] feature graphic;
- [ ] screenshots reales;
- [ ] categoría;
- [ ] correo/website de soporte;
- [ ] política de privacidad;
- [ ] content rating;
- [ ] Data Safety;
- [ ] acceso de revisión si la app requiere login.

### G5 — publicación
- [ ] Internal testing primero aunque no sea una obligación de producción.
- [ ] Corregir crash/ANR/bloqueos.
- [ ] Release candidate.
- [ ] Autorizar subida a producción de forma separada.

## 5. Store positioning

Hipótesis de copy:

**Título:** Nortex — Ventas e Inventario

**Short description:**  
POS, inventario, caja, compras y cotizaciones para comercios de Nicaragua.

**Mensaje principal:**  
Tu negocio, inventario y caja en un solo sistema. Vendé, controlá existencias y enviá cotizaciones desde el teléfono o la computadora.

No prometer:
- cumplimiento fiscal certificado;
- disponibilidad offline absoluta;
- WhatsApp operativo antes de su validación;
- hardware compatible sin pruebas físicas;
- automatizaciones que no estén activas.

## 6. Riesgos que bloquean publicación

- pérdida del keystore;
- `appId` incorrecto antes de la primera publicación;
- política de privacidad desalineada con telemetría/datos reales;
- Data Safety incompleto;
- login imposible para review;
- WebView que rompe funciones críticas;
- dependencias Android fuera de matriz soportada;
- afirmaciones de funciones no desplegadas.

## 7. Definición de hecho

“Play preparado” = AAB firmado + QA física + identidad de organización + ficha + Data Safety.

“Play publicado” sólo existe después de una subida autorizada, revisión de Google y disponibilidad confirmada. Este documento no acredita ninguna de esas etapas.
