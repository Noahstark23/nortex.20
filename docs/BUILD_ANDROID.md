# Nortex Android — construir, firmar y publicar (Fase 1)

> Estado: **shell Android listo** (Capacitor 6). El proyecto nativo vive en `android/`.
> Esta guía es para una máquina con **Android SDK** (Android Studio) — el AAB **no**
> se puede compilar en el contenedor del agente (no tiene SDK). appId:
> `com.somosnortex.app` · nombre: **Nortex** · versionCode 1 / versionName 1.0.

## Qué es esta Fase 1

Un contenedor nativo (Capacitor) que **carga la PWA de producción** (`https://somosnortex.com`)
en un WebView a pantalla completa. No se reescribió nada de la app: se empaqueta la que ya
existe. Consecuencia clave para operar:

- **Actualizar el contenido = desplegar el sitio.** Como la app carga la web en vivo, cada
  deploy de Nortex llega al instante a los usuarios **sin pasar por revisión de Play**. Solo
  necesitás subir un AAB nuevo cuando cambia el **shell nativo** (ícono, permisos, un plugin).
- El offline lo da el **service worker + la cola en IndexedDB** de la PWA (una vez cargada).
- Por qué no se bundleó el `dist` adentro: el frontend hace 213 `fetch('/api/...')` relativas;
  bundlear las rompería. Bundle local + OTA + capacidades nativas = fase siguiente (ver §Fase 2).

## Requisitos (una vez)

- **Android Studio** (trae el SDK, build-tools y platform **API 35** — requerido por Play en 2026).
- **JDK 17**.
- Node + `npm install` en el repo.

## Flujo de trabajo

Cada vez que quieras regenerar el contenido empaquetado (fallback) o tras cambiar
`capacitor.config.ts` / los íconos:

```bash
npm run mobile:sync      # npm run build + cap sync android
npm run mobile:assets    # (solo si cambiaste los SVG de assets/) regenera íconos/splash
npm run mobile:open      # abre el proyecto en Android Studio
```

### Probar en un dispositivo/emulador (debug)

```bash
cd android
./gradlew assembleDebug
# APK en android/app/build/outputs/apk/debug/app-debug.apk → instalar con `adb install`
```
Verificar: abre, carga somosnortex.com, se puede iniciar sesión, hacer una venta, y que el
modo avión mantenga la app usable (cola offline).

### Compilar el AAB de release (lo que sube a Play)

1. **Generar el keystore** (UNA vez — guardalo con backup seguro; perderlo = no poder
   actualizar la app nunca más):
   ```bash
   keytool -genkey -v -keystore nortex-release.keystore \
     -alias nortex -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **Configurar la firma** en `android/app/build.gradle` (bloque `signingConfigs` + `release`)
   o, mejor, con un `android/keystore.properties` **fuera de git** (ya cubierto por el
   `.gitignore` de Android para `*.keystore`/`local.properties`; agregá `keystore.properties`).
3. Compilar:
   ```bash
   cd android
   ./gradlew bundleRelease
   # AAB en android/app/build/outputs/bundle/release/app-release.aab
   ```

### Subir a Play Console

1. Crear la app en [Play Console](https://play.google.com/console). Activar **Play App Signing**.
2. Completar: ficha (título, descripción, capturas de teléfono, ícono 512, gráfico destacado),
   **política de privacidad** → `https://somosnortex.com/privacy`, formulario de **Data Safety**,
   **content rating**, público objetivo.
3. Subir el AAB a **Internal Testing** (hasta 100 testers, disponible al instante).

## ⚠️ El requisito de testers de Play (leer antes de crear la cuenta)

Las cuentas de desarrollador **personales creadas después de nov-2023** deben pasar **closed
testing con 20 testers durante 14 días seguidos** antes de poder promover a producción. Las
cuentas de **organización** no tienen ese requisito → **abrir la cuenta como organización** si
es posible. (Costo de la cuenta: **$25** una sola vez.)

## Actualizar la versión (cuando subas un AAB nuevo)

En `android/app/build.gradle`: subir `versionCode` (entero, +1 cada release) y `versionName`
(texto visible). Play rechaza un AAB con `versionCode` repetido o menor.

## Fase 2 (siguiente, no incluida acá)

- Capacidades nativas: escáner de código de barras con la cámara, impresión térmica Bluetooth,
  push nativo (reemplaza el polling de `Layout.tsx`).
- Bundle local + OTA (Capgo): requiere abstraer una base de API configurable en las 213
  llamadas `fetch('/api/...')` para que funcionen desde `capacitor://localhost`.
- iOS / App Store (requiere Mac o CI): `npx cap add ios`. El appId y la web ya quedan listos.

## Notas de configuración (dónde está cada cosa)

| Qué | Dónde |
|---|---|
| appId, nombre, server.url, colores | `capacitor.config.ts` (raíz) |
| Versiones de SDK (compile/target 35, min 22) | `android/variables.gradle` |
| versionCode / versionName / applicationId | `android/app/build.gradle` |
| Nombre visible bajo el ícono | `android/app/src/main/res/values/strings.xml` |
| Íconos y splash (generados) | `android/app/src/main/res/` · fuentes en `assets/*.svg` |
