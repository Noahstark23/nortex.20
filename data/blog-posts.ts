/**
 * NORTEX — contenido del blog de marketing (archivo único).
 *
 * Cada objeto es un artículo. La taxonomía de clústeres vive en
 * data/blog-clusters.ts; `cluster` referencia un clúster por su `name` EXACTO.
 *
 * Reglas de contenido (ver CLAUDE.md / prompt SEO):
 *  - `content` usa SOLO la sintaxis que soporta utils/markdown.ts.
 *  - Toda cifra fiscal debe estar respaldada (DGI / Código del Trabajo / INSS).
 *    Donde un dato sea sensible y no esté confirmado, se marca "confirmá con tu
 *    contador o en la DGI" en vez de inventarlo.
 *  - Español de Nicaragua: usar "vos / tu negocio", nunca "tú".
 */

export interface BlogPostFaq {
    q: string;
    a: string;
}

export interface BlogPost {
    slug: string;
    title: string;
    /** Meta description (≤ 155 caracteres recomendado). */
    description: string;
    /** Keyword principal del artículo (del plan SEO). */
    keyword: string;
    /** Nombre EXACTO del clúster (data/blog-clusters.ts → BlogCluster.name). */
    cluster: string;
    /** Badge corto para tarjetas/encabezado. */
    category: string;
    /** Fecha de publicación ISO YYYY-MM-DD. */
    date: string;
    /** Fecha de última actualización ISO (opcional; por defecto = date). */
    updated?: string;
    readTime: string;
    /** Slugs relacionados: el pilar del clúster + hermanos (≥ 2). */
    relatedSlugs: string[];
    /** Preguntas frecuentes (≥ 2) → alimenta el JSON-LD FAQPage. */
    faq: BlogPostFaq[];
    /** Cuerpo en Markdown (subconjunto soportado por utils/markdown.ts). */
    content: string;
}

