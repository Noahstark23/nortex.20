# Plan de desarrollo — Nortex App Móvil (Play Store + App Store)

> Estado: **plan aprobable** · Rama `claude/plan-app-movil`
> Insumos: recon técnico de la PWA actual (`vite.config.ts`, `lib/db.ts`, manifest,
> service worker) + requisitos vigentes de Google Play y App Store.
> Objetivo: publicar Nortex como app instalable en Play Store (Android) y App Store
> (iOS) **reusando la web existente**, con las capacidades nativas que un POS necesita.

---

## 1. El problema

Nortex ya es una PWA instalable, pero:
- Los usuarios reales (ferreteros, pulperas, farmacéuticos) **buscan "apps" en la Play
  Store** — una PWA no se descubre ahí y "agregar a pantalla de inicio" casi nadie lo usa.
- Estar en las tiendas da **confianza** (una app con reseñas > un link web) y **capacidades
  nativas** que hoy no tenemos: escáner de código de barras con la cámara, impresión
  térmica por Bluetooth, notificaciones push de pedidos nuevos.

## 2. Decisión técnica: **Capacitor** (no TWA)

| | TWA (Trusted Web Activity) | **Capacitor (elegido)** |
|---|---|---|
| Play Store | ✅ | ✅ |
| **App Store (iOS)** | ❌ **imposible** (es solo Android) | ✅ |
| Un solo código para ambas | — | ✅ reusa el build de Vite tal cual |
| APIs nativas (cámara/barras, Bluetooth, push) | difícil | ✅ plugins |
| Actualización | auto con la web | bundle + OTA (ver abajo) |

**Como el iOS/App Store está en el alcance, TWA queda descartado de entrada** (es un
concepto de Google/Chrome, no existe para iOS). Capacitor envuelve el build web en un
shell nativo Android **y** iOS y da acceso a plugins del dispositivo. No se reescribe la
app: se empaqueta la que ya existe.

### Cómo carga la web dentro del shell — dos modos

- **(A) Bundle local + OTA** (recomendado): los assets del build viven DENTRO del app
  (offline-first, ya tenemos service worker + cola offline en IndexedDB). Para no depender
  del review de la tienda por cada cambio de JS/CSS, se usa **actualización OTA** (Capgo /
  `@capgo/capacitor-updater`): los cambios de front salen al instante; solo los cambios
  nativos (plugins nuevos) requieren nueva versión en la tienda.
- **(B) Cargar la web live** (`server.url = https://somosnortex.com`): updates instantáneos
  pero **requiere red** (pierde el offline del POS) y **Apple suele rechazar** un wrapper
  que es "solo un sitio web" (guideline 4.2). ❌ no recomendado para un POS.

→ **Modo A**: bundle local para offline real + OTA para iterar rápido.

## 3. Qué existe hoy (del recon) y qué falta

**Listo (reusable):**
- PWA con `vite-plugin-pwa` (`registerType: autoUpdate`), manifest (`name`, `theme_color
  #0c0c0e`, `display: standalone`, `start_url: /`), service worker con precache (~2 MB).
- **Offline real de POS**: cola de ventas en IndexedDB (`lib/db.ts`) + `runtimeCaching: []`
  (los datos de negocio nunca salen de un caché HTTP compartido — bien para multi-tenant).
- Dominio de producción `somosnortex.com`, política de privacidad en `/privacy`.

**Gaps concretos a cubrir:**
- **Íconos**: hoy solo hay `icon-192.svg` (SVG) + `apple-touch-icon.png`. Las tiendas y
  Capacitor exigen **PNG multi-tamaño**: 512×512 (Play), adaptive Android (foreground +
  background), 1024×1024 (App Store), y splash screens. Hay que generarlos del logo.
- **iOS necesita macOS** para compilar (Xcode). Sin Mac → CI en la nube (Codemagic / EAS
  Build / Ionic Appflow).
- **Firma (signing)**: keystore Android + certificados Apple. Perder el keystore = **no
  poder volver a actualizar la app nunca** → se guarda con backup seguro (regla Capa 6).
- El SW/PWA dentro del WebView de Capacitor no se comporta 100% igual que en Chrome →
  validar que el offline funciona en el WebView real (QA en dispositivo, no solo build).

## 4. Roadmap por fases (cada fase = su PR)

