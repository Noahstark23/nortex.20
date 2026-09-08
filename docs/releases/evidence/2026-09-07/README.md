# Evidencia visual local del candidato — 2026-09-07

Esta galería conserva el recorrido visual realizado sobre el contenido del
candidato `6fa1e385ae54c9086df8188957d2d15dba9208dc` antes de integrar el commit de
evidencia. La aplicación corrió en `127.0.0.1:4180`, con MySQL 8 descartable, el
tenant sintético `Ferretería Nortex QA Preproducción` y 14 productos de ejemplo.

No se conectaron cuentas, bases, correo, pagos, mensajería ni telemetría reales.
Se agregó un producto sintético al carrito para observar el ticket, pero no se
abrió caja ni se confirmó una venta, compra, cierre, devolución o ajuste.

## Acceso

### Login nocturno

![Login de Nortex en modo noche](./login-noche-escritorio.jpg)

### Login diurno con texto escrito

El correo es ficticio y la contraseña permanece enmascarada. Esta captura prueba
la tinta, el borde y el foco de los campos; no prueba autenticación remota.

![Login de Nortex en modo día con campos escritos](./login-dia-campos-escritorio.jpg)

## ERP autenticado

### Inicio — Día

![Inicio autenticado en modo día](./inicio-dia-escritorio.jpg)

### Inicio — Noche

![Inicio autenticado en modo noche](./inicio-noche-escritorio.jpg)

### Inventario — Día

![Inventario en modo día](./inventario-dia-escritorio.jpg)

### Inventario — Noche

![Inventario en modo noche](./inventario-noche-escritorio.jpg)

### Punto de venta — Día

El POS conserva un plano operativo oscuro en ambos modos; la preferencia cambia
el shell y el menú. El carrito mostrado es local y sintético.

![POS en modo día con carrito sintético](./pos-dia-escritorio.jpg)

### Punto de venta — Noche

![POS en modo noche sin transacción](./pos-noche-escritorio.jpg)

### Compras — Día

![Formulario inicial de compras en modo día](./compras-dia-escritorio.jpg)

### Caja y arqueos — Noche

![Caja y arqueos en modo noche](./caja-noche-escritorio.jpg)

### Equipo — Día y Noche

![Equipo en modo día](./equipo-dia-escritorio.jpg)

![Equipo en modo noche](./equipo-noche-escritorio.jpg)

## Navegación móvil — 390 × 720

### Inicio

![Inicio autenticado en viewport móvil](./inicio-dia-movil.jpg)

### Menú completo — Día

![Menú móvil completo en modo día](./menu-dia-movil.jpg)

### Menú completo — Noche

![Menú móvil completo en modo noche](./menu-noche-movil.jpg)

## Superficie pública

### Landing — Día

![Landing pública completa en modo día](./landing-dia-escritorio.jpg)

### Landing — Noche

![Landing pública completa en modo noche](./landing-noche-escritorio.jpg)

## Qué acredita y qué no

Las imágenes acreditan el render observado en esa sesión local: legibilidad de
shell, menús, iconos, formularios, estados vacíos, catálogo y temas en los
viewports indicados. Los registros finales del navegador no mostraron warnings ni
errores en las pestañas auditadas.

No acreditan staging, producción, periféricos físicos, todos los navegadores,
todos los roles, todas las rutas, accesibilidad completa ni una transacción por
UI. La integridad de dinero e inventario se valida aparte en la compuerta MySQL;
la promoción exige además CI del SHA integrado, staging del mismo SHA, health
remoto y smoke autenticado.
