/**
 * NORTEX — taxonomía de clústeres del blog (arquitectura de contenido SEO).
 *
 * Cada artículo (`BlogPost.cluster`) referencia un clúster por su `name` EXACTO.
 * Cada clúster tiene un artículo pilar (`pillarSlug`) que es el hub temático; el
 * resto son artículos de soporte que enlazan al pilar y entre sí.
 *
 * Los hubs se publican en /blog/categoria/:slug (ver components/ClusterPage.tsx).
 */

export interface BlogCluster {
    /** slug del hub: /blog/categoria/<slug> */
    slug: string;
    /** nombre EXACTO usado en BlogPost.cluster */
    name: string;
    /** subtítulo/descripción del hub (también meta description del hub) */
    description: string;
    /** slug del artículo pilar del clúster */
    pillarSlug: string;
    /** emoji corto para el chip/hub (sin dependencias de íconos extra) */
    emoji: string;
}

export const blogClusters: BlogCluster[] = [
    {
        slug: 'facturacion-dgi',
        name: 'Facturación DGI',
        description: 'Cómo facturar cumpliendo la DGI en Nicaragua: series, requisitos, facturación electrónica y comprobantes.',
        pillarSlug: 'facturacion-dgi-nicaragua-guia',
        emoji: '🧾',
    },
    {
        slug: 'impuestos-retenciones',
        name: 'Impuestos y Retenciones',
        description: 'Retenciones IR en la fuente, anticipos y obligaciones tributarias mensuales ante la DGI.',
        pillarSlug: 'retenciones-ir-nicaragua-2026',
        emoji: '📊',
    },
    {
        slug: 'iva',
        name: 'IVA',
        description: 'IVA en Nicaragua: tasa, base gravable, exenciones, crédito fiscal y declaración mensual.',
        pillarSlug: 'iva-nicaragua-guia-completa',
        emoji: '💵',
    },
    {
        slug: 'nomina-planillas',
        name: 'Nómina y Planillas',
        description: 'Cálculo de nómina, INSS, INATEC e IR salarial según el Código del Trabajo de Nicaragua.',
        pillarSlug: 'como-calcular-nomina-nicaragua-2026',
        emoji: '👷',
    },
    {
        slug: 'recursos-humanos',
        name: 'Recursos Humanos',
        description: 'Prestaciones laborales, contratos, vacaciones, aguinaldo e indemnización en Nicaragua.',
        pillarSlug: 'prestaciones-laborales-nicaragua-guia',
        emoji: '🤝',
    },
    {
        slug: 'inventario-kardex',
        name: 'Inventario y Kardex',
        description: 'Control de inventario, método Kardex, costeo y rotación de stock para PyMES.',
        pillarSlug: 'control-de-inventario-kardex-nicaragua',
        emoji: '📦',
    },
    {
        slug: 'punto-de-venta',
        name: 'Punto de Venta',
        description: 'Sistemas de punto de venta (POS) para negocios en Nicaragua: qué buscar y cómo elegir.',
        pillarSlug: 'sistema-punto-de-venta-nicaragua-guia',
        emoji: '🛒',
    },
    {
        slug: 'contabilidad-pyme',
        name: 'Contabilidad PyME',
        description: 'Contabilidad básica para pequeños negocios: cuentas, estados financieros y obligaciones.',
        pillarSlug: 'contabilidad-basica-pyme-nicaragua',
        emoji: '📒',
    },
    {
        slug: 'cobranza-credito',
        name: 'Cobranza y Crédito',
        description: 'Gestión de cuentas por cobrar, crédito a clientes y recuperación de cartera.',
        pillarSlug: 'gestion-de-cobranza-cuentas-por-cobrar',
        emoji: '📥',
    },
    {
        slug: 'cuota-fija',
        name: 'Régimen de Cuota Fija',
        description: 'El régimen simplificado de Cuota Fija de la DGI: quién aplica, cuánto se paga y obligaciones.',
        pillarSlug: 'regimen-cuota-fija-nicaragua-guia',
        emoji: '🪙',
    },
    {
        slug: 'ferreterias',
        name: 'Ferreterías',
        description: 'Gestión, inventario y facturación para ferreterías en Nicaragua.',
        pillarSlug: 'como-administrar-una-ferreteria-nicaragua',
        emoji: '🔧',
    },
    {
        slug: 'farmacias',
        name: 'Farmacias',
        description: 'Control de lotes, caducidad y facturación para farmacias en Nicaragua.',
        pillarSlug: 'como-administrar-una-farmacia-nicaragua',
        emoji: '💊',
    },
    {
        slug: 'pulperias-minoristas',
        name: 'Pulperías y Minoristas',
        description: 'Administración de pulperías, mini-súper y negocios minoristas de barrio.',
        pillarSlug: 'como-administrar-una-pulperia-nicaragua',
        emoji: '🏪',
    },
    {
        slug: 'prestamos-microfinanzas',
        name: 'Préstamos y Microfinanzas',
        description: 'Gestión de préstamos, intereses y cartera para prestamistas y microfinancieras.',
        pillarSlug: 'como-gestionar-prestamos-microfinanzas-nicaragua',
        emoji: '🏦',
    },
    {
        slug: 'finanzas-gestion',
        name: 'Finanzas y Gestión',
        description: 'Flujo de caja, márgenes, costos y decisiones financieras para hacer crecer tu negocio.',
        pillarSlug: 'flujo-de-caja-pyme-nicaragua',
        emoji: '📈',
    },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const clustersByName: Record<string, BlogCluster> = Object.fromEntries(
    blogClusters.map(c => [c.name, c]),
);
const clustersBySlug: Record<string, BlogCluster> = Object.fromEntries(
    blogClusters.map(c => [c.slug, c]),
);

export const getClusterByName = (name: string): BlogCluster | undefined => clustersByName[name];
export const getClusterBySlug = (slug: string): BlogCluster | undefined => clustersBySlug[slug];
