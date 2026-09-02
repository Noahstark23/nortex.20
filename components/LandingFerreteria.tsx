import React from 'react';
import IndustryLanding from './public/IndustryLanding';

const LandingFerreteria: React.FC = () => (
  <IndustryLanding
    industryLabel="Ferreterías"
    industryType="FERRETERIA"
    source="landing_ferreteria"
    hero="Mostrador rápido, inventario ordenado y caja clara para tu ferretería."
    intro="Pensado para negocios con catálogos extensos, compras frecuentes y atención intensa en mostrador. Nortex conecta la venta con inventario, caja y cobranza sin obligar al equipo a saltar entre herramientas."
    problems={[
      'Búsqueda por nombre, código y categoría para atender sin frenar al vendedor.',
      'Inventario, alertas y kardex visibles para saber qué se movió y qué toca reponer.',
      'Caja, ventas a crédito y compras dentro de una misma operación diaria.',
    ]}
    modules={[
      'Productos, categorías y presentaciones con una lectura clara del catálogo.',
      'Punto de venta con búsqueda rápida y soporte para escáner de código de barras.',
      'Inventario, kardex y alertas de stock mínimo para apoyar la reposición.',
      'Facturas Serie A/B, IVA y retenciones dentro del flujo operativo.',
      'Clientes, ventas a crédito y seguimiento de cobranza.',
      'Proveedores, órdenes de compra y reportes de ventas diarias.',
      'Cotizaciones en PDF para preparar ventas antes de pasar por caja.',
      'Planilla y seguimiento del equipo desde el mismo sistema.',
    ]}
    closingBody="Creá tu cuenta con el giro ferretería ya seleccionado y revisá el producto con tus propios datos durante la prueba."
    footerLinks={[
      { label: 'Para farmacias', to: '/farmacias' },
      { label: 'Blog', to: '/blog' },
    ]}
  />
);

export default LandingFerreteria;
