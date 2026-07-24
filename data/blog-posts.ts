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
    /** Si está presente, la guía renderiza una calculadora interactiva (SEO + captación). */
    calculator?: 'aguinaldo' | 'vacaciones' | 'horasExtras' | 'inss' | 'liquidacion' | 'iva';
    /** Pasos para el JSON-LD HowTo (guías "cómo calcular"). ≥ 2 pasos. */
    howToSteps?: { name: string; text: string }[];
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
            { q: '¿Qué aporta el patrono además del salario?', a: 'Sobre el salario bruto el empleador aporta INSS patronal (21.5% si tiene menos de 50 trabajadores; 22.5% si tiene 50 o más) e INATEC (2%). Por eso el costo real de un trabajador es mayor que su salario base.' },
            { q: '¿El aguinaldo paga INSS o IR?', a: 'El décimo tercer mes (aguinaldo) está exento de IR y no genera cotización al INSS cuando equivale a un mes de salario o menos, según el Código del Trabajo. Confirmá casos especiales con tu contador.' },
        ],
        content: `
Calcular bien la nómina es una de las obligaciones más importantes de cualquier negocio en Nicaragua. El Código del Trabajo (Ley 185) y la Ley de Seguridad Social fijan los mínimos que todo empleador debe cumplir. Esta guía te lleva paso a paso, con ejemplos.

## 1. Componentes del salario bruto

El salario bruto de un trabajador incluye:

- Salario base acordado en el contrato
- Horas extra (se pagan al doble: 100% de recargo, Art. 62 de la Ley 185)
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

- **INSS patronal: 21.5%** para empleadores con menos de 50 trabajadores (**22.5%** con 50 o más)
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

- **Vacaciones:** 15 días de descanso por cada 6 meses de trabajo continuo (Art. 76) — se acumulan 2.5 días por mes, 30 días al año.
- **Décimo tercer mes (aguinaldo):** equivale a un mes de salario por año completo; se acumula 1/12 por mes. Se paga en los primeros diez días de diciembre (Art. 93).
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
            { q: '¿Cuántos días de vacaciones corresponden por ley?', a: 'El Código del Trabajo (Art. 76) reconoce 15 días de descanso con goce de salario por cada 6 meses de trabajo continuo — es decir, 2.5 días por mes, 30 días al año.' },
            { q: '¿El aguinaldo es obligatorio?', a: 'Sí. El décimo tercer mes equivale a un mes de salario por año trabajado (proporcional si es menos) y se paga en los primeros diez días de diciembre (Art. 93). Es un derecho irrenunciable.' },
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

Corresponden **15 días** de descanso con goce de salario por cada **6 meses** de trabajo continuo (Art. 76) — es decir, **2.5 días por mes**, 30 días al año. Si el trabajador sale antes, se le pagan las vacaciones proporcionales acumuladas.

> Valor de un día de vacaciones = salario mensual ÷ 30.

## Décimo tercer mes (aguinaldo)

Equivale a **un mes de salario por año** trabajado, proporcional si es menos. Se paga en los **primeros diez días de diciembre** (Art. 93) y está exento de IR e INSS cuando equivale a un mes o menos. Te lo explicamos paso a paso en la [guía del aguinaldo](/blog/como-calcular-aguinaldo-nicaragua).

## Indemnización por antigüedad (Art. 45)

Cuando termina la relación por ciertas causas, corresponde indemnización: como referencia, hasta un mes de salario por cada uno de los primeros tres años y veinte días por año a partir del cuarto, con un tope. El detalle y los casos están en la [guía de indemnización](/blog/como-calcular-indemnizacion-laboral-nicaragua).

## Horas extra, séptimo día y feriados

- **Horas extra:** se pagan al doble de la hora ordinaria — 100% de recargo (Art. 62).
- **Séptimo día:** el descanso semanal es remunerado.
- **Feriados nacionales:** son de descanso obligatorio con goce de salario; si se trabajan, se pagan con recargo adicional (Art. 68).

## Cuánto cuesta realmente un trabajador

El salario base es solo una parte. Sumá INSS patronal, INATEC y la provisión de prestaciones para conocer el costo real. Lo desglosamos en la [guía para calcular la nómina](/blog/como-calcular-nomina-nicaragua-2026).

| Concepto | Cómo se acumula |
| --- | --- |
| Vacaciones | 2.5 días por mes (Art. 76) |
| Aguinaldo | 1/12 de salario por mes |
| INSS patronal | 21.5% del salario (22.5% con 50+ trabajadores) |
| INATEC | 2% del salario |

## Nortex calcula las prestaciones por vos

Nortex acumula vacaciones y aguinaldo mes a mes, calcula horas extra y arma la liquidación final sin que tengás que sacar la calculadora. Menos errores, menos reclamos.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-calcular-inss-nicaragua',
        title: 'Cómo calcular el INSS en Nicaragua 2026 (con calculadora)',
        description: 'Calculá el INSS laboral (7%) y patronal en Nicaragua con la calculadora gratis. Qué descuenta el trabajador, qué aporta el patrono y cómo enterarlo.',
        keyword: 'cómo calcular INSS Nicaragua',
        calculator: 'inss',
        howToSteps: [
            { name: 'Tomá el salario bruto', text: 'Partí del salario bruto mensual del trabajador (incluye comisiones y horas extra).' },
            { name: 'INSS laboral (7%)', text: 'Aplicá el 7% sobre el salario, hasta el techo cotizable vigente: es la deducción que paga el trabajador.' },
            { name: 'INSS patronal', text: 'Aplicá la tasa patronal (22.5% con 50 o más empleados, 21.5% con menos) sobre la misma base: es el aporte de la empresa.' },
            { name: 'INATEC (2%)', text: 'Sumá el 2% de INATEC sobre el total como costo adicional del empleador.' },
        ],
        cluster: 'Nómina y Planillas',
        category: 'Recursos Humanos',
        date: '2026-05-02',
        readTime: '5 min',
        relatedSlugs: ['como-calcular-nomina-nicaragua-2026', 'como-calcular-aguinaldo-nicaragua'],
        faq: [
            { q: '¿Cuánto es el INSS laboral?', a: 'El INSS laboral es el 7% del salario bruto y se le descuenta directamente al trabajador en la planilla.' },
            { q: '¿Cuánto aporta el patrono al INSS?', a: 'El INSS patronal es el 21.5% del salario bruto para empleadores con menos de 50 trabajadores, y 22.5% para los de 50 o más, según la reforma de la Ley de Seguridad Social.' },
        ],
        content: `
El INSS es uno de los descuentos y aportes obligatorios de toda planilla en Nicaragua. Calcularlo bien evita diferencias y multas. Acá te lo explicamos simple.

## Dos partes: laboral y patronal

El INSS tiene dos componentes que se calculan sobre el **salario bruto**:

- **INSS laboral (7%):** se le **descuenta al trabajador**.
- **INSS patronal:** lo **paga la empresa** además del salario — **21.5%** con menos de 50 trabajadores, **22.5%** con 50 o más.

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
        title: 'Cómo calcular el aguinaldo en Nicaragua 2026 (con calculadora)',
        description: 'Calculá el aguinaldo o décimo tercer mes en Nicaragua con la calculadora gratis. Fórmula para año completo y proporcional, cuándo se paga y si paga impuestos.',
        keyword: 'cómo calcular aguinaldo Nicaragua',
        calculator: 'aguinaldo',
        howToSteps: [
            { name: 'Tomá el salario mensual', text: 'Partí del salario mensual ordinario del trabajador.' },
            { name: 'Dividí entre 12', text: 'Dividí el salario mensual entre 12 para obtener el aguinaldo de un mes de trabajo.' },
            { name: 'Multiplicá por los meses', text: 'Multiplicá por los meses trabajados desde el 1 de diciembre anterior.' },
            { name: 'Resultado', text: 'Ese es el aguinaldo proporcional; si trabajó el año completo, equivale a un salario mensual.' },
        ],
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

