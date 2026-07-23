import React from 'react';
import { ShoppingBag, Clock } from 'lucide-react';

/**
 * Mercado B2B — OCULTO hasta tener catálogo real.
 *
 * La versión anterior mostraba un catálogo de datos falsos (MOCK_CATALOG) y
 * armaba órdenes que debitaban el wallet real del tenant a partir de precios
 * inventados. Se retiró: un marketplace que mueve dinero real no puede correr
 * sobre datos fantasma. Cuando exista un catálogo real (productos de
 * proveedores/distribuidores en la plataforma) se reconstruye esta pantalla
 * sobre esa fuente. El item de navegación quedó oculto (ver Layout.tsx).
 */
const B2BMarketplace: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="p-4 bg-nortex-accent/10 rounded-2xl mb-5">
        <ShoppingBag size={40} className="text-nortex-accent" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Mercado B2B</h1>
      <p className="text-slate-500 max-w-md mb-4">
        Estamos construyendo el catálogo real de proveedores para que compres
        insumos al por mayor desde Nortex. Pronto vas a poder pedir aquí con tu
        billetera y línea de crédito.
      </p>
      <div className="inline-flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full">
        <Clock size={14} /> Próximamente
      </div>
    </div>
  );
};

export default B2BMarketplace;
