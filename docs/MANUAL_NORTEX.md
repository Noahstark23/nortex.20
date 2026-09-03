# Manual de Nortex

**Manual del empleado — qué es Nortex y cómo funciona, en un solo documento.**

Este manual está escrito para que cualquier persona del negocio —desde el cajero
hasta el dueño o el contador— entienda qué es Nortex y aprenda a usar cada parte.
No necesitas saber de computación: si sabes usar WhatsApp, puedes usar Nortex.

> Nicaragua: los montos se manejan en córdobas (C$) y dólares (US$). Los impuestos
> y cálculos siguen las leyes nicaragüenses (DGI, INSS, Código del Trabajo).

---

## Índice

1. [¿Qué es Nortex?](#1-qué-es-nortex)
2. [Conceptos básicos](#2-conceptos-básicos)
3. [Primeros pasos](#3-primeros-pasos)
4. [Guías rápidas por rol](#4-guías-rápidas-por-rol)
5. [Referencia por módulo](#5-referencia-por-módulo)
   - [Ventas](#51-ventas)
   - [Compras](#52-compras)
   - [Inventario (Bodega)](#53-inventario-bodega)
   - [Finanzas y Fiscal](#54-finanzas-y-fiscal)
   - [Recursos Humanos (RRHH)](#55-recursos-humanos-rrhh)
   - [Cobranza](#56-cobranza)
   - [Prestamista](#57-prestamista)
   - [Administración](#58-administración)
6. [Roles y permisos](#6-roles-y-permisos)
7. [Glosario](#7-glosario)
8. [Preguntas frecuentes](#8-preguntas-frecuentes)

---

## 1. ¿Qué es Nortex?

**Nortex es el sistema que administra todo tu negocio desde un solo lugar.** Vende,
controla el inventario, lleva la contabilidad, paga la planilla, cobra lo que te deben
y —si prestás dinero— administra tu cartera de préstamos. Todo conectado: cuando hacés
una venta, el inventario baja, la contabilidad se actualiza y los reportes se arman
solos. El dueño no tiene que “cuadrar” a mano.

**¿Para quién es?** Para la pequeña y mediana empresa nicaragüense. Nortex se adapta al
tipo de negocio:

| Tipo de negocio | Para qué sirve |
|---|---|
| **Ferretería** | Venta de materiales, control de stock por lote, crédito a clientes. |
| **Pulpería / Abarrotes** | Venta rápida, control de vencimientos, fiado. |
| **Retail** (tienda general) | Punto de venta, inventario, reportes. |
| **Prestamista** | Préstamos (gota a gota o financiera), cobradores y cartera. |

El tipo se elige al registrar el negocio y cambia lo que ves: un prestamista ve la
cartera de préstamos en vez del punto de venta, por ejemplo.

**Lo que Nortex hace por vos, en una frase por área:**
- **Ventas (POS):** cobra rápido, imprime el ticket y controla la caja.
- **Inventario:** sabe cuánto tenés, qué se está agotando y qué se está venciendo.
- **Compras:** registra lo que le comprás a tus proveedores y lo que les debés.
- **Contabilidad:** arma los asientos y los estados financieros automáticamente.
- **RRHH:** calcula la planilla con INSS, IR y prestaciones según la ley.
- **Cobranza:** te dice a quién cobrar hoy y lleva el estado de cuenta de cada cliente.
- **Prestamista:** administra préstamos, cuotas, mora y cobradores.

---

## 2. Conceptos básicos

Antes de empezar, cuatro ideas que se repiten en todo el sistema:

- **Tu cuenta = tu negocio.** Cada negocio (lo llamamos *tenant*) tiene sus datos
  totalmente separados de los demás. Lo que ves es solo de tu negocio.
- **Roles.** Cada persona del equipo entra con su usuario y tiene un **rol** (Dueño,
  Cajero, Contador, etc.) que define qué puede ver y hacer. Ver
  [Roles y permisos](#6-roles-y-permisos).
- **Suscripción y prueba.** Al registrarte tenés **14 días de prueba gratis**. Después
  se activa la suscripción mensual (tarjeta o transferencia) desde **Facturación**.
- **Funciona con y sin internet (PWA).** El punto de venta sigue trabajando aunque se
  caiga el internet: guarda las ventas en el dispositivo y las **sincroniza** cuando
  vuelve la señal. No se pierde ninguna venta.
- **Integración con WhatsApp.** Nortex envía tickets y recordatorios por WhatsApp e incluye
  un **asistente por WhatsApp** para atender pedidos y consultas. Requiere conectar la API de
  WhatsApp Business; lo configura el dueño/administrador.

**Contexto Nicaragua que el sistema ya conoce:**
- **IVA 15%** sobre las ventas gravadas.
- **INSS laboral 7%** (se le retiene al trabajador), **INSS patronal 21.5%** (negocios
  con menos de 50 empleados) o **22.5%** (50 o más), e **INATEC 2%** — estos tres los paga
  el empleador (Ley 539).
- **IR laboral** según la tabla progresiva de la DGI.
- **NIIF PyMES** para la contabilidad; **partida doble** (todo asiento cuadra: Debe = Haber).

---

## 3. Primeros pasos

### 3.1 Registrar el negocio
1. Entrá a la página de registro y elegí **Crear cuenta**.
2. Llená: nombre del negocio, **tipo** (Ferretería, Pulpería, Retail o Prestamista),
   tu correo y una contraseña.
3. Listo: queda creado tu negocio con **14 días de prueba** y tu usuario como **Dueño
   (OWNER)**. El sistema te da un **PIN inicial (1234)** para marcar entrada/salida.

### 3.2 Iniciar sesión
- Entrá con tu **correo y contraseña**. Si sos un cobrador o repartidor, entrás con
  **teléfono + PIN** desde la app móvil.
- ¿Olvidaste la contraseña? Usá **“¿Olvidó su contraseña?”**: te llega un enlace al
  correo para crear una nueva.

### 3.3 Invitar a tu equipo
1. Andá a **Mi Equipo** (menú Administración).
2. **Invitar**: poné el correo de la persona y elegí su **rol**.
3. Le llega una invitación por correo (válida 48 horas). Al aceptarla, crea su usuario.

### 3.4 Marcar entrada y salida (reloj con PIN)
- Cada empleado marca su entrada/salida con su **PIN de 4 dígitos** (botón del reloj en
  la barra lateral, o desde **Mi Espacio**). Esto registra las horas trabajadas para la
  planilla.

### 3.5 Cómo está organizado el menú
El menú lateral agrupa todo por áreas. Según tu rol verás más o menos opciones:
- **Ventas:** Punto de Venta, Cajas y Arqueos, Inventario, Toma Física, Entregas,
  Cotizaciones, Clientes (CRM).
- **Compras:** Compras, Proveedores, Compras Inteligentes, Mercado B2B.
- **Finanzas:** Finanzas (panel), Cobranza, Facturación, Contabilidad, Reportes,
  Salud Financiera, Auditoría.
- **Personal:** Mi Espacio.
- **Administración:** Recursos Humanos, Mi Equipo, Panel Admin.

> En modo **Prestamista** el menú cambia a: Dashboard Financiero, Cartera de Clientes,
> Reportes de Cobro y Cobradores.

### 3.6 Tu primer día (paso a paso)

Al registrarte, Nortex te recibe con una **bienvenida** y una guía de **«Primeros
pasos»**: un checklist (botón flotante abajo a la derecha) que **se completa solo** a
medida que usás el sistema. No tenés que marcar nada a mano: cuando hacés tu primera
venta, ese paso queda listo. Siempre podés volver a abrirlo desde **Ayuda y Tutoriales**
(barra lateral), donde además hay **tutoriales guiados** del POS y del Inventario.

**Si vendés (ferretería, pulpería, retail):**
1. **Configurá tus datos fiscales (DGI)** desde «Configuración DGI» en el panel (RUC,
   dirección) — así tus tickets salen válidos.
2. **Agregá tu primer producto** en Inventario (nombre, precio, stock). Tip: podés
   importar muchos desde Excel.
3. **Hacé tu primera venta** en el POS: buscá el producto, agregalo, cobrá con Efectivo,
   imprimí el ticket. 🎉 Ese es el momento clave.
4. **Registrá un cliente** si vas a vender al crédito (asignale su límite).
5. **Invitá a tu equipo** desde Mi Equipo (cada quien marca entrada con su PIN).
6. Volvé al panel: ya verás tus **ventas de hoy** y el **flujo de caja** con datos reales.

**Si prestás dinero (Prestamista):**
1. **Configurá los datos de tu negocio.**
2. **Registrá tu primer cliente** (o se crea solo al originar el préstamo).
3. **Creá tu primer préstamo**: capital, tasa, número de cuotas y frecuencia. Se genera
   el plan de cuotas. 🎉
4. **Agregá un cobrador** y asignale préstamos; entra por el celular a su ruta.

> Consejo: dejá que el checklist te guíe. En 15–20 minutos tu negocio queda operando.

---

## 4. Guías rápidas por rol

Lo mínimo que cada quien necesita para su día a día. La referencia completa está en la
[sección 5](#5-referencia-por-módulo).

### 4.1 Cajero / Empleado
1. **Marcá tu entrada** con tu PIN.
2. Abrí **Punto de Venta**. Si tu negocio usa cajas, **abrí la caja** con el efectivo inicial.
3. **Vendé:** buscá el producto (o escaneá el código de barras), agregalo al carrito, repetí.
4. **Cobrá:** elegí el método (**Efectivo** o **Crédito/fiado**) y confirmá.
5. **Entregá el ticket** (impreso o por WhatsApp).
6. Al final del turno, **cerrá la caja** (arqueo): contás el efectivo y el sistema te dice
   si cuadra.

### 4.2 Dueño / Gerente
- **Finanzas (panel):** mirá las ventas, gastos y ganancia del día, y las alertas (stock
  bajo, vencimientos, posibles robos).
- **Inventario / Compras:** registrá lo que comprás, controlá el stock, reponé con
  **Compras Inteligentes**.
- **Reportes:** ventas, inventario, impuestos.
- **Mi Equipo:** invitá personal y asigná roles.
- **Cobranza:** revisá a quién cobrar y registrá abonos.

### 4.3 Contador
- **Contabilidad:** revisá el plan de cuentas y los asientos automáticos; registrá
  **asientos manuales** cuando haga falta.
- **Cierre de período:** al cerrar el mes, **bloqueás el período** para que nadie cambie
  cifras ya declaradas a la DGI.
- **Nómina:** el Contador también puede **calcular y pagar la planilla** (y el aguinaldo).
- **Reportes / Fiscal:** sacá los reportes de IVA, IR, **retenciones** (IR/IMI/IVA retenido) y
  los estados financieros.
- **Auditoría:** revisá el registro de quién hizo qué.

### 4.4 Cobrador (Prestamista)
1. **Entrá con teléfono + PIN** en el celular.
2. Mirá tu **ruta del día**: a quién visitar (cuotas de hoy y vencidas).
3. **Registrá el abono** de cada cliente y entregá el **recibo**.
4. Al final, **entregá el efectivo a la bóveda** (depósito) en el negocio.

---

## 5. Referencia por módulo

Cada módulo sigue el mismo formato: **¿Qué es? · Quién lo usa · Cómo se usa · Notas
Nicaragua · Errores comunes.**

### 5.1 Ventas

#### Punto de Venta (POS)
- **¿Qué es?** La caja registradora digital: donde se hacen las ventas.
- **Quién lo usa:** Cajero, Empleado, Gerente, Dueño.
- **Cómo se usa:**
  1. Buscá el producto por nombre o **escaneá el código de barras**.
  2. Ajustá la cantidad y agregá los productos al **carrito**.
  3. (Opcional) Aplicá un **descuento** o elegí el **cliente** (para fiado).
  4. Elegí el **método de pago**: **Efectivo** o **Crédito (fiado)**. Se admite también el
     pago en **dólares** (con su tasa de cambio).
  5. Confirmá. Se imprime el **ticket** y se puede enviar por **WhatsApp**.
  - **Devoluciones, entradas/salidas de efectivo** y **carritos en espera** también se manejan
    desde el POS durante el turno.
- **Notas Nicaragua:** el **IVA 15%** se calcula automáticamente. La venta al **crédito**
  exige un **cliente con límite de crédito** disponible y genera una cuenta por cobrar.
- **Errores comunes:** “Sin caja abierta” → primero abrí la caja en *Cajas y Arqueos*.
  “Cliente bloqueado / sin cupo” → revisá su límite de crédito en *Clientes*.

#### Cajas y Arqueos
- **¿Qué es?** El control del efectivo de cada turno.
- **Quién lo usa:** el **Cajero abre/cierra su turno desde el propio Punto de Venta**; la
  pantalla **Cajas y Arqueos** (monitor de turnos en vivo, historial y forzar cierre) es para
  **Gerente, Dueño y Admin**.
- **Cómo se usa:** **Abrí la caja** con el efectivo inicial → durante el turno se registran
  ventas, **entradas y salidas** de efectivo → al final **cerrás la caja** declarando el
  efectivo contado. El sistema muestra si **sobra o falta** (descuadre).
- **Errores comunes:** descuadres grandes generan una **alerta** (posible robo o error de
  cobro).

#### Inventario, Toma Física y Compras Inteligentes
Ver [Inventario (Bodega)](#53-inventario-bodega).

#### Entregas / Pedidos web
- **¿Qué es?** La bandeja de **pedidos en línea** (del catálogo público) y la gestión de
  **entregas a domicilio** con motorizados.
- **Quién lo usa:** Gerente/Dueño (despacha), Motorizado (entrega).
- **Cómo se usa:** los pedidos del catálogo público llegan a **Entregas** (con aviso
  sonoro). Se **asigna un motorizado** y el cliente puede **rastrear** su pedido por un
  enlace público.

#### Cotizaciones
- **¿Qué es?** Proformas/presupuestos para clientes.
- **Cómo se usa:** armás la cotización con sus productos y precios; se puede **convertir en
  venta** cuando el cliente acepta.

#### Clientes (CRM)
- **¿Qué es?** El directorio de clientes con su **límite de crédito**, deuda actual e
  historial.
- **Cómo se usa:** registrá al cliente, asignale un **límite de crédito** y, si hace falta,
  **bloquealo** para que no se le venda fiado. Desde aquí también se ve su historial.

#### Catálogo público
- **¿Qué es?** Una tienda en línea con tus productos publicados, en una dirección propia
  (ej. `/pedidos/tu-negocio`). Los clientes navegan y hacen pedidos que entran a *Entregas*.

### 5.2 Compras

#### Compras
- **¿Qué es?** El registro de lo que le comprás a tus proveedores (entra al inventario).
- **Cómo se usa:**
  1. Elegí el **proveedor** y el **número de factura**.
  2. Agregá los productos con su **cantidad y costo** (y **lote/vencimiento** si aplica).
  3. Elegí **Contado** o **Crédito**:
     - *Contado:* se descuenta de tu billetera (rechaza si no hay saldo).
     - *Crédito:* queda como **cuenta por pagar** al proveedor.
  4. Confirmá: el **stock sube**, el **costo promedio** se recalcula y queda el asiento contable.

#### Proveedores
- **¿Qué es?** El directorio de proveedores (con RUC, contacto, categoría).
- **Cómo se usa:** crear, **editar** y **eliminar** proveedores (no se puede borrar si ya
  tiene compras registradas). Cada producto puede tener un **proveedor por defecto**.

#### Compras Inteligentes
- **¿Qué es?** El asistente de reposición: **¿qué reponer?**.
- **Quién lo usa:** Dueño/Admin.
- **Cómo se usa:** combina el **punto de reorden** con la **velocidad de venta** y lista lo
  que conviene comprar, con cantidad sugerida. Seleccionás, ajustás cantidades y
  **genera una orden de compra por proveedor** que, al confirmar, crea la compra.

#### Mercado B2B
- **¿Qué es?** Un mercado mayorista para comprarles a otros distribuidores dentro de Nortex.

### 5.3 Inventario (Bodega)

- **¿Qué es?** El control de existencias: qué hay, cuánto, a qué costo, y su movimiento.
- **Quién lo usa:** Bodega/Gerente/Dueño (editan); el resto consulta.
- **Cómo se usa (lo principal):**
  - **Productos:** alta/edición con nombre, **SKU/código**, precio, unidad, stock mínimo,
    **punto de reorden** y **stock objetivo**, y proveedor por defecto.
  - **Lista grande sin lag:** la pantalla pagina, filtra (categoría, agotados, publicados)
    y ordena; se **exporta a Excel** lo filtrado.
  - **Edición masiva:** cambiar **precio o categoría** de muchos productos a la vez (fijar o
    ajustar por %). No toca el costo (lo calcula el sistema).
  - **Lotes y vencimientos:** agregar lotes (suma stock + Kardex), ver próximos a vencer y
    **dar de baja** lo vencido (merma). Los lotes vencidos **no se venden** automáticamente.
  - **Kardex:** el historial inmutable de cada movimiento (entradas, salidas, ajustes),
    paginado y con filtro por fecha.
  - **Ajustes:** corregir stock con **justificación obligatoria** (queda en Kardex y auditoría).
  - **Etiquetas:** imprimir etiquetas de precio/código de los productos seleccionados.
  - **Importación masiva:** cargar productos desde Excel/CSV.

#### Toma Física (conteo cíclico)
- **¿Qué es?** Contar el inventario real y **cuadrarlo** contra el sistema.
- **Quién lo usa:** Dueño/Admin.
- **Cómo se usa:**
  1. **Creá una toma** (todo el inventario o una categoría): el sistema toma una “foto”
     del stock esperado.
  2. **Contá** físicamente (podés **escanear** para sumar 1 por producto). Vas viendo las
     diferencias y la **merma/sobrante estimado**.
  3. **Cerrá:** el sistema ajusta el stock al conteo, deja el **Kardex** y registra el
     **asiento contable** de la merma o sobrante (valuado al costo).
- **Notas Nicaragua:** la merma se reconoce como **Pérdida por Merma** y el sobrante como
  ingreso, cuadrando Debe = Haber. Si el **período está cerrado**, no deja cerrar la toma.
- **Errores comunes:** “ya hay una toma abierta” → cerrá o cancelá la anterior. Los
  productos **no contados no se tocan** (no se asumen en cero).

### 5.4 Finanzas y Fiscal

#### Finanzas (panel / Dashboard)
- **¿Qué es?** El resumen del negocio: **ventas, gastos y ganancia del día**, score de
  crédito, y **alertas** (stock bajo, lotes por vencer, posibles robos, estado de la prueba).

#### Contabilidad
- **¿Qué es?** El motor contable de **partida doble** (NIIF PyMES). Cada venta, compra,
  gasto, nómina o ajuste genera su **asiento automático**; el contador no captura a mano lo
  rutinario.
- **Quién lo usa:** Contador, Dueño/Admin.
- **Cómo se usa:**
  - **Plan de cuentas:** catálogo estándar (Caja, Inventario, CxC, CxP, IVA, etc.).
  - **Asiento manual:** registrar movimientos que no salen de una operación (ajustes,
    aperturas).
  - **Cierre de período:** **bloquear** un mes ya declarado para que ningún asiento lo
    modifique (protege lo declarado a la DGI). Un período cerrado rechaza cualquier asiento
    con esa fecha. Lo puede **cerrar** el Dueño, Admin o Contador; **reabrirlo solo el Dueño**.
  - **Estados financieros:** Balance General y Estado de Resultados se arman solos.
- **Notas Nicaragua:** cuentas y cálculos siguen NIIF PyMES y la DGI; el **IVA** y las
  **retenciones** se contabilizan automáticamente.

#### Reportes / Fiscal
- **¿Qué es?** Reportes de **ventas, inventario e impuestos**: IVA, IR y **retenciones**
  (IR 2% sobre compras, IMI municipal, IVA retenido), exportables.
- **Cómo se usa:** elegí el rango de fechas y descargá; sirve para la declaración a la DGI.

#### Salud Financiera
- **¿Qué es?** Indicadores de liquidez y flujo de caja para ver cómo va el negocio.

#### Auditoría
- **¿Qué es?** El registro de **quién hizo qué** (cambios sensibles, ajustes, mermas) y las
  **alertas** de anomalías. Para Dueño/Admin/Contador.

#### Facturación (suscripción)
- **¿Qué es?** El pago de la **suscripción a Nortex**.
- **Cómo se usa:** ver el estado (Prueba / Activa / Vencida), pagar con **tarjeta (Stripe)**
  o **reportar una transferencia** (banco, referencia y comprobante) para que se apruebe.

### 5.5 Recursos Humanos (RRHH)

- **¿Qué es?** La administración del personal y la **planilla** según la ley nicaragüense.
- **Quién lo usa:** Dueño/Admin (y Contador para lo fiscal).
- **Cómo se usa:**
  - **Empleados:** alta con cédula, **INSS**, salario, comisión, **jornada** (Diurna 8h,
    Nocturna 7h, Mixta 7.5h — Ley 185), cuenta bancaria, **contrato** (indeterminado,
    determinado o por obra) y expediente, con avisos de fin de período de prueba/contrato.
  - **Nómina:** el sistema calcula el neto descontando **INSS laboral (7%)** e **IR laboral**,
    suma **horas extra** y **recargo por feriado trabajado** cuando aplica, y reconoce el costo
    patronal: **INSS patronal (21.5%/22.5%)** e **INATEC (2%)**. También aplica **deducciones
    judiciales** (pensión alimenticia, embargos — Art. 88). Al pagar, deja el asiento contable.
  - **Provisión mensual de prestaciones:** cada mes acumula el costo de aguinaldo, vacaciones e
    indemnización (no espera a fin de año), para que el resultado no quede subestimado.
  - **Aguinaldo (treceavo):** se calcula por el **método de 360 días**.
  - **Vacaciones** y **liquidación**: la indemnización sigue el **Art. 45** (30 días por año
    los primeros 3 años, 20 desde el 4º, con piso de 1 mes y techo de 5 meses).
  - **Permisos y adelantos:** solicitudes que el sistema valida (saldo de vacaciones,
    solapamientos) y descuenta en planilla. *(Las vacaciones y otros permisos los registra RRHH.)*
- **Mi Espacio:** el portal del empleado para **marcar entrada/salida**, ver sus horas, solicitar
  **permiso sin goce** y **adelantos**, y ver su colilla de pago.

### 5.6 Cobranza

- **¿Qué es?** El cobro de lo que te deben por **ventas a crédito (fiado)**.
- **Quién lo usa:** Dueño/Admin/Gerente.
- **Cómo se usa:**
  - **Panel + “Cobrar hoy”:** lista las deudas por **urgencia** (vencidas primero) con KPIs
    (por cobrar, vencido, por vencer, recaudado hoy). Filtro **“cobrar hoy”** = vencidos +
    por vencer.
  - **Recordatorio 1-toque:** botón de **WhatsApp** para recordarle al cliente.
  - **Estado de cuenta:** por cliente, factura por factura con sus abonos y el saldo; se
    **imprime**.
  - **Abono:** registrar un pago parcial o total; ofrece **imprimir el recibo**.
  - **Incobrables:** si una deuda ya no se va a cobrar, el Dueño/Admin la **castiga**: se
    reconoce la pérdida con su asiento (**Cuentas Incobrables** contra Cuentas por Cobrar) y
    baja la deuda del cliente. Exige justificación y respeta el cierre de período.

### 5.7 Prestamista

> Solo para negocios tipo **Prestamista (LENDER)**. El menú cambia a cartera de préstamos.

- **¿Qué es?** La administración de **préstamos** (gota a gota o financiera) y su cobranza.
- **Quién lo usa:** Dueño/Admin (cartera) y **Cobrador** (calle).
- **Cómo se usa:**
  - **Originar préstamo:** capital, **tasa de interés**, número de cuotas y **frecuencia**
    (diaria, semanal, quincenal, mensual). Tipos: **gota a gota (interés fijo)** o
    **financiera (amortizado, sistema francés)**. Al crearlo se genera el **plan de cuotas**.
  - **Plan de cuotas y mora:** cada cuota tiene su vencimiento; los abonos se **imputan a las
    cuotas** (más antiguas primero) y la cartera muestra la **mora** (días y monto) o la
    próxima cuota.
  - **Cobradores:** se crean usuarios **Cobrador**, se les **asignan** préstamos y entran por
    el celular a su ruta.
  - **Gastos de ruta:** registrar gasolina, etc.
  - **Bóveda (depósito):** el cobrador **entrega el efectivo** recaudado y queda registrado.
  - **Penalidad / Refinanciamiento:** aplicar mora manual o **refinanciar** (el saldo viejo
    pasa a un préstamo nuevo con capital fresco).

### 5.8 Administración

#### Mi Equipo
- Gestión de usuarios: **invitar**, asignar **rol**, **desactivar/reactivar**. Las
  invitaciones vencen a las 48 horas.

#### Panel Admin
- Vista técnica/administrativa del sistema (referencia interna). Para Dueño/Admin.

---

## 6. Roles y permisos

Cada usuario tiene un rol que define qué ve y qué puede hacer:

| Rol | Qué hace |
|---|---|
| **OWNER (Dueño)** | Acceso total a todo el negocio. |
| **ADMIN** | Igual que el Dueño (mano derecha). |
| **MANAGER (Gerente)** | Operación: POS, inventario, clientes, proveedores, compras, cotizaciones, reportes. No ve contabilidad ni auditoría. |
| **CASHIER (Cajero)** | Punto de venta; consulta inventario y clientes. |
| **ACCOUNTANT (Contador)** | Fiscal y planilla: Contabilidad, **Nómina/Planilla**, Reportes, Compras, Auditoría. |
| **VIEWER (Consulta)** | Solo lectura (paneles y reportes). |
| **EMPLOYEE (Empleado)** | Acceso mínimo: POS y consulta de inventario. |
| **COLLECTOR (Cobrador)** | Solo la vista móvil del cobrador (modo Prestamista). |
| **SUPER_ADMIN** | Administración global de la plataforma (interno de Nortex). |

> Esta tabla describe lo que cada rol **puede hacer** (el sistema bloquea las acciones no
> permitidas en el servidor). En el menú lateral algunos roles pueden **ver** más opciones de
> las que pueden usar: las acciones sensibles (editar inventario, contabilidad, nómina, etc.)
> quedan igualmente protegidas aunque aparezcan en el menú.

---

## 7. Glosario

- **DGI:** Dirección General de Ingresos (autoridad fiscal de Nicaragua).
- **IVA:** Impuesto al Valor Agregado, 15% en Nicaragua.
- **IR:** Impuesto sobre la Renta (laboral = el que se le retiene al trabajador).
- **INSS:** seguro social. **Laboral 7%** (al trabajador); **patronal 21.5%** (menos de 50
  empleados) o **22.5%** (50 o más), al empleador.
- **INATEC:** aporte de capacitación, 2% (lo paga el empleador).
- **NIIF PyMES:** normas de contabilidad para pequeñas y medianas empresas.
- **Aguinaldo (treceavo):** mes 13 de salario; se calcula por método de 360 días.
- **Asiento:** registro contable de partida doble (Debe = Haber).
- **Partida doble:** todo movimiento se registra en dos cuentas que se equilibran.
- **Kardex:** historial de movimientos de un producto (entradas/salidas/ajustes).
- **Arqueo:** conteo del efectivo de la caja para ver si cuadra.
- **Toma física:** conteo del inventario real para cuadrarlo con el sistema.
- **Merma:** pérdida de inventario (vencido, dañado, faltante).
- **CxC / CxP:** Cuentas por Cobrar (te deben) / por Pagar (debés).
- **Aging:** antigüedad de las deudas (30/60/90 días).
- **Fiado / Crédito:** venta que el cliente paga después.
- **Gota a gota:** préstamo informal de interés fijo, con cobro frecuente.
- **Motorizado / Cobrador:** persona que reparte o cobra en la calle.
- **PWA:** la app funciona en el navegador y **sin internet** (modo offline).
- **Tenant:** tu negocio dentro de Nortex (datos separados de los demás).

---

## 8. Preguntas frecuentes

- **No puedo vender: “Sin caja abierta”.** Abrí la caja en *Cajas y Arqueos* con el
  efectivo inicial.
- **No me deja vender fiado a un cliente.** Revisá que el cliente tenga **límite de crédito**
  disponible y que no esté **bloqueado** (en *Clientes*).
- **Se cayó el internet.** Seguí vendiendo: el POS guarda las ventas y las **sincroniza**
  cuando vuelve la señal.
- **“Período cerrado”.** Se cerró ese mes. Para registrar algo con esa fecha, el **Dueño**
  debe **reabrir el período** en *Contabilidad* (solo el Dueño puede reabrir).
- **Una compra de contado no se registra: “saldo insuficiente”.** No hay saldo en la
  billetera; usá **crédito** o recargá.
- **Olvidé mi PIN o contraseña.** La contraseña se recupera por correo (“¿Olvidó su
  contraseña?”). El PIN lo restablece el Dueño/Admin en *Recursos Humanos*.
- **Un lote vencido no se vende.** Es a propósito: dalo de baja como merma en *Inventario*.

---

*Manual de Nortex — documento vivo. Si una función no aparece o cambió, este manual se
actualiza junto con el sistema.*
