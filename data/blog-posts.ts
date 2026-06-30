export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;                 // fecha de última actualización (SEO: dateModified)
  readTime: string;
  category: string;                 // badge visible
  cluster?: string;                 // clúster temático (matchea data/blog-clusters.ts -> name)
  keyword?: string;                 // keyword objetivo principal
  relatedSlugs?: string[];          // enlazado interno explícito (pillar/cluster)
  faq?: { q: string; a: string }[]; // bloque FAQ -> FAQPage JSON-LD
  content: string;
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
- INSS Patronal (21.5%): C$3,225
- INATEC (2%): C$300
- **Costo total para el empleador: C$18,525**

### 4. Prestaciones sociales

**Vacaciones:** 15 días por cada 6 meses trabajados, es decir 2.5 días por mes (30 días al año), Art. 76.
Valor: salario_diario × días acumulados.

**Décimo tercer mes (Aguinaldo):** 1/12 del salario por mes trabajado.
Se paga en los primeros diez días de diciembre.

**Indemnización por antigüedad (Art. 45):** 1 mes de salario por cada uno de los primeros 3 años y 20 días por cada año a partir del cuarto, con un máximo de 5 meses. Aplica en despido o mutuo acuerdo, no en renuncia.

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
    category: 'Fiscal',
    cluster: 'Impuestos Nicaragua',
    keyword: 'retenciones ir nicaragua',
    relatedSlugs: ['iva-en-nicaragua', 'ir-en-nicaragua', 'impuestos-en-nicaragua'],
    faq: [
      { q: '¿Cuál es la tasa de retención por compra de bienes?', a: 'La retención en la fuente por compra de bienes y servicios generales es del 2% sobre la base gravable (sin IVA).' },
      { q: '¿Cuándo se declaran las retenciones IR?', a: 'Las retenciones se enteran a la DGI dentro de los primeros 15 días del mes siguiente, a través de la Ventanilla Electrónica Tributaria (VET).' },
    ],
    content: `
## Retenciones IR Nicaragua 2026

Las retenciones en la fuente son un mecanismo de la DGI donde el comprador retiene un porcentaje del pago al proveedor y lo entrega directamente al fisco.

### Tasas de retención vigentes 2026

**Retención por compra de bienes:** 2%
**Retención por servicios generales:** 2%
**Retención por servicios profesionales (personas naturales):** 10%
**Arrendamientos:** la tasa depende de si el ingreso es renta de actividad económica o renta de capital; confirmá el caso con tu contador.

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
