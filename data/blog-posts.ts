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
  date: string;
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
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'como-calcular-nomina-nicaragua-2026',
    title: 'Cómo calcular la nómina en Nicaragua 2026 (Guía completa Ley 185)',
    description: 'Guía paso a paso para calcular salarios, INSS, INATEC, IR, vacaciones y aguinaldo según el Código del Trabajo de Nicaragua. Con ejemplos reales.',
    date: '2026-03-01',
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
      },
    ],
    content: `
## Cómo calcular la nómina en Nicaragua 2026

Calcular correctamente la nómina es una de las obligaciones más importantes para cualquier negocio en Nicaragua. El Código del Trabajo (Ley 185) establece los requisitos mínimos que todo empleador debe cumplir.

### 1. Componentes del salario

El salario bruto de un trabajador en Nicaragua incluye:
- Salario base
- Horas extras (50% adicional días hábiles, 100% domingos y feriados)
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

### 3. Aportes patronales

**INSS Patronal:** 21.5% del salario bruto (2026)
**INATEC:** 2% del salario bruto

**Ejemplo para salario de C$15,000:**
- INSS Patronal: C$3,225
- INATEC: C$300
- **Costo total para el empleador: C$18,525**

### 4. Prestaciones sociales

**Vacaciones:** 15 días hábiles por año trabajado (1.25 días por mes)
Valor: salario_diario × 15

**Décimo tercer mes (Aguinaldo):** 1/12 del salario por mes trabajado
Se paga la primera quincena de diciembre.

**Indemnización:** 1 mes de salario por año trabajado

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
      },
    ],
    content: `
## Retenciones IR Nicaragua 2026

Las retenciones en la fuente son un mecanismo de la DGI donde el comprador retiene un porcentaje del pago al proveedor y lo entrega directamente al fisco.

### Tasas de retención vigentes 2026

| Concepto | Tasa |
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
- Retención 2% sobre C$50,000 = C$1,000
- **Pagas al proveedor: C$56,500**
- **Entregás a DGI: C$1,000**

### Errores comunes que generan multas

1. No emitir constancia de retención
2. Declarar fuera del plazo (10 del mes siguiente)
3. Retener sobre el IVA (solo se retiene sobre la base gravable)
4. No llevar registro de retenciones efectuadas

### Declaración mensual

Las retenciones se declaran en la **VET (Ventanilla Electrónica Tributaria)** antes del día 10 de cada mes.

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