Se paga en los **primeros diez días de diciembre** (Art. 93). Si la relación termina antes, se liquida la parte proporcional acumulada.

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
        title: 'Cómo calcular la indemnización laboral en Nicaragua 2026 (Art. 45)',
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
    {
        slug: 'constancia-de-retencion-ir-nicaragua',
        title: 'Constancia de retención IR: qué es y cómo emitirla bien',
        description: 'Qué debe llevar una constancia de retención IR en Nicaragua, cuándo entregarla al proveedor y los errores que la invalidan ante la DGI.',
        keyword: 'constancia de retención Nicaragua',
        cluster: 'Impuestos y Retenciones',
        category: 'Fiscal',
        date: '2026-07-01',
        readTime: '5 min',
        relatedSlugs: ['retenciones-ir-nicaragua-2026', 'calendario-tributario-dgi-pyme'],
        faq: [
            { q: '¿Para qué le sirve la constancia al proveedor?', a: 'Es el comprobante de que el impuesto retenido se enteró a su nombre: con ella el proveedor acredita esa retención como anticipo de su IR anual. Sin constancia, el proveedor pierde ese crédito.' },
            { q: '¿Cuándo debo entregarla?', a: 'Al momento de efectuar la retención, junto con el pago. Retener sin entregar constancia es uno de los reclamos más comunes de los proveedores y una observación típica de la DGI.' },
        ],
        content: `
Si tu negocio retiene IR en la fuente, cada retención debe ir acompañada de su constancia. Es un documento pequeño con consecuencias grandes: para tu proveedor es dinero.

## Qué es la constancia de retención

Es el comprobante que el **retenedor** (quien paga y retiene) le entrega al **retenido** (el proveedor) documentando que le retuvo un porcentaje del pago y que lo enterará a la DGI a su nombre. Para el proveedor, esa constancia es un **anticipo de su IR anual**: sin ella, pierde el crédito.

## Qué debe llevar

Como mínimo, una constancia debe identificar:

- **Retenedor:** nombre/razón social y RUC.
- **Retenido:** nombre/razón social y RUC.
- **Fecha** y número de la factura o documento que origina el pago.
- **Base** sobre la que se retuvo (sin IVA).
- **Tasa** aplicada (2%, 5%, 10% según el concepto — ver la [guía de retenciones](/blog/retenciones-ir-nicaragua-2026)).
- **Monto retenido**.

> Confirmá el formato formal vigente con tu contador: la DGI define los requisitos del documento.

## Ejemplo

Pagás C$20,000 por servicios profesionales:

| Dato | Valor |
| --- | --- |
| Base | C$20,000 |
| Tasa (servicios profesionales) | 10% |
| Retenido | C$2,000 |
| Pagado al proveedor | C$18,000 |

La constancia documenta esos C$2,000 que vos enterás a la DGI a nombre del proveedor.

## Errores que la invalidan

1. Calcular la retención **sobre el total con IVA** (siempre sobre la base).
2. No entregarla al momento del pago.
3. RUC o datos del proveedor incorrectos.
4. No cuadrar las constancias emitidas con la declaración del mes.

## Nortex emite las constancias por vos

Cada compra con retención en Nortex genera su constancia con base, tasa y monto correctos, y el reporte mensual queda cuadrado para declarar.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'calendario-tributario-dgi-pyme',
        title: 'Calendario tributario DGI: qué declara una PyME cada mes',
        description: 'Las declaraciones que una PyME en régimen general presenta a la DGI: IVA, retenciones, anticipo IR y la anual. Cómo organizarte sin multas.',
        keyword: 'calendario tributario DGI Nicaragua',
        cluster: 'Impuestos y Retenciones',
        category: 'Fiscal',
        date: '2026-07-02',
        readTime: '6 min',
        relatedSlugs: ['retenciones-ir-nicaragua-2026', 'iva-nicaragua-guia-completa', 'anticipo-ir-pago-minimo-nicaragua'],
        faq: [
            { q: '¿Qué declara cada mes una PyME en régimen general?', a: 'Típicamente el IVA, las retenciones efectuadas y el anticipo de IR del período, a través de la VET. Las fechas límite exactas las fija el calendario de la DGI según tu tipo de contribuyente: confirmalas con tu contador.' },
            { q: '¿Qué pasa si declaro tarde?', a: 'Declarar u pagar fuera de plazo genera multas y recargos, incluso si la declaración va en cero. Por eso conviene tener las cifras cuadradas antes de la fecha límite, no el mismo día.' },
        ],
        content: `
La mayoría de las multas de la DGI no vienen de evadir: vienen de declarar tarde o con cifras descuadradas. Tener claro qué toca cada mes es la defensa más barata.

## Las obligaciones mensuales típicas

Una PyME en **régimen general** normalmente presenta cada mes, por la VET:

- **IVA:** débito menos crédito fiscal del período (ver [guía del IVA](/blog/iva-nicaragua-guia-completa)).
- **Retenciones IR** efectuadas a proveedores (ver [guía de retenciones](/blog/retenciones-ir-nicaragua-2026)).
- **Anticipo IR / pago mínimo** sobre los ingresos del mes (ver [guía del anticipo](/blog/anticipo-ir-pago-minimo-nicaragua)).

> Las fechas límite dependen de tu tipo de contribuyente y las fija el calendario oficial de la DGI. No las asumás: confirmalas en la VET o con tu contador.

## La obligación anual

Además de lo mensual, cada año se presenta la **declaración anual del IR** sobre la renta del período fiscal. Ahí se liquida el impuesto real y se acreditan los anticipos y retenciones que ya pagaste durante el año.

## Cómo organizarte para no correr

1. **Cerrá el mes** en los primeros días: ventas, compras y retenciones cuadradas.
2. Prepará las cifras **antes** de la fecha límite, no el mismo día.
3. Guardá el soporte de cada declaración (la DGI puede pedirlo años después).
4. Si un mes no hubo movimiento, igual suele corresponder **declarar en cero** — no declarar también genera multa.

## El costo de llegar tarde

| Situación | Consecuencia |
| --- | --- |
| Declarar tarde | Multa + recargos |
| Declarar en cero fuera de plazo | Multa igual |
| Cifras descuadradas | Observaciones y posibles reparos |

## Nortex te deja las cifras listas

Con Nortex, el IVA, las retenciones y los ingresos del mes salen cuadrados del propio sistema: llegás a la VET con los números listos, no con una caja de facturas por sumar.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'anticipo-ir-pago-minimo-nicaragua',
        title: 'Anticipo IR y pago mínimo definitivo en Nicaragua: cómo funcionan',
        description: 'Qué es el anticipo mensual del IR y el pago mínimo definitivo en Nicaragua, sobre qué se calculan y cómo se acreditan en la declaración anual.',
        keyword: 'anticipo IR pago mínimo definitivo Nicaragua',
        cluster: 'Impuestos y Retenciones',
        category: 'Fiscal',
        date: '2026-07-03',
        readTime: '6 min',
        relatedSlugs: ['calendario-tributario-dgi-pyme', 'retenciones-ir-nicaragua-2026', 'contabilidad-basica-pyme-nicaragua'],
        faq: [
            { q: '¿Sobre qué se calcula el anticipo mensual de IR?', a: 'Sobre los ingresos brutos del mes. La tasa aplicable depende de tu clasificación como contribuyente según la normativa vigente: confirmá la que te corresponde con tu contador antes de declarar.' },
            { q: '¿El anticipo es un impuesto adicional?', a: 'No: es un adelanto del IR anual. Al presentar la declaración anual, los anticipos y retenciones que pagaste durante el año se acreditan contra el impuesto que resulte.' },
        ],
        content: `
Cada mes, además del IVA, una PyME en régimen general adelanta una parte de su IR anual. Ese adelanto es el anticipo — y entenderlo evita el susto de "¿por qué pago IR si aún no cierro el año?".

## Qué es el anticipo IR

Es un **pago mensual a cuenta del IR anual**, calculado sobre los **ingresos brutos** del mes. No es un impuesto aparte: es el mismo IR anual pagado en cuotas adelantadas.

## Qué es el pago mínimo definitivo

La ley establece un **piso** de tributación sobre los ingresos brutos del año: aunque tu utilidad sea baja o nula, hay un mínimo que se compara contra el IR calculado sobre la utilidad, y se paga **el mayor** de los dos.

> Las tasas del anticipo y del pago mínimo dependen de tu clasificación como contribuyente y han cambiado con las reformas fiscales. No uses cifras de memoria: confirmá la tasa que te aplica con tu contador o en la DGI.

## Cómo se acredita todo al final del año

En la declaración anual del IR se hace la cuenta completa:

1. Se calcula el IR sobre la **utilidad** del año.
2. Se compara contra el **pago mínimo** sobre ingresos brutos.
3. Del mayor de los dos, se **restan** los anticipos pagados y las retenciones que te hicieron (ver [constancias de retención](/blog/constancia-de-retencion-ir-nicaragua)).
4. El resultado es saldo a pagar o saldo a favor.

## Por qué importa llevar bien los ingresos

Como el anticipo se calcula sobre ingresos brutos, subdeclarar ingresos un mes no "ahorra": descuadra tu anual y te expone a reparos. Y sobredeclarar te hace adelantar de más. La base de todo es un [registro contable ordenado](/blog/contabilidad-basica-pyme-nicaragua).

## Nortex te da los ingresos del mes en un clic

Nortex acumula tus ingresos facturados del período, listos para calcular el anticipo con tu contador, y guarda el historial completo para la declaración anual.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'exenciones-iva-tasa-cero-nicaragua',
        title: 'Exenciones de IVA y tasa cero en Nicaragua: la diferencia importa',
        description: 'Qué significa que un producto esté exento de IVA o gravado con tasa 0% en Nicaragua, y cómo afecta tu crédito fiscal. Guía para PyMES.',
        keyword: 'exenciones IVA Nicaragua',
        cluster: 'IVA',
        category: 'Fiscal',
        date: '2026-07-01',
        readTime: '5 min',
        relatedSlugs: ['iva-nicaragua-guia-completa', 'credito-fiscal-iva-nicaragua'],
        faq: [
            { q: '¿Exento y tasa cero es lo mismo?', a: 'No. En ambos casos el cliente no paga IVA, pero en tasa cero la operación está gravada (al 0%) y da derecho a acreditar el IVA de las compras asociadas; en exento no hay ese derecho pleno. La diferencia se siente en tu crédito fiscal.' },
            { q: '¿Cómo sé si mi producto está exento?', a: 'La ley define listas de bienes y servicios exentos (por ejemplo, ciertos productos de la canasta básica y medicamentos). Como las listas se actualizan, confirmá el tratamiento de tu producto específico con tu contador o en la DGI.' },
        ],
        content: `
"Este producto no lleva IVA" puede significar dos cosas distintas — y la diferencia afecta directamente cuánto crédito fiscal podés usar.

## Exento vs. tasa cero

En los dos casos el cliente no paga IVA en la factura, pero tributariamente no son lo mismo:

| Tratamiento | ¿La operación está gravada? | ¿Da crédito fiscal por las compras? |
| --- | --- | --- |
| **Tasa 0%** | Sí, al 0% | Sí |
| **Exento** | No | No pleno |

- **Tasa cero:** la operación está dentro del IVA pero con tasa 0% (típico de ciertas **exportaciones**). Como está gravada, mantiene el derecho a acreditar el IVA de las compras asociadas.
- **Exento:** la operación está **fuera** del impuesto. El IVA que pagaste en las compras asociadas no se acredita igual: tiende a volverse costo.

## Qué suele estar exento

La ley exime ciertos bienes y servicios — por ejemplo, productos de la **canasta básica** y **medicamentos**, entre otros.

> Las listas y condiciones se actualizan. Antes de vender un producto sin IVA, confirmá su tratamiento exacto con tu contador o en la DGI: facturar mal una exención es un error caro en ambas direcciones.

## Por qué te importa como comerciante

1. Si vendés productos exentos junto a gravados (una pulpería, una farmacia), tu **crédito fiscal** se prorratea: no todo el IVA de tus compras es acreditable.
2. Cobrar IVA sobre algo exento es cobrarle de más al cliente; no cobrarlo sobre algo gravado es asumir el impuesto de tu bolsillo.
3. Tu sistema debe distinguir productos **gravados y exentos** por artículo, no por venta. Repasá la [guía del IVA](/blog/iva-nicaragua-guia-completa) y el [crédito fiscal](/blog/credito-fiscal-iva-nicaragua).

## Nortex distingue gravado y exento por producto

En Nortex cada producto se configura como gravado o exento: la factura desglosa bien el IVA y el reporte mensual separa las bases automáticamente.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-declarar-iva-vet-nicaragua',
        title: 'Cómo declarar el IVA en la VET: guía paso a paso',
        description: 'Los pasos para preparar y presentar tu declaración mensual de IVA en la Ventanilla Electrónica Tributaria (VET) de la DGI sin errores.',
        keyword: 'cómo declarar IVA VET Nicaragua',
        cluster: 'IVA',
        category: 'Fiscal',
        date: '2026-07-04',
        readTime: '6 min',
        relatedSlugs: ['iva-nicaragua-guia-completa', 'credito-fiscal-iva-nicaragua', 'calendario-tributario-dgi-pyme'],
        faq: [
            { q: '¿Qué necesito antes de entrar a la VET?', a: 'El total de ventas gravadas y exentas del mes, el IVA cobrado (débito), el IVA pagado en compras (crédito fiscal) y las retenciones del período, todos cuadrados contra tus facturas. La VET es solo el último paso: el trabajo real es tener esas cifras bien.' },
            { q: '¿Debo declarar si no tuve movimiento?', a: 'Sí: en general corresponde presentar la declaración en cero dentro del plazo. No presentar, aunque no haya movimiento, genera multa.' },
        ],
        content: `
Declarar el IVA no empieza en la VET: empieza en tus registros. Si llegás al portal con las cifras cuadradas, la declaración toma minutos. Esta es la ruta.

## Paso 0: cuadrá el mes

Antes de entrar al portal necesitás cuatro números del período:

1. **Ventas gravadas** (base) y su **IVA cobrado** (débito fiscal).
2. **Ventas exentas**, si las hay (ver [exenciones](/blog/exenciones-iva-tasa-cero-nicaragua)).
3. **Compras gravadas** y su **IVA pagado** ([crédito fiscal](/blog/credito-fiscal-iva-nicaragua)).
4. **Retenciones** de IVA que te hicieron, si aplican.

Todo debe cuadrar contra tus facturas emitidas y recibidas — la DGI puede cruzar la información con tus clientes y proveedores.

## Paso 1: entrá a la VET

La **Ventanilla Electrónica Tributaria** es el portal de la DGI donde se presentan las declaraciones. Ingresás con tu usuario de contribuyente.

## Paso 2: llenā la declaración del período

Seleccioná el impuesto (IVA) y el período. Cargá las bases y los montos: débito, crédito, retenciones. El sistema calcula el saldo:

> IVA a pagar = IVA cobrado − crédito fiscal − retenciones acreditables.

Si el crédito supera al débito, queda **saldo a favor** que se arrastra al período siguiente.

## Paso 3: presentá y pagá dentro del plazo

Presentar la declaración y pagar son dos actos: ambos tienen fecha límite según el [calendario tributario](/blog/calendario-tributario-dgi-pyme). Guardá el comprobante de presentación y el de pago.

## Errores comunes

- Declarar el crédito fiscal de compras **sin factura formal** (la DGI lo rechaza).
- Olvidar las ventas exentas (descuadra la base).
- Dejar la declaración para el último día y encontrarse el portal saturado.
- No declarar un mes "sin movimiento".

## Nortex te entrega el mes cuadrado

El reporte de IVA de Nortex trae débito, crédito y bases separadas por gravado/exento, directo de tus facturas. Llegás a la VET a transcribir, no a calcular.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'notas-de-credito-debito-nicaragua',
        title: 'Notas de crédito y débito: cómo corregir una factura en regla',
        description: 'Cuándo usar una nota de crédito o de débito en Nicaragua, cómo afectan el IVA y por qué nunca debés borrar o alterar una factura emitida.',
        keyword: 'nota de crédito Nicaragua',
        cluster: 'Facturación DGI',
        category: 'Facturación',
        date: '2026-07-02',
        readTime: '5 min',
        relatedSlugs: ['facturacion-dgi-nicaragua-guia', 'series-de-facturacion-dgi-nicaragua'],
        faq: [
            { q: '¿Cuándo uso nota de crédito y cuándo de débito?', a: 'Nota de crédito cuando el valor de la factura debe bajar (devolución, descuento posterior, error a favor del cliente). Nota de débito cuando debe subir (cargo omitido, interés pactado). La factura original nunca se altera.' },
            { q: '¿La nota de crédito afecta el IVA?', a: 'Sí: ajusta la base y el IVA de la operación original. Una devolución documentada con nota de crédito reduce tu débito fiscal del período en que se emite.' },
        ],
        content: `
Una factura emitida es un documento fiscal: no se borra, no se edita, no se "desaparece". Cuando algo cambia después de facturar, la herramienta correcta es la nota de crédito o de débito.

## La regla: la factura original no se toca

Alterar o eliminar una factura emitida rompe la correlatividad de tu [serie](/blog/series-de-facturacion-dgi-nicaragua) y descuadra tu declaración — dos señales de alerta clásicas para la DGI. Toda corrección posterior se documenta con un comprobante nuevo que **referencia** a la factura original.

## Nota de crédito: cuando el valor baja

Se emite cuando la operación queda en **menos** que lo facturado:

- Devolución total o parcial de mercadería.
- Descuento o rebaja concedida después de facturar.
- Error de precio o cantidad a favor del cliente.

**Efecto en el IVA:** reduce la base y el débito fiscal. Si facturaste C$11,500 (C$10,000 + IVA) y el cliente devuelve la mitad, la nota de crédito por C$5,750 baja tu IVA cobrado en C$750.

## Nota de débito: cuando el valor sube

Se emite cuando corresponde **cobrar más** sobre una operación ya facturada:

- Un cargo omitido (flete, instalación).
- Intereses pactados por pago tardío.
- Error de precio en contra tuya.

## Qué debe llevar cada nota

| Dato | Por qué |
| --- | --- |
| Referencia a la factura original | Vincula el ajuste a la operación |
| Motivo del ajuste | Soporta la corrección ante la DGI |
| Base e IVA del ajuste | Cuadra la declaración del período |
| Su propia numeración correlativa | Es un comprobante fiscal más |

## Nortex emite las notas vinculadas a la factura

En Nortex, la nota de crédito o débito se genera desde la factura original: hereda la referencia, ajusta el IVA y el inventario (si hay devolución), y todo queda cuadrado para el mes.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-inscribirse-dgi-ruc-nicaragua',
        title: 'Cómo inscribirse en la DGI y sacar el RUC en Nicaragua 2026',
        description: 'Los pasos para formalizar tu negocio en Nicaragua: inscripción en la DGI, obtención del RUC, elección de régimen y qué sigue después.',
        keyword: 'cómo sacar el RUC Nicaragua',
        cluster: 'Facturación DGI',
        category: 'Facturación',
        date: '2026-07-05',
        readTime: '6 min',
        relatedSlugs: ['regimen-cuota-fija-nicaragua-guia', 'facturacion-dgi-nicaragua-guia', 'cuota-fija-vs-regimen-general'],
        faq: [
            { q: '¿Qué es el RUC?', a: 'El Registro Único del Contribuyente: el número que te identifica ante la DGI para declarar, facturar y pagar impuestos. Sin RUC no podés emitir facturas formales ni operar en regla.' },
            { q: '¿Qué régimen elijo al inscribirme?', a: 'Depende del tamaño del negocio: los pequeños suelen calificar para Cuota Fija y los demás van al régimen general. La elección tiene consecuencias en lo que declarás cada mes — leé la comparación y confirmá con un contador.' },
        ],
        content: `
Formalizarte no es solo "pagar impuestos": es poder facturar a clientes formales, acceder a crédito y crecer sin miedo a una multa. El primer paso es el RUC.

## Qué es el RUC y por qué lo necesitás

El **Registro Único del Contribuyente (RUC)** es tu identidad fiscal ante la DGI. Lo necesitás para:

- Emitir **facturas formales** (los clientes empresariales lo exigen).
- Declarar y pagar impuestos.
- Abrir cuentas bancarias empresariales y acceder a financiamiento formal.

## Los pasos generales

1. **Reuní tus documentos:** identificación (cédula), y según el caso, documentos del local y de la actividad. Para personas jurídicas, la documentación de constitución.
2. **Presentate a la administración de rentas** de la DGI que corresponde a tu domicilio (o usá los canales en línea disponibles).
3. **Elegí tu régimen:** [Cuota Fija](/blog/regimen-cuota-fija-nicaragua-guia) si calificás como pequeño contribuyente, o régimen general. Compará antes en [Cuota Fija vs. régimen general](/blog/cuota-fija-vs-regimen-general).
4. **Recibí tu RUC** y tu usuario para los servicios en línea.

> Los requisitos documentales exactos varían según tu situación (persona natural o jurídica, actividad, municipio). Confirmá la lista vigente en la DGI o con un contador antes de ir, para no hacer dos viajes.

## Después del RUC: alcaldía y demás

La DGI no es el único registro. Según tu actividad y municipio, también corresponde la **matrícula municipal** en la alcaldía y, si tenés empleados, la inscripción como **empleador en el INSS**. Cada registro tiene sus propias obligaciones.

## Lo que cambia al estar inscrito

Desde que tenés RUC, tenés **obligaciones periódicas**: declarar en los plazos (aunque sea en cero) y mantener tus datos actualizados. Inscribirse y olvidarse es la receta para acumular multas silenciosas.

## Nortex te acompaña desde el día uno

Formalizaste y ahora hay que facturar en regla: Nortex emite tus facturas con RUC y series correctas, y te deja los números listos para cada declaración. Ver la [guía de facturación DGI](/blog/facturacion-dgi-nicaragua-guia).

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'cuota-fija-vs-regimen-general',
        title: 'Cuota Fija vs. régimen general: cuál le conviene a tu negocio',
        description: 'Comparación práctica entre el régimen de Cuota Fija y el régimen general de la DGI: obligaciones, costos administrativos y cuándo cambiarte.',
        keyword: 'cuota fija vs régimen general Nicaragua',
        cluster: 'Régimen de Cuota Fija',
        category: 'Fiscal',
        date: '2026-07-06',
        readTime: '6 min',
        relatedSlugs: ['regimen-cuota-fija-nicaragua-guia', 'como-inscribirse-dgi-ruc-nicaragua', 'iva-nicaragua-guia-completa'],
        faq: [
            { q: '¿Puedo pasarme de Cuota Fija al régimen general cuando quiera?', a: 'El traslado procede cuando lo solicitás o cuando dejás de calificar (por superar los topes). El cambio implica nuevas obligaciones desde el traslado: IVA, retenciones y anticipos. Planificalo con tu contador, no lo improvises.' },
            { q: '¿En Cuota Fija puedo facturar a empresas grandes?', a: 'Podés emitir el comprobante que tu régimen permite, pero muchas empresas formales necesitan factura con IVA desglosado para su crédito fiscal, y por eso prefieren proveedores del régimen general. Si tu meta son clientes corporativos, ese es un factor de peso.' },
        ],
        content: `
No hay un régimen "mejor": hay uno que le queda a tu tamaño y a tus clientes. Esta comparación te ayuda a decidir con cabeza fría.

## La comparación de frente

| Aspecto | Cuota Fija | Régimen general |
| --- | --- | --- |
| Pago | Cuota mensual fija por tramo | IVA + anticipo IR + retenciones según movimiento |
| Declaraciones mensuales | Mínimas | IVA, retenciones, anticipo (VET) |
| Contabilidad exigida | Básica | Formal |
| Factura con IVA para clientes | Limitada | Sí |
| Crédito fiscal por compras | No | Sí |
| Apto para | Negocio pequeño de barrio | Negocio en crecimiento / clientes formales |

## Cuándo la Cuota Fija gana

- Tu clientela es **consumidor final** (no pide factura con IVA).
- Tus ingresos e inventario están **bajo los topes** del régimen (ver la [guía de Cuota Fija](/blog/regimen-cuota-fija-nicaragua-guia); confirmá los montos vigentes con tu contador).
- No querés carga administrativa: una cuota al mes y listo.

## Cuándo conviene el régimen general

- Vendés a **empresas formales** que necesitan IVA desglosado para su crédito fiscal.
- Tus **compras** llevan mucho IVA que hoy no acreditás (en general, ese IVA es costo puro para vos).
- Estás **cerca de los topes** — mejor migrar planificado que forzado.

## El error clásico: quedarse por inercia

Muchos negocios crecen y siguen en Cuota Fija "porque es más fácil", perdiendo clientes corporativos y crédito fiscal. Otros saltan al general sin estar listos y se ahogan en declaraciones. La decisión se toma con números: ingresos, IVA de compras y perfil de clientes.

> El traslado de régimen tiene efectos desde la fecha del cambio (nuevas obligaciones mensuales). Hacelo acompañado de un contador.

## Nortex sirve en los dos regímenes

En Cuota Fija, Nortex te ordena ventas e inventario. En régimen general, además te cuadra el [IVA](/blog/iva-nicaragua-guia-completa) y las retenciones. Y si migrás, tu historial ya está en el sistema.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-calcular-horas-extras-nicaragua',
        title: 'Cómo calcular las horas extras en Nicaragua 2026 (con ejemplos)',
        description: 'Las horas extras en Nicaragua se pagan al doble (100% de recargo, Art. 62 Ley 185). Fórmula, límites legales y ejemplos paso a paso.',
        keyword: 'cómo calcular horas extras Nicaragua',
        cluster: 'Nómina y Planillas',
        category: 'Recursos Humanos',
        date: '2026-07-01',
        readTime: '5 min',
        relatedSlugs: ['como-calcular-nomina-nicaragua-2026', 'como-calcular-inss-nicaragua'],
        faq: [
            { q: '¿Cuánto se paga la hora extra en Nicaragua?', a: 'Toda hora extra se paga al doble de la hora ordinaria: un 100% de recargo, según el Art. 62 del Código del Trabajo. Aplica también a las horas trabajadas en el día de descanso o compensatorio.' },
            { q: '¿Cuántas horas extras se pueden trabajar por ley?', a: 'El Art. 58 del Código del Trabajo limita la jornada extraordinaria a un máximo de 3 horas diarias y 9 semanales. No puede usarse como esquema permanente.' },
            { q: '¿Las horas extras pagan INSS e IR?', a: 'Sí: forman parte del salario bruto del período, así que entran en la base del INSS laboral y del IR salarial como cualquier otro ingreso ordinario.' },
        ],
        content: `
Las horas extras mal pagadas son una fuente clásica de reclamos laborales — y de multas del MITRAB. La fórmula es simple si partís del valor correcto de la hora ordinaria.

## Primero: el valor de la hora ordinaria

> Hora ordinaria = salario mensual ÷ 30 días ÷ 8 horas = salario ÷ 240.

Para un salario de C$12,000: la hora ordinaria vale 12,000 ÷ 240 = **C$50**.

## El recargo que manda la ley: 100%

Según el **Art. 62** del Código del Trabajo (Ley 185), las horas extraordinarias — y las trabajadas en el día de descanso o compensatorio — se pagan con **un cien por ciento más** que la hora ordinaria:

> Hora extra = hora ordinaria × 2.

No existe la "hora extra al 50%" en Nicaragua: ese esquema es de otros países. Acá toda hora extra vale doble.

## No confundir con el feriado trabajado

El **feriado nacional** es descanso obligatorio **con goce de salario**. Si el trabajador labora un feriado, recibe además el recargo correspondiente (Art. 68) — es un concepto distinto de la hora extra de un día normal, y se calcula sobre el día, no solo la hora.

## Ejemplo completo

Salario C$12,000 (hora ordinaria = C$50). En el mes trabajó 6 horas extras en días hábiles y 4 en su día de descanso:

1. Extras en días hábiles: 6 × 50 × 2 = **C$600**
2. Extras en día de descanso: 4 × 50 × 2 = **C$400**
3. Total extras del mes: **C$1,000**

Ese monto se suma al salario bruto y entra en la base del [INSS](/blog/como-calcular-inss-nicaragua) y del IR salarial.

## Los límites legales

El **Art. 58** limita la jornada extraordinaria a **3 horas diarias y 9 semanales** como máximo. Las extras son para picos de trabajo, no un esquema permanente.

## Reglas prácticas que evitan reclamos

- Registrá las horas extras **por día y por trabajador**, autorizadas por escrito.
- Las extras se pagan en el mismo período en que se trabajaron.
- Respetá los topes del Art. 58: excederlos sistemáticamente es una infracción laboral.

## Nortex calcula las extras con su recargo

Registrás las horas y Nortex aplica el recargo correcto (50% o 100%), las suma a la planilla y actualiza INSS e IR. Ver la [guía completa de nómina](/blog/como-calcular-nomina-nicaragua-2026).

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'ir-salarial-nicaragua-como-calcularlo',
        title: 'IR salarial en Nicaragua: cómo calcularlo paso a paso',
        description: 'Cómo calcular el IR sobre salarios en Nicaragua con la tabla progresiva: base gravable, anualización y ejemplo completo con INSS incluido.',
        keyword: 'IR salarial Nicaragua',
        cluster: 'Nómina y Planillas',
        category: 'Fiscal',
        date: '2026-07-03',
        readTime: '6 min',
        relatedSlugs: ['como-calcular-nomina-nicaragua-2026', 'como-calcular-inss-nicaragua', 'como-calcular-aguinaldo-nicaragua'],
        faq: [
            { q: '¿Desde qué salario se paga IR en Nicaragua?', a: 'La renta anual gravable hasta C$100,000 está exenta. Como la base es el salario menos el INSS laboral, en términos mensuales un salario ronda el umbral cuando su base anualizada supera los C$100,000.' },
            { q: '¿El aguinaldo entra en el cálculo del IR?', a: 'No: el décimo tercer mes está exento de IR cuando equivale a un mes de salario o menos, así que no se suma a la base gravable anual.' },
        ],
        content: `
El IR salarial es el impuesto que el empleador retiene al trabajador y entera a la DGI. El cálculo tiene tres pasos: base, anualización y tabla. Vamos con cada uno.

## Paso 1: la base gravable

La base del IR no es el salario bruto: es el salario **menos el INSS laboral (7%)**.

> Base mensual = salario bruto − INSS laboral.

## Paso 2: anualizá

La tabla del IR es **anual**, así que la base mensual se multiplica por 12 para ubicar el tramo:

> Base anual = base mensual × 12.

## Paso 3: aplicá la tabla progresiva

| Renta anual gravable (C$) | Tasa marginal |
| --- | --- |
| Hasta 100,000 | Exento |
| 100,001 – 200,000 | 15% sobre el exceso de 100,000 |
| 200,001 – 350,000 | 20% sobre el exceso de 200,000 |
| 350,001 – 500,000 | 25% sobre el exceso de 350,000 |
| Más de 500,000 | 30% sobre el exceso de 500,000 |

La tabla es **progresiva por tramos**: cada tasa aplica solo al exceso del tramo, más el impuesto acumulado de los tramos anteriores.

## Ejemplo completo

Salario bruto C$20,000:

1. INSS laboral: 20,000 × 7% = C$1,400.
2. Base mensual: C$18,600 → anual: **C$223,200**.
3. Tramo 200,001–350,000: impuesto = 15,000 (por el tramo de 100k–200k al 15%) + 20% × (223,200 − 200,000) = 15,000 + 4,640 = **C$19,640 anual**.
4. Retención mensual ≈ 19,640 ÷ 12 = **C$1,637**.

El trabajador recibe: 20,000 − 1,400 − 1,637 = **C$16,963**.

## Detalles que cambian el resultado

- El [aguinaldo](/blog/como-calcular-aguinaldo-nicaragua) está exento: no lo sumés a la base.
- Salarios variables (comisiones, [horas extra](/blog/como-calcular-horas-extras-nicaragua)) obligan a recalcular la proyección anual cada mes.
- Si el trabajador entró a mitad de año, la anualización se ajusta al período real.

## Nortex retiene el IR exacto

Nortex anualiza, aplica la tabla por tramos y ajusta cuando el salario varía. La retención sale correcta cada mes, sin hoja de cálculo aparte. Ver la [guía completa de nómina](/blog/como-calcular-nomina-nicaragua-2026).

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-calcular-vacaciones-nicaragua',
        title: 'Cómo calcular las vacaciones en Nicaragua 2026 (con calculadora)',
        description: 'Calculá las vacaciones según el Art. 76 de la Ley 185 con la calculadora gratis: 15 días por semestre (2.5 por mes), con ejemplos de goce y de pago.',
        keyword: 'cómo calcular vacaciones Nicaragua',
        calculator: 'vacaciones',
        howToSteps: [
            { name: 'Contá los meses trabajados', text: 'Contá los meses trabajados desde tu último período de vacaciones gozado.' },
            { name: 'Multiplicá por 2.5', text: 'Multiplicá los meses por 2.5 para los días de vacaciones acumulados (15 por semestre, Art. 76).' },
            { name: 'Salario diario', text: 'Calculá el salario diario dividiendo el salario mensual entre 30.' },
            { name: 'Monto a pagar', text: 'Multiplicá los días por el salario diario para el monto, o gozá los días de descanso.' },
        ],
        cluster: 'Recursos Humanos',
        category: 'Recursos Humanos',
        date: '2026-07-04',
        readTime: '5 min',
        relatedSlugs: ['prestaciones-laborales-nicaragua-guia', 'como-calcular-indemnizacion-laboral-nicaragua', 'como-calcular-nomina-nicaragua-2026'],
        faq: [
            { q: '¿Cuántos días de vacaciones se acumulan por mes?', a: 'Se acumulan 2.5 días por mes trabajado: el Art. 76 del Código del Trabajo reconoce 15 días de descanso remunerado por cada 6 meses de trabajo continuo (30 días al año).' },
            { q: '¿Las vacaciones se pueden pagar en lugar de descansarse?', a: 'La regla general del Código del Trabajo es que las vacaciones se descansan. El pago en efectivo procede en la liquidación final (las acumuladas no gozadas). Evitá hacer del pago la costumbre: confirmá los casos válidos con un asesor laboral.' },
        ],
        content: `
Las vacaciones son de las prestaciones más simples de calcular — y de las más mal llevadas, porque nadie registra cuántos días acumuló cada quien. Acá está la fórmula y cómo llevar el control.

## La regla

El Código del Trabajo (**Art. 76**) reconoce **15 días** de descanso continuo y remunerado por cada **6 meses** de trabajo ininterrumpido — 30 días al año:

> Acumulación = 2.5 días por mes trabajado.

## Cuánto vale un día de vacaciones

> Día de vacaciones = salario mensual ÷ 30.

Para C$15,000 de salario: cada día vale **C$500**.

## Ejemplo 1: goce normal

Trabajador con 8 meses de antigüedad quiere salir de vacaciones:

- Acumulado: 8 × 2.5 = **20 días** disponibles.
- Sale 7 días: se le pagan con normalidad (su salario no se interrumpe) y le quedan 13 acumulados.

## Ejemplo 2: liquidación final

Salario C$15,000, sale del trabajo con 5 meses sin haber gozado vacaciones:

- Acumulado: 5 × 2.5 = 12.5 días.
- Pago: 12.5 × 500 = **C$6,250** en la liquidación.

## Control que evita problemas

- Llevá un **saldo de días** por trabajador: acumulados, gozados, pendientes.
- Programá las vacaciones: acumular años enteros crea pasivos grandes y conflictos.
- En la [liquidación final](/blog/como-calcular-indemnizacion-laboral-nicaragua), las vacaciones pendientes se pagan siempre.

Las vacaciones conviven con el resto de [prestaciones laborales](/blog/prestaciones-laborales-nicaragua-guia): aguinaldo, indemnización y la planilla mensual.

## Nortex lleva el saldo de cada trabajador

Nortex acumula 2.5 días por mes automáticamente, descuenta los días gozados y valora el saldo para la liquidación. Sin cuaderno, sin discusiones.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'contrato-de-trabajo-nicaragua-requisitos',
        title: 'Contrato de trabajo en Nicaragua: qué debe tener para protegerte',
        description: 'Qué debe contener un contrato de trabajo según el Código del Trabajo de Nicaragua, tipos de contrato y errores del empleador que salen caros.',
        keyword: 'contrato de trabajo Nicaragua',
        cluster: 'Recursos Humanos',
        category: 'Recursos Humanos',
        date: '2026-07-05',
        readTime: '6 min',
        relatedSlugs: ['prestaciones-laborales-nicaragua-guia', 'como-calcular-nomina-nicaragua-2026', 'como-calcular-indemnizacion-laboral-nicaragua'],
        faq: [
            { q: '¿Si no hay contrato escrito, no hay relación laboral?', a: 'Al contrario: la relación laboral existe por el hecho de la prestación del trabajo, con o sin papel. Sin contrato escrito, en un conflicto se presume lo que el trabajador alegue razonablemente — el papel protege sobre todo al empleador.' },
            { q: '¿Contrato determinado o indeterminado?', a: 'La regla general es el contrato por tiempo indeterminado; el determinado procede para obras o plazos justificados. Encadenar contratos determinados para evitar antigüedad es una práctica riesgosa que los tribunales suelen reclasificar.' },
        ],
        content: `
El contrato de trabajo no es un trámite: es tu principal defensa en un conflicto laboral. Y el error más caro es no tenerlo por escrito.

## Sin papel también hay relación laboral

En Nicaragua, la relación laboral **existe por el hecho del trabajo**, haya papel o no. Lo que cambia sin contrato escrito es la **prueba**: en un juicio, la falta de documento juega contra el empleador. El contrato escrito te protege a vos.

## Qué debe contener

Como mínimo, el contrato debería fijar:

- **Identificación** de las partes.
- **Puesto y funciones** (lo más concreto posible).
- **Salario**, forma y período de pago.
- **Jornada** y horario.
- **Lugar** de trabajo.
- **Tipo y duración** del contrato.
- **Fecha de inicio**.

> Para cláusulas especiales (confidencialidad, período de prueba, movilidad), asesorate legalmente: una cláusula mal redactada puede ser nula o volverse en tu contra.

## Tipos de contrato

| Tipo | Cuándo procede |
| --- | --- |
| Indeterminado | La regla general |
| Determinado (plazo/obra) | Trabajos con fin previsible y justificado |

Encadenar contratos determinados para "no acumular antigüedad" es una práctica que los tribunales reclasifican como indeterminado — con todas las [prestaciones](/blog/prestaciones-laborales-nicaragua-guia) e [indemnización](/blog/como-calcular-indemnizacion-laboral-nicaragua) acumuladas.

## Lo que el contrato no puede quitar

Ninguna cláusula puede renunciar derechos mínimos del Código del Trabajo: salario mínimo, vacaciones, aguinaldo, INSS. Un contrato que diga lo contrario es nulo en esa parte.

## Del contrato a la planilla

El contrato define el salario; la [planilla](/blog/como-calcular-nomina-nicaragua-2026) lo ejecuta cada mes con sus deducciones y aportes. Que los dos digan lo mismo: pagar distinto de lo pactado es otra fuente clásica de reclamos.

## Nortex conecta contrato y nómina

En Nortex cada empleado tiene su ficha con salario, fecha de ingreso y condiciones — y la planilla se calcula desde esos datos. Coherencia entre lo firmado y lo pagado.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'salario-minimo-nicaragua-como-funciona',
        title: 'Salario mínimo en Nicaragua: cómo funciona y cómo te afecta',
        description: 'Cómo se fija el salario mínimo en Nicaragua, por qué varía por sector económico y qué debe revisar un empleador cuando se ajusta.',
        keyword: 'salario mínimo Nicaragua',
        cluster: 'Nómina y Planillas',
        category: 'Recursos Humanos',
        date: '2026-07-06',
        readTime: '5 min',
        relatedSlugs: ['como-calcular-nomina-nicaragua-2026', 'contrato-de-trabajo-nicaragua-requisitos'],
        faq: [
            { q: '¿Cuánto es el salario mínimo en Nicaragua?', a: 'No hay un único monto: el salario mínimo se fija por sector económico y se ajusta periódicamente por acuerdo de la comisión tripartita (gobierno, empleadores, sindicatos). Consultá la tabla vigente del MITRAB antes de fijar salarios — no uses cifras de memoria.' },
            { q: '¿Qué pasa si pago bajo el mínimo?', a: 'Es una infracción laboral: el trabajador puede reclamar la diferencia retroactiva y el MITRAB puede multar. Además, el mínimo arrastra las prestaciones calculadas sobre el salario.' },
        ],
        content: `
El salario mínimo en Nicaragua no es un número único ni fijo: varía por sector y se ajusta periódicamente. Como empleador, lo que necesitás es saber cómo funciona el mecanismo y cuándo revisar tu planilla.

## Cómo se fija

El salario mínimo lo negocia una **comisión tripartita** (gobierno, empleadores y sindicatos) y se publica por **acuerdo ministerial** del MITRAB. Se define **por sector económico** — agropecuario, industria, comercio, servicios, etc. — así que dos negocios distintos pueden tener mínimos distintos.

> Los montos se ajustan periódicamente. No fijes salarios con cifras de memoria o de años anteriores: consultá la tabla vigente publicada por el MITRAB o confirmala con tu contador.

## Qué te obliga como empleador

1. Ningún salario de tu planilla puede estar **bajo el mínimo** de tu sector.
2. Cuando el mínimo se ajusta, **revisá tu planilla**: los salarios que quedaron bajo el nuevo piso deben subir desde la vigencia del acuerdo.
3. El mínimo arrastra el resto: INSS, [prestaciones](/blog/prestaciones-laborales-nicaragua-guia) y liquidaciones se calculan sobre el salario real, nunca menos que el mínimo.

## El riesgo de ignorarlo

Pagar bajo el mínimo expone a:

- Reclamo del trabajador por la **diferencia retroactiva** (más sus prestaciones recalculadas).
- Multas del MITRAB.
- Un contrato que "pacta" menos del mínimo es **nulo** en esa cláusula (ver [contrato de trabajo](/blog/contrato-de-trabajo-nicaragua-requisitos)).

## Mínimo vs. salario de mercado

El mínimo es el piso legal, no la referencia de mercado. Para retener gente buena, el número que importa es el que paga tu competencia — el mínimo solo te dice desde dónde es legal empezar.

## Nortex te ayuda a mantener la planilla en regla

Con la planilla en Nortex ves todos los salarios de un vistazo y ajustarlos cuando cambia el mínimo toma minutos, con el recálculo de INSS y prestaciones incluido. Ver la [guía de nómina](/blog/como-calcular-nomina-nicaragua-2026).

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'punto-de-equilibrio-negocio-como-calcularlo',
        title: 'Punto de equilibrio: cuánto tenés que vender para no perder',
        description: 'Cómo calcular el punto de equilibrio de tu negocio: costos fijos, margen de contribución y la fórmula, con un ejemplo paso a paso.',
        keyword: 'punto de equilibrio cómo calcularlo',
        cluster: 'Finanzas y Gestión',
        category: 'Finanzas',
        date: '2026-07-02',
        readTime: '6 min',
        relatedSlugs: ['como-calcular-margen-de-ganancia-nicaragua', 'flujo-de-caja-pyme-nicaragua', 'presupuesto-pyme-como-armarlo'],
        faq: [
            { q: '¿Qué es el punto de equilibrio?', a: 'Es el nivel de ventas en el que no ganás ni perdés: los ingresos cubren exactamente los costos fijos y variables. Por debajo perdés plata; por encima, cada venta adicional deja utilidad.' },
            { q: '¿Qué es el margen de contribución?', a: 'Es lo que queda de cada córdoba vendido después de pagar el costo variable de esa venta. Es la parte de la venta que contribuye a cubrir los costos fijos y, después del equilibrio, a generar utilidad.' },
        ],
        content: `
"¿Cuánto tengo que vender al mes para no perder?" es la pregunta más importante que un dueño puede hacerse — y tiene una respuesta exacta: el punto de equilibrio.

## Los tres ingredientes

1. **Costos fijos:** lo que pagás venda o no venda — alquiler, planilla base, luz, internet.
2. **Costos variables:** lo que cuesta cada venta — la mercadería, comisiones.
3. **Margen de contribución:** el porcentaje de cada venta que queda después del costo variable.

> Margen de contribución % = (Precio − Costo variable) ÷ Precio.

Ojo: es pariente del [margen de ganancia](/blog/como-calcular-margen-de-ganancia-nicaragua), calculado sin IVA.

## La fórmula

> Punto de equilibrio (ventas C$) = Costos fijos ÷ Margen de contribución %.

## Ejemplo

Una tienda con costos fijos de C$30,000 al mes y margen de contribución promedio del 25%:

| Dato | Valor |
| --- | --- |
| Costos fijos mensuales | C$30,000 |
| Margen de contribución | 25% |
| **Punto de equilibrio** | 30,000 ÷ 0.25 = **C$120,000/mes** |

Traducido: necesita vender **C$4,000 diarios** (mes de 30 días) solo para empatar. Todo lo que venda por encima deja 25 centavos de cada córdoba como utilidad.

## Para qué usarlo

- **Meta diaria de ventas** con base real, no con optimismo.
- Evaluar un **gasto fijo nuevo** (¿cuánta venta extra exige ese alquiler más caro?).
- Decidir **promociones**: bajar precios baja el margen de contribución y sube el equilibrio.

## El error común

Calcular el equilibrio una vez y olvidarlo. Cambian el alquiler, los precios de tus proveedores o tu mezcla de productos — y tu punto de equilibrio se movió. Revisalo al armar tu [presupuesto](/blog/presupuesto-pyme-como-armarlo) y cuidá el [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua) mientras llegás a él.

## Nortex te da los números del equilibrio

Nortex conoce tus ventas, costos y márgenes reales por producto: los insumos exactos para calcular tu punto de equilibrio con datos, no con estimaciones.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'presupuesto-pyme-como-armarlo',
        title: 'Cómo armar el presupuesto de tu negocio (sin ser contador)',
        description: 'Guía simple para armar un presupuesto mensual de tu PyME: ingresos realistas, gastos fijos y variables, y cómo usarlo de verdad cada mes.',
        keyword: 'presupuesto para PyME',
        cluster: 'Finanzas y Gestión',
        category: 'Finanzas',
        date: '2026-07-05',
        readTime: '6 min',
        relatedSlugs: ['flujo-de-caja-pyme-nicaragua', 'punto-de-equilibrio-negocio-como-calcularlo', 'contabilidad-basica-pyme-nicaragua'],
        faq: [
            { q: '¿Cuál es la diferencia entre presupuesto y flujo de caja?', a: 'El presupuesto es el plan (cuánto esperás vender y gastar); el flujo de caja es la realidad del efectivo entrando y saliendo. El presupuesto se compara cada mes contra lo real para corregir a tiempo.' },
            { q: '¿Cada cuánto reviso el presupuesto?', a: 'Compará presupuesto contra real cada mes. Un presupuesto que no se revisa es una lista de deseos; el valor está en detectar los desvíos y actuar.' },
        ],
        content: `
Un presupuesto no es una hoja para cumplir con el banco: es la herramienta que convierte "espero que el mes salga bien" en un plan con números. Y se arma en una tarde.

## Paso 1: proyectá los ingresos (con los pies en la tierra)

Partí de tus ventas reales de los últimos meses — no de tu mejor mes histórico. Si tenés estacionalidad (diciembre fuerte, septiembre flojo), reflejala. Una proyección inflada arruina todo lo demás.

## Paso 2: listá los gastos fijos

Lo que pagás venda o no venda:

- Alquiler, luz, agua, internet
- Planilla base + INSS patronal + INATEC
- Cuotas de préstamos
- Suscripciones y servicios

## Paso 3: estimá los variables

Los que se mueven con la venta: costo de mercadería (usá tu costo real, ver [margen](/blog/como-calcular-margen-de-ganancia-nicaragua)), comisiones, empaques, fletes. Expresalos como **porcentaje de la venta** para que escalen con la proyección.

## Paso 4: armá el cuadro

| Concepto | Presupuesto (C$) |
| --- | --- |
| Ventas proyectadas | 150,000 |
| Costo variable (65%) | 97,500 |
| Gastos fijos | 35,000 |
| **Utilidad esperada** | **17,500** |

Cruzalo con tu [punto de equilibrio](/blog/punto-de-equilibrio-negocio-como-calcularlo): si la venta proyectada apenas lo roza, el plan necesita ajuste antes de empezar el mes.

## Paso 5: compará contra lo real, cada mes

Acá vive el valor del presupuesto. A fin de mes, poné lo real al lado de lo planeado y preguntá por los desvíos: ¿vendí menos? ¿el costo subió? ¿se coló un gasto? Detectar el desvío en el mes uno es corregible; descubrirlo en diciembre no.

## Presupuesto y efectivo no son lo mismo

Podés cumplir el presupuesto y aun así quedarte sin efectivo si vendés a crédito. El presupuesto planifica utilidad; el [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua) cuida la liquidez. Usá los dos.

## Nortex te da el "real" sin esfuerzo

Con Nortex, las ventas, costos y gastos del mes ya están registrados: comparar presupuesto contra realidad toma minutos, no un fin de semana con la calculadora.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'estado-de-resultados-como-leerlo',
        title: 'Estado de resultados: cómo leerlo para tomar decisiones',
        description: 'Qué es el estado de resultados, cómo se estructura (ventas, costo, gastos, utilidad) y qué preguntas responde sobre tu negocio.',
        keyword: 'estado de resultados cómo leerlo',
        cluster: 'Contabilidad PyME',
        category: 'Contabilidad',
        date: '2026-07-03',
        readTime: '6 min',
        relatedSlugs: ['contabilidad-basica-pyme-nicaragua', 'como-calcular-margen-de-ganancia-nicaragua', 'flujo-de-caja-pyme-nicaragua'],
        faq: [
            { q: '¿Qué diferencia hay entre utilidad bruta y utilidad neta?', a: 'La utilidad bruta es ventas menos el costo de lo vendido; la neta es lo que queda después de restar además los gastos operativos e impuestos. Un negocio puede tener buena utilidad bruta y pésima neta si los gastos se lo comen.' },
            { q: '¿El estado de resultados muestra mi efectivo?', a: 'No: muestra si ganaste o perdiste en el período, no cuánto efectivo tenés. Una venta a crédito suma utilidad hoy aunque el dinero entre el mes que viene. Para el efectivo está el flujo de caja.' },
        ],
        content: `
El estado de resultados es la película del mes: cuánto vendiste, cuánto te costó y cuánto quedó. Leerlo bien responde la pregunta que importa: ¿el negocio gana o solo se mueve?

## La estructura, de arriba hacia abajo

| Línea | Qué es |
| --- | --- |
| Ventas | Todo lo facturado en el período |
| (−) Costo de ventas | Lo que costó la mercadería vendida |
| = **Utilidad bruta** | Lo que dejó la venta en sí |
| (−) Gastos operativos | Alquiler, planilla, luz, transporte |
| = **Utilidad operativa** | Lo que deja operar el negocio |
| (−) Intereses e impuestos | Financiamiento y fisco |
| = **Utilidad neta** | Lo que de verdad quedó |

## Las tres preguntas que responde

**1. ¿Mi margen bruto es sano?** Utilidad bruta ÷ ventas. Si es bajo, el problema está en precios o costo de mercadería (ver [margen de ganancia](/blog/como-calcular-margen-de-ganancia-nicaragua)).

**2. ¿Los gastos se comen la ganancia?** Si la utilidad bruta es buena pero la neta es raquítica, el problema no es vender: son los gastos fijos.

**3. ¿La tendencia mejora o empeora?** Un mes aislado dice poco; tres meses comparados dicen todo. Mirá las líneas como porcentaje de ventas y seguí su evolución.

## Utilidad no es efectivo

La trampa clásica: el estado de resultados dice que ganaste C$20,000, pero la cuenta está vacía. Pasa cuando vendés a crédito o cuando la utilidad se fue a comprar inventario. La utilidad se lee acá; la liquidez, en el [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua). Son dos lentes distintos del mismo negocio ([contabilidad básica](/blog/contabilidad-basica-pyme-nicaragua)).

## Un vicio a evitar

Armar el estado de resultados solo cuando lo pide el banco o la DGI. Es una herramienta de decisión mensual: sin ella, las decisiones de precios, gastos y crecimiento se toman a ciegas.

## Nortex te lo arma solo

Cada venta, compra y gasto registrado en Nortex alimenta tu estado de resultados en tiempo real: margen bruto, gastos y utilidad del mes sin esperar al contador.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'como-hacer-conteo-fisico-inventario',
        title: 'Cómo hacer un conteo físico de inventario sin cerrar el negocio',
        description: 'Guía para hacer la toma física de inventario: preparación, conteo por zonas, ajustes de diferencias y conteos cíclicos para no cerrar el negocio.',
        keyword: 'conteo físico de inventario',
        cluster: 'Inventario y Kardex',
        category: 'Inventario',
        date: '2026-07-01',
        readTime: '6 min',
        relatedSlugs: ['control-de-inventario-kardex-nicaragua', 'rotacion-de-inventario-como-calcularla', 'metodos-de-costeo-inventario-peps-promedio'],
        faq: [
            { q: '¿Cada cuánto se hace un conteo físico?', a: 'Un conteo general al menos una vez al año, complementado con conteos cíclicos (contar una parte del inventario cada semana o mes) para los productos de más valor o rotación. El cíclico detecta diferencias sin parar el negocio.' },
            { q: '¿Qué hago con las diferencias que encuentre?', a: 'Investigá primero las grandes (¿venta sin registrar? ¿robo? ¿error de recepción?), luego ajustá el sistema para que refleje la realidad y dejá documentado el ajuste con fecha y responsable.' },
        ],
        content: `
El sistema dice 48 unidades; el estante tiene 43. Esa diferencia es plata perdida — y solo el conteo físico la saca a la luz. Acá va el método para hacerlo bien.

## Por qué contar si "el sistema ya sabe"

El [Kardex](/blog/control-de-inventario-kardex-nicaragua) registra lo que se digita; el estante refleja lo que pasó de verdad: mermas, robo hormiga, errores de recepción, ventas sin registrar. El conteo físico es el careo entre los dos.

## Preparación (la mitad del éxito)

1. **Ordenả antes de contar:** producto agrupado, etiquetado, sin cajas mezcladas.
2. **Cortá el movimiento:** definí una hora de corte; lo que entre o salga después se registra aparte.
3. **Dividí en zonas** y asigná responsables por zona.
4. **Imprimí las hojas de conteo sin cantidades del sistema** (contar "a ciegas" evita que el contador copie el número esperado).

## El conteo

- Contá **todo lo de la zona**, unidad por unidad — no "a ojo".
- Los productos de alto valor cuéntalos **dos veces con personas distintas**.
- Anotá también el **estado**: vencido, dañado, sin etiqueta.

## El ajuste

Comparado el conteo contra el sistema:

| Diferencia | Acción |
| --- | --- |
| Pequeña y aislada | Ajustar y seguir |
| Grande en un producto | Investigar antes de ajustar |
| Patrón repetido en una zona/turno | Investigar proceso o personal |

Todo ajuste queda **documentado**: fecha, responsable, motivo. El ajuste sin registro es la puerta para que las pérdidas se vuelvan invisibles.

## Conteos cíclicos: la alternativa a cerrar

En lugar de un solo conteo anual gigante, contá **una parte cada semana**: los productos A (más valor/rotación, ver [rotación](/blog/rotacion-de-inventario-como-calcularla)) más seguido, los C una vez al año. El negocio nunca cierra y las diferencias se detectan frescas.

## Nortex hace el careo por vos

Nortex genera las hojas de conteo, recibe las cantidades físicas y calcula las diferencias contra el Kardex al instante, con el ajuste documentado.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'rotacion-de-inventario-como-calcularla',
        title: 'Rotación de inventario: el número que te dice qué comprar',
        description: 'Cómo calcular la rotación de inventario y los días de inventario, e identificar productos estrella y plata dormida en tu bodega.',
        keyword: 'rotación de inventario',
        cluster: 'Inventario y Kardex',
        category: 'Inventario',
        date: '2026-07-04',
        readTime: '5 min',
        relatedSlugs: ['control-de-inventario-kardex-nicaragua', 'como-hacer-conteo-fisico-inventario', 'flujo-de-caja-pyme-nicaragua'],
        faq: [
            { q: '¿Qué es una buena rotación de inventario?', a: 'Depende del giro: los perecederos rotan en días; una ferretería puede rotar su inventario pocas veces al año. Lo útil no es compararte con otros, sino comparar tus productos entre sí y tu tendencia en el tiempo.' },
            { q: '¿Qué hago con los productos que no rotan?', a: 'Primero dejá de recomprarlos. Luego liquidá lo que tenés (descuento, combo) para recuperar el efectivo: un producto parado pierde valor y ocupa espacio y capital que un producto estrella usaría mejor.' },
        ],
        content: `
Tu bodega es una cuenta bancaria en especie: cada producto es plata guardada. La rotación te dice cuáles depósitos están trabajando y cuáles están dormidos.

## La fórmula

> Rotación = Costo de lo vendido en el período ÷ Inventario promedio (al costo).

Y su hermana, más intuitiva:

> Días de inventario = días del período ÷ rotación.

## Ejemplo

En el año vendiste mercadería que te costó C$600,000 y tu inventario promedio vale C$150,000:

- Rotación = 600,000 ÷ 150,000 = **4 veces al año**.
- Días de inventario = 365 ÷ 4 ≈ **91 días**: cada córdoba invertido en bodega tarda ~3 meses en volver.

## Leelo por producto, no solo global

El número global esconde los extremos. Clasificá:

| Tipo | Comportamiento | Acción |
| --- | --- | --- |
| Estrella | Rota rápido y deja margen | Nunca quedarse sin stock |
| Vaca lechera | Rota rápido, margen bajo | Negociar costo, comprar eficiente |
| Dormido | Meses sin moverse | No recomprar, liquidar |

## Rotación y efectivo

Un inventario que rota lento es [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua) congelado: compraste algo que no se convierte en efectivo. Antes de pedir un préstamo "porque falta plata", revisá cuánta plata tenés parada en estantes.

## De dónde salen los datos

Necesitás el costo de ventas y el valor del inventario — es decir, un [Kardex](/blog/control-de-inventario-kardex-nicaragua) al día y [conteos](/blog/como-hacer-conteo-fisico-inventario) que lo mantengan honesto.

## Nortex te muestra la rotación por producto

Nortex calcula la rotación y los días de inventario de cada producto y te señala lo dormido: sabés qué recomprar, qué liquidar y dónde está atrapado tu efectivo.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'antiguedad-de-saldos-como-usarla',
        title: 'Antigüedad de saldos: el reporte que salva tu cartera',
        description: 'Cómo leer el reporte de antigüedad de saldos, clasificar tu cartera por días de vencimiento y decidir acciones de cobro con datos.',
        keyword: 'antigüedad de saldos',
        cluster: 'Cobranza y Crédito',
        category: 'Cobranza',
        date: '2026-07-02',
        readTime: '5 min',
        relatedSlugs: ['gestion-de-cobranza-cuentas-por-cobrar', 'como-cobrar-cuentas-morosas-nicaragua', 'politica-de-credito-negocio'],
        faq: [
            { q: '¿Qué es el reporte de antigüedad de saldos?', a: 'Es la foto de tu cartera clasificada por cuánto tiempo lleva vencida cada deuda: corriente, 1-30, 31-60, 61-90 y más de 90 días. Muestra dónde está el riesgo y a quién cobrar primero.' },
            { q: '¿Cada cuánto debo revisarlo?', a: 'Semanal como mínimo. La cobrabilidad cae con cada semana que pasa: una cartera revisada mensualmente ya perdió oportunidades de recuperar deudas cuando aún eran frescas.' },
        ],
        content: `
"¿Cuánto te deben?" es fácil de responder. "¿Cuánto de eso vas a cobrar de verdad?" — eso lo responde la antigüedad de saldos.

## Qué es

Es tu cartera por cobrar **clasificada por tiempo de vencimiento**. La misma deuda total puede ser sana o un desastre según cómo se reparte:

| Tramo | Significado | Cobrabilidad |
| --- | --- | --- |
| Corriente | Aún no vence | Alta |
| 1-30 días | Atraso temprano | Alta si actuás ya |
| 31-60 días | Mora instalándose | Media |
| 61-90 días | Mora seria | Baja |
| +90 días | Riesgo de pérdida | Muy baja |

## Cómo leerlo en 3 preguntas

**1. ¿Dónde está concentrada la plata?** C$80,000 por cobrar con 70% corriente es salud; el mismo monto con 40% en +60 días es una alarma.

**2. ¿Quiénes son los grandes de cada tramo?** Ordenar cada tramo por monto te da la lista de llamadas del día: primero los montos grandes en tramos tempranos (máxima recuperación por llamada).

**3. ¿La foto mejora o empeora?** Compará mes a mes el porcentaje vencido. Si crece, el problema ya no es cobranza: es a quién le estás fiando (ver [política de crédito](/blog/politica-de-credito-negocio)).

## Del reporte a la acción

- **Corriente:** recordatorio antes del vencimiento.
- **1-30:** contacto inmediato — acá se gana o se pierde la cartera (ver [cómo cobrar morosos](/blog/como-cobrar-cuentas-morosas-nicaragua)).
- **31-60:** plan de pago documentado.
- **+60:** decisión — escalar, negociar quita, o suspender crédito.

La antigüedad de saldos convierte la [gestión de cobranza](/blog/gestion-de-cobranza-cuentas-por-cobrar) de "perseguir a todos" en "cobrar con prioridades".

## Nortex te lo da en tiempo real

Cada venta a crédito en Nortex alimenta la antigüedad de saldos automáticamente: abrís el reporte y sabés a quién llamar hoy y cuánto está en riesgo.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'politica-de-credito-negocio',
        title: 'Política de crédito: las reglas para fiar sin fundirte',
        description: 'Cómo definir una política de crédito para tu negocio: a quién fiar, cuánto, a qué plazo y qué hacer ante el atraso. Con plantilla de criterios.',
        keyword: 'política de crédito para clientes',
        cluster: 'Cobranza y Crédito',
        category: 'Cobranza',
        date: '2026-07-06',
        readTime: '6 min',
        relatedSlugs: ['gestion-de-cobranza-cuentas-por-cobrar', 'antiguedad-de-saldos-como-usarla', 'flujo-de-caja-pyme-nicaragua'],
        faq: [
            { q: '¿Qué debe definir una política de crédito?', a: 'Cuatro cosas: a quién se le da crédito (criterios), cuánto (límite por cliente), a qué plazo, y qué pasa ante el atraso (suspensión del crédito, plan de pago). Escrita y aplicada igual para todos.' },
            { q: '¿Cómo fijo el límite de crédito de un cliente?', a: 'Empezá bajo (por ejemplo, el equivalente a una compra típica) y subilo con historial de pago puntual. El límite protege: acota cuánto podés perder con un solo cliente.' },
        ],
        content: `
Fiar sin reglas no es generosidad: es rifar tu efectivo. Una política de crédito de una página convierte el "dale, llevátelo" en decisiones que protegen tu negocio.

## Por qué escribirla

Cuando las reglas están solo en tu cabeza, cada excepción se negocia en caliente — y el cliente insistente siempre gana. Con política escrita, el "no" deja de ser personal: es la regla del negocio.

## Los 4 componentes

**1. A quién.** Criterios mínimos: tiempo como cliente, compras previas de contado, referencias. Cliente nuevo = contado; el crédito se gana.

**2. Cuánto.** Límite por cliente. Regla práctica: empezá con el valor de una compra típica y subilo con buen historial. El límite acota tu pérdida máxima por cliente.

**3. A qué plazo.** 15 o 30 días, definido y comunicado en la venta. El plazo que no se dice se vuelve "cuando pueda".

**4. Qué pasa al atraso.** La consecuencia automática más efectiva: **atrasado = crédito suspendido** hasta ponerse al día. Sin excepciones silenciosas.

## Plantilla de arranque

| Regla | Ejemplo |
| --- | --- |
| Antigüedad mínima como cliente | 3 meses comprando de contado |
| Límite inicial | C$2,000 |
| Aumento de límite | +50% tras 3 créditos pagados puntual |
| Plazo | 15 días |
| Atraso | Crédito suspendido hasta pagar |

Ajustá los montos a tu realidad — lo importante es que existan y se cumplan.

## La política se retroalimenta

Tu [antigüedad de saldos](/blog/antiguedad-de-saldos-como-usarla) te dice si la política funciona: si la mora crece, los criterios están flojos. Y cada moroso recurrente es un límite que bajar. Así, la [cobranza](/blog/gestion-de-cobranza-cuentas-por-cobrar) deja de apagar incendios y tu [flujo de caja](/blog/flujo-de-caja-pyme-nicaragua) respira.

## Nortex aplica la política por vos

En Nortex definís el límite por cliente y el sistema lo respeta en caja: si el cliente llegó a su tope o está vencido, la venta a crédito se detiene sola.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'codigo-de-barras-negocio-como-implementarlo',
        title: 'Código de barras en tu negocio: cómo implementarlo bien',
        description: 'Cómo implementar código de barras en tu negocio: qué escáner usar, cómo codificar productos sin código y el impacto en caja e inventario.',
        keyword: 'código de barras punto de venta',
        cluster: 'Punto de Venta',
        category: 'Punto de Venta',
        date: '2026-07-03',
        readTime: '5 min',
        relatedSlugs: ['sistema-punto-de-venta-nicaragua-guia', 'control-de-inventario-kardex-nicaragua', 'arqueo-de-caja-paso-a-paso'],
        faq: [
            { q: '¿Necesito imprimir códigos para todos mis productos?', a: 'No: la mayoría de productos comerciales ya traen código de fábrica (EAN). Solo generás códigos propios para lo que se vende a granel, fraccionado o sin empaque — y para eso basta una impresora de etiquetas sencilla.' },
            { q: '¿Qué escáner me conviene?', a: 'Para un mostrador, un escáner láser o de imagen USB básico es suficiente y económico. Si vendés con celular o tablet, la cámara del dispositivo puede escanear directamente en muchos sistemas.' },
        ],
        content: `
Buscar cada producto por nombre en la caja es lento y propenso a errores. El código de barras convierte cada venta en un bip: rápido, exacto y conectado al inventario.

## Qué gana tu negocio

- **Velocidad en caja:** un bip contra escribir y buscar. En hora pico, es la diferencia entre fila y fuga de clientes.
- **Exactitud:** se cobra el producto correcto al precio correcto — sin "creo que era este".
- **Inventario confiable:** cada bip descuenta el [Kardex](/blog/control-de-inventario-kardex-nicaragua) sin digitación.

## Lo que ya viene resuelto

La mayoría de productos comerciales trae **código EAN de fábrica**: solo lo registrás una vez en tu sistema asociándolo al producto y su precio. Desde ahí, todo es escanear.

## Lo que codificás vos

Para granel, fraccionados o productos sin empaque, generás **códigos internos** e imprimís etiquetas con una impresora sencilla:

| Caso | Solución |
| --- | --- |
| Producto con empaque comercial | Usar su EAN de fábrica |
| Granel (clavos, arroz por libra) | Código interno por producto |
| Fraccionado (media pastilla, retazo) | Código interno por presentación |

## El hardware, sin exagerar

Un **escáner USB básico** cuesta poco y funciona como un teclado: se conecta y escanea. Con celular o tablet, muchos sistemas escanean con la **cámara**. No necesitás equipo industrial para un mostrador.

## El proceso de arranque

1. Registrá tus productos con su código (los EAN, escaneándolos una vez).
2. Etiquetá lo que no trae código.
3. Entrená a la caja: **todo pasa por el escáner**, sin excepciones "de memoria".
4. Verificá con el [arqueo](/blog/arqueo-de-caja-paso-a-paso) que ventas y caja cuadran.

Es la mejora de mayor impacto por córdoba invertido en un [punto de venta](/blog/sistema-punto-de-venta-nicaragua-guia).

## Nortex escanea desde el día uno

Nortex registra productos por su código de barras, vende con escáner o cámara y descuenta el inventario en cada bip.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'tabla-de-amortizacion-prestamo-como-leerla',
        title: 'Tabla de amortización: cómo leerla antes de prestar o pedir prestado',
        description: 'Qué es una tabla de amortización, cómo se reparte cada cuota entre interés y capital, y qué mirar antes de firmar o de otorgar un préstamo.',
        keyword: 'tabla de amortización préstamo',
        cluster: 'Préstamos y Microfinanzas',
        category: 'Préstamos',
        date: '2026-07-04',
        readTime: '6 min',
        relatedSlugs: ['como-gestionar-prestamos-microfinanzas-nicaragua', 'flujo-de-caja-pyme-nicaragua'],
        faq: [
            { q: '¿Por qué al inicio del préstamo casi todo va a intereses?', a: 'Porque el interés de cada cuota se calcula sobre el saldo pendiente, y al inicio el saldo es el más alto. A medida que el capital baja, la porción de interés de cada cuota se achica y la de capital crece.' },
            { q: '¿Qué pasa si abono a capital?', a: 'Un abono extraordinario reduce el saldo, y con él los intereses futuros: el préstamo se acorta o la cuota baja según lo pactado. Verificá que el contrato permita abonos sin penalidad.' },
        ],
        content: `
Una cuota de préstamo no es un número: es una mezcla de interés y capital que cambia cada mes. La tabla de amortización muestra esa mezcla — y leerla evita sorpresas de los dos lados del mostrador.

## Qué es

Es el calendario del préstamo, cuota por cuota, mostrando cuánto de cada pago va a **interés** y cuánto **amortiza** (reduce) el capital, y el **saldo** que queda.

## La mecánica

En el sistema de cuota fija (el más común):

> Interés del mes = saldo pendiente × tasa del período.
> Amortización = cuota − interés del mes.

Como el interés se calcula **sobre el saldo**, al inicio (saldo alto) casi toda la cuota es interés; al final, casi toda es capital.

## Ejemplo ilustrativo

Préstamo de C$10,000 a 6 meses, con tasa del 3% mensual sobre saldo (cuota fija ≈ C$1,846):

| Mes | Interés | Amortización | Saldo |
| --- | --- | --- | --- |
| 1 | 300 | 1,546 | 8,454 |
| 2 | 254 | 1,592 | 6,862 |
| 3 | 206 | 1,640 | 5,222 |

> La tasa del ejemplo es solo ilustrativa para mostrar la mecánica. Las tasas reales que podés cobrar o aceptar tienen marco legal en Nicaragua: confirmalo con un asesor antes de pactar.

## Qué mirar antes de firmar (o de prestar)

1. **El costo total:** sumá todas las cuotas y restá el capital — ese es el precio real del préstamo.
2. **Sobre qué se calcula el interés:** sobre **saldo** (justo) o sobre el **monto original** todo el plazo (mucho más caro a igual tasa nominal).
3. **Abonos a capital:** ¿se permiten sin penalidad?
4. **Cargos extra:** comisiones y seguros que no aparecen en la "tasa".

## Para el que presta

La tabla es tu herramienta de control de cartera: define qué debía entrar cada mes y hace visible el atraso al instante (ver [gestión de préstamos](/blog/como-gestionar-prestamos-microfinanzas-nicaragua)).

## Nortex genera la tabla de cada crédito

Nortex arma la tabla de amortización de cada préstamo, registra los pagos contra ella y te muestra el saldo y el atraso real de cada cliente.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'que-productos-dejan-mas-ganancia-pulperia',
        title: '¿Qué productos dejan más ganancia en una pulpería?',
        description: 'Cómo identificar los productos que de verdad dejan ganancia en tu pulpería: margen vs. rotación, la mezcla correcta y errores de surtido.',
        keyword: 'productos más rentables pulpería',
        cluster: 'Pulperías y Minoristas',
        category: 'Pulperías',
        date: '2026-07-05',
        readTime: '5 min',
        relatedSlugs: ['como-administrar-una-pulperia-nicaragua', 'como-calcular-margen-de-ganancia-nicaragua', 'rotacion-de-inventario-como-calcularla'],
        faq: [
            { q: '¿Los productos que más se venden son los que más dejan?', a: 'No necesariamente: los de alta rotación (gaseosas, pan) suelen tener margen bajo — atraen clientes. La ganancia real suele estar en lo que se lleva "de paso" con mejor margen. La mezcla de ambos es lo que hace rentable la pulpería.' },
            { q: '¿Cómo sé el margen real de cada producto?', a: 'Registrando el costo real de compra (con flete y merma) y el precio de venta sin engaños de memoria. Margen = (precio − costo) ÷ precio. Un sistema lo calcula por producto automáticamente.' },
        ],
        content: `
En la pulpería, lo que más se vende no es lo que más deja — y confundir las dos cosas es trabajar mucho para ganar poco. La clave está en la mezcla.

## Dos tipos de producto, dos roles

**Los que atraen (alta rotación, margen bajo):** gaseosas, pan, tortillas, recargas. El cliente viene por ellos todos los días. Casi no dejan margen, pero traen el tráfico.

**Los que dejan (margen alto, venta "de paso"):** productos de limpieza, cuidado personal, golosinas, abarrotes no comparables. El cliente los lleva porque ya está ahí — y ahí vive tu ganancia.

## La pregunta correcta

No es "¿qué se vende más?" sino **"¿cuánto me deja cada córdoba vendido de esto?"** — es decir, el [margen](/blog/como-calcular-margen-de-ganancia-nicaragua) por producto, cruzado con su [rotación](/blog/rotacion-de-inventario-como-calcularla):

| Producto | Rol | Qué hacer |
| --- | --- | --- |
| Margen bajo + rota mucho | Imán de clientes | Tenerlo siempre, comprarlo bien |
| Margen alto + rota bien | La joya | Darle visibilidad, nunca faltar |
| Margen alto + rota poco | De paso | Ubicarlo junto al mostrador |
| Margen bajo + rota poco | Peso muerto | No recomprar |

## Trucos de surtido que funcionan

- **Ubicación:** lo de buen margen, a la vista y al alcance del mostrador (la compra impulsiva es tu aliada).
- **Fraccionar:** vender por unidad o porción suele dejar mejor margen que el paquete completo.
- **No competir en lo comparable:** en productos que el cliente conoce de memoria (la gaseosa), el precio manda; tu margen se hace en lo que no compara.

## El requisito: conocer tus números

Todo esto exige saber costo y venta **por producto** — no "más o menos". Es el corazón de [administrar bien una pulpería](/blog/como-administrar-una-pulperia-nicaragua).

## Nortex te muestra qué te deja plata

Con Nortex ves el margen y la rotación de cada producto: cuáles son tus joyas, qué es peso muerto y dónde poner el esfuerzo.

[Probá Nortex gratis 30 días →](/register)
`,
    },
    {
        slug: 'precios-por-mayoreo-ferreteria',
        title: 'Precios por mayoreo en ferretería: cómo fijarlos sin regalar margen',
        description: 'Cómo definir precios por mayoreo y escalas de cantidad en tu ferretería sin sacrificar el margen: métodos, ejemplo y errores comunes.',
        keyword: 'precios por mayoreo ferretería',
        cluster: 'Ferreterías',
        category: 'Ferreterías',
        date: '2026-07-06',
        readTime: '5 min',
        relatedSlugs: ['como-administrar-una-ferreteria-nicaragua', 'como-calcular-margen-de-ganancia-nicaragua', 'politica-de-credito-negocio'],
        faq: [
            { q: '¿Cuánto descuento dar por mayoreo?', a: 'El que tu margen aguante: partí del margen del producto y decidí cuánto estás dispuesto a ceder a cambio de volumen. Un descuento del 10% sobre un margen del 25% se lleva el 40% de tu ganancia — hacé la cuenta antes de prometer.' },
            { q: '¿Le doy precio de mayoreo a cualquiera que pida cantidad?', a: 'Definí umbrales claros (por cantidad o monto) y aplicalos parejo. El mayoreo "negociado a ojo" en el mostrador termina regalando margen a quien más presiona, no a quien más compra.' },
        ],
        content: `
El maestro de obra pide precio "por cantidad" y la respuesta improvisada suele regalar margen. El mayoreo bien hecho premia el volumen sin fundir la ganancia — y se define antes, no en el mostrador.

## El principio: el descuento sale del margen

Todo descuento se paga con tu [margen](/blog/como-calcular-margen-de-ganancia-nicaragua). La cuenta que hay que hacer siempre:

> Si un producto deja 25% de margen y das 10% de descuento, tu ganancia baja un 40%.

El volumen tiene que compensar esa cesión — y eso se calcula, no se siente.

## Escalas claras, iguales para todos

Definí umbrales objetivos y publicalos:

| Cantidad | Precio |
| --- | --- |
| 1-9 unidades | Precio detalle |
| 10-49 | −5% |
| 50+ | −10% |

Las escalas por **monto de compra total** también funcionan (p. ej., descuento a partir de C$10,000). Lo importante: la regla decide, no la insistencia del cliente.

## Dónde sí y dónde no

- **Sí:** productos con margen amplio y costo negociable con tu proveedor por volumen.
- **Con cuidado:** productos ancla (cemento, varilla) que ya vendés casi al costo — ahí el "mayoreo" puede ser vender a pérdida.
- **Mejor alternativa a veces:** en lugar de descuento, valor agregado — flete incluido, prioridad de entrega, [crédito con reglas](/blog/politica-de-credito-negocio).

## Mayoreo y crédito: cuentas separadas

El cliente de volumen suele pedir también plazo. Son dos concesiones distintas: descuento **y** crédito juntos es margen cedido dos veces. Decidí cada uno por separado.

## Nortex maneja listas de precios por volumen

En Nortex configurás precios por escala de cantidad o listas por tipo de cliente, y la caja los aplica sola: el mayoreo queda en la regla, no en la negociación. Ver la [guía de ferreterías](/blog/como-administrar-una-ferreteria-nicaragua).

[Probá Nortex gratis 30 días →](/register)
`,
    },
];
