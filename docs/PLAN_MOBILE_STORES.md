# Plan — Nortex a Google Play Store (primero) y Apple App Store

> Objetivo: publicar Nortex en **Play Store** cuanto antes y dejar **App Store**
> encaminado (ya hay Mac mini para iOS). Nortex maneja **dinero real** y su **POS
> offline es la joya de la corona** → el empaquetado no puede romper el modo
> offline. Datos de tiendas verificados 2025-2026 (§9).
>
> **Decisión de negocio tomada:** la app **NO vende la suscripción por dentro** —
> el comerciante paga por fuera (transferencia). Esto hace la publicación
> **viable sin comisión (0%)** en ambas tiendas (ver §6.1).

## 0. Estado actual (recon del repo)

| Señal | Estado | Implica |
|---|---|---|
| PWA | ✅ `vite-plugin-pwa`, `display: standalone`, `autoUpdate` | 50% del camino a Play ya está |
| Offline | ✅ Workbox precache (4 MiB), **cola de ventas en IndexedDB**, caché **tenant-safe** | Preservarlo al empaquetar — **crítico en iOS** (§1, §5) |
| Íconos | ⚠️ solo `icon-192.svg` + `apple-touch-icon.png` | **Falta PNG 512×512 maskable** (Play no acepta SVG) |
| `start_url` | ⚠️ `/` la sirve `landing.html` (marketing), no la app | El app empaquetado debe arrancar en **login**, no en la landing |
| Push nativo | ❌ no hay | Se agrega en iOS (ayuda a pasar Apple 4.2) |
| Capacitor/Cordova | ❌ no instalado | Se agrega en Fase 2 (iOS) sin tocar el core |

## 1. Recomendación estratégica (híbrida — confirmada por la investigación)

- **Android → TWA** (Bubblewrap / PWABuilder). Corre el PWA en el **motor Chrome
  real** del dispositivo → **service worker + IndexedDB + offline funcionan
  idénticos, cero cambios.** Camino rápido, **sin Mac**, salida AAB.
- **iOS → Capacitor** (Apple no permite TWA). **⚠️ Hallazgo clave:** la **WKWebView
  de iOS NO registra service workers de forma fiable** — Capacitor sirve los assets
  desde `capacitor://localhost` y el SW no arranca; hay reportes de pantallas en
  blanco y corrupción de IndexedDB al relanzar offline. **Conclusión: en iOS NO se
  puede confiar el fiado/venta offline al service worker.**

**Implicación de arquitectura (Fase 2):** abstraer la **cola offline** detrás de
una interfaz de persistencia con dos backends: **IndexedDB en Android/web** (como
hoy) y **SQLite nativo en iOS** (`@capacitor-community/sqlite`) + un sync-manager
propio (pending changes + resolución de conflictos). PWABuilder genera ambos
paquetes (TWA Android + proyecto iOS), pero el offline iOS es **trabajo de
ingeniería real**, no un wrapper automático.

## 2. Prerrequisitos (cuentas, costos, la Mac) — datos verificados

- **Google Play Console** — **$25 pago único** (de por vida).
- **Apple Developer Program** — **$99/año**.
- **Cuenta de ORGANIZACIÓN en ambas** (no personal): pone a la empresa como
  vendedor **y en Google exime del requisito de 12 testers** (§4). Requiere
  **D-U-N-S** (número gratuito de Dun & Bradstreet, **tarda hasta ~30 días** — es
  el paso más lento → **tramitarlo YA**).
- **Mac mini** ✅ — para Xcode 16 (compilar/firmar/subir iOS).
- **Dominio HTTPS** ✅ — para el `assetlinks.json` del TWA.
- **Política de privacidad pública (URL)** — **obligatoria** en ambas tiendas.
- **⚠️ [VERIFICAR ANTES DE PAGAR]:** elegibilidad de registro de desarrollador para
  **Nicaragua** en Play y en Apple Developer Program (el agente no pudo confirmarlo
  en fuente oficial). Como no hay venta in-app, **no** se necesita "merchant
  registration". Workaround si no aplica: registrar la entidad en otro país con
  presencia legal.

## 3. Fase 0 — Preparar el PWA (sirve a las DOS tiendas, sin Mac)

1. **Íconos** PNG **192 + 512 + maskable** (safe-zone) desde el logo Obsidian;
   actualizar `manifest.icons` de `vite.config.ts` (hoy solo SVG). Splash.
2. **`start_url`/scope** → arranca en la **app (login)**, no en `landing.html`.
   Revisar `scope`, `display`, `orientation`, `theme_color`.
3. **Lighthouse PWA "installable" = 100** (requisito de facto del TWA).
4. **`/.well-known/assetlinks.json`** servido por Express (quita la barra de URL).

## 4. Fase 1 — Android / Google Play (PRIMERO, sin Mac)

1. Generar el TWA con **PWABuilder** (simple) o **Bubblewrap** (control) → **AAB**,
   **targetSdk 35 (Android 15)** — obligatorio desde 31-ago-2025.
