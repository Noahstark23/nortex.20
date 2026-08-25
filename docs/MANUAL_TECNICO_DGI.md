# Manual Técnico y de Usuario — Sistema de Facturación Computarizada "Nortex"

**Documento para el expediente de registro ante la Dirección General de Ingresos (DGI)
de Nicaragua**, conforme a la **Disposición Técnica No. 09-2007**, a presentarse por la
Ventanilla Electrónica Tributaria (VET).

---

> ## ⛔ NO PRESENTAR TODAVÍA
>
> Este manual describe el sistema **tal como está hoy**, y hay dos requisitos de la
> DT 09-2007 que **aún no se cumplen**. Presentarlo antes de cerrarlos sería declarar
> ante la DGI algo que no es cierto:
>
> | | Requisito | Estado |
> |---|---|---|
> | **DGI-4** | Respaldo de la información | Resuelto en código (servicio `backup` del compose, con verificación y prueba de restauración). **Falta cargar las credenciales del bucket en producción y confirmar el primer respaldo** |
> | **DGI-5** | Anulación de comprobantes | **No existe** en el sistema |
>
> Detalle y evidencia en [`AUDITORIA_DGI.md`](./AUDITORIA_DGI.md). Una vez cerrados,
> actualizar las secciones **7** y **5.4** de este manual y recién ahí presentar.
>
> Los campos marcados `[[ASÍ]]` son datos legales del proveedor que deben completarse
> a mano antes de presentar. **No los inventé.**

---

## 1 · Identificación

### 1.1 Del proveedor del sistema

| Campo | Valor |
|---|---|
| Razón social | `[[RAZÓN SOCIAL DEL PROVEEDOR]]` |
| RUC | `[[RUC DEL PROVEEDOR]]` |
| Domicilio fiscal | `[[DIRECCIÓN FISCAL]]` |
| Representante legal | `[[NOMBRE Y CÉDULA]]` |
| Contacto técnico | `[[NOMBRE, TELÉFONO, CORREO]]` |

### 1.2 Del sistema

| Campo | Valor |
|---|---|
| Nombre comercial | Nortex |
| Tipo | Sistema de Facturación Computarizada (SFC) integrado a ERP/POS |
| Modalidad | Servicio en la nube (SaaS), multiempresa |
| Idioma | Español (Nicaragua) |
| Moneda base | Córdoba nicaragüense (C$), con registro auxiliar en dólares |

### 1.3 Lenguaje de programación y plataforma

Requisito expreso de la solicitud en la VET.

| Componente | Tecnología | Versión |
|---|---|---|
| Lenguaje | TypeScript | 5.8 |
| Interfaz de usuario | React + Vite (aplicación web progresiva) | React 19.2 · Vite 6.2 |
| Servidor de aplicación | Node.js con Express | Express 5.2 |
| Acceso a datos | Prisma ORM | 6.4.1 |
| Base de datos | MySQL 8 (motor InnoDB, transaccional) | 8.x |
| Aritmética monetaria | `decimal.js` (decimal de precisión arbitraria) | 10.6 |
| Validación de entradas | Zod | 4.4 |
| Cifrado de contraseñas | bcrypt | 3.0 |
| Sesiones | JSON Web Tokens firmados | 9.0 |

---

## 2 · Descripción general

Nortex registra las operaciones de compra, venta, inventario, cuentas por cobrar,
caja, nómina y contabilidad de pequeñas y medianas empresas, y emite los comprobantes
de venta correspondientes.

Cada empresa usuaria (en adelante, **contribuyente**) opera sobre datos aislados de
los demás. El aislamiento no depende de la interfaz: **toda** consulta a datos de
negocio se filtra por el identificador del contribuyente, y ese identificador se toma
exclusivamente del token de sesión firmado en el servidor — nunca de un dato enviado
por el navegador. Un usuario no puede, ni alterando la petición, leer ni modificar
información de otro contribuyente.

---

## 3 · Arquitectura

```
   Navegador / dispositivo del contribuyente
   ├─ Interfaz (React) — punto de venta, inventario, reportes
   └─ Almacenamiento local cifrado por origen (IndexedDB)
        └─ Cola de ventas emitidas sin conexión
                    │  HTTPS
                    ▼
   Servidor de aplicación (Node.js + Express)
   ├─ Autenticación y control de acceso por rol
   ├─ Motor transaccional de ventas, inventario y contabilidad
   └─ Registro de auditoría
                    │
                    ▼
   Base de datos MySQL 8 (InnoDB, transaccional)
                    │
                    ▼
   Respaldo automático a almacenamiento externo  → §7
```

### 3.1 Operación sin conexión

El comercio nicaragüense opera con conectividad intermitente. Si el servidor no
responde, la venta **no se pierde ni se duplica**:

1. La venta se guarda en el almacenamiento local del dispositivo con un
   **identificador único de operación** generado en el momento.
2. Al restablecerse la conexión, la cola se envía al servidor.
3. El servidor descarta cualquier reenvío del mismo identificador. Reintentar una
   venta ya registrada **no** genera un segundo comprobante ni un segundo descargo de
   inventario.

