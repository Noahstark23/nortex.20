export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  readTime: string;
  category: string;
  content: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'como-calcular-nomina-nicaragua-2026',
    title: 'Cómo calcular la nómina en Nicaragua 2026 (Guía completa Ley 185)',
    description: 'Guía paso a paso para calcular salarios, INSS, INATEC, IR, vacaciones y aguinaldo según el Código del Trabajo de Nicaragua. Con ejemplos reales.',
    date: '2026-03-01',
    readTime: '8 min',
    category: 'Recursos Humanos',
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
- Hasta C$100,000 anuales: exento
- C$100,001 - C$200,000: 15% sobre el exceso
- C$200,001 - C$350,000: 20% sobre el exceso
- C$350,001 - C$500,000: 25% sobre el exceso
- Más de C$500,000: 30% sobre el exceso

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
    category: 'Fiscal',
    content: `
## Retenciones IR Nicaragua 2026

Las retenciones en la fuente son un mecanismo de la DGI donde el comprador retiene un porcentaje del pago al proveedor y lo entrega directamente al fisco.

### Tasas de retención vigentes 2026

**Retención por compra de bienes:** 2%
**Retención por servicios generales:** 2%  
**Retención por servicios profesionales:** 10%
**Retención por arrendamiento:** 5%

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
