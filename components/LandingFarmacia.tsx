import React from 'react';
import IndustryLanding from './public/IndustryLanding';
import { sectorLandingContent } from '../data/sectorLandingContent';

const LandingFarmacia: React.FC = () => (
  <IndustryLanding
    industryLabel="Farmacias"
    industryType="FARMACIA"
    source="landing_farmacia"
    sector={sectorLandingContent.farmacia}
    hero={sectorLandingContent.farmacia.hero}
    intro={sectorLandingContent.farmacia.intro}
    problems={[
      'Búsqueda por nombre, código y categoría para resolver consultas del mostrador.',
      'Inventario y alertas de stock visibles para organizar compras y reposición.',
      'Facturación, caja y seguimiento del equipo dentro de un flujo continuo.',
    ]}
    modules={[
      'Catálogo y búsqueda rápida para productos de alta rotación.',
      'Punto de venta con soporte para escáner de código de barras.',
      'Inventario, kardex y alertas de stock mínimo.',
      'Facturas Serie A/B, IVA y retenciones dentro del flujo operativo.',
      'Clientes, ventas a crédito y seguimiento de cobranza.',
      'Proveedores, órdenes de compra y reportes de ventas diarias.',
      'Usuarios y seguimiento de ventas por integrante del equipo.',
      'Planilla y acceso desde computadora, tableta o teléfono.',
    ]}
    closingBody="Creá tu cuenta con el giro farmacia ya seleccionado y comprobá el flujo con tu equipo durante la prueba."
    footerLinks={[
      { label: 'Para ferreterías', to: '/ferreterias' },
      { label: 'Blog', to: '/blog' },
    ]}
  />
);

export default LandingFarmacia;