Esa idempotencia es la garantía de que el correlativo fiscal no se duplica por una
falla de red.

---

## 4 · Numeración de comprobantes

### 4.1 Correlativo ininterrumpido

Cada contribuyente tiene uno o más **rangos de numeración autorizados** por la DGI,
registrados con: serie, número inicial, número final y estado.

El número se asigna **dentro de la misma transacción de base de datos** que registra la
venta, mediante una operación atómica de incremento. Consecuencias verificables:

- **No se puede repetir un número.** Dos cajas vendiendo al mismo tiempo reciben
  números distintos: la operación de lectura e incremento es una sola sentencia y el
  motor la serializa.
- **No se puede saltar un número.** El contador solo avanza al registrarse una venta.
- **No se emite fuera del rango autorizado.** Al alcanzarse el número final, el sistema
  **rechaza la venta** con el mensaje *"Rango de facturación DGI agotado. Solicite nuevo
  rango."* en lugar de continuar emitiendo.
- **Si la transacción falla, el número no se consume**: la reversión de la transacción
  deshace también el incremento.

### 4.2 Series

El sistema admite múltiples series por contribuyente (A, B, …), pensadas para puntos
de emisión o sucursales distintas. Cada serie lleva su propio correlativo y su propio
rango autorizado, independientes entre sí.

---

## 5 · El comprobante

### 5.1 Contenido impreso

| Bloque | Datos |
|---|---|
| Encabezado fiscal | Nombre del contribuyente · RUC · dirección · teléfono · **código de autorización DGI** |
| Identificación | Serie y número de factura · fecha y hora · número interno de operación · cajero |
| Cliente | Nombre · cédula o RUC (cuando corresponde) |
| Detalle | Cantidad · descripción · importe por línea |
| Totales | **Base imponible · IVA 15% · TOTAL** (y subtotal/descuento cuando hubo descuento) |
| Cobro | Forma de pago; en efectivo, monto recibido y vuelto |
| Pie | Leyenda de validez fiscal cuando el contribuyente tiene código de autorización |

### 5.2 Tratamiento del IVA

Conforme a la práctica comercial nicaragüense, **el precio exhibido incluye el IVA**.
El sistema **no recarga** el 15% sobre el precio de góndola: lo **desglosa**.

```
Base imponible = Total ÷ 1.15
IVA (15%)      = Total − Base imponible
TOTAL          = Precio cobrado al cliente
```

El importe registrado en la base de datos como total de la venta es exactamente el
importe cobrado. La misma cifra aparece en pantalla, en el comprobante impreso y en los
reportes, sin conversiones intermedias.

### 5.3 Productos exentos

Cada producto lleva una marca de exención de IVA. Esa marca se **congela en el momento
de la venta**: si posteriormente se reclasifica el producto, las ventas ya emitidas
conservan el tratamiento fiscal que tenían al emitirse.

### 5.4 Modificación y anulación

**Un comprobante emitido no se modifica ni se elimina.** El sistema no expone ninguna
operación que altere el importe, el número, la serie ni el detalle de una venta ya
registrada, ni que la borre de la base de datos.

Lo único que evoluciona es el **estado de cobranza** (saldo pendiente, pagada,
incobrable), que es información de crédito y no altera el documento fiscal.

Las **devoluciones** de mercadería se registran como operaciones nuevas e
independientes, que dejan su propio rastro en inventario y en contabilidad.

> **Pendiente declarado (DGI-5):** el sistema **todavía no** implementa la *anulación*
> de un comprobante mal emitido. Está diferenciada de la devolución y debe incorporarse
> antes de presentar este expediente: estado de anulado, motivo obligatorio, registro en
> auditoría, reversión de inventario, **número no reutilizable**, y permanencia del
> comprobante anulado en los libros marcado como tal.

---

## 6 · Control de acceso y seguridad

### 6.1 Usuarios y contraseñas

Las contraseñas se almacenan **cifradas de forma irreversible** (bcrypt con sal). El
sistema no guarda ni puede recuperar la contraseña en claro; solo verificarla.

### 6.2 Sesiones

El acceso se otorga mediante un token firmado criptográficamente por el servidor, con
vencimiento. Las llaves de firma se administran en un **conjunto rotable**, de modo que
una llave puede sustituirse sin invalidar las sesiones vigentes. **No hay secretos
escritos en el código fuente**; se proveen por variables de entorno.

### 6.3 Roles

| Rol | Alcance |
|---|---|
| `OWNER` | Total sobre su empresa, incluida la configuración fiscal |
| `ADMIN` | Operación y administración |
| `MANAGER` | Operación e informes de gestión |
| `ACCOUNTANT` | Contabilidad e informes fiscales |
| `CASHIER` | Punto de venta y su propia caja |
| `VIEWER` | Solo lectura |

Cada operación sensible declara los roles admitidos y el servidor los verifica en cada
petición. No se depende de que la interfaz oculte un botón.

### 6.4 Turnos de caja y cierre a ciegas

Toda venta se asocia al **turno de caja** abierto por un operario identificado. Al
cerrar el turno, el sistema exige **primero** que el operario declare el efectivo
físico contado, y **solo después** revela el importe esperado por el sistema y la
diferencia. El operario no puede ver el número esperado antes de declarar el suyo.

