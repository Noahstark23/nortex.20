import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Venta en curso — canal entre el POS y el menú que lo rodea.
 *
 * POR QUÉ EXISTE: el sidebar está montado ALREDEDOR del POS (`App.tsx`), así que
 * un clic en cualquier ítem del menú desmonta la caja. El carrito ya sobrevive
 * (utils/cartPersistence.ts), así que salir dejó de destruir la venta — pero el
 * cajero no tiene forma de saberlo, y un carrito que "desaparece" asusta igual
 * aunque después vuelva.
 *
 * Por qué NO se usa `useBlocker` de react-router: exige un data router
 * (`createBrowserRouter`) y la app monta `<BrowserRouter>` (App.tsx). Migrar
 * todo el ruteo por este aviso sería desproporcionado; el menú es el único
 * camino de salida que importa y está acá al lado.
 *
 * Se parte en DOS contextos a propósito: el POS solo consume el setter —que es
 * estable— así que reportar el carrito en cada tecla no lo re-renderiza. El
 * único que re-renderiza al cambiar la venta es el Layout, que es chico.
 */

export interface VentaEnCurso {
    hayVenta: boolean;
    lineas: number;
    total: number;
}

const SIN_VENTA: VentaEnCurso = { hayVenta: false, lineas: 0, total: 0 };

const VentaEnCursoCtx = createContext<VentaEnCurso>(SIN_VENTA);
const ReportarVentaCtx = createContext<(v: VentaEnCurso) => void>(() => { /* sin provider: no-op */ });

export const VentaEnCursoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [venta, setVenta] = useState<VentaEnCurso>(SIN_VENTA);

    // Se ignoran los reportes que no cambian nada: sin esto, cada render del POS
    // empujaría un objeto nuevo y el Layout se re-renderizaría de gusto.
    const reportar = useCallback((v: VentaEnCurso) => {
        setVenta(prev =>
            prev.hayVenta === v.hayVenta && prev.lineas === v.lineas && prev.total === v.total ? prev : v
        );
    }, []);

    const valor = useMemo(() => venta, [venta]);

    return (
        <ReportarVentaCtx.Provider value={reportar}>
            <VentaEnCursoCtx.Provider value={valor}>{children}</VentaEnCursoCtx.Provider>
        </ReportarVentaCtx.Provider>
    );
};

/** Para el menú: qué venta hay abierta ahora mismo. */
export const useVentaEnCurso = (): VentaEnCurso => useContext(VentaEnCursoCtx);

/** Para el POS: publicar el estado del carrito. La función es estable. */
export const useReportarVenta = (): ((v: VentaEnCurso) => void) => useContext(ReportarVentaCtx);
