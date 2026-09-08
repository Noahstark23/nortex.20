# Auditoría visual de Nortex — 2026-09-05

## Estado preciso del candidato

Este documento registra una reparación local; no certifica el sistema que usan
las personas. El candidato vive únicamente en la rama local
`codex/release-gate-20260905`, basada inicialmente en
`d9cdd7cefb1724ab2fab65458f6aadaf531c339a`. No se hizo push, merge, dispatch,
staging ni despliegue.

No hay una sesión QA autenticada disponible para esta ronda. Por ello no existe
evidencia visual amarrada al candidato para Inicio, Inventario, Equipo, POS,
Compras ni las demás rutas privadas. Tras la build final se revisó el preview
local anónimo de `/login` por accesibilidad: título, etiquetas, campos y control
Día/Noche estaban expuestos. No hubo login, envío de formulario, captura ni
comparación visual, por lo que esta evidencia no demuestra acceso, datos ni
flujos de negocio.

## Defectos reparados en el código candidato

| Problema reportado | Reparación candidata | Evidencia local | Límite |
| --- | --- | --- | --- |
| En Día, texto heredado podía quedar claro sobre una superficie clara. | El bridge de Día en `index.css` publica tinta contextual por superficie; `utils/daySurfaceInk.ts` delimita las islas oscuras reales. | Pruebas de contrato de superficie y de los tokens que Tailwind debe conservar. | No hay recorrido autenticado ni captura final por ruta. |
| Iconos o texto secundarios no heredaban la tinta del relleno sólido. | Las reglas de compatibilidad usan clases exactas y tintas semánticas explícitas; no cambian fondos translúcidos. | `frontendColorSemantics` y `lightWorkspaceSurfaceInk` cubren pares contenedor--descendiente. | La prueba no sustituye revisión humana de cada pantalla. |
| Etiquetas secundarias de Clock IN/OUT se volvían difíciles de leer. | `PinPadClock` usa tinta opaca semántica en vez de `opacity-80` sobre el relleno. | Cobertura de semántica de color del candidato. | Falta validarlo con un rol y una sesión de personal QA. |
| El estado de facturación mezclaba gradientes claros con tinta heredada. | `Billing` selecciona una superficie y tinta de estado explícitas, incluido el texto secundario. | Pruebas de superficie Día y de semántica visual. | Falta comprobarlo con una cuenta en cada estado. |
| El badge Kardex de pérdida podía traducirse a un fondo claro con tinta clara. | `Inventory` usa tokens de ticket para `ADJUST_LOSS`, no una combinación naranja heredada. | Contrato de tinta/superficie en el candidato. | Falta recorrido real de inventario con datos QA. |

Estas son reparaciones de contraste y consistencia del tema, no una declaración de
que toda la interfaz tenga el mismo diseño ni de que todos los módulos estén
aprobados. El modo Noche conserva sus tokens propios; el cambio no convierte una
captura de Día en evidencia de Noche.

## Evidencia ejecutada localmente

La reejecución final de Vitest en el candidato terminó con **306 archivos y 4,076
pruebas aprobadas**. También reportó **11 archivos y 69 pruebas omitidas**,
dependientes de QA/MySQL fuera del entorno normal; no se cuentan como aprobadas.
La compuerta aislada ejecutó 12 de esos recorridos HTTP/QA con MySQL 8 temporal:
**12 suites y 83 casos aprobados, sin casos omitidos ni `todo`**.

También terminaron correctamente el generate local de Prisma, TypeScript,
`check:design`, `build` y `build:seo`. Este último prerenderizó 71 rutas y dejó
72 URLs en el sitemap. La build acredita que los artefactos del candidato se
generan; no equivale a QA visual de esas rutas ni a una observación de staging.

Las pruebas visuales relevantes incluyen:

```sh
mise exec -- npm test -- --run \
  tests/frontendColorSemantics.test.ts \
  tests/lightWorkspaceSurfaceInk.test.ts \
  tests/lightWorkspaceFormContrast.test.ts \
  tests/layoutThemeToggle.test.tsx
```

También existen pruebas de rutas y de landing pública. Son regresiones de código:
no equivalen a una inspección visual completa, a una sesión autenticada ni a una
demostración en staging. El resultado automatizado tampoco acredita que el menú,
los iconos y cada campo de cada rol sean legibles en un navegador y dispositivo
reales.

## Qué sigue sin demostrarse

- Inicio, Inventario, Compras, POS, Equipo, Caja, Delivery, LENDER y Superadmin
  con una cuenta QA y datos sintéticos, en Día y Noche.
- Escritura visible en formularios, errores de API, estados vacíos, loading,
  permisos y responsive en las rutas privadas.
- Recorridos UI → API → MySQL de venta, devolución/corrección, compra, fiado,
  cierre y stock, con dos tenants y los roles necesarios. Los controles de
  integración cubren contratos de backend, no la experiencia completa de UI.
- Cámara, impresora, balanza, lector y uso humano prolongado.
- Cualquier observación de staging o producción.

## Criterio antes de pedir producción

1. Mostrar y registrar el mismo escenario local del SHA ya construido en Día y
   Noche; la revisión anónima actual se limitó al login.
2. Crear o recibir acceso a un tenant QA descartable; registrar recorridos y
   resultados por rol, módulo y tamaño de pantalla, sin usar datos de clientes.
3. Integrar el SHA mediante revisión autorizada, demostrar CI y staging del mismo
   SHA y corregir los hallazgos que aparezcan allí.
4. Obtener una autorización de producto separada que indique SHA, alcance,
   ventana, responsable y rollback. Hasta entonces, producción permanece
   bloqueada.
