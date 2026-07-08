export interface BlogFaq {
  q: string;
  a: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;          // fecha de publicación (YYYY-MM-DD)
  readTime: string;
  category: string;      // etiqueta visible corta (badge)
  content: string;       // cuerpo en Markdown (ver lib/markdown.ts)

  // ── Taxonomía y SEO (modelo pillar/cluster, ver data/blog-taxonomy.ts) ──
  cluster: string;          // slug del clúster al que pertenece
  pillar?: boolean;         // true si es el artículo pilar del clúster
  updated?: string;         // última actualización (YYYY-MM-DD) → dateModified / lastmod
  keyword?: string;         // keyword objetivo (informativo)
  intent?: 'informacional' | 'comercial' | 'comparativa' | 'caso';
  relatedSlugs?: string[];  // enlazado interno explícito (se completa con hermanos)
  faqs?: BlogFaq[];         // bloque FAQ → FAQPage JSON-LD + featured snippets
  image?: string;           // imagen destacada (ruta o URL absoluta), opcional
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'como-calcular-nomina-nicaragua-2026',
    title: 'Cómo calcular la nómina en Nicaragua 2026 (Guía completa Ley 185)',
    description: 'Guía paso a paso para calcular salarios, INSS, INATEC, IR, vacaciones y aguinaldo según el Código del Trabajo de Nicaragua. Con ejemplos reales.',
    date: '2026-03-01',
    updated: '2026-06-30',
    readTime: '8 min',
    category: 'Recursos Humanos',
    cluster: 'Recursos Humanos y Nómina',
    keyword: 'como calcular nomina nicaragua',
    relatedSlugs: ['inss-nicaragua', 'aguinaldo-nicaragua', 'vacaciones-nicaragua'],
    faq: [
      { q: '¿Cuánto es el INSS laboral en Nicaragua?', a: 'El INSS laboral (cuota del trabajador) es el 7% del salario bruto, con un techo cotizable que se actualiza cada año.' },
      { q: '¿Cuánto paga el empleador de INSS?', a: 'El INSS patronal es 21.5% para empleadores con menos de 50 trabajadores y 22.5% para los de 50 o más, más 2% de INATEC.' },
    category: 'Nómina y RR.HH.',
    readTime: '8 min',
    cluster: 'nomina-rrhh',
    pillar: true,
    keyword: 'cómo calcular la nómina en Nicaragua',
    intent: 'informacional',
    relatedSlugs: ['retenciones-ir-nicaragua-2026'],
    faqs: [
      {
        q: '¿Las horas extra en Nicaragua se pagan al 50%?',
        a: 'No. Las horas extra se pagan al doble del valor de la hora ordinaria (un 100% de recargo), sin importar si es día hábil, según el Art. 62 de la Ley 185. El recargo del 100% por día feriado trabajado (Art. 68) es un concepto distinto.',
      },
      {
        q: '¿Cuántos días de vacaciones corresponden por año en Nicaragua?',
        a: 'Corresponden 15 días de descanso por cada 6 meses de trabajo continuo, equivalente a 2.5 días por mes o 30 días al año (Art. 76 de la Ley 185).',
      },
      {
        q: '¿Qué porcentaje es el INSS patronal en 2026?',
        a: 'El INSS patronal es 21.5% del salario bruto para empleadores con menos de 50 trabajadores y 22.5% para 50 o más (Ley 539), más un 2% de INATEC.',
      },
    ],
    content: `
## Cómo calcular la nómina en Nicaragua 2026

Calcular correctamente la nómina es una de las obligaciones más importantes para cualquier negocio en Nicaragua. El Código del Trabajo (Ley 185) y la Ley de Seguridad Social (Ley 539) establecen los requisitos mínimos que todo empleador debe cumplir.

**Los que atraen (alta rotación, margen bajo):** gaseosas, pan, tortillas, recargas. El cliente viene por ellos todos los días. Casi no dejan margen, pero traen el tráfico.

El salario bruto de un trabajador en Nicaragua incluye:
- Salario base
- Horas extras: se pagan al **doble** de la hora ordinaria (Art. 62 Ley 185)
- Comisiones (si aplica)

## La pregunta correcta

No es "¿qué se vende más?" sino **"¿cuánto me deja cada córdoba vendido de esto?"** — es decir, el [margen](/blog/como-calcular-margen-de-ganancia-nicaragua) por producto, cruzado con su [rotación](/blog/rotacion-de-inventario-como-calcularla):

**IR sobre salarios:** Aplica la tabla progresiva anual de la DGI sobre la renta neta de INSS:
- Hasta C$100,000 anuales: exento
- C$100,000.01 - C$200,000: 15% sobre el exceso
- C$200,000.01 - C$350,000: C$15,000 + 20% sobre el exceso
- C$350,000.01 - C$500,000: C$45,000 + 25% sobre el exceso
- Más de C$500,000: C$82,500 + 30% sobre el exceso

## Trucos de surtido que funcionan

- **Ubicación:** lo de buen margen, a la vista y al alcance del mostrador (la compra impulsiva es tu aliada).
- **Fraccionar:** vender por unidad o porción suele dejar mejor margen que el paquete completo.
- **No competir en lo comparable:** en productos que el cliente conoce de memoria (la gaseosa), el precio manda; tu margen se hace en lo que no compara.

## El requisito: conocer tus números
**INSS Patronal:** 21.5% del salario bruto para empleadores con menos de 50 trabajadores (22.5% si tiene 50 o más).
**INATEC:** 2% del salario bruto.

**Ejemplo para salario de C$15,000 (PyME con menos de 50 empleados):**
**IR sobre salarios:** se calcula sobre la renta neta anual (después de restar el INSS laboral) con la tabla progresiva de la DGI. Cada tramo paga un impuesto base más un porcentaje sobre el exceso:

| Renta neta anual (C$) | Impuesto base (C$) | % sobre el exceso |
| --- | --- | --- |
| 0 – 100,000 | exento | 0% |
| 100,000.01 – 200,000 | 0 | 15% |
| 200,000.01 – 350,000 | 15,000 | 20% |
| 350,000.01 – 500,000 | 45,000 | 25% |
| 500,000.01 a más | 82,500 | 30% |

### 3. Aportes patronales

**INSS Patronal:** 21.5% del salario bruto para empleadores con menos de 50 trabajadores; 22.5% para 50 o más (Ley 539)
**INATEC:** 2% del salario bruto

**Ejemplo para salario de C$15,000 (negocio con menos de 50 empleados):**
- INSS Patronal (21.5%): C$3,225
- INATEC (2%): C$300
- **Costo total para el empleador: C$18,525**

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
**Vacaciones:** 15 días por cada 6 meses trabajados, es decir 2.5 días por mes (30 días al año), Art. 76.
Valor: salario_diario × días acumulados.

**Décimo tercer mes (Aguinaldo):** 1/12 del salario por mes trabajado.
Se paga en los primeros diez días de diciembre.

**Indemnización por antigüedad (Art. 45):** 1 mes de salario por cada uno de los primeros 3 años y 20 días por cada año a partir del cuarto, con un máximo de 5 meses. Aplica en despido o mutuo acuerdo, no en renuncia.
**Vacaciones:** 15 días de descanso por cada 6 meses de trabajo continuo, es decir **2.5 días por mes** (30 días al año) — Art. 76 de la Ley 185
Valor del saldo acumulado: salario_diario × días acumulados

**Décimo tercer mes (Aguinaldo):** 1/12 del salario por mes trabajado
Se paga la primera quincena de diciembre.

**Indemnización por antigüedad (Art. 45):** 1 mes de salario por cada uno de los primeros 3 años trabajados y 20 días por cada año a partir del cuarto. Mínimo 1 mes, máximo 5 meses. Aplica en despido o mutuo acuerdo, no en renuncia.

## El principio: el descuento sale del margen

Todo descuento se paga con tu [margen](/blog/como-calcular-margen-de-ganancia-nicaragua). La cuenta que hay que hacer siempre:

> Si un producto deja 25% de margen y das 10% de descuento, tu ganancia baja un 40%.
[Prueba Nortex gratis 30 días →](/register)
    `
  },
  {
    slug: 'retenciones-ir-nicaragua-2026',
    title: 'Retenciones IR Nicaragua 2026: Guía completa para PyMES',
    description: 'Todo lo que necesitás saber sobre retenciones en la fuente IR en Nicaragua. Tasas, comprobantes, declaración mensual y errores que generan multas DGI.',
    date: '2026-03-05',
    updated: '2026-06-30',
    readTime: '6 min',
    category: 'Fiscal',
    cluster: 'Impuestos Nicaragua',
    keyword: 'retenciones ir nicaragua',
    relatedSlugs: ['iva-en-nicaragua', 'ir-en-nicaragua', 'impuestos-en-nicaragua'],
    faq: [
      { q: '¿Cuál es la tasa de retención por compra de bienes?', a: 'La retención en la fuente por compra de bienes y servicios generales es del 2% sobre la base gravable (sin IVA).' },
      { q: '¿Cuándo se declaran las retenciones IR?', a: 'Las retenciones se enteran a la DGI dentro de los primeros 15 días del mes siguiente, a través de la Ventanilla Electrónica Tributaria (VET).' },
    category: 'Impuestos',
    readTime: '6 min',
    cluster: 'impuestos',
    keyword: 'retenciones IR Nicaragua',
    intent: 'informacional',
    relatedSlugs: ['como-calcular-nomina-nicaragua-2026'],
    faqs: [
      {
        q: '¿Se retiene IR sobre el IVA?',
        a: 'No. La retención en la fuente se aplica únicamente sobre la base gravable (el valor de los bienes o servicios), nunca sobre el IVA.',
      },
      {
        q: '¿Cuándo se declaran las retenciones IR en Nicaragua?',
        a: 'Se declaran en la Ventanilla Electrónica Tributaria (VET) antes del día 10 del mes siguiente al que se efectuaron.',
      },
      {
        q: '¿Desde qué monto se aplica la retención?',
        a: 'Cuando una empresa compra bienes o servicios por un valor mayor a C$1,000 debe retener el porcentaje correspondiente.',
      },
    ],
    content: `
## Retenciones IR Nicaragua 2026

El volumen tiene que compensar esa cesión — y eso se calcula, no se siente.

## Escalas claras, iguales para todos

Definí umbrales objetivos y publicalos:
**Retención por compra de bienes:** 2%
**Retención por servicios generales:** 2%
**Retención por servicios profesionales (personas naturales):** 10%
**Arrendamientos:** la tasa depende de si el ingreso es renta de actividad económica o renta de capital; confirmá el caso con tu contador.
| Concepto | Tasa de retención |
| --- | --- |
| Compra de bienes | 2% |
| Servicios generales | 2% |
| Servicios profesionales | 10% |
| Arrendamiento | 5% |

| Cantidad | Precio |
| --- | --- |
| 1-9 unidades | Precio detalle |
| 10-49 | −5% |
| 50+ | −10% |

Las escalas por **monto de compra total** también funcionan (p. ej., descuento a partir de C$10,000). Lo importante: la regla decide, no la insistencia del cliente.

## Dónde sí y dónde no
**Ejemplo:** Comprás mercadería por C$50,000 + IVA
- IVA 15% = C$7,500
- Total factura = C$57,500
- Retención 2% sobre C$50,000 (base sin IVA) = C$1,000
- **Pagas al proveedor: C$56,500**
- **Entregás a DGI: C$1,000**

- **Sí:** productos con margen amplio y costo negociable con tu proveedor por volumen.
- **Con cuidado:** productos ancla (cemento, varilla) que ya vendés casi al costo — ahí el "mayoreo" puede ser vender a pérdida.
- **Mejor alternativa a veces:** en lugar de descuento, valor agregado — flete incluido, prioridad de entrega, [crédito con reglas](/blog/politica-de-credito-negocio).

## Mayoreo y crédito: cuentas separadas
1. No emitir constancia de retención
2. Declarar fuera del plazo (primeros 15 días del mes siguiente)
3. Retener sobre el IVA (solo se retiene sobre la base gravable)
4. No llevar registro de retenciones efectuadas

El cliente de volumen suele pedir también plazo. Son dos concesiones distintas: descuento **y** crédito juntos es margen cedido dos veces. Decidí cada uno por separado.

## Nortex maneja listas de precios por volumen
Las retenciones se declaran en la **VET (Ventanilla Electrónica Tributaria)** dentro de los primeros 15 días de cada mes, junto con la Declaración Mensual de Impuestos (DMI).

En Nortex configurás precios por escala de cantidad o listas por tipo de cliente, y la caja los aplica sola: el mayoreo queda en la regla, no en la negociación. Ver la [guía de ferreterías](/blog/como-administrar-una-ferreteria-nicaragua).

[Probá Nortex gratis 30 días →](/register)
`,
    },
];