export const blogPosts: BlogPost[] = [
    {
        slug: 'como-calcular-nomina-nicaragua-2026',
        title: 'Cómo calcular la nómina en Nicaragua 2026 (Guía completa Ley 185)',
        description: 'Guía paso a paso para calcular salarios, INSS, INATEC, IR, vacaciones y aguinaldo según el Código del Trabajo de Nicaragua, con ejemplos reales.',
        keyword: 'cómo calcular la nómina en Nicaragua',
        cluster: 'Nómina y Planillas',
        category: 'Recursos Humanos',
        date: '2026-03-01',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['como-calcular-inss-nicaragua', 'como-calcular-aguinaldo-nicaragua', 'prestaciones-laborales-nicaragua-guia'],
        faq: [
            { q: '¿Cuánto se descuenta de INSS laboral en Nicaragua?', a: 'Al trabajador se le retiene el 7% de su salario bruto en concepto de INSS laboral. Ese monto lo descontás de la planilla y lo enterás al INSS junto con el aporte patronal.' },
            { q: '¿Qué aporta el patrono además del salario?', a: 'Sobre el salario bruto el empleador aporta INSS patronal (21.5%) e INATEC (2%). Por eso el costo real de un trabajador es mayor que su salario base. Confirmá la tasa patronal vigente con el INSS, ya que puede variar según el tamaño de la empresa.' },
            { q: '¿El aguinaldo paga INSS o IR?', a: 'El décimo tercer mes (aguinaldo) está exento de IR y no genera cotización al INSS cuando equivale a un mes de salario o menos, según el Código del Trabajo. Confirmá casos especiales con tu contador.' },
        ],
        content: `
Calcular bien la nómina es una de las obligaciones más importantes de cualquier negocio en Nicaragua. El Código del Trabajo (Ley 185) y la Ley de Seguridad Social fijan los mínimos que todo empleador debe cumplir. Esta guía te lleva paso a paso, con ejemplos.

## 1. Componentes del salario bruto

El salario bruto de un trabajador incluye:

- Salario base acordado en el contrato
- Horas extra (50% adicional en días hábiles; 100% en domingos y feriados)
- Comisiones e incentivos, si aplican

El salario bruto es la base sobre la que se calculan las cotizaciones y, en parte, los impuestos.

## 2. Deducciones al trabajador

Del salario bruto se le descuentan dos cosas al trabajador:

**INSS laboral: 7% del salario bruto.**

> Ejemplo: si el salario bruto es C$10,000, el INSS laboral es C$700.

**IR sobre salarios:** se aplica la tabla progresiva del IR de rentas del trabajo. Sobre una base **anual**:

| Renta anual gravable (C$) | Tasa marginal |
| --- | --- |
| Hasta 100,000 | Exento |
| 100,001 – 200,000 | 15% sobre el exceso |
| 200,001 – 350,000 | 20% sobre el exceso |
| 350,001 – 500,000 | 25% sobre el exceso |
| Más de 500,000 | 30% sobre el exceso |

La base del IR es el salario menos el INSS laboral. Si tu sistema de nómina lo hace mensual, anualiza para ubicar el tramo correcto.

## 3. Aportes del patrono

Además del salario, el empleador paga sobre el salario bruto:

- **INSS patronal: 21.5%** (confirmá la tasa vigente con el INSS según el tamaño de tu empresa)
- **INATEC: 2%**

**Ejemplo para un salario de C$15,000:**

| Concepto | Monto (C$) |
| --- | --- |
| Salario bruto | 15,000 |
| INSS patronal (21.5%) | 3,225 |
| INATEC (2%) | 300 |
| **Costo total empleador** | **18,525** |

Ese costo total es el número que realmente debés presupuestar por cada empleado, no solo el salario base.

## 4. Prestaciones sociales

El Código del Trabajo obliga a reconocer:

- **Vacaciones:** 15 días de descanso por año trabajado (se acumulan 1.25 días por mes). Valor = salario diario × 15.
- **Décimo tercer mes (aguinaldo):** equivale a un mes de salario por año completo; se acumula 1/12 por mes. Se paga en la primera quincena de diciembre.
- **Indemnización por antigüedad:** según el Art. 45, hasta un mes de salario por cada uno de los primeros tres años y veinte días por año a partir del cuarto, con un tope. Confirmá el cálculo exacto con tu contador.

## 5. Ejemplo integral mensual

Para un salario bruto de C$20,000:

1. INSS laboral (7%): C$1,400 → lo paga el trabajador.
2. Base para IR: C$18,600 (anualizada para ubicar el tramo).
3. INSS patronal (21.5%): C$4,300 → lo paga la empresa.
4. INATEC (2%): C$400 → lo paga la empresa.
5. Provisión de aguinaldo del mes: C$1,667 (un doceavo).

## 6. Automatizá este proceso con Nortex

Hacer esto a mano, empleado por empleado, es donde aparecen los errores que la DGI y el INSS multan. Nortex calcula automáticamente INSS, INATEC, IR, vacaciones y aguinaldo: ingresás el salario base y el sistema arma la planilla en segundos.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'retenciones-ir-nicaragua-2026',
        title: 'Retenciones IR Nicaragua 2026: Guía completa para PyMES',
        description: 'Tasas de retención IR en la fuente en Nicaragua, comprobantes, declaración mensual en la VET y errores que generan multas de la DGI.',
        keyword: 'retenciones IR Nicaragua',
        cluster: 'Impuestos y Retenciones',
        category: 'Fiscal',
        date: '2026-03-05',
        updated: '2026-06-30',
        readTime: '7 min',
        relatedSlugs: ['facturacion-dgi-nicaragua-guia', 'iva-nicaragua-guia-completa', 'contabilidad-basica-pyme-nicaragua'],
        faq: [
            { q: '¿Desde qué monto se aplica retención IR en la fuente?', a: 'En compras de bienes y servicios la retención se aplica generalmente a partir de C$1,000 por transacción. Confirmá el umbral vigente con tu contador, porque depende de la disposición administrativa de la DGI del año.' },
            { q: '¿Se retiene sobre el IVA?', a: 'No. La retención IR se calcula sobre la base gravable (el valor del bien o servicio), no sobre el IVA. Retener sobre el IVA es uno de los errores más comunes que corrige la DGI.' },
            { q: '¿Cuándo se declaran las retenciones?', a: 'Las retenciones efectuadas en un mes se declaran y enteran en la Ventanilla Electrónica Tributaria (VET) dentro de los primeros días del mes siguiente. Confirmá la fecha límite exacta del calendario DGI vigente.' },
        ],
        content: `
Las retenciones en la fuente son un mecanismo de la DGI: el comprador retiene un porcentaje del pago al proveedor y lo entrega directamente al fisco a cuenta del IR del proveedor. Si tu negocio es retenedor, esta guía te ordena las tasas, los comprobantes y los plazos.

## ¿Qué es una retención en la fuente?

Cuando tu negocio paga por un bien o servicio, en ciertos casos no le pagás el 100% al proveedor: retenés un porcentaje y lo enterás a la DGI. El proveedor usa la constancia de retención como un anticipo de su propio IR anual.

## Tasas de retención vigentes

Las tasas más usadas por una PyME son:

| Concepto | Tasa |
| --- | --- |
| Compra de bienes | 2% |
| Servicios generales | 2% |
| Servicios profesionales | 10% |
| Arrendamiento (alquileres) | 5% |

Estas son las tasas de referencia; siempre confirmá con tu contador la disposición administrativa vigente de la DGI, porque pueden cambiar año con año.

## ¿Cuándo aplicar retención?

Como regla general, cuando una transacción de compra de bienes o servicios supera **C$1,000**, el comprador retenedor debe aplicar la retención correspondiente.

**Ejemplo:** comprás mercadería por C$50,000 + IVA.

1. IVA 15% = C$7,500
2. Total factura = C$57,500
3. Retención 2% sobre la base (C$50,000) = C$1,000
4. Le pagás al proveedor: C$56,500
5. Enterás a la DGI: C$1,000

Fijate que la retención se calcula sobre los C$50,000, **no** sobre el total con IVA.

## Errores comunes que generan multas

- No emitir la constancia de retención al proveedor.
- Declarar fuera del plazo del mes siguiente.
- Retener sobre el IVA en lugar de sobre la base gravable.
- No llevar un registro ordenado de las retenciones efectuadas.

## Declaración mensual en la VET

Las retenciones se declaran en la **Ventanilla Electrónica Tributaria (VET)** dentro de los primeros días del mes siguiente. Confirmá la fecha límite exacta en el calendario tributario vigente de la DGI.

Nortex genera automáticamente el reporte de retenciones listo para declarar, con la base, la tasa y el monto retenido por proveedor.

[Mirá cómo funciona →](/register)
`,
    },
    {
        slug: 'facturacion-dgi-nicaragua-guia',
        title: 'Facturación DGI en Nicaragua: guía completa para tu negocio',
        description: 'Cómo facturar cumpliendo la DGI en Nicaragua: requisitos de la factura, series, IVA, retenciones y facturación electrónica. Guía para PyMES.',
        keyword: 'facturación DGI Nicaragua',
        cluster: 'Facturación DGI',
        category: 'Facturación',
        date: '2026-04-02',
        updated: '2026-06-30',
        readTime: '9 min',
        relatedSlugs: ['series-de-facturacion-dgi-nicaragua', 'iva-nicaragua-guia-completa', 'retenciones-ir-nicaragua-2026'],
        faq: [
            { q: '¿Qué datos debe llevar una factura para la DGI?', a: 'Una factura debe identificar al emisor (nombre/razón social y RUC), al cliente, la numeración de la serie autorizada, la fecha, el detalle de bienes o servicios, la base gravable, el IVA desglosado y el total. Confirmá los requisitos formales vigentes con tu contador o en la DGI.' },
            { q: '¿La facturación electrónica es obligatoria en Nicaragua?', a: 'La DGI ha venido ampliando la facturación electrónica por etapas y según el tipo de contribuyente. Verificá si tu negocio ya está obligado consultando tu calendario de contribuyente en la VET o con tu contador.' },
            { q: '¿Qué pasa si emito una factura con un error?', a: 'No se borra ni se altera una factura ya emitida: se anula formalmente o se emite una nota de crédito/débito según corresponda. Llevá el control de anulaciones para que tu declaración cuadre.' },
        ],
        content: `
Facturar bien no es solo entregar un papel: es la base de tu contabilidad, de tus impuestos y de tu relación con la DGI. Esta guía ordena lo esencial para que tu negocio en Nicaragua facture en regla.

## Por qué importa facturar en regla

Cada factura que emitís es un registro de ingreso que la DGI puede cruzar con tus declaraciones de IVA e IR. Facturar mal —o no facturar— es la principal causa de diferencias, multas y problemas en una revisión fiscal. Además, tus clientes formales necesitan la factura para deducir su gasto y soportar su propio crédito fiscal.

## Datos que debe llevar una factura

Una factura para la DGI generalmente incluye:

- **Datos del emisor:** nombre o razón social y número RUC.
- **Datos del cliente:** nombre y, cuando aplica, su RUC o cédula.
- **Serie y número** correlativo autorizado.
- **Fecha** de emisión.
- **Detalle** de los bienes o servicios.
- **Base gravable**, **IVA desglosado** (15%) y **total**.

> Confirmá los requisitos formales exactos y vigentes con tu contador o en la DGI: cambian según el régimen y el tipo de comprobante.

## Series A y B: ¿para qué sirven?

Muchos negocios manejan series distintas para separar tipos de operación (por ejemplo, ventas gravadas y otros comprobantes). Llevar las series ordenadas y sin saltos de numeración es clave para que la DGI no observe tu facturación. Profundizamos en esto en la guía de [series de facturación](/blog/series-de-facturacion-dgi-nicaragua).

## IVA y retenciones en la factura

Sobre la base gravable se aplica el **IVA del 15%**. Si sos agente retenedor o tu cliente lo es, además puede operar una **retención IR en la fuente** (ver la [guía de retenciones IR](/blog/retenciones-ir-nicaragua-2026)). Recordá: el IVA se calcula sobre la base, y la retención también se calcula sobre la base, nunca sobre el IVA.

**Ejemplo de una factura simple:**

| Concepto | Monto (C$) |
| --- | --- |
| Subtotal (base gravable) | 10,000.00 |
| IVA 15% | 1,500.00 |
| **Total a pagar** | **11,500.00** |

## Facturación electrónica

La DGI ha venido impulsando la facturación electrónica por etapas. Si tu negocio ya está obligado, el comprobante se genera y transmite en formato electrónico con su validación. Verificá tu situación en la VET o con tu contador antes de asumir que estás dentro o fuera del alcance.

## Errores que cuestan caro

1. Saltos o duplicados en la numeración de la serie.
2. No desglosar el IVA.
3. Alterar una factura ya emitida en vez de anularla o emitir nota de crédito.
4. No conservar copia ordenada para la declaración mensual.

## Cómo Nortex te ayuda a facturar en regla

Nortex emite facturas con la numeración correlativa por serie, desglosa el IVA automáticamente, registra las retenciones y deja todo listo para tu declaración. Sin saltos, sin cálculos a mano.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'series-de-facturacion-dgi-nicaragua',
        title: 'Series de facturación en Nicaragua: cómo manejarlas sin errores',
        description: 'Qué son las series de facturación, para qué sirven las Series A y B, y cómo evitar saltos de numeración que la DGI puede observar.',
        keyword: 'series de facturación Nicaragua',
        cluster: 'Facturación DGI',
        category: 'Facturación',
        date: '2026-04-08',
        readTime: '5 min',
        relatedSlugs: ['facturacion-dgi-nicaragua-guia', 'iva-nicaragua-guia-completa'],
        faq: [
            { q: '¿Qué es una serie de facturación?', a: 'Es un identificador (por ejemplo "A" o "B") que agrupa una secuencia de facturas numeradas de forma correlativa. Permite ordenar distintos tipos de comprobante o puntos de venta.' },
            { q: '¿Puedo tener varias series a la vez?', a: 'Sí. Muchos negocios usan varias series para separar sucursales, cajas o tipos de operación. Lo importante es que dentro de cada serie la numeración sea correlativa y sin saltos.' },
        ],
        content: `
Si la DGI revisa tu negocio, una de las primeras cosas que mira es la numeración de tus facturas. Manejar bien las series evita observaciones y multas. Acá te explicamos cómo.

## ¿Qué es una serie?

Una serie es una letra o código que agrupa una secuencia de facturas numeradas de forma correlativa: A-0001, A-0002, A-0003… Cada serie lleva su propio conteo.

## ¿Para qué sirven las Series A y B?

Sirven para **separar tipos de operación o puntos de venta**. Por ejemplo, una serie para la caja principal y otra para una sucursal, o una para ventas gravadas y otra para otro tipo de comprobante. Así, cada flujo queda ordenado y es fácil de auditar.

## La regla de oro: numeración sin saltos

Dentro de una serie, la numeración debe ser **correlativa y continua**. Un salto (pasar de A-0005 a A-0009) o un número duplicado son señales de alerta para la DGI. Si anulás una factura, el número **no desaparece**: queda registrado como anulado.

## Buenas prácticas

- Definí desde el inicio cuántas series vas a usar y para qué.
- No reutilices números ni "saltés" para corregir.
- Registrá cada anulación con su motivo.
- Cuadrá la numeración con tu declaración mensual.

Para el panorama completo de facturación, leé la [guía de facturación DGI](/blog/facturacion-dgi-nicaragua-guia).

## Nortex maneja las series por vos

Nortex asigna el siguiente número correlativo de cada serie automáticamente, bloquea duplicados y deja registro de cada anulación. Olvidate de cuadrar numeraciones a mano.

[Empezá gratis con Nortex →](/register)
`,
    },
    {
        slug: 'iva-nicaragua-guia-completa',
        title: 'IVA en Nicaragua: tasa, base gravable y declaración (guía 2026)',
        description: 'Cómo funciona el IVA en Nicaragua: tasa del 15%, base gravable, crédito fiscal, exenciones y declaración mensual ante la DGI. Guía para PyMES.',
        keyword: 'IVA Nicaragua',
        cluster: 'IVA',
        category: 'Fiscal',
        date: '2026-04-12',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['credito-fiscal-iva-nicaragua', 'facturacion-dgi-nicaragua-guia', 'retenciones-ir-nicaragua-2026'],
        faq: [
            { q: '¿Cuál es la tasa de IVA en Nicaragua?', a: 'La tasa general del IVA en Nicaragua es del 15%. Algunas operaciones están exentas o gravadas con tasa 0% (por ejemplo ciertas exportaciones). Confirmá el tratamiento de tu producto con tu contador.' },
            { q: '¿Qué es el crédito fiscal del IVA?', a: 'Es el IVA que pagás en tus compras y que podés restar del IVA que cobrás en tus ventas. Al final del mes enterás a la DGI la diferencia (IVA cobrado menos crédito fiscal).' },
            { q: '¿Cuándo se declara el IVA?', a: 'El IVA se declara y entera mensualmente en la VET dentro de los plazos del calendario tributario. Confirmá la fecha límite exacta vigente con tu contador.' },
        ],
        content: `
El IVA es el impuesto que más se ve en el día a día de un negocio: lo cobrás en cada venta y lo pagás en cada compra. Entender cómo funciona te evita pagar de más —o quedar debiendo— a la DGI.

## Qué es el IVA y cuánto es

El Impuesto al Valor Agregado (IVA) en Nicaragua tiene una **tasa general del 15%** sobre la base gravable de bienes y servicios. Es un impuesto que el consumidor final paga, pero que tu negocio recauda y entera a la DGI.

## Base gravable: sobre qué se calcula

El IVA se calcula sobre el **valor del bien o servicio** (la base gravable), antes de cualquier retención.

> Sobre una venta de C$10,000, el IVA es C$1,500 y el total es C$11,500.

## Débito y crédito fiscal

Acá está la clave del IVA:

- **Débito fiscal:** el IVA que **cobrás** en tus ventas.
- **Crédito fiscal:** el IVA que **pagás** en tus compras de bienes y servicios para el negocio.

Cada mes, a la DGI le enterás la diferencia:

| Concepto | Monto (C$) |
| --- | --- |
| IVA cobrado en ventas (débito) | 15,000 |
| IVA pagado en compras (crédito) | 9,000 |
| **IVA a pagar a la DGI** | **6,000** |

Por eso es tan importante guardar tus facturas de compra: cada una es crédito fiscal que reduce lo que pagás. Profundizamos en la [guía de crédito fiscal](/blog/credito-fiscal-iva-nicaragua).

## Exenciones y tasa cero

No todo lleva 15%. Algunos bienes están **exentos** y ciertas operaciones (como algunas exportaciones) van con **tasa 0%**. La diferencia importa para tu crédito fiscal. Como el listado cambia, confirmá el tratamiento de tu producto con tu contador o en la DGI antes de aplicarlo.

## Declaración mensual

El IVA se declara cada mes en la **VET**. Necesitás tener cuadrado el IVA cobrado, el crédito fiscal y las retenciones del período. Declarar tarde genera recargos.

## Cómo Nortex te simplifica el IVA

Nortex calcula el IVA de cada venta, acumula el crédito fiscal de tus compras y te muestra el IVA a pagar del mes listo para declarar. Sin hojas de cálculo paralelas.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'credito-fiscal-iva-nicaragua',
        title: 'Crédito fiscal del IVA en Nicaragua: cómo aprovecharlo bien',
        description: 'Qué es el crédito fiscal del IVA, qué compras lo generan y cómo no perderlo. Guía práctica para PyMES en Nicaragua.',
        keyword: 'crédito fiscal IVA Nicaragua',
        cluster: 'IVA',
        category: 'Fiscal',
        date: '2026-04-18',
        readTime: '5 min',
        relatedSlugs: ['iva-nicaragua-guia-completa', 'facturacion-dgi-nicaragua-guia'],
        faq: [
            { q: '¿Qué compras generan crédito fiscal?', a: 'Generalmente las compras de bienes y servicios gravados que están relacionadas con tu actividad económica y respaldadas con una factura formal a nombre de tu negocio. Confirmá los casos límite con tu contador.' },
            { q: '¿Puedo perder el crédito fiscal?', a: 'Sí: si la compra no está bien documentada, no está a nombre del negocio o no se relaciona con tu actividad, la DGI puede rechazar ese crédito. Por eso es vital guardar y registrar cada factura de compra.' },
        ],
        content: `
El crédito fiscal es, literalmente, dinero que reducís de tu pago de IVA. Pero solo si lo documentás bien. Acá te explicamos cómo aprovecharlo sin perderlo.

## Qué es el crédito fiscal

Es el IVA que pagás en tus compras de bienes y servicios para el negocio. Ese IVA no es un gasto: es un **crédito** que restás del IVA que cobraste en tus ventas. Mientras más crédito fiscal válido tengás, menos IVA le enterás a la DGI.

## Qué compras lo generan

Como regla general, generan crédito fiscal las compras que:

- Están **gravadas con IVA** (15%).
- Se relacionan con **tu actividad económica**.
- Están respaldadas por una **factura formal a nombre de tu negocio** (con tu RUC).

Una compra personal, sin factura o a nombre de otra persona, **no** genera crédito fiscal que puedas usar.

## Cómo no perderlo

1. Pedí siempre factura formal con el RUC de tu negocio.
2. Archivá las facturas de compra del mes.
3. Registrá cada compra para que el crédito quede contabilizado.
4. No mezcles gastos personales con los del negocio.

Para ver cómo el crédito se cruza con el débito, leé la [guía completa del IVA](/blog/iva-nicaragua-guia-completa).

## Nortex registra tu crédito fiscal automáticamente

Cada compra que ingresás en Nortex suma su crédito fiscal y se descuenta del IVA del mes. Llegás a la declaración con el número ya listo.

[Empezá gratis con Nortex →](/register)
`,
    },
    {
        slug: 'regimen-cuota-fija-nicaragua-guia',
        title: 'Régimen de Cuota Fija en Nicaragua: qué es y a quién conviene',
        description: 'Guía del régimen simplificado de Cuota Fija de la DGI en Nicaragua: quién puede acogerse, qué obligaciones tiene y cuándo pasar al régimen general.',
        keyword: 'régimen cuota fija Nicaragua',
        cluster: 'Régimen de Cuota Fija',
        category: 'Fiscal',
        date: '2026-04-22',
        updated: '2026-06-30',
        readTime: '7 min',
        relatedSlugs: ['iva-nicaragua-guia-completa', 'contabilidad-basica-pyme-nicaragua', 'facturacion-dgi-nicaragua-guia'],
        faq: [
            { q: '¿Quién puede estar en Cuota Fija?', a: 'El régimen de Cuota Fija está pensado para pequeños contribuyentes cuyos ingresos y/o inventario no superan los topes que define la DGI. Los montos exactos los fija la normativa vigente: confirmalos con tu contador o en la DGI antes de decidir.' },
            { q: '¿Un negocio en Cuota Fija cobra IVA?', a: 'El pequeño contribuyente de Cuota Fija paga una cuota mensual fija en lugar de liquidar IVA e IR de forma general. El tratamiento concreto depende de tu situación: confirmalo con tu contador.' },
            { q: '¿Cuándo conviene salir de Cuota Fija?', a: 'Cuando tu negocio crece y supera los topes, o cuando tus clientes formales necesitan factura con IVA para su crédito fiscal, suele convenir pasar al régimen general. Es una decisión que conviene analizar con un contador.' },
        ],
        content: `
La Cuota Fija es la puerta de entrada a la formalidad para miles de pequeños negocios en Nicaragua. Es simple, pero tiene límites. Acá te explicamos si te conviene.

## Qué es el régimen de Cuota Fija

Es un **régimen simplificado** de la DGI para pequeños contribuyentes. En vez de liquidar IVA e IR mes a mes con todo el papeleo del régimen general, pagás una **cuota mensual fija** según el tramo en el que caés.

La idea es bajar la carga administrativa para negocios pequeños: pulperías, ventas, talleres y similares.

## ¿Quién puede acogerse?

El régimen está pensado para contribuyentes cuyos **ingresos** y/o **inventario** no superan los topes que define la normativa.

> Los montos exactos de los topes los fija la DGI y pueden actualizarse. No los asumás de memoria: confirmá los límites vigentes con tu contador o directamente en la DGI antes de decidir tu régimen.

## Obligaciones del pequeño contribuyente

Aunque es simplificado, no es "sin reglas":

- Pagar la **cuota mensual** en la fecha que corresponde.
- Estar inscrito y mantener tus datos al día.
- Llevar un control básico de ingresos y compras.

## Cuota Fija vs. régimen general

| Aspecto | Cuota Fija | Régimen general |
| --- | --- | --- |
| Carga administrativa | Baja | Mayor |
| Pago | Cuota mensual fija | IVA + IR según movimiento |
| Factura con IVA a clientes formales | Limitada | Sí |
| Apto para | Negocios pequeños | Negocios en crecimiento |

## ¿Cuándo conviene cambiar?

Conviene analizar el paso al régimen general cuando:

1. Tu negocio **supera los topes** de la Cuota Fija.
2. Tus **clientes formales** te piden factura con IVA para su crédito fiscal.
3. Querés **deducir** más gastos y crédito fiscal.

Es una decisión con consecuencias fiscales: conversala con tu contador. Para entender el lado contable, leé la [guía de contabilidad básica](/blog/contabilidad-basica-pyme-nicaragua).

## Nortex crece con tu negocio

Estés en Cuota Fija o en régimen general, Nortex ordena tus ventas, compras e inventario. Y el día que des el salto al régimen general, ya tenés todo registrado para facturar con IVA.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'prestaciones-laborales-nicaragua-guia',
        title: 'Prestaciones laborales en Nicaragua: la guía completa (Ley 185)',
        description: 'Vacaciones, aguinaldo, indemnización, horas extra y feriados según el Código del Trabajo de Nicaragua. Qué le debés a cada trabajador y cómo calcularlo.',
        keyword: 'prestaciones laborales Nicaragua',
        cluster: 'Recursos Humanos',
        category: 'Recursos Humanos',
        date: '2026-04-25',
        updated: '2026-06-30',
        readTime: '9 min',
        relatedSlugs: ['como-calcular-aguinaldo-nicaragua', 'como-calcular-indemnizacion-laboral-nicaragua', 'como-calcular-nomina-nicaragua-2026'],
        faq: [
            { q: '¿Cuántos días de vacaciones corresponden por ley?', a: 'El Código del Trabajo reconoce 15 días de descanso con goce de salario por cada año trabajado, que se acumulan a razón de 1.25 días por mes.' },
            { q: '¿El aguinaldo es obligatorio?', a: 'Sí. El décimo tercer mes equivale a un mes de salario por año trabajado (proporcional si es menos) y se paga en la primera quincena de diciembre. Es un derecho irrenunciable.' },
            { q: '¿Qué prestaciones se pagan al terminar el contrato?', a: 'Al finalizar la relación se liquidan las vacaciones y el aguinaldo proporcionales no pagados, y según la causa de terminación, la indemnización por antigüedad del Art. 45. Confirmá el cálculo con tu contador.' },
        ],
        content: `
Contratar a alguien en Nicaragua implica más que pagar un salario: el Código del Trabajo (Ley 185) fija prestaciones que son derechos irrenunciables. Esta es la guía para que sepás exactamente qué le debés a cada trabajador.

## Las prestaciones que manda la ley

Todo trabajador con relación laboral tiene derecho, como mínimo, a:

- **Vacaciones** con goce de salario.
- **Décimo tercer mes** (aguinaldo).
- **Indemnización por antigüedad** según la causa de terminación.
- Pago de **horas extra**, **séptimo día** y **feriados** nacionales.

## Vacaciones

Corresponden **15 días** de descanso con goce de salario por cada año trabajado, acumulables a razón de **1.25 días por mes**. Si el trabajador sale antes del año, se le pagan las vacaciones proporcionales acumuladas.

> Valor de un día de vacaciones = salario mensual ÷ 30.

## Décimo tercer mes (aguinaldo)

Equivale a **un mes de salario por año** trabajado, proporcional si es menos. Se paga en la **primera quincena de diciembre** y está exento de IR e INSS cuando equivale a un mes o menos. Te lo explicamos paso a paso en la [guía del aguinaldo](/blog/como-calcular-aguinaldo-nicaragua).

## Indemnización por antigüedad (Art. 45)

Cuando termina la relación por ciertas causas, corresponde indemnización: como referencia, hasta un mes de salario por cada uno de los primeros tres años y veinte días por año a partir del cuarto, con un tope. El detalle y los casos están en la [guía de indemnización](/blog/como-calcular-indemnizacion-laboral-nicaragua).

## Horas extra, séptimo día y feriados

- **Horas extra:** se pagan con 50% de recargo en días hábiles y 100% en días de descanso y feriados.
- **Séptimo día:** el descanso semanal es remunerado.
- **Feriados nacionales:** trabajarlos se paga con recargo.

## Cuánto cuesta realmente un trabajador

El salario base es solo una parte. Sumá INSS patronal, INATEC y la provisión de prestaciones para conocer el costo real. Lo desglosamos en la [guía para calcular la nómina](/blog/como-calcular-nomina-nicaragua-2026).

| Concepto | Cómo se acumula |
| --- | --- |
| Vacaciones | 1.25 días por mes |
| Aguinaldo | 1/12 de salario por mes |
| INSS patronal | 21.5% del salario (confirmar con INSS) |
| INATEC | 2% del salario |

## Nortex calcula las prestaciones por vos

Nortex acumula vacaciones y aguinaldo mes a mes, calcula horas extra y arma la liquidación final sin que tengás que sacar la calculadora. Menos errores, menos reclamos.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-calcular-inss-nicaragua',
        title: 'Cómo calcular el INSS en Nicaragua (laboral y patronal)',
        description: 'Cálculo del INSS laboral (7%) y patronal en Nicaragua, con ejemplos. Qué descuenta el trabajador, qué aporta el patrono y cómo enterarlo.',
        keyword: 'cómo calcular INSS Nicaragua',
        cluster: 'Nómina y Planillas',
        category: 'Recursos Humanos',
        date: '2026-05-02',
        readTime: '5 min',
        relatedSlugs: ['como-calcular-nomina-nicaragua-2026', 'como-calcular-aguinaldo-nicaragua'],
        faq: [
            { q: '¿Cuánto es el INSS laboral?', a: 'El INSS laboral es el 7% del salario bruto y se le descuenta directamente al trabajador en la planilla.' },
            { q: '¿Cuánto aporta el patrono al INSS?', a: 'El INSS patronal ronda el 21.5% del salario bruto, pero puede variar según el tamaño de la empresa y la normativa vigente. Confirmá la tasa que te aplica con el INSS.' },
        ],
        content: `
El INSS es uno de los descuentos y aportes obligatorios de toda planilla en Nicaragua. Calcularlo bien evita diferencias y multas. Acá te lo explicamos simple.

## Dos partes: laboral y patronal

El INSS tiene dos componentes que se calculan sobre el **salario bruto**:

- **INSS laboral (7%):** se le **descuenta al trabajador**.
- **INSS patronal (21.5%):** lo **paga la empresa** además del salario (confirmá la tasa vigente según el tamaño de tu empresa con el INSS).

## Ejemplo

Para un salario bruto de **C$12,000**:

| Concepto | Cálculo | Monto (C$) |
| --- | --- | --- |
| INSS laboral (7%) | 12,000 × 0.07 | 840 |
| INSS patronal (21.5%) | 12,000 × 0.215 | 2,580 |

El trabajador recibe su salario menos C$840 (más el IR que corresponda). La empresa, además del salario, entera C$2,580 de patronal más el INATEC.

## Cómo se entera

El INSS laboral retenido y el patronal se enteran al Instituto en los plazos establecidos. Llevá la planilla cuadrada mes a mes para no arrastrar diferencias.

Para el cálculo completo de la planilla, leé la [guía para calcular la nómina](/blog/como-calcular-nomina-nicaragua-2026).

## Nortex calcula el INSS automáticamente

Ingresás el salario y Nortex calcula el INSS laboral, el patronal y el INATEC, y arma la planilla lista para enterar.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-calcular-aguinaldo-nicaragua',
        title: 'Cómo calcular el aguinaldo (décimo tercer mes) en Nicaragua',
        description: 'Fórmula del aguinaldo o décimo tercer mes en Nicaragua, con ejemplos para año completo y proporcional. Cuándo se paga y si paga impuestos.',
        keyword: 'cómo calcular aguinaldo Nicaragua',
        cluster: 'Nómina y Planillas',
        category: 'Recursos Humanos',
        date: '2026-05-06',
        readTime: '5 min',
        relatedSlugs: ['como-calcular-nomina-nicaragua-2026', 'prestaciones-laborales-nicaragua-guia'],
        faq: [
            { q: '¿Cómo se calcula el aguinaldo proporcional?', a: 'Se suma 1/12 del salario por cada mes trabajado en el período. Si el trabajador laboró 6 meses, le corresponde medio mes de salario.' },
            { q: '¿El aguinaldo paga IR o INSS?', a: 'El décimo tercer mes está exento de IR y no cotiza al INSS cuando equivale a un mes de salario o menos, según el Código del Trabajo.' },
        ],
        content: `
El aguinaldo o décimo tercer mes es un derecho irrenunciable en Nicaragua. Calcularlo es sencillo si seguís la fórmula. Acá va, con ejemplos.

## La fórmula

El aguinaldo equivale a **un mes de salario por año trabajado**. Se acumula a razón de **un doceavo (1/12) del salario por cada mes** laborado en el período (que va de diciembre a diciembre).

> Aguinaldo = (salario mensual ÷ 12) × meses trabajados.

## Ejemplo: año completo

Salario de C$15,000, trabajó los 12 meses:

- Aguinaldo = 15,000 ÷ 12 × 12 = **C$15,000** (un mes completo).

## Ejemplo: proporcional

Salario de C$15,000, trabajó 7 meses:

- Aguinaldo = 15,000 ÷ 12 × 7 = **C$8,750**.

## ¿Cuándo se paga?

Se paga en la **primera quincena de diciembre**. Si la relación termina antes, se liquida la parte proporcional acumulada.

## ¿Paga impuestos?

El aguinaldo está **exento de IR** y no cotiza al **INSS** cuando equivale a un mes de salario o menos. Confirmá casos especiales con tu contador.

Para ver cómo encaja en la planilla, leé la [guía para calcular la nómina](/blog/como-calcular-nomina-nicaragua-2026) y la [guía de prestaciones](/blog/prestaciones-laborales-nicaragua-guia).

## Nortex provisiona el aguinaldo cada mes

En vez de buscar la plata en diciembre, Nortex acumula la provisión del aguinaldo mes a mes y la liquida cuando corresponde.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-calcular-indemnizacion-laboral-nicaragua',
        title: 'Cómo calcular la indemnización laboral en Nicaragua (Art. 45)',
        description: 'Cómo funciona la indemnización por antigüedad del Art. 45 del Código del Trabajo de Nicaragua, con ejemplo de cálculo y qué incluye la liquidación final.',
        keyword: 'indemnización laboral Nicaragua',
        cluster: 'Recursos Humanos',
        category: 'Recursos Humanos',
        date: '2026-05-10',
        readTime: '6 min',
        relatedSlugs: ['prestaciones-laborales-nicaragua-guia', 'como-calcular-aguinaldo-nicaragua'],
        faq: [
            { q: '¿Cuánto es la indemnización por antigüedad?', a: 'Como referencia del Art. 45: hasta un mes de salario por cada uno de los primeros tres años trabajados y veinte días de salario por cada año a partir del cuarto, con un tope. Confirmá el cálculo exacto de tu caso con un contador o asesor laboral.' },
            { q: '¿Qué incluye una liquidación final?', a: 'Suele incluir el salario pendiente, las vacaciones y el aguinaldo proporcionales no pagados y, según la causa de terminación, la indemnización por antigüedad.' },
        ],
        content: `
Cuando termina una relación laboral, la liquidación final debe calcularse bien para evitar reclamos. La pieza más delicada es la indemnización por antigüedad. Te la explicamos.

## Qué es la indemnización por antigüedad

Es una prestación que reconoce el tiempo trabajado cuando la relación termina por ciertas causas. Está en el **Art. 45 del Código del Trabajo** (Ley 185).

## Cómo se calcula (referencia)

Como referencia general del Art. 45:

- **Hasta un mes de salario** por cada uno de los **primeros tres años** trabajados.
- **Veinte días de salario** por cada año **a partir del cuarto**.
- Con un **tope** máximo establecido por la ley.

> El cálculo exacto depende de la causa de terminación y de la situación de cada trabajador. Confirmalo con un contador o asesor laboral antes de pagar una liquidación.

## Ejemplo

Trabajador con salario de C$18,000 y 3 años completos:

- 3 años × 1 mes = **C$54,000** de indemnización por antigüedad (referencia), más las prestaciones proporcionales pendientes.

## Qué más incluye la liquidación

Además de la indemnización (cuando aplica), la liquidación final suele incluir:

1. Salario pendiente hasta el último día.
2. **Vacaciones** proporcionales no gozadas.
3. **Aguinaldo** proporcional no pagado (ver [guía del aguinaldo](/blog/como-calcular-aguinaldo-nicaragua)).

Para el panorama completo de derechos, leé la [guía de prestaciones laborales](/blog/prestaciones-laborales-nicaragua-guia).

## Nortex arma la liquidación final

Nortex tiene registrado el historial de cada empleado y arma la liquidación con vacaciones, aguinaldo e indemnización proporcionales, lista para revisar.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'control-de-inventario-kardex-nicaragua',
        title: 'Control de inventario y Kardex para negocios en Nicaragua',
        description: 'Qué es el Kardex, cómo controlar tu inventario, evitar faltantes y conocer el costo real de tus productos. Guía práctica para PyMES en Nicaragua.',
        keyword: 'control de inventario Kardex Nicaragua',
        cluster: 'Inventario y Kardex',
        category: 'Inventario',
        date: '2026-05-12',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['metodos-de-costeo-inventario-peps-promedio', 'sistema-punto-de-venta-nicaragua-guia', 'como-calcular-margen-de-ganancia-nicaragua'],
        faq: [
            { q: '¿Qué es un Kardex?', a: 'Es el registro de cada entrada y salida de un producto, con su cantidad y costo, que permite saber en todo momento cuánto stock tenés y a qué costo. Es la base del control de inventario.' },
            { q: '¿Por qué mi inventario físico no cuadra con el sistema?', a: 'Suele ser por ventas no registradas, mermas, robos o errores de digitación. Hacer conteos físicos periódicos y compararlos con el Kardex es la forma de detectar y corregir las diferencias.' },
        ],
        content: `
El inventario suele ser la mayor inversión de un negocio de retail. Si no lo controlás, perdés plata sin darte cuenta: por faltantes, por vencimientos o por vender al costo equivocado. El Kardex es la herramienta para evitarlo.

## Qué es el Kardex

El Kardex es el **registro de movimientos** de cada producto: cada entrada (compra) y cada salida (venta o merma) con su cantidad y su costo. Con él sabés en todo momento:

- Cuántas unidades tenés en existencia.
- A qué costo entraron.
- Cuánto vale tu inventario.

## Por qué importa el costo, no solo la cantidad

Saber que tenés "50 martillos" no alcanza. Necesitás saber **a qué costo** los tenés para fijar bien el precio y conocer tu margen real. Acá entran los [métodos de costeo](/blog/metodos-de-costeo-inventario-peps-promedio) (PEPS, costo promedio).

## Faltantes y diferencias

Cuando el inventario físico no cuadra con el sistema, casi siempre es por:

1. Ventas que no se registraron.
2. Mermas, daños o vencimientos.
3. Robo hormiga.
4. Errores de digitación al recibir mercadería.

La solución es hacer **conteos físicos periódicos** y compararlos con el Kardex.

## Punto de reorden y stock mínimo

Definí un **stock mínimo** por producto y un **punto de reorden**: cuando las existencias bajan de cierto nivel, es hora de comprar. Así evitás quedarte sin lo que más se vende.

| Concepto | Para qué sirve |
| --- | --- |
| Stock mínimo | Nivel bajo el cual no querés caer |
| Punto de reorden | Cuándo volver a comprar |
| Rotación | Qué tan rápido se vende un producto |

## Inventario y rentabilidad

Un buen control de inventario te dice qué productos rotan, cuáles están parados (plata dormida) y cuáles te dejan más margen. Es información directa para decidir qué comprar y a qué precio vender. Conectalo con tu [margen de ganancia](/blog/como-calcular-margen-de-ganancia-nicaragua).

## Nortex lleva el Kardex por vos

Cada venta en el [punto de venta](/blog/sistema-punto-de-venta-nicaragua-guia) descuenta el stock y actualiza el Kardex en tiempo real, con alertas de stock mínimo y reportes de rotación. Sin contar a mano.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'metodos-de-costeo-inventario-peps-promedio',
        title: 'Métodos de costeo de inventario: PEPS y costo promedio',
        description: 'Diferencia entre PEPS (FIFO) y costo promedio para valorar tu inventario, con ejemplos. Cuál conviene a tu negocio en Nicaragua.',
        keyword: 'métodos de costeo de inventario',
        cluster: 'Inventario y Kardex',
        category: 'Inventario',
        date: '2026-05-16',
        readTime: '6 min',
        relatedSlugs: ['control-de-inventario-kardex-nicaragua', 'como-calcular-margen-de-ganancia-nicaragua'],
        faq: [
            { q: '¿Qué es el método PEPS?', a: 'PEPS (Primeras Entradas, Primeras Salidas; FIFO en inglés) asume que se venden primero las unidades más antiguas. El costo de venta usa los costos de las compras más viejas.' },
            { q: '¿Qué método me conviene?', a: 'Depende de tu negocio y de cómo varían tus costos. El costo promedio suaviza las variaciones de precio; PEPS refleja mejor el orden físico en productos perecederos. Conversalo con tu contador.' },
        ],
        content: `
Cuando comprás el mismo producto a distintos precios a lo largo del tiempo, ¿a qué costo lo vendés? El método de costeo responde esa pregunta y afecta tu margen y tus impuestos.

## El problema del costo variable

Comprás 10 unidades a C$100 y, semanas después, 10 más a C$120. Cuando vendés una, ¿su costo es C$100 o C$120? El método de costeo lo define.

## PEPS (Primeras Entradas, Primeras Salidas)

PEPS asume que se venden primero **las unidades más antiguas**. El costo de venta toma los costos de las compras más viejas. Es ideal para productos **perecederos**, donde físicamente querés sacar primero lo que entró antes.

## Costo promedio

Cada vez que comprás, se recalcula un **costo promedio ponderado** de las existencias. Todas las salidas usan ese promedio. Suaviza las variaciones de precio y es simple de mantener.

## Ejemplo comparado

Compras: 10 a C$100 y luego 10 a C$120. Vendés 5 unidades:

| Método | Costo de las 5 unidades |
| --- | --- |
| PEPS | 5 × 100 = C$500 |
| Costo promedio | 5 × 110 = C$550 |

El método cambia tu costo de venta y, por lo tanto, tu utilidad reportada.

## ¿Cuál elegir?

- **PEPS:** mejor para perecederos y donde el orden físico importa (farmacias, alimentos).
- **Costo promedio:** simple y estable para mercadería general (ferreterías, abarrotes).

Sea cual sea, lo importante es ser **consistente**. Conversá la elección con tu contador. Y mantené el [Kardex](/blog/control-de-inventario-kardex-nicaragua) al día para que el costeo funcione.

## Nortex costea tu inventario automáticamente

Nortex calcula el costo de cada salida según el método configurado y te muestra el margen real de cada venta. Sin planillas paralelas.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'sistema-punto-de-venta-nicaragua-guia',
        title: 'Sistema de punto de venta (POS) en Nicaragua: cómo elegir el tuyo',
        description: 'Qué es un sistema POS, qué funciones necesita tu negocio en Nicaragua (facturación DGI, inventario, caja) y cómo elegir el correcto. Guía práctica.',
        keyword: 'sistema de punto de venta Nicaragua',
        cluster: 'Punto de Venta',
        category: 'Punto de Venta',
        date: '2026-05-18',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['arqueo-de-caja-paso-a-paso', 'control-de-inventario-kardex-nicaragua', 'facturacion-dgi-nicaragua-guia'],
        faq: [
            { q: '¿Qué es un sistema POS?', a: 'Un sistema de punto de venta (POS, por sus siglas en inglés) es el software con el que registrás las ventas, cobrás, emitís la factura y descontás el inventario en el momento de cada venta.' },
            { q: '¿Qué debe tener un POS en Nicaragua?', a: 'Debe permitir facturar cumpliendo la DGI, controlar inventario en tiempo real, manejar la caja y los arqueos, y dar reportes de ventas. Para algunos giros, además, control de crédito a clientes o de lotes y caducidad.' },
        ],
        content: `
El punto de venta es el corazón operativo de cualquier comercio. Elegir bien el sistema POS te ahorra horas, evita errores de caja y mantiene tu negocio en regla con la DGI. Esta guía te ayuda a decidir.

## Qué hace un sistema POS

Un POS moderno hace mucho más que sumar precios:

- Registra cada **venta** y cobra (efectivo, tarjeta, transferencia).
- Emite la **factura** cumpliendo la DGI.
- Descuenta el **inventario** en tiempo real (ver [Kardex](/blog/control-de-inventario-kardex-nicaragua)).
- Controla la **caja** y los arqueos por turno.
- Da **reportes** de ventas, márgenes y productos top.

## Qué necesita un negocio en Nicaragua

Más allá de lo básico, en Nicaragua un buen POS debería ofrecer:

1. **Facturación compatible con la DGI** (series, IVA desglosado, retenciones). Ver [guía de facturación DGI](/blog/facturacion-dgi-nicaragua-guia).
2. **Inventario integrado**, para que cada venta actualice el stock.
3. **Arqueo de caja** por turno para cuadrar el efectivo. Ver [cómo hacer un arqueo](/blog/arqueo-de-caja-paso-a-paso).
4. **Reportes** claros para tomar decisiones.

## Funciones según tu giro

| Giro | Función clave extra |
| --- | --- |
| Ferretería | Búsqueda por código, crédito a clientes |
| Farmacia | Lotes y fechas de caducidad |
| Pulpería | Velocidad de cobro, productos por unidad |
| Distribuidora | Precios por mayoreo, rutas |

## Errores al elegir un POS

- Comprar uno que **no factura DGI** y tener que cambiarlo después.
- Elegir un sistema sin **inventario integrado** (terminás contando a mano).
- No considerar el **soporte local** en español.

## Nortex es un POS pensado para Nicaragua

Nortex factura cumpliendo la DGI, controla tu inventario en tiempo real, maneja caja y arqueos, y te da reportes claros. Todo en uno, con soporte local.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'arqueo-de-caja-paso-a-paso',
        title: 'Cómo hacer un arqueo de caja paso a paso',
        description: 'Qué es un arqueo de caja, cómo hacerlo por turno y qué hacer cuando hay faltante o sobrante. Guía práctica para negocios en Nicaragua.',
        keyword: 'arqueo de caja',
        cluster: 'Punto de Venta',
        category: 'Punto de Venta',
        date: '2026-05-22',
        readTime: '5 min',
        relatedSlugs: ['sistema-punto-de-venta-nicaragua-guia', 'flujo-de-caja-pyme-nicaragua'],
        faq: [
            { q: '¿Qué es un arqueo de caja?', a: 'Es la comparación entre el efectivo que hay físicamente en la caja y el que el sistema dice que debería haber según las ventas y movimientos del turno.' },
            { q: '¿Qué hago si hay un faltante?', a: 'Registrá el faltante, revisá los movimientos del turno (vueltos, retiros, ventas no cobradas) e identificá la causa. Llevar el arqueo por turno ayuda a ubicar dónde se originó la diferencia.' },
        ],
        content: `
El arqueo de caja es la forma más simple de cuidar tu efectivo. Hacerlo bien, por turno, detecta errores y desalienta el robo hormiga. Te mostramos cómo.

## Qué es un arqueo

Es comparar el **efectivo físico** de la caja con el efectivo que **debería haber** según las ventas y movimientos del turno. Si los dos números cuadran, la caja está sana; si no, hay un faltante o un sobrante que investigar.

## Paso a paso

1. **Cerrá el turno** en el sistema para fijar el total de ventas en efectivo.
2. **Contá el efectivo** físico de la caja (billetes y monedas).
3. Restá el **fondo inicial** (el cambio con el que abrió la caja).
4. Compará el efectivo contado con lo que el sistema esperaba.
5. Registrá la **diferencia** (faltante o sobrante) y su causa.

## Ejemplo

| Concepto | Monto (C$) |
| --- | --- |
| Fondo inicial | 1,000 |
| Ventas en efectivo del turno | 8,500 |
| Efectivo esperado en caja | 9,500 |
| Efectivo contado | 9,420 |
| **Faltante** | **80** |

## Qué hacer con las diferencias

Un faltante o sobrante pequeño suele ser un error de vueltos. Uno grande o repetido hay que investigarlo: ventas no registradas, retiros sin anotar o algo más serio. La clave es hacer el arqueo **por turno y por cajero**, para ubicar dónde se originó.

Conectá el efectivo de caja con tu [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua) y tu [sistema POS](/blog/sistema-punto-de-venta-nicaragua-guia).

## Nortex hace el arqueo automático

Nortex cierra el turno, calcula el efectivo esperado y registra faltantes y sobrantes por cajero. El arqueo deja de ser un dolor de cabeza.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'contabilidad-basica-pyme-nicaragua',
        title: 'Contabilidad básica para PyMES en Nicaragua: por dónde empezar',
        description: 'Conceptos de contabilidad que todo dueño de negocio en Nicaragua debe entender: ingresos, gastos, estados financieros y obligaciones con la DGI.',
        keyword: 'contabilidad básica PyME Nicaragua',
        cluster: 'Contabilidad PyME',
        category: 'Contabilidad',
        date: '2026-05-25',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['flujo-de-caja-pyme-nicaragua', 'iva-nicaragua-guia-completa', 'como-calcular-margen-de-ganancia-nicaragua'],
        faq: [
            { q: '¿Necesito un contador si tengo un negocio pequeño?', a: 'Sí, conviene. Aun con un sistema que ordene tus números, un contador te ayuda a cumplir con la DGI, optimizar impuestos y leer tus estados financieros. El sistema le facilita el trabajo y te baja el costo.' },
            { q: '¿Cuál es la diferencia entre utilidad y flujo de caja?', a: 'La utilidad es ingresos menos gastos en el período; el flujo de caja es el efectivo que entra y sale. Podés tener utilidad en papel y aun así quedarte sin efectivo si tus clientes no te pagan a tiempo.' },
        ],
        content: `
No necesitás ser contador para entender los números de tu negocio, pero sí necesitás entender lo básico para no manejar a ciegas. Esta guía te da el mínimo indispensable.

## Ingresos, gastos y utilidad

La ecuación más simple de tu negocio:

> Utilidad = Ingresos − Gastos.

Suena obvio, pero la mayoría de los negocios no separa bien sus gastos ni conoce su utilidad real. El primer paso es registrar **todo**: cada venta y cada gasto.

## Separá el negocio de lo personal

El error más común del dueño de PyME: usar la caja del negocio como billetera personal. Mezclar los dos vuelve imposible saber si el negocio gana o pierde. Definí un **sueldo** para vos y respetá la separación.

## Los estados financieros básicos

| Estado | Qué te dice |
| --- | --- |
| Estado de resultados | Si ganaste o perdiste en el período |
| Balance general | Qué tenés (activos) y qué debés (pasivos) |
| Flujo de caja | El efectivo que entró y salió |

El [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua) merece atención aparte: es la causa número uno de quiebres en negocios que "vendían bien".

## Obligaciones con la DGI

Según tu régimen, tenés que declarar IVA, IR y retenciones. Llevar la contabilidad ordenada hace que esas declaraciones sean rápidas y sin sustos. Repasá la [guía del IVA](/blog/iva-nicaragua-guia-completa).

## Margen y rentabilidad

Vender mucho no es ganar mucho. Conocé tu [margen de ganancia](/blog/como-calcular-margen-de-ganancia-nicaragua) por producto para saber qué te deja plata de verdad.

## El rol del contador (y del sistema)

Un sistema ordena los números y un contador los interpreta y te mantiene en regla. Juntos te dan tranquilidad. El sistema, además, le baja el costo al contador porque ya recibe todo registrado.

## Nortex ordena tu contabilidad desde la venta

Cada venta, compra y gasto en Nortex queda registrado y clasificado, listo para tus reportes y para tu contador. Menos papeles, más control.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'gestion-de-cobranza-cuentas-por-cobrar',
        title: 'Gestión de cobranza y cuentas por cobrar en Nicaragua',
        description: 'Cómo dar crédito a clientes sin quebrar tu flujo: políticas de crédito, control de cuentas por cobrar y recuperación de cartera. Guía para PyMES.',
        keyword: 'gestión de cobranza cuentas por cobrar',
        cluster: 'Cobranza y Crédito',
        category: 'Cobranza',
        date: '2026-05-28',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['como-cobrar-cuentas-morosas-nicaragua', 'flujo-de-caja-pyme-nicaragua', 'contabilidad-basica-pyme-nicaragua'],
        faq: [
            { q: '¿Conviene dar crédito a los clientes?', a: 'El crédito puede aumentar tus ventas, pero también inmoviliza tu efectivo y trae riesgo de mora. Conviene si tenés una política clara de crédito y un control ordenado de las cuentas por cobrar.' },
            { q: '¿Qué es la antigüedad de saldos?', a: 'Es un reporte que clasifica lo que te deben según hace cuánto venció (corriente, 1-30 días, 31-60, etc.). Te muestra qué cartera está sana y cuál se está volviendo riesgosa.' },
        ],
        content: `
Vender a crédito puede hacer crecer tu negocio o ahogarlo, según cómo lo manejés. La clave está en tener política, control y seguimiento. Te explicamos cómo cobrar sin pelear y sin perder plata.

## El crédito es una inversión, no un favor

Cuando vendés a crédito, le estás **prestando** tu mercadería al cliente. Esa plata sale de tu flujo hoy y vuelve después… si volvés a cobrar. Por eso el crédito necesita reglas.

## Definí una política de crédito

Antes de fiar, definí:

- **A quién** le das crédito (clientes con historial).
- **Cuánto** (un límite por cliente).
- **A qué plazo** (15, 30 días).
- **Qué pasa** si no paga a tiempo.

## Controlá tus cuentas por cobrar

Tenés que saber, en cualquier momento, **cuánto te deben y desde cuándo**. El reporte de **antigüedad de saldos** clasifica la deuda por tiempo vencido:

| Estado | Riesgo |
| --- | --- |
| Corriente (no vencido) | Bajo |
| 1-30 días vencido | Medio |
| 31-60 días | Alto |
| Más de 60 días | Muy alto |

Mientras más vieja la deuda, más difícil de cobrar.

## Seguimiento antes que cobranza dura

La mejor cobranza es la **preventiva**: recordatorios antes del vencimiento, contacto apenas se atrasa. Cuando ya hay mora, escalá con orden. Lo vemos en [cómo cobrar cuentas morosas](/blog/como-cobrar-cuentas-morosas-nicaragua).

## Cobranza y flujo de caja

Tu cartera por cobrar es efectivo "atrapado". Cobrarla a tiempo es lo que mantiene sano tu [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua).

## Nortex controla tu cartera

Nortex registra cada venta a crédito, te muestra la antigüedad de saldos y te avisa qué cobrar hoy. Menos cuentas olvidadas, más efectivo de vuelta.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-cobrar-cuentas-morosas-nicaragua',
        title: 'Cómo cobrar cuentas morosas sin perder al cliente',
        description: 'Estrategias prácticas para recuperar cuentas vencidas en Nicaragua: recordatorios, planes de pago y escalamiento, manteniendo la relación con el cliente.',
        keyword: 'cómo cobrar cuentas morosas',
        cluster: 'Cobranza y Crédito',
        category: 'Cobranza',
        date: '2026-06-02',
        readTime: '5 min',
        relatedSlugs: ['gestion-de-cobranza-cuentas-por-cobrar', 'flujo-de-caja-pyme-nicaragua'],
        faq: [
            { q: '¿Cuándo empiezo a cobrar una cuenta vencida?', a: 'Apenas vence. Mientras más temprano contactés al cliente, más fácil es recuperar. Esperar semanas convierte una mora manejable en una deuda difícil.' },
            { q: '¿Conviene ofrecer un plan de pago?', a: 'Sí, cuando el cliente quiere pagar pero no puede de una vez. Un plan de pago realista recupera más que insistir en el total. Documentá el acuerdo.' },
        ],
        content: `
Toda cartera tiene morosos. La diferencia entre recuperar la plata o perderla está en cómo gestionás el cobro. Acá van estrategias que funcionan sin quemar la relación.

## Actuá temprano

La regla número uno: cobrá **apenas vence**. Una cuenta de 5 días de vencida se recupera con una llamada amable; una de 90 días ya es un problema. El tiempo juega en tu contra.

## Escalá con orden

1. **Recordatorio amable** antes y al momento del vencimiento.
2. **Contacto directo** (llamada o mensaje) a los pocos días.
3. **Conversación** para entender por qué no paga.
4. **Plan de pago** si quiere pagar pero no puede de una vez.
5. **Escalamiento formal** si no hay respuesta.

## Ofrecé soluciones, no solo presión

Muchos morosos **quieren** pagar pero no pueden de golpe. Un plan de pago realista —y documentado— recupera más que repetir "pagame todo". Mostrate firme con la deuda y flexible con la forma.

## Cuidá la relación

Un cliente que se atrasó una vez puede ser un buen cliente por años. Cobrá con firmeza pero con respeto: el objetivo es **recuperar la plata y conservar al cliente**, no ganar la discusión.

## Aprendé para la próxima

Si un cliente es moroso recurrente, ajustá su [límite de crédito](/blog/gestion-de-cobranza-cuentas-por-cobrar) o pasalo a pago de contado. La cobranza también es información para decidir a quién fiar.

## Nortex te dice a quién cobrar hoy

Nortex te muestra las cuentas vencidas ordenadas por antigüedad y te ayuda a dar seguimiento para que no se te escape ninguna.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'flujo-de-caja-pyme-nicaragua',
        title: 'Flujo de caja para PyMES en Nicaragua: la guía práctica',
        description: 'Qué es el flujo de caja, por qué un negocio rentable puede quedarse sin efectivo y cómo proyectarlo para no tener sustos. Guía para PyMES en Nicaragua.',
        keyword: 'flujo de caja PyME Nicaragua',
        cluster: 'Finanzas y Gestión',
        category: 'Finanzas',
        date: '2026-06-05',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['como-calcular-margen-de-ganancia-nicaragua', 'gestion-de-cobranza-cuentas-por-cobrar', 'contabilidad-basica-pyme-nicaragua'],
        faq: [
            { q: '¿Por qué un negocio con utilidades se queda sin efectivo?', a: 'Porque la utilidad se mide al vender, pero el efectivo entra cuando cobrás. Si vendés a crédito y tus gastos son de contado, podés tener utilidad en papel y no tener con qué pagar. Por eso se proyecta el flujo de caja.' },
            { q: '¿Cada cuánto debo proyectar mi flujo de caja?', a: 'Al menos mensual, y semanal si tu negocio es ajustado de efectivo. La proyección te avisa con anticipación si vas a quedar corto, para que actúes antes y no después.' },
        ],
        content: `
Muchos negocios no quiebran por falta de ventas, sino por falta de efectivo. El flujo de caja es la herramienta que te avisa antes de que eso pase. Esta guía te enseña a usarlo.

## Utilidad no es lo mismo que efectivo

Acá está el concepto que salva negocios:

> Ganás cuando vendés, pero solo tenés plata cuando **cobrás**.

Si vendés C$100,000 a crédito a 30 días pero tus proveedores y tu planilla se pagan **hoy**, podés tener "utilidad" y aun así no tener con qué pagar. Eso es un problema de **flujo de caja**.

## Qué es el flujo de caja

Es el registro y la proyección del **efectivo que entra y sale** de tu negocio en el tiempo:

- **Entradas:** ventas de contado, cobros de crédito, otros ingresos.
- **Salidas:** compras, planilla, alquiler, impuestos, préstamos.

## Proyectá, no solo registres

Lo valioso no es mirar el flujo de ayer, sino **proyectar** el de las próximas semanas:

| Semana | Entradas | Salidas | Saldo |
| --- | --- | --- | --- |
| 1 | 40,000 | 35,000 | +5,000 |
| 2 | 30,000 | 38,000 | −3,000 |
| 3 | 45,000 | 30,000 | +12,000 |

En la semana 2 vas a quedar corto: ahora lo sabés con tiempo para actuar (cobrar antes, posponer una compra, negociar un pago).

## Cómo cuidar tu flujo

1. Cobrá tu [cartera](/blog/gestion-de-cobranza-cuentas-por-cobrar) a tiempo.
2. Negociá plazos con proveedores.
3. No inmovilices efectivo en inventario parado.
4. Conocé tu [margen](/blog/como-calcular-margen-de-ganancia-nicaragua) para no vender a pérdida.

## Nortex te muestra tu efectivo real

Nortex registra entradas y salidas, controla tu cartera por cobrar y te da la foto del efectivo para que proyectes sin sorpresas.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-calcular-margen-de-ganancia-nicaragua',
        title: 'Cómo calcular el margen de ganancia de tus productos',
        description: 'Diferencia entre margen y markup, cómo calcular tu margen real considerando costos e IVA, y cómo fijar precios que dejen ganancia. Guía para Nicaragua.',
        keyword: 'cómo calcular margen de ganancia',
        cluster: 'Finanzas y Gestión',
        category: 'Finanzas',
        date: '2026-06-10',
        readTime: '6 min',
        relatedSlugs: ['flujo-de-caja-pyme-nicaragua', 'control-de-inventario-kardex-nicaragua'],
        faq: [
            { q: '¿Cuál es la diferencia entre margen y markup?', a: 'El markup es el porcentaje que agregás sobre el costo; el margen es la ganancia como porcentaje del precio de venta. Un markup del 50% no equivale a un margen del 50%. Confundirlos hace que creás que ganás más de lo que ganás.' },
            { q: '¿El IVA es parte de mi ganancia?', a: 'No. El IVA que cobrás no es tuyo: lo recaudás para la DGI. Tu margen se calcula sobre el precio sin IVA, no sobre el total que cobra el cliente.' },
        ],
        content: `
Fijar precios "al tanteo" es una de las formas más rápidas de perder plata sin darte cuenta. Entender tu margen real te permite poner precios que dejan ganancia de verdad.

## Margen vs. markup: no es lo mismo

Acá se equivocan casi todos:

- **Markup:** cuánto agregás **sobre el costo**.
- **Margen:** la ganancia como porcentaje del **precio de venta**.

> Si comprás a C$100 y vendés a C$150, el markup es 50% pero el margen es 33% (50 de ganancia sobre 150 de venta).

Confundirlos te hace creer que ganás más de lo que realmente ganás.

## La fórmula del margen

> Margen % = (Precio de venta − Costo) ÷ Precio de venta × 100.

Ejemplo: costo C$100, precio C$150 (sin IVA):

- Margen = (150 − 100) ÷ 150 × 100 = **33.3%**.

## Cuidado con el IVA

El **IVA no es tuyo**: lo cobrás para la DGI. Calculá siempre tu margen sobre el precio **sin IVA**. Si vendés a C$172.50 (C$150 + 15% IVA), tu margen se calcula sobre los C$150, no sobre los C$172.50. Repasá la [guía del IVA](/blog/iva-nicaragua-guia-completa).

## El costo real no es solo la compra

Tu costo incluye, además del precio de compra, el flete, las mermas y, según el método, el [costeo de inventario](/blog/control-de-inventario-kardex-nicaragua). Un margen calculado sobre un costo incompleto miente.

## Usá el margen para decidir

Conocer el margen de cada producto te dice:

1. Qué productos te dejan más plata (empujalos).
2. Cuáles vendés casi sin ganancia (revisá precio o proveedor).
3. Hasta dónde podés hacer una promoción sin perder.

## Nortex te muestra el margen de cada venta

Nortex conoce el costo de tu inventario y te muestra el margen real de cada producto y de cada venta, sin IVA de por medio. Decidís con datos, no con corazonadas.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-administrar-una-ferreteria-nicaragua',
        title: 'Cómo administrar una ferretería en Nicaragua: guía completa',
        description: 'Inventario por código, crédito a clientes, márgenes y facturación DGI: todo lo que necesitás para administrar una ferretería rentable en Nicaragua.',
        keyword: 'cómo administrar una ferretería Nicaragua',
        cluster: 'Ferreterías',
        category: 'Ferreterías',
        date: '2026-06-12',
        updated: '2026-06-30',
        readTime: '9 min',
        relatedSlugs: ['control-de-inventario-kardex-nicaragua', 'gestion-de-cobranza-cuentas-por-cobrar', 'sistema-punto-de-venta-nicaragua-guia'],
        faq: [
            { q: '¿Cómo controlo miles de productos en una ferretería?', a: 'Con un inventario por código y un sistema POS que descuente el stock en cada venta. Manejar a mano cientos o miles de SKU es inviable: necesitás Kardex en tiempo real, stock mínimo y punto de reorden.' },
            { q: '¿Conviene dar crédito en una ferretería?', a: 'El crédito a maestros de obra y clientes frecuentes ayuda a vender más, pero hay que controlarlo con límites y seguimiento de cuentas por cobrar para no quedarte sin efectivo.' },
        ],
        content: `
Una ferretería vive de dos cosas: tener el producto cuando el cliente lo pide y conocer su margen real. Administrar cientos de SKU a mano es imposible. Esta guía ordena lo esencial.

## El reto: miles de productos

Una ferretería maneja desde un tornillo hasta una bomba de agua. Sin un **inventario por código** y un sistema que descuente el stock en cada venta, es imposible saber qué tenés y qué falta. El [Kardex](/blog/control-de-inventario-kardex-nicaragua) es la base.

## Stock mínimo y punto de reorden

El cliente de ferretería no espera: si no tenés el codo de media pulgada, lo compra en la de enfrente. Definí **stock mínimo** y **punto de reorden** por producto para no quedarte sin lo que más rota.

## Márgenes por categoría

No todo deja lo mismo. La tornillería y los accesorios suelen dejar más margen que los productos "ancla" (cemento, varilla) que se venden casi al costo para atraer clientes. Conocé el [margen](/blog/como-calcular-margen-de-ganancia-nicaragua) de cada categoría para decidir precios y promociones.

| Tipo de producto | Rol | Margen típico |
| --- | --- | --- |
| Ancla (cemento, varilla) | Atraer clientes | Bajo |
| Accesorios y tornillería | Ganancia | Alto |
| Herramienta | Ticket alto | Medio |

## Crédito a maestros de obra

El crédito a maestros y clientes frecuentes es parte del negocio ferretero. Pero sin control se vuelve un hueco de efectivo. Aplicá límites y seguí tus [cuentas por cobrar](/blog/gestion-de-cobranza-cuentas-por-cobrar).

## Facturación en regla

Vender a empresas constructoras exige factura formal con IVA y, a veces, manejar retenciones. Tené tu [facturación DGI](/blog/facturacion-dgi-nicaragua-guia) ordenada para no perder esos clientes.

## Nortex está hecho para ferreterías

Nortex controla miles de productos por código, descuenta inventario en cada venta, maneja crédito a clientes y factura cumpliendo la DGI. Probalo gratis 30 días.

[Empezá ahora →](/register)
`,
    },
    {
        slug: 'como-administrar-una-farmacia-nicaragua',
        title: 'Cómo administrar una farmacia en Nicaragua: lotes y caducidad',
        description: 'Control de lotes y fechas de caducidad (FEFO), inventario, márgenes y facturación para administrar una farmacia rentable y en regla en Nicaragua.',
        keyword: 'cómo administrar una farmacia Nicaragua',
        cluster: 'Farmacias',
        category: 'Farmacias',
        date: '2026-06-15',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['como-controlar-vencimientos-farmacia-fefo', 'control-de-inventario-kardex-nicaragua', 'sistema-punto-de-venta-nicaragua-guia'],
        faq: [
            { q: '¿Cómo evito perder dinero por medicamentos vencidos?', a: 'Controlando lotes y fechas de caducidad con el criterio FEFO (primero en vencer, primero en salir) y con alertas de productos próximos a vencer para promoverlos o devolverlos a tiempo.' },
            { q: '¿Una farmacia necesita un POS especial?', a: 'Necesita un POS que maneje lotes y caducidad, además de inventario y facturación. Un sistema genérico que solo suma precios no sirve para el control que exige una farmacia.' },
        ],
        content: `
En una farmacia, el inventario tiene fecha de muerte: lo que no vendés a tiempo, vence y se vuelve pérdida total. Administrar bien una farmacia es, sobre todo, controlar lotes y caducidad. Te explicamos cómo.

## El enemigo: el vencimiento

Cada producto vencido es plata que tirás a la basura, y además un riesgo legal y de salud. El control de **lotes y fechas de caducidad** no es opcional en una farmacia: es la diferencia entre ganar y perder.

## FEFO: primero en vencer, primero en salir

La regla de oro del inventario farmacéutico es **FEFO** (First Expired, First Out): siempre vendé primero lo que vence antes. Esto exige saber, de cada producto, **qué lotes tenés y cuándo vencen**. Lo profundizamos en [control de vencimientos](/blog/como-controlar-vencimientos-farmacia-fefo).

## Alertas que salvan plata

Un buen sistema te avisa cuándo un lote está **próximo a vencer**, para que actúes: promoverlo, rotarlo a una sucursal con más salida o gestionar la devolución al proveedor mientras todavía se puede.

## Inventario y Kardex

Más allá de la caducidad, una farmacia maneja cientos de presentaciones. El [Kardex](/blog/control-de-inventario-kardex-nicaragua) en tiempo real te dice qué tenés, qué rota y qué está parado.

## Márgenes y precios regulados

Algunos medicamentos tienen precios de referencia y márgenes ajustados; otros (cuidado personal, vitaminas) dejan más. Conocé tu mezcla para cuidar la rentabilidad sin descuidar el servicio.

## Facturación en regla

La farmacia factura con IVA según corresponda y debe tener su [facturación DGI](/blog/facturacion-dgi-nicaragua-guia) ordenada. Un [POS](/blog/sistema-punto-de-venta-nicaragua-guia) que integre todo evita el doble trabajo.

## Nortex controla lotes y caducidad

Nortex maneja inventario por lote y fecha de caducidad, te alerta de lo próximo a vencer y factura cumpliendo la DGI. Dejá de perder plata por vencimientos.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-controlar-vencimientos-farmacia-fefo',
        title: 'Control de vencimientos en farmacia: el método FEFO',
        description: 'Cómo aplicar el método FEFO (primero en vencer, primero en salir) para evitar pérdidas por caducidad en tu farmacia en Nicaragua.',
        keyword: 'control de vencimientos farmacia FEFO',
        cluster: 'Farmacias',
        category: 'Farmacias',
        date: '2026-06-20',
        readTime: '5 min',
        relatedSlugs: ['como-administrar-una-farmacia-nicaragua', 'control-de-inventario-kardex-nicaragua'],
        faq: [
            { q: '¿Qué significa FEFO?', a: 'FEFO viene de "First Expired, First Out": primero en vencer, primero en salir. Es el criterio de rotación que prioriza vender los lotes que caducan antes, para minimizar pérdidas.' },
            { q: '¿FEFO es lo mismo que PEPS?', a: 'No exactamente. PEPS (FIFO) saca primero lo que entró antes; FEFO saca primero lo que vence antes. En productos perecederos, lo que entró primero no siempre es lo que vence primero, por eso en farmacia se usa FEFO.' },
        ],
        content: `
En una farmacia, controlar vencimientos es controlar pérdidas. El método FEFO es la forma estándar de hacerlo. Acá te explicamos cómo aplicarlo en el día a día.

## Qué es FEFO

**FEFO** = First Expired, First Out (primero en vencer, primero en salir). El principio es simple: cuando hay varios lotes de un mismo producto, **vendé primero el que vence antes**.

## FEFO no es PEPS

Es fácil confundirlos:

- **PEPS (FIFO):** sale primero lo que **entró** primero.
- **FEFO:** sale primero lo que **vence** primero.

En medicamentos, un lote que compraste después puede vencer antes que uno viejo (por distintas fechas de fabricación). Por eso en farmacia manda **FEFO**, no PEPS. Para el costeo contable, ver [métodos de costeo](/blog/control-de-inventario-kardex-nicaragua).

## Cómo aplicarlo en la práctica

1. Registrá **cada lote con su fecha de caducidad** al recibir mercadería.
2. Acomodá el anaquel para que lo que vence antes quede **adelante**.
3. Configurá **alertas** de productos próximos a vencer.
4. Actuá a tiempo: promoción, rotación o devolución al proveedor.

## Qué hacer con lo próximo a vencer

| Tiempo a vencer | Acción |
| --- | --- |
| 90+ días | Rotación normal |
| 30-90 días | Promover / rotar a sucursal con más salida |
| Menos de 30 días | Gestionar devolución o descuento |

## El control manual no escala

Con cientos de presentaciones y múltiples lotes, llevar las caducidades en un cuaderno es inviable. Necesitás un sistema que registre el lote y te avise. Es el corazón de [administrar una farmacia](/blog/como-administrar-una-farmacia-nicaragua).

## Nortex te avisa antes de que venza

Nortex controla cada lote con su fecha de caducidad y te alerta de lo próximo a vencer para que actúes a tiempo. Menos pérdidas, más margen.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-administrar-una-pulperia-nicaragua',
        title: 'Cómo administrar una pulpería en Nicaragua y que sea rentable',
        description: 'Control de inventario, manejo de fiado, margen y caja para administrar una pulpería rentable en Nicaragua. Guía práctica para el negocio de barrio.',
        keyword: 'cómo administrar una pulpería Nicaragua',
        cluster: 'Pulperías y Minoristas',
        category: 'Pulperías',
        date: '2026-06-22',
        updated: '2026-06-30',
        readTime: '7 min',
        relatedSlugs: ['flujo-de-caja-pyme-nicaragua', 'como-calcular-margen-de-ganancia-nicaragua', 'regimen-cuota-fija-nicaragua-guia'],
        faq: [
            { q: '¿Cómo controlo el fiado en mi pulpería?', a: 'Anotá cada fiado con cliente, monto y fecha, poné un límite por persona y dale seguimiento. El fiado descontrolado es la causa número uno de que una pulpería se quede sin efectivo para reponer.' },
            { q: '¿Una pulpería paga impuestos?', a: 'Muchas pulperías tributan bajo el régimen de Cuota Fija de la DGI, que es un pago mensual fijo. Confirmá tu situación y los topes vigentes con tu contador o en la DGI.' },
        ],
        content: `
La pulpería es el negocio más común de Nicaragua y, también, uno donde es fácil "trabajar para nada". El secreto de una pulpería rentable está en tres cosas: inventario, fiado y caja. Te lo explicamos.

## El problema de la pulpería

Vende todo el día, mueve efectivo… y a fin de mes no queda plata. ¿Por qué? Casi siempre por tres fugas: **no saber el margen**, **fiar sin control** y **mezclar la caja con el bolsillo**.

## 1. Conocé tu margen

Comprar a C$10 y vender a C$12 deja poco, y a veces ni eso después de la merma. Conocé el [margen](/blog/como-calcular-margen-de-ganancia-nicaragua) de tus productos clave. Productos de alta rotación con bajo margen (gaseosas, pan) se compensan con otros de mejor margen.

## 2. Controlá el fiado

El fiado es parte de la cultura del barrio, pero descontrolado **quiebra**. Reglas mínimas:

- Anotá **cada fiado**: cliente, monto, fecha.
- Poné un **límite** por cliente.
- Cobrá con constancia.

El fiado es efectivo tuyo en la calle. Mientras más fiás sin cobrar, menos podés reponer.

## 3. Separá la caja de tu bolsillo

Sacar plata de la caja "para el gasto" sin anotar es la fuga invisible. Definí tu **sueldo** y respetalo. Cuidá tu [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua).

## 4. Reponé lo que rota

No llenés el estante de lo que no se vende. Mirá qué sale rápido y reponé eso. El inventario parado es plata dormida.

## Impuestos: Cuota Fija

Muchas pulperías tributan bajo el [régimen de Cuota Fija](/blog/regimen-cuota-fija-nicaragua-guia), un pago mensual fijo. Confirmá tu situación con tu contador o en la DGI.

## Nortex ordena tu pulpería

Nortex controla tu inventario, registra el fiado por cliente y te muestra la caja real. Sabés qué te deja plata y qué no, sin cuadernos.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-gestionar-prestamos-microfinanzas-nicaragua',
        title: 'Cómo gestionar préstamos y cartera en Nicaragua',
        description: 'Cómo otorgar préstamos, calcular intereses, controlar la cartera y manejar la mora para prestamistas y microfinancieras en Nicaragua. Guía práctica.',
        keyword: 'cómo gestionar préstamos microfinanzas Nicaragua',
        cluster: 'Préstamos y Microfinanzas',
        category: 'Préstamos',
        date: '2026-06-25',
        updated: '2026-06-30',
        readTime: '8 min',
        relatedSlugs: ['gestion-de-cobranza-cuentas-por-cobrar', 'flujo-de-caja-pyme-nicaragua', 'como-cobrar-cuentas-morosas-nicaragua'],
        faq: [
            { q: '¿Cómo controlo la mora de mi cartera de préstamos?', a: 'Con un control de cartera que clasifique los créditos por días de atraso y un seguimiento de cobranza ordenado. La mora se gestiona temprano: mientras más rápido contactás al cliente atrasado, más recuperás.' },
            { q: '¿Qué tasa de interés puedo cobrar?', a: 'Las tasas y el marco aplicable a quienes prestan dinero están regulados en Nicaragua. Antes de fijar tasas y comisiones, confirmá el marco legal vigente con un asesor legal o financiero para operar en regla.' },
        ],
        content: `
Prestar dinero es un negocio de cartera y de cobranza. Ganás si la plata vuelve con su interés, y perdés si la mora se te descontrola. Esta guía ordena cómo gestionar préstamos sin perder el control.

## El negocio es la cartera

Tu activo no es el efectivo que tenés en mano: es la **cartera de préstamos** colocada. Gestionarla bien significa saber, en todo momento, **cuánto colocaste, cuánto te deben y cuánto está atrasado**.

## Otorgar con criterio

Antes de prestar, evaluá:

- La **capacidad de pago** del cliente.
- Su **historial** (si es cliente recurrente).
- El **monto y plazo** adecuados a su flujo.

Prestar de más, a quien no puede pagar, no es un favor: es una pérdida futura.

## Intereses y marco legal

El interés es tu ingreso, pero **las tasas y el marco para quienes prestan dinero están regulados en Nicaragua**.

> No fijés tasas, comisiones ni cargos sin confirmar el marco legal vigente con un asesor legal o financiero. Operar fuera de la norma trae riesgos serios.

## Controlá la mora desde el día uno

La mora se gestiona **temprano**. Clasificá tu cartera por días de atraso y actuá rápido:

| Estado de la cuota | Días de atraso | Acción |
| --- | --- | --- |
| Al día | 0 | Seguimiento normal |
| Atraso temprano | 1-15 | Recordatorio / contacto |
| Mora | 16-60 | Gestión activa de cobro |
| Mora alta | 60+ | Escalamiento |

La técnica de cobro es la misma que en cualquier cartera: ver [cómo cobrar cuentas morosas](/blog/como-cobrar-cuentas-morosas-nicaragua).

## Cartera y flujo de caja

Cada cuota que entra es el combustible para volver a prestar. Si la cobranza se atrasa, tu [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua) se seca y no podés colocar. Cobranza y colocación van de la mano.

## Nortex gestiona tu cartera de préstamos

Nortex controla tus créditos, calcula cuotas, clasifica la cartera por atraso y te ayuda con el seguimiento de cobranza. Tené tu cartera bajo control.

[Probá Nortex gratis 30 días →](/register)
`,
    },
];
