// data/blog-clusters.ts
// Taxonomía de clústeres temáticos del blog (modelo pillar + cluster).
// Cada artículo de data/blog-posts.ts declara `cluster` con el `name` de uno
// de estos clústeres. El hub vive en /blog/categoria/:slug (ver ClusterPage).
export interface BlogCluster {
  id: string;
  name: string;        // debe coincidir EXACTO con BlogPost.cluster
  slug: string;        // /blog/categoria/<slug>
  description: string;
  pillarSlug: string;  // slug del artículo pilar (vacío si el clúster no tiene uno único)
}

export const blogClusters: BlogCluster[] = [
  { id: 'INV', name: 'Inventarios', slug: 'inventarios', pillarSlug: 'control-de-inventario',
    description: 'Control de inventario, Kardex, costeo y bodega para PyMES de Nicaragua.' },
  { id: 'FAC', name: 'Facturación', slug: 'facturacion', pillarSlug: 'como-facturar-en-nicaragua',
    description: 'Facturación que cumple la DGI: tipos de factura, notas, crédito fiscal y errores.' },
  { id: 'POS', name: 'Punto de Venta (POS)', slug: 'pos', pillarSlug: 'que-es-un-pos',
    description: 'Sistemas de punto de venta para vender más rápido y cuadrar la caja.' },
  { id: 'ADM', name: 'Administración y ERP', slug: 'administracion', pillarSlug: 'que-es-un-erp',
    description: 'ERP, indicadores, flujo de caja y márgenes para administrar con números.' },
  { id: 'COM', name: 'Compras', slug: 'compras', pillarSlug: 'como-comprar-para-un-negocio',
    description: 'Compras, proveedores, órdenes y recepción para cuidar tu margen.' },
  { id: 'VEN', name: 'Ventas', slug: 'ventas', pillarSlug: 'como-aumentar-las-ventas',
    description: 'Tácticas para vender más: ticket promedio, cross/up selling y fidelización.' },
  { id: 'RH', name: 'Recursos Humanos y Nómina', slug: 'recursos-humanos', pillarSlug: 'como-calcular-nomina-nicaragua-2026',
    description: 'Nómina, INSS, INATEC, vacaciones, aguinaldo y liquidaciones (Ley 185).' },
  { id: 'CON', name: 'Contabilidad', slug: 'contabilidad', pillarSlug: 'contabilidad-para-pymes-nicaragua',
    description: 'Estados financieros, asientos y NIIF para PyMES, explicado simple.' },
  { id: 'IMP', name: 'Impuestos Nicaragua', slug: 'impuestos-nicaragua', pillarSlug: 'impuestos-en-nicaragua',
    description: 'IVA, IR, retenciones, cuota fija y calendario tributario de la DGI.' },
  { id: 'EMP', name: 'Emprendimiento', slug: 'emprendimiento', pillarSlug: 'como-abrir-un-negocio-en-nicaragua',
    description: 'De la idea al negocio formal: abrir, administrar y hacer crecer una PyME.' },
  { id: 'TEC', name: 'Tecnología', slug: 'tecnologia', pillarSlug: 'tecnologia-para-pymes',
    description: 'SaaS, nube, seguridad, backups y código de barras para negocios.' },
  { id: 'IA', name: 'Inteligencia Artificial', slug: 'ia-negocios', pillarSlug: 'ia-para-negocios',
    description: 'IA aplicada a inventario, ventas, atención al cliente y reportes.' },
  { id: 'CAS', name: 'Casos reales', slug: 'casos', pillarSlug: '',
    description: 'Cómo negocios reales de Nicaragua resolvieron sus problemas con Nortex.' },
  { id: 'CMP', name: 'Comparativas', slug: 'comparativas', pillarSlug: '',
    description: 'Comparaciones honestas: ERP vs Excel, POS vs caja, Nortex vs alternativas.' },
  { id: 'IND', name: 'Guías por industria', slug: 'guias', pillarSlug: '',
    description: 'Guías completas por rubro: ferreterías, farmacias, pulperías, restaurantes y más.' },
];

export const clusterBySlug = (slug: string): BlogCluster | undefined =>
  blogClusters.find((c) => c.slug === slug);

export const clusterByName = (name: string): BlogCluster | undefined =>
  blogClusters.find((c) => c.name === name);
