# Guía de usuario — Facturar carne por peso con Nortex

Esta guía está dirigida a dueños, administradores y cajeros de carnicerías,
pollerías y negocios que venden productos por peso.

## Lo más importante antes de empezar

**Para facturar carne no es obligatorio conectar la balanza por cable a
Nortex.** Hoy existen dos formas seguras de trabajar en caja:

1. leer el peso estable en cualquier balanza y escribirlo en el POS;
2. hacer que una balanza imprima una etiqueta EAN-13 con el peso y escanearla
   con un lector de códigos de barras.

La conexión USB/serial directa que aparece en **Balanzas y Etiquetas** es una
prueba experimental de solo lectura. Todavía no agrega el peso al ticket ni
está certificada para facturar con una marca o modelo específico.

```text
¿Qué hace la balanza del negocio?
├─ Solo muestra el peso
│  └─ Usá captura manual en el POS.
├─ Imprime una etiqueta EAN-13 que contiene el peso
│  └─ Configurá el perfil una vez y escaneá cada etiqueta.
├─ Imprime únicamente el precio total
│  └─ Pedí que la configuren para imprimir peso o usá captura manual.
└─ Tiene cable USB/serial
   └─ No lo uses todavía como fuente automática de una venta real.
```

## 1. Preparación inicial por el dueño o administrador

### Crear el producto de carne

1. Entrá a **Mis Productos**.
2. Seleccioná **Nuevo Producto** y luego **Crear Manual**, si aparece esa
   segunda opción.
3. Escribí el nombre, por ejemplo `Posta de res`, y completá **SKU / Código**.
   El SKU identifica el producto en el catálogo; no es el PLU de la balanza.
4. En **Familia**, elegí **Carnes** o **Pollos y aves**.
5. En **Forma de venta**, verificá **Por peso/medida**.
6. Elegí la misma **Unidad** que usa la balanza:
   - `lb` si el negocio vende y pesa en libras;
   - `kg` si vende y pesa en kilogramos.
7. Definí el **Paso de cantidad**:
   - para libras, normalmente `0.01`;
   - para kilogramos con precisión de un gramo, `0.001`.
8. En **Precio de Venta**, escribí el precio de una unidad completa. Por
   ejemplo, `145` significa C$145 por kg si la unidad seleccionada es `kg`.
9. Guardá el producto y comprobá que tenga existencia en la bodega correcta.

> Al elegir la familia **Carnes**, Nortex propone `lb` y paso `0.01`. Si el
> negocio trabaja en kilogramos, cambiá ambos valores antes de guardar.

El preset de carnes también activa control por lote. Al registrar una compra,
Nortex puede pedir número de lote y fecha de vencimiento; revisá esa opción con
el responsable de inventario antes de cargar existencias.

No mezcles sistemas de unidades durante la configuración. Las conversiones
automáticas admitidas son `g ↔ kg` y `oz ↔ lb`; Nortex no convierte una etiqueta
en libras a un producto configurado en kilogramos.

## 2. Método sencillo: escribir el peso manualmente

Este método funciona con cualquier balanza, aunque no tenga impresora, USB ni
conexión a internet.

### Rutina del cajero

1. Abrí el turno de caja y entrá a **Vender**.
2. Colocá la bandeja o bolsa en la balanza y aplicá la tara desde la propia
   balanza. Nortex no controla la tara.
3. Colocá la carne y esperá a que el peso quede estable.
4. Buscá o tocá el producto en el POS.
5. Nortex abrirá **Cantidad de [producto]** y mostrará su unidad y paso.
6. En **Peso o cantidad**, escribí exactamente el valor de la balanza.
7. Presioná **Agregar al ticket** o Enter.
8. Revisá cantidad, unidad, precio por unidad y total antes de cobrar.
9. Elegí el método de pago y emití el ticket.

### Ejemplo

Si `Posta de res` cuesta C$145 por kg y la balanza muestra `0.750 kg`, el cajero
escribe `0.750`. Nortex agrega al ticket:

| Producto | Cantidad | Precio unitario | Total |
|---|---:|---:|---:|
| Posta de res | 0.750 kg | C$145.00/kg | C$108.75 |

Cada paquete medido se conserva como una línea independiente. Si hay dos bolsas
de la misma carne, pesá y agregá cada una por separado.

## 3. Método recomendado: etiqueta impresa y lector de código