### 6.5 Registro de auditoría

Toda operación que mueve dinero o inventario deja constancia con: contribuyente,
usuario, acción, estado anterior y posterior, y fecha y hora. El registro se escribe
**dentro de la misma transacción** que la operación: no puede existir un movimiento sin
su registro, ni un registro sin su movimiento.

Los movimientos de inventario dejan además un asiento de Kardex con las existencias
antes y después, leídas de la propia base bajo bloqueo — no calculadas por separado.

---

## 7 · Respaldo de la información

El sistema ejecuta un respaldo **automático diario** de la base de datos completa:

| | |
|---|---|
| **Frecuencia** | Diaria, 03:15 hora de Nicaragua (fuera del horario de facturación) |
| **Alcance** | Volcado completo (estructura, datos, rutinas, disparadores) en `utf8mb4` |
| **Destino** | Almacenamiento externo S3-compatible, **separado del servidor de aplicación**, organizado por año/mes |
| **Verificación** | Cada respaldo se valida antes de transferirse (integridad del archivo, cierre completo del volcado y presencia de las tablas fiscales). Un volcado incompleto se rechaza y genera alerta |
| **Prueba de restauración** | El procedimiento de restauración se ejecuta y verifica automáticamente en cada cambio del sistema, comparando tablas y número de registros contra el origen |
| **Evidencia** | Cada respaldo exitoso registra fecha, tamaño, huella `sha256` y destino en `last-backup.json` |
| **Retención** | `[[AÑOS DE RETENCIÓN]]` en el almacenamiento externo; 7 días en el servidor |

> **Antes de presentar:** confirmar que el servicio de respaldo está desplegado con sus
> credenciales cargadas y que existe al menos un registro de respaldo exitoso. El
> detalle técnico y su estado están en [`AUDITORIA_DGI.md`](./AUDITORIA_DGI.md) (DGI-4).

Período de retención a declarar: `[[AÑOS DE RETENCIÓN]]` (mínimo el exigido por el
Código Tributario).

---

## 8 · Reportes disponibles

| Reporte | Uso |
|---|---|
| Libro Diario | Asientos cronológicos del período |
| Libro Mayor | Movimientos y saldos por cuenta |
| Balance General | Situación financiera a una fecha |
| Estado de Resultados | Ingresos, costos y gastos del período |
| Catálogo de cuentas | Plan contable del contribuyente |
| Cierres de período | Control de períodos contables |
| Kardex | Entradas, salidas y existencias por producto |
| Arqueos de caja | Turnos, declarado contra esperado, diferencias |

La contabilidad se lleva por **partida doble**: cada operación genera su asiento
balanceado de forma automática, sin captura manual paralela.

---

## 9 · Manual de usuario

### 9.1 Emitir una venta

1. **Abrir la caja.** Declarar el efectivo inicial. Sin caja abierta no se puede cobrar.
2. **Cargar los productos.** Escanear el código de barras (o teclearlo y pulsar Enter),
   o seleccionar el producto en pantalla. Cada lectura confirma con sonido.
3. **Cliente** (opcional en contado, **obligatorio** en crédito).
4. **Cobrar.** Elegir la forma de pago. En efectivo, el sistema calcula el vuelto.
5. **Entregar el comprobante**: impreso, o enviado al cliente.

Si no hay internet, la venta se registra igual y se sincroniza sola al volver la
conexión. El indicador de la barra superior muestra cuántas ventas están pendientes de
enviar.

### 9.2 Cerrar la caja

Contar el efectivo físico, declararlo, y recién entonces el sistema muestra el esperado
y la diferencia. Toda diferencia queda registrada con su responsable.

### 9.3 Atajos de teclado

`F2` buscar · `F4` aparcar la venta en curso · `F7` salida de efectivo ·
`F8` entrada de efectivo · `F9` cobrar en efectivo · `Esc` cerrar la ventana activa.

### 9.4 Configuración fiscal

En **Configuración → Datos fiscales** se registran RUC, dirección, teléfono y el
**código de autorización DGI**. Mientras no haya código de autorización cargado, el
comprobante se imprime **sin** la leyenda de validez fiscal.

Los rangos de numeración autorizados se registran por serie, con número inicial y
final. Al agotarse un rango el sistema deja de emitir y solicita uno nuevo.

---

## 10 · Declaración de alcance

Este manual describe el comportamiento **verificado en el código fuente** del sistema a
la fecha indicada. No describe funcionalidad proyectada.

Dos requisitos de la DT 09-2007 están **explícitamente pendientes** y señalados en las
secciones 5.4 y 7. El expediente no debe presentarse hasta cerrarlos y actualizar este
documento.

| | |
|---|---|
| Versión del manual | 1.0 (borrador) |
| Fecha | `[[FECHA]]` |
| Elaborado por | `[[NOMBRE]]` |

---

*Este documento debe mantenerse junto al código que describe. Si el comportamiento del
sistema cambia, el manual cambia con él: un manual que describe una versión que ya no
corre es peor que no tenerlo, porque induce a error al auditor.*