### Fase 1 — Shell Android en Play Store (testing interno)
- Instalar Capacitor (`@capacitor/core`, `/cli`, `/android`), `npx cap init`.
- **appId** (⚠️ inmutable tras publicar): propuesta `com.somosnortex.app`.
- Generar íconos + splash (PNG multi-size + adaptive) desde el logo con `@capacitor/assets`.
- Config nativa: barra de estado, safe areas (notch), botón atrás de Android, orientación.
- `npm run build` → `npx cap copy` → abrir en Android Studio → **AAB firmado** (Play App Signing).
- Play Console: crear app, ficha mínima (título, descripción, screenshots, ícono, gráfico
  destacado), y subir a **Internal Testing** (hasta 100 testers, disponible al instante).
- QA en dispositivo real: login, una venta, offline (avión), impresión de recibo actual.

### Fase 2 — Capacidades nativas del POS (lo que justifica ser "app")
- **Escáner de código de barras** con la cámara (MLKit / `@capacitor-community/barcode-scanner`)
  integrado al POS y al alta de inventario.
- **Impresión térmica Bluetooth** de recibos (plugin nativo) — hoy depende del navegador.
- **Push notifications** nativas (pedidos web nuevos, alertas de stock/caja) — reemplaza el
  polling de `Layout.tsx` por push real.
- Opcional: biometría/PIN para abrir caja, guardado seguro del token.
- Beneficio doble: estas funciones **blindan contra el rechazo 4.2 de Apple** (deja de ser
  "solo una web").

### Fase 3 — iOS / App Store
- Requiere **Mac o CI en la nube** (Codemagic / EAS).
- `npx cap add ios`, íconos 1024, splash, permisos en `Info.plist` (cámara, Bluetooth, push).
- **Apple Developer Program** ($99/año) + App Store Connect.
- App Review: cuidar guideline **4.2** (mitigado por las funciones nativas de Fase 2).

### Fase 4 — Testers → Producción (lo que la mayoría subestima)
- **Play (⚠️ crítico)**: las cuentas de desarrollador **personales creadas después de
  nov-2023** deben pasar **closed testing con 20 testers durante 14 días seguidos** antes de
  poder publicar a producción. Cuenta de **organización** puede no tener este requisito →
  conviene abrir la cuenta como organización si se puede. Además: formulario de **Data
  Safety**, **content rating**, cumplir el **target API level** del año.
- **iOS**: **TestFlight** (hasta 10.000 testers externos; 100 internos) + review de la beta.
- **OTA (Capgo)** configurado para iterar el front sin pasar por review en cada cambio.

## 5. Costos y requisitos que decide/provee el CEO

| Ítem | Costo | Nota |
|---|---|---|
| Google Play Developer | **$25** (una vez) | Abrir como **organización** si se puede (evita el requisito de 20 testers). |
| Apple Developer Program | **$99 / año** | Obligatorio para App Store y TestFlight. |
| Mac o CI para iOS | Mac propia, o CI (~$ mensual) | Sin macOS no se compila iOS. |
| Keystore / certificados de firma | — | **Guardar con backup seguro**: perderlos = no poder actualizar. |
| Assets de marca | — | Logo en alta, screenshots por tamaño, gráfico destacado, textos de ficha. |
| Cuenta Google/Apple del negocio | — | Definir con qué correo/organización se publican (no una cuenta personal descartable). |

## 6. Decisiones abiertas (para arrancar Fase 1)

1. **¿Ambas tiendas o Android primero?** Recomiendo **Android primero** (Fases 1–2) y iOS
   después (Fase 3), porque Android es más barato/rápido y no necesita Mac. Capacitor deja
   iOS listo para cuando quieras, sin retrabajo.
2. **appId definitivo** (inmutable): propuesta `com.somosnortex.app`.
3. **Nombre en la tienda**: "Nortex" o "Nortex — Punto de venta". (Google indexa el título.)
4. **Cuenta de publicación**: ¿organización o personal? (impacta el requisito de 20 testers).

## 7. Fuera de alcance (explícito)
- Reescribir la app en React Native / Flutter (no hace falta: se empaqueta la web).
- Pagos in-app / suscripciones vía la tienda (Google/Apple cobran 15–30%; el cobro sigue
  por Stripe fuera de la app, respetando las reglas de cada tienda).
- Publicar antes de tener el keystore respaldado y la política de privacidad enlazada.
