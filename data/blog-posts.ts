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

Calcular correctamente la nómina es una de las obligaciones más importantes para cualquier negocio en Nicaragua. El Código del Trabajo (Ley 185) establece los requisitos mínimos que todo empleador debe cumplir.

### 1. Componentes del salario

El salario bruto de un trabajador en Nicaragua incluye:
- Salario base
- Horas extra: se pagan al **doble** de la hora ordinaria (100% de recargo), sin importar el día de la semana — Art. 62 de la Ley 185. La hora ordinaria equivale al salario mensual dividido entre 240 (30 días × 8 horas).
- Recargo por día feriado trabajado: 100% adicional sobre el día — Art. 68 de la Ley 185
- Comisiones (si aplica)

### 2. Deducciones del trabajador

**INSS Laboral:** 7% del salario bruto
- Si el salario es C$10,000: INSS = C$700

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