En este flujo la balanza y Nortex no necesitan hablar por cable:

```text
Carne → balanza imprime etiqueta → lector escanea EAN-13 → Nortex calcula total
```

### Equipo necesario

- una balanza que pueda imprimir etiquetas EAN-13;
- un lector USB o Bluetooth configurado como teclado;
- el lector debe enviar Enter después de los 13 dígitos;
- tres o más etiquetas reales de muestra;
- el manual de la balanza o ayuda del técnico que la configura.

El lector se conecta a la computadora o tableta del POS. **No se conecta la
balanza al POS para este flujo.**

### Pedir al técnico que configure la balanza

La etiqueta debe cumplir estas condiciones:

- tener exactamente 13 dígitos EAN-13;
- usar un prefijo fijo, por ejemplo `20` o `21`;
- incluir un PLU fijo que identifique el tipo de carne;
- incluir el peso o conteo, no solamente el precio total;
- usar siempre la misma unidad configurada en Nortex;
- incluir un dígito de verificación EAN-13 válido.

Si el código contiene solamente el precio total, Nortex no intentará dividirlo
por el precio actual para inventar un peso. En ese caso se debe reimprimir la
etiqueta con peso o escribir el peso manualmente.

### Configurar el perfil en Nortex

Solo el dueño o un administrador puede realizar estos pasos:

1. Entrá a **Stock → Balanzas y Etiquetas**.
2. En **Nuevo perfil**, escribí un nombre descriptivo, por ejemplo
   `Balanza carnicería mostrador`.
3. Presioná **Crear borrador**.
4. Copiá del manual o de una etiqueta real:
   - **Prefijos**;
   - **Inicio PLU** y **Largo PLU**;
   - **Inicio del valor** y **Largo del valor**;
   - **Decimales implícitos**;
   - **Unidad codificada**.
5. En **Qué codifica**, elegí **Peso**.
6. En **Checksum**, mantené **Validar EAN-13**.
7. En **Política de precio**, elegí **Recalcular con Nortex**.
8. Definí un valor mínimo y máximo razonables para la balanza.
9. En **Mapeos PLU → producto medido**, agregá cada PLU y seleccioná el
   producto correspondiente.
10. Presioná **Guardar borrador**.

Las posiciones de PLU y valor usan **base cero**: el primer dígito es la
posición `0`. No adivinés estas posiciones; confirmalas con varias etiquetas.

### Ejemplo de etiqueta

Con el formato predeterminado, el código válido `2000123012506` se interpreta
así:

| Parte | Dígitos | Significado |
|---|---|---|
| Prefijo | `20` | Etiqueta de balanza |
| PLU | `00123` | Posta de res |
| Valor | `01250` | 1.250 kg con 3 decimales implícitos |
| Checksum | `6` | Verificación EAN-13 |

Para ese ejemplo se configura:

- Inicio PLU: `2`;
- Largo PLU: `5`;
- Inicio del valor: `7`;
- Largo del valor: `5`;
- Qué codifica: **Peso**;
- Decimales implícitos: `3`;
- Unidad codificada: `kg`;
- PLU `00123` → producto `Posta de res`.

### Probar antes de publicar

1. En **Probar una etiqueta**, escaneá o escribí los 13 dígitos.
2. Presioná **Interpretar**.
3. Confirmá que Nortex muestre:
   - **Etiqueta reconocida**;
   - el producto correcto;
   - el PLU correcto;
   - el mismo peso de la etiqueta;
   - el total esperado con el precio de Nortex.
4. Repetí la prueba con al menos tres etiquetas reales y pesos distintos.
5. Probá también una etiqueta dañada o alterada; debe ser rechazada.
6. Marcá la confirmación de revisión y presioná **Guardar y publicar**.

Una versión publicada no se edita. Para cambiar posiciones, PLU o unidades se
crea una **Nueva versión**, se prueba y después se publica.

## 4. Facturar diariamente con etiquetas

1. Después de publicar el perfil, abrí **Vender** con internet al menos una vez
   para que el POS descargue la versión que podrá usar sin conexión.
2. Abrí el turno de caja.
3. Confirmá que el indicador del lector diga **Activo**.
4. Aplicá la tara a la bandeja desde la balanza, colocá la carne y esperá el
   peso estable.
5. Imprimí la etiqueta y pegala en el paquete.
6. Mantené enfocado **Buscar o escanear** y pasá la etiqueta por el lector.
7. Nortex agregará una línea con producto, cantidad, unidad, precio unitario y
   total calculado.
