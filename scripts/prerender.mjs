// scripts/prerender.mjs
// Ejecutar DESPUÉS de npm run build
import fs from 'fs';
import path from 'path';

const DIST = './dist';
const indexHTML = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');

// Inyectar contenido textual visible para Google en el index.html del build
// Esto asegura que los crawlers vean texto aunque no ejecuten JS

const seoContent = `
<div id="seo-content" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;" aria-hidden="true">
  <h1>Nortex - Sistema de Facturación e Inventario para Nicaragua</h1>
  <p>Sistema POS para ferreterías y farmacias en Nicaragua. Facturación compatible con DGI, control de inventario en tiempo real, nómina según Ley 185.</p>
  <h2>Características principales</h2>
  <ul>
    <li>Punto de Venta POS para ferreterías Nicaragua</li>
    <li>Sistema de inventario con Kardex para farmacias Nicaragua</li>
    <li>Facturación DGI Nicaragua - Series A y B</li>
    <li>Nómina y planillas según Código del Trabajo Nicaragua</li>
    <li>Control de retenciones IR y IVA</li>
    <li>Reportes financieros para PyMES Nicaragua</li>
    <li>Sistema de cobranza y créditos para pequeños negocios</li>
  </ul>
  <p>Nortex es el sistema de facturación más completo para pequeñas y medianas empresas en Nicaragua. Compatible con normativas DGI 2026.</p>
</div>
`;

// Insertar el contenido SEO justo después del <body>
const modifiedHTML = indexHTML.replace(
  '<div id="root"></div>',
  `${seoContent}\n    <div id="root"></div>`
);

fs.writeFileSync(path.join(DIST, 'index.html'), modifiedHTML);
console.log('✅ SEO content injected into dist/index.html');