2. Publicar `assetlinks.json` con el fingerprint de firma (Play App Signing).
3. **Cuenta de organización ⇒ SIN el circo de 12 testers/14 días** (ese requisito
   es solo para cuentas **personales** creadas después del 13-nov-2023).
4. Ficha: capturas, descripción (español nica), **categoría Business**, **Data
   Safety form** (declarar PII/financiero honesto), política de privacidad.
5. Release a producción.

## 5. Fase 2 — iOS / App Store (con la Mac mini)

1. Xcode 16 (SDK iOS 18, deployment target **iOS 15**) + **Capacitor**
   (`@capacitor/core`, `@capacitor/ios`) envolviendo el `dist/`.
2. **Offline nativo (no SW):** mover la cola de ventas a **SQLite nativo**
   (`@capacitor-community/sqlite`) tras una interfaz de persistencia; sync-manager.
3. **Features nativas para pasar Apple 4.2** (ver §6.2): **scanner de código de
   barras** (`@capacitor-mlkit/barcode-scanning`, ML Kit, Android+iOS) + **push** +
   **Face ID/Touch ID** para login/autorizar dinero.
4. TestFlight → App Review → release.

## 6. Landmines / decisiones (con veredicto de la investigación)

1. ✅ **IAP / comisión — RESUELTO Y VIABLE (0%).** Nortex es B2B SaaS con pago
   externo → **es el caso que las reglas favorecen**:
   - **Apple 3.1.3(b) Multiplatform/(c) Enterprise:** app *companion* de un servicio
     web, el usuario **inicia sesión en una cuenta existente**, **sin ningún comercio
     in-app** → **no obliga IAP ni comisión**. **Regla de oro: dentro de iOS, cero
     precios, cero botón "suscribite", cero flujo de compra.** Solo login + usar.
   - **Google Play Billing:** solo aplica a compras digitales **dentro** de la app;
     una suscripción cobrada 100% por fuera **no debe comisión**.
   - Contexto 2025 (a favor): fallos **Epic v. Apple** (EE.UU., abr-2025) y **Epic v.
     Google** relajaron el anti-steering. Igual, para Nortex lo más seguro es **no
     presentar comercio alguno in-app**.
2. 🟠 **Apple 4.2 (minimum functionality):** un wrapper "que se siente a bookmark"
   **se rechaza**. Con **scanner de barras + push + Face ID** el riesgo baja a **BAJO**.
3. 🟠 **D-U-N-S / cuenta de organización** — tramitar ya (~30 días).
4. 🟠 **Privacidad:** política pública + **Data Safety (Google)** + **App Privacy
   (Apple)**, enfoque minimalista (Nortex maneja PII + datos financieros).
5. 🟡 **Offline iOS bajo WKWebView** — el trabajo de ingeniería real (SQLite, §5).
6. ⚠️ **[VERIFICAR] elegibilidad de registro para Nicaragua** en ambas tiendas.

## 7. Orden de acción

1. **Tramitar el D-U-N-S YA** (cuello de botella de ~30 días) → cuenta de
   **organización** en ambas tiendas.
2. **Verificar elegibilidad de registro para Nicaragua** antes de pagar.
3. **Fase 0** (íconos PNG + start_url + assetlinks) — desbloquea todo.
4. **Fase 1** (TWA → Play): offline intacto, AAB, targetSdk 35.
5. **Fase 2** (Capacitor iOS): SQLite offline + scanner/push/Face ID.
6. **Privacidad** (política + Data Safety + App Privacy) antes de cualquier review.

## 8. Costos totales de arranque

| Concepto | Costo |
|---|---|
| Google Play Console | $25 (único) |
| Apple Developer | $99/año |
| D-U-N-S | gratis (~30 días de trámite) |
| **Trabajo de código** | Fase 0 (chico) · Fase 1 (chico, TWA) · **Fase 2 iOS = el grueso** (Capacitor + offline SQLite + plugins nativos) |

## 9. Datos verificados (2025-2026) — fuentes

- Play testing: 12 testers × 14 días **solo cuentas personales post-13-nov-2023**;
  **org exenta**. Play $25 único. Apple $99/año. D-U-N-S obligatorio para org.
- Android: **targetSdk 35** desde 31-ago-2025 (36 desde ago-2026); **AAB** obligatorio.
- iOS: **Xcode 16 + SDK iOS 18** desde 24-abr-2025; deployment target ~iOS 15.
- TWA preserva SW/IndexedDB; **WKWebView (iOS) NO registra SW fiable** → SQLite nativo.
- IAP: no obligatorio para B2B con pago externo sin comercio in-app (Apple 3.1.3 /
  Play Billing); anti-steering relajado en 2025 (Epic v. Apple/Google).
- Scanner: **`@capacitor-mlkit/barcode-scanning`** (ML Kit, ambas plataformas).
- **[CONFIRMAR]:** (a) exención formal de org en la doc de Google; (b) registro de
  desarrollador para Nicaragua; (c) deployment target exacto de la versión de Capacitor.

---

*Fases de código (0/1/2) siguen el loop `nortex-feature` (rama → QA → PR). La
persistencia offline de iOS merece su propio spike + PR antes de comprometer fecha
de App Store.*
