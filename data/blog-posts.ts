// data/blog-posts.ts
// Contenido del blog como data. Cada post pertenece a un clúster (ver
// data/blog-clusters.ts) y puede ser el PILAR del clúster (isPillar) o un
// artículo de clúster que enlaza al pilar y a sus hermanos vía relatedSlugs.

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
  /** Etiqueta visible (badge). Suele coincidir con el nombre del clúster. */
  category: string;
  /** Slug del clúster al que pertenece (data/blog-clusters.ts). */
  cluster: string;
  /** true si es el artículo pilar del clúster. */
  isPillar?: boolean;
  /** Slugs de artículos relacionados (pilar + hermanos). Si se omite, se
   *  derivan automáticamente del mismo clúster. */
  relatedSlugs?: string[];
  /** Preguntas frecuentes → genera FAQPage (JSON-LD) y apunta a snippets. */
  faqs?: BlogFaq[];
  content: string;
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
    category: 'Recursos Humanos y Nómina',
    cluster: 'recursos-humanos-nomina',
    isPillar: true,
    relatedSlugs: ['retenciones-ir-nicaragua-2026'],
    faqs: [
      {
        q: '¿Cuánto es el INSS laboral en Nicaragua 2026?',
        a: 'El INSS laboral (cuota del trabajador) es 7% del salario bruto. El INSS patronal a cargo del empleador es 21.5% y el INATEC 2%.',
      },
      {
        q: '¿Cuándo se paga el aguinaldo o décimo tercer mes?',
        a: 'El décimo tercer mes equivale a 1/12 del salario por mes trabajado y se paga en la primera quincena de diciembre.',
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

### 1. Componentes del salario

El salario bruto de un trabajador en Nicaragua incluye:
- Salario base
- Horas extras: se pagan al **doble** de la hora ordinaria (Art. 62 Ley 185)
- Comisiones (si aplica)

### 2. Deducciones del trabajador

**INSS Laboral:** 7% del salario bruto
- Si el salario es C$10,000: INSS = C$700

**IR sobre salarios:** Aplica tabla progresiva DGI 2026:

| Renta anual (C$) | Tasa sobre el exceso |
| --- | --- |
| Hasta 100,000 | Exento |
| 100,001 – 200,000 | 15% |
| 200,001 – 350,000 | 20% |
| 350,001 – 500,000 | 25% |
| Más de 500,000 | 30% |
**IR sobre salarios:** Aplica la tabla progresiva anual de la DGI sobre la renta neta de INSS:
- Hasta C$100,000 anuales: exento
- C$100,000.01 - C$200,000: 15% sobre el exceso
- C$200,000.01 - C$350,000: C$15,000 + 20% sobre el exceso
- C$350,000.01 - C$500,000: C$45,000 + 25% sobre el exceso
- Más de C$500,000: C$82,500 + 30% sobre el exceso

### 3. Aportes patronales

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

### 4. Prestaciones sociales

**Vacaciones:** 15 días hábiles por año trabajado (1.25 días por mes)
Valor: salario_diario × 15

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

### 5. Automatiza este proceso con Nortex

Nortex calcula automáticamente todos estos valores. Solo ingresás el salario base de cada empleado y el sistema hace el resto: INSS, INATEC, IR, vacaciones y aguinaldo en segundos.

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
    category: 'Impuestos Nicaragua',
    cluster: 'impuestos-nicaragua',
    relatedSlugs: ['como-calcular-nomina-nicaragua-2026'],
    faqs: [
      {
        q: '¿Cuál es la tasa de retención IR por servicios profesionales?',
        a: 'La retención en la fuente por servicios profesionales es del 10%. Por compra de bienes y servicios generales es del 2%, y por arrendamiento del 5%.',
      },
      {
        q: '¿Cuándo se declaran las retenciones IR en Nicaragua?',
        a: 'Las retenciones se declaran en la Ventanilla Electrónica Tributaria (VET) antes del día 10 del mes siguiente.',
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

Las retenciones en la fuente son un mecanismo de la DGI donde el comprador retiene un porcentaje del pago al proveedor y lo entrega directamente al fisco.

### Tasas de retención vigentes 2026

| Concepto | Tasa |
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

### ¿Cuándo aplicar retención?

Cuando una empresa compra bienes o servicios por un valor **mayor a C$1,000**, debe retener el porcentaje correspondiente.

**Ejemplo:** Comprás mercadería por C$50,000 + IVA
- IVA 15% = C$7,500
- Total factura = C$57,500
- Retención 2% sobre C$50,000 (base sin IVA) = C$1,000
- **Pagas al proveedor: C$56,500**
- **Entregás a DGI: C$1,000**

### Errores comunes que generan multas

1. No emitir constancia de retención
2. Declarar fuera del plazo (primeros 15 días del mes siguiente)
3. Retener sobre el IVA (solo se retiene sobre la base gravable)
4. No llevar registro de retenciones efectuadas

### Declaración mensual

Las retenciones se declaran en la **VET (Ventanilla Electrónica Tributaria)** dentro de los primeros 15 días de cada mes, junto con la Declaración Mensual de Impuestos (DMI).

Nortex genera automáticamente el reporte de retenciones listo para declarar en la VET.

[Ver cómo funciona →](/register)
    `
  }
];

const postBySlug: Record<string, BlogPost> = Object.fromEntries(
  blogPosts.map((p) => [p.slug, p]),
);

/** Devuelve un post por su slug, o undefined si no existe. */
export function getPost(slug: string | undefined): BlogPost | undefined {
  return slug ? postBySlug[slug] : undefined;
}

/** Posts de un clúster, con el pilar primero y el resto por fecha descendente. */
export function postsByCluster(clusterSlug: string): BlogPost[] {
  return blogPosts
    .filter((p) => p.cluster === clusterSlug)
    .sort((a, b) => {
      if (a.isPillar && !b.isPillar) return -1;
      if (b.isPillar && !a.isPillar) return 1;
      return b.date.localeCompare(a.date);
    });
}

/**
 * Artículos relacionados de un post: usa relatedSlugs si está definido; si no,
 * deriva hasta `limit` hermanos del mismo clúster (incluyendo el pilar).
 */
export function relatedPosts(post: BlogPost, limit = 3): BlogPost[] {
  const explicit = (post.relatedSlugs ?? [])
    .map((s) => postBySlug[s])
    .filter((p): p is BlogPost => Boolean(p) && p!.slug !== post.slug);

  if (explicit.length >= limit) return explicit.slice(0, limit);

  const siblings = postsByCluster(post.cluster).filter(
    (p) => p.slug !== post.slug && !explicit.some((e) => e.slug === p.slug),
  );

  return [...explicit, ...siblings].slice(0, limit);
}

/** Posts ordenados para el índice del blog (más recientes primero). */
export function postsByDate(): BlogPost[] {
  return [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));
}