8. Compará el peso visible con la etiqueta antes de cobrar.
9. Repetí el proceso para cada paquete y finalizá el pago normalmente.

Si la misma etiqueta se lee dos veces en pocos segundos, Nortex preguntará
**¿Es otro paquete igual?** Elegí **No, cancelar** salvo que realmente exista un
segundo paquete físico con esa misma etiqueta.

La cantidad proveniente de una etiqueta no se edita en el carrito. Si el peso
es incorrecto, quitá la línea, volvé a pesar y generá otra etiqueta.

## 5. Qué significa “conexión directa”

La sección **Conexión directa: fundación experimental** sirve para comprobar si
una balanza transmite texto por puerto serial. Actualmente:

- solo está disponible en navegadores de escritorio compatibles con Web Serial
  y bajo HTTPS o entorno local seguro;
- no está disponible en iPhone/iPad ni en la aplicación Android WebView;
- abre un puerto genérico a 9600 baud;
- reconoce ejemplos de texto como `ST,1.250,kg`;
- espera tres lecturas similares para declarar un peso estable;
- usa un límite de prueba de 60 kg;
- no controla tara, calibración, precio ni configuración de la balanza;
- **no envía la lectura al carrito y no autoriza una venta `LIVE_SCALE`**.

El botón **Seleccionar puerto y leer** no debe usarse como procedimiento de caja
hasta que Nortex certifique la marca, modelo, protocolo y comportamiento físico
de esa balanza.

## 6. Problemas frecuentes

| Mensaje o situación | Qué hacer |
|---|---|
| Al tocar la carne se agrega 1 unidad | Editá el producto y elegí **Por peso/medida**. |
| El POS rechaza `0.750` | Revisá unidad y **Paso de cantidad** del producto. |
| “El código no coincide con una etiqueta configurada” | Confirmá que el perfil esté publicado y que el prefijo sea correcto. |
| “No existe un producto mapeado para el PLU” | Agregá ese PLU en la versión y publicá una nueva versión. |
| Checksum o código inválido | Reimprimí la etiqueta; no la ingresés como SKU común. |
| La etiqueta trae solo precio total | Configurá la balanza para codificar peso o usá captura manual. |
| Unidad incompatible | Usá `kg/g` o `lb/oz` de forma consistente; no mezcles kg con lb. |
| Peso fuera de rango | Revisá los valores mínimo/máximo y el estado físico de la balanza. |
| “Los formatos todavía se están cargando” | Esperá unos segundos, confirmá la conexión y volvé a escanear. |
| Una venta offline pide revisión | No borres ni reinterpretés la etiqueta; un administrador debe conciliarla. |
| Web Serial no aparece | Usá etiquetas o captura manual; el navegador/dispositivo no es compatible. |

## 7. Lista de verificación antes de la primera venta real

- [ ] Producto configurado como **Por peso/medida**.
- [ ] Unidad de producto y balanza iguales o compatibles.
- [ ] Precio ingresado por lb o por kg, según corresponda.
- [ ] Paso de cantidad acorde con la precisión de la balanza.
- [ ] Stock disponible en la bodega de la caja.
- [ ] El lector escribe 13 dígitos y envía Enter.
- [ ] Perfil probado con tres etiquetas físicas distintas.
- [ ] Todos los PLU están mapeados al producto correcto.
- [ ] El código contiene peso, no solamente precio total.
- [ ] Cantidad y total revisados antes de publicar el perfil.
- [ ] Cajeros capacitados para cancelar una lectura duplicada.

## 8. Información necesaria para certificar una balanza

Si se desea integrar una balanza por cable, enviar a soporte:

- marca y modelo exactos;
- fotografía de la placa y de los conectores;
- manual técnico o enlace del fabricante;
- sistema operativo y navegador usados en caja;
- tipo de conexión: USB, RS-232, Bluetooth o red;
- configuración serial: baud rate, bits, paridad y terminador;
- al menos 20 lecturas crudas: cero, estable, inestable, negativo y sobrecarga;
- al menos tres etiquetas reales con los 13 dígitos visibles;
- unidad y capacidad máxima de la balanza.

Hasta completar esa certificación, los procedimientos autorizados para facturar
son **captura manual** y **etiqueta EAN-13 configurada**.
