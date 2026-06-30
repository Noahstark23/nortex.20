// data/blog-clusters.ts
// Taxonomía pillar/cluster del blog (ver el Plan de Contenido SEO).
//
// Cada clúster agrupa un artículo PILAR (guía amplia, keyword cabeza) y varios
// artículos de clúster (cola larga) que enlazan de vuelta al pilar. El hub
// /blog/categoria/:slug renderiza cada clúster y concentra la autoridad temática.
//
// `pillarSlug` apunta al slug del artículo pilar en data/blog-posts.ts. Puede ser
// null en clústeres sin pilar definido (Comparativas, Casos reales).

export interface BlogCluster {
  /** Slug del hub: /blog/categoria/<slug> */
  slug: string;
  /** Nombre visible del clúster (badge y títulos). */
  name: string;
  /** Slug del artículo pilar (o null si aún no hay pilar). */
  pillarSlug: string | null;
  /** Meta title del hub (≤ 60 caracteres recomendado). */
  metaTitle: string;
  /** Meta description del hub (≤ 155 caracteres recomendado). */
  metaDescription: string;
  /** H1 del hub. */
  h1: string;
  /** Intro visible del hub. */
  intro: string;
  /** Orden de aparición en el índice del blog. */
  order: number;
}

export const blogClusters: BlogCluster[] = [
  {
    slug: 'inventarios',
    name: 'Inventarios',
    pillarSlug: 'control-de-inventario-nicaragua',
    metaTitle: 'Control de Inventario para PyMES en Nicaragua | Nortex',
    metaDescription:
      'Guías de control de inventario, Kardex, costeo, stock mínimo y conteos físicos para negocios en Nicaragua. Aprendé a no perder dinero por descontrol.',
    h1: 'Control de inventario para negocios en Nicaragua',
    intro:
      'Todo sobre controlar tu stock sin perder dinero: Kardex, costeo, mínimos, conteos físicos y mermas, explicado para PyMES nicaragüenses.',
    order: 1,
  },
  {
    slug: 'guias-industria',
    name: 'Guías por industria',
    pillarSlug: null,
    metaTitle: 'Guías por Industria para PyMES en Nicaragua | Nortex',
    metaDescription:
      'Guías de gestión por rubro: ferreterías, farmacias, pulperías, distribuidoras y más. Inventario, facturación y ventas adaptados a tu negocio.',
    h1: 'Guías por industria para negocios de Nicaragua',
    intro:
      'Cómo gestionar tu negocio según tu rubro: ferretería, farmacia, pulpería, distribuidora y más, con ejemplos y cifras locales.',
    order: 2,
  },
  {
    slug: 'facturacion',
    name: 'Facturación',
    pillarSlug: 'como-facturar-en-nicaragua',
    metaTitle: 'Cómo Facturar en Nicaragua (DGI) | Guías Nortex',
    metaDescription:
      'Facturación electrónica y DGI en Nicaragua: series, retenciones, notas de crédito y errores comunes. Guías prácticas para PyMES.',
    h1: 'Facturación DGI en Nicaragua',
    intro:
      'Cómo emitir facturas que cumplen con la DGI: series, retenciones, comprobantes, notas de crédito y los errores que generan multas.',
    order: 3,
  },
  {
    slug: 'impuestos-nicaragua',
    name: 'Impuestos Nicaragua',
    pillarSlug: 'impuestos-en-nicaragua',
    metaTitle: 'Impuestos en Nicaragua para PyMES | Guías Nortex',
    metaDescription:
      'IVA, IR, retenciones, cuota fija y calendario DGI explicados para PyMES de Nicaragua. Evitá multas y declará a tiempo.',
    h1: 'Impuestos en Nicaragua para PyMES',
    intro:
      'IVA, IR, retenciones en la fuente, cuota fija y el calendario de la DGI, explicados con ejemplos de cálculo para tu negocio.',
    order: 4,
  },
  {
    slug: 'administracion-erp',
    name: 'Administración y ERP',
    pillarSlug: 'que-es-un-erp',
    metaTitle: 'Administración y ERP para PyMES en Nicaragua | Nortex',
    metaDescription:
      'Qué es un ERP, cómo administrar una PyME y qué procesos digitalizar primero. Guías de gestión para negocios nicaragüenses.',
    h1: 'Administración y ERP para PyMES',
    intro:
      'Qué es un ERP, cómo ordenar la administración de tu negocio y qué digitalizar primero para crecer sin caos.',
    order: 5,
  },
  {
    slug: 'recursos-humanos-nomina',
    name: 'Recursos Humanos y Nómina',
    pillarSlug: 'como-calcular-nomina-nicaragua-2026',
    metaTitle: 'Nómina y RRHH en Nicaragua (Ley 185) | Nortex',
    metaDescription:
      'Cómo calcular nómina, INSS, INATEC, IR, vacaciones, aguinaldo e indemnización según la Ley 185 de Nicaragua. Guías con ejemplos.',
    h1: 'Recursos Humanos y nómina en Nicaragua',
    intro:
      'Cómo calcular la nómina y cumplir el Código del Trabajo (Ley 185): INSS, INATEC, IR, vacaciones, aguinaldo e indemnización.',
    order: 6,
  },
  {
    slug: 'contabilidad',
    name: 'Contabilidad',
    pillarSlug: 'contabilidad-para-pymes',
    metaTitle: 'Contabilidad para PyMES en Nicaragua | Nortex',
    metaDescription:
      'Contabilidad básica para PyMES de Nicaragua: estados financieros, flujo de caja, costos y conceptos clave sin jerga contable.',
    h1: 'Contabilidad para PyMES',
    intro:
      'Contabilidad sin jerga: estados financieros, flujo de caja, costos y márgenes para que tomés mejores decisiones.',
    order: 7,
  },
  {
    slug: 'punto-de-venta',
    name: 'Punto de Venta (POS)',
    pillarSlug: 'que-es-un-pos',
    metaTitle: 'Punto de Venta (POS) para PyMES en Nicaragua | Nortex',
    metaDescription:
      'Qué es un POS, cómo elegirlo y cómo usarlo para vender más rápido y controlar la caja en tu negocio en Nicaragua.',
    h1: 'Punto de venta (POS) para negocios',
    intro:
      'Qué es un punto de venta, cómo elegirlo y cómo te ayuda a vender más rápido y cuadrar la caja todos los días.',
    order: 8,
  },
  {
    slug: 'ventas',
    name: 'Ventas',
    pillarSlug: 'como-aumentar-las-ventas',
    metaTitle: 'Cómo Aumentar las Ventas de tu Negocio | Nortex',
    metaDescription:
      'Estrategias prácticas para vender más en Nicaragua: precios, promociones, fidelización y atención al cliente para PyMES.',
    h1: 'Cómo aumentar las ventas de tu negocio',
    intro:
      'Tácticas concretas para vender más: precios, promociones, fidelización y atención, pensadas para PyMES nicaragüenses.',
    order: 9,
  },
  {
    slug: 'tecnologia',
    name: 'Tecnología',
    pillarSlug: 'tecnologia-para-pymes',
    metaTitle: 'Tecnología para PyMES en Nicaragua | Nortex',
    metaDescription:
      'Qué herramientas digitales necesita una PyME en Nicaragua: software, pagos, internet y seguridad. Guías sin tecnicismos.',
    h1: 'Tecnología para PyMES',
    intro:
      'Qué herramientas digitales sí valen la pena para una PyME: software, pagos, conectividad y seguridad, sin tecnicismos.',
    order: 10,
  },
  {
    slug: 'inteligencia-artificial',
    name: 'Inteligencia Artificial',
    pillarSlug: 'ia-para-negocios',
    metaTitle: 'IA para Negocios en Nicaragua | Guías Nortex',
    metaDescription:
      'Cómo usar inteligencia artificial en una PyME: atención al cliente, pronóstico de demanda, contenido y productividad. Casos prácticos.',
    h1: 'Inteligencia artificial para negocios',
    intro:
      'Usos reales de la IA en una PyME: atención al cliente, pronóstico de demanda, contenido y productividad del día a día.',
    order: 11,
  },
  {
    slug: 'compras',
    name: 'Compras',
    pillarSlug: 'como-comprar-para-un-negocio',
    metaTitle: 'Compras y Proveedores para PyMES | Nortex',
    metaDescription:
      'Cómo comprar para tu negocio: proveedores, órdenes de compra, costos de importación y negociación. Guías para PyMES en Nicaragua.',
    h1: 'Compras y proveedores para tu negocio',
    intro:
      'Cómo comprar mejor: elegir proveedores, órdenes de compra, costos de importación y negociar precios sin perder margen.',
    order: 12,
  },
  {
    slug: 'comparativas',
    name: 'Comparativas',
    pillarSlug: null,
    metaTitle: 'Comparativas de Software para PyMES | Nortex',
    metaDescription:
      'Comparativas honestas de software de gestión: ERP vs Excel, sistemas POS, facturación y más, con el contexto de Nicaragua.',
    h1: 'Comparativas de software para PyMES',
    intro:
      'Comparativas honestas para decidir bien: ERP vs Excel, sistemas POS, software de facturación y alternativas para tu negocio.',
    order: 13,
  },
  {
    slug: 'emprendimiento',
    name: 'Emprendimiento',
    pillarSlug: 'como-abrir-un-negocio-en-nicaragua',
    metaTitle: 'Cómo Abrir un Negocio en Nicaragua | Nortex',
    metaDescription:
      'Guía para emprender en Nicaragua: trámites, registro, capital inicial, cuota fija y primeros pasos para abrir tu negocio.',
    h1: 'Cómo abrir un negocio en Nicaragua',
    intro:
      'Pasos para emprender en Nicaragua: trámites, registro DGI, capital inicial, cuota fija y cómo arrancar con el pie derecho.',
    order: 14,
  },
  {
    slug: 'casos-reales',
    name: 'Casos reales',
    pillarSlug: null,
    metaTitle: 'Casos Reales de PyMES en Nicaragua | Nortex',
    metaDescription:
      'Historias reales de negocios nicaragüenses que ordenaron inventario, facturación y ventas con un sistema de gestión.',
    h1: 'Casos reales de negocios en Nicaragua',
    intro:
      'Historias de negocios nicaragüenses que ordenaron su inventario, facturación y ventas, con resultados concretos.',
    order: 15,
  },
];

const clusterBySlug: Record<string, BlogCluster> = Object.fromEntries(
  blogClusters.map((c) => [c.slug, c]),
);

/** Devuelve un clúster por su slug, o undefined si no existe. */
export function getCluster(slug: string | undefined): BlogCluster | undefined {
  return slug ? clusterBySlug[slug] : undefined;
}

/** Clústeres ordenados para mostrar en el índice del blog. */
export function orderedClusters(): BlogCluster[] {
  return [...blogClusters].sort((a, b) => a.order - b.order);
}
