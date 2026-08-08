import type { CapacitorConfig } from '@capacitor/cli';

/**
 * NORTEX — App móvil (Capacitor). Fase 1: shell Android que envuelve la PWA de
 * producción (https://somosnortex.com).
 *
 * POR QUÉ server.url y no bundle local (todavía): el frontend hace 213 llamadas
 * `fetch('/api/...')` RELATIVAS. Si bundleáramos el dist adentro del APK y lo
 * cargáramos desde capacitor://localhost, esas 213 llamadas apuntarían a
 * capacitor://localhost/api y romperían. Cargar el sitio real hace que resuelvan
 * a https://somosnortex.com/api sin tocar una sola línea, y el service worker +
 * la cola offline en IndexedDB de la PWA siguen funcionando (es un origen seguro
 * real). El bundle local + OTA (que exige abstraer una base de API configurable
 * en las 213 llamadas) queda para una fase siguiente, junto con las capacidades
 * nativas (escáner de barras, impresión Bluetooth, push).
 *
 * appId es INMUTABLE una vez publicado en Play Store — confirmar antes del primer
 * release. appName es el nombre visible bajo el ícono.
 */
const config: CapacitorConfig = {
  appId: 'com.somosnortex.app',
  appName: 'Nortex',
  // webDir es obligatorio aunque usemos server.url: es el fallback que se
  // empaqueta en el APK. Apuntamos al build de Vite.
  webDir: 'dist',
  backgroundColor: '#0c0c0e', // Identidad Obsidian (igual que theme_color del manifest PWA)
  server: {
    // Abrimos directo en /login: la raíz "/" de producción sirve la landing de
    // marketing (Express → landing.html), no la app. Sin este path, la app
    // arrancaba en la web de ventas en vez de la pantalla de acceso. Tras el
    // login el SPA navega a /app/* (mismo origen, permitido). Si ya hay sesión,
    // /login rebota solo a /app.
    url: 'https://somosnortex.com/login',
    androidScheme: 'https',
    cleartext: false, // solo HTTPS; nada de tráfico en claro
    // Navegación acotada SOLO al apex. Antes el wildcard *.somosnortex.com
    // dejaba que un XSS en cualquier subdominio (marketing, CMS, preview) se
    // cargara DENTRO del WebView con el bridge nativo a mano → phishing con la
    // barra de la app y acceso al contexto nativo. La app solo vive en el apex;
    // los links externos (WhatsApp, etc.) los abre el navegador del sistema.
    allowNavigation: ['somosnortex.com'],
  },
  android: {
    // El WebView respeta el color de fondo mientras carga (evita el flash blanco).
    backgroundColor: '#0c0c0e',
  },
};

export default config;
