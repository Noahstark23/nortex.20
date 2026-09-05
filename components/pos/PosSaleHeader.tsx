import type { ReactNode } from 'react';

export interface PosSaleHeaderProps {
    simple: boolean;
    firstSale: boolean;
    businessName: string;
    cashierName?: string;
    children: ReactNode;
}

/** Cabecera operativa: identidad compacta y acciones existentes, sin estado de venta. */
export const PosSaleHeader = ({ simple, firstSale, businessName, cashierName, children }: PosSaleHeaderProps) => (
    <header data-nx-theme={simple ? 'light' : 'dark'} className={`nx-pos-header nx-shell-border absolute inset-x-0 top-0 z-10 flex min-w-0 items-center justify-between gap-2 border-b px-3 sm:px-4 lg:gap-3 lg:px-6 ${simple ? 'h-16' : 'nx-dark-chrome h-14'}`}>
        <div className="nx-pos-header-identity flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
            <h1 className="nx-shell-text shrink-0 text-sm font-bold tracking-tight">
                {firstSale ? 'Primera venta' : 'Nueva venta'}
            </h1>
            {businessName && <span className="nx-shell-muted min-w-0 truncate text-xs" title={businessName}>
                {businessName}
            </span>}
            {cashierName && <span className="nx-shell-muted hidden min-w-0 max-w-40 truncate text-xs lg:inline" title={`Caja: ${cashierName}`}>
                Caja: {cashierName}
            </span>}
        </div>
        <div role="group" aria-label="Acciones de venta" className="flex min-w-0 max-w-[55%] shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap py-1 lg:max-w-[70%] [&>*]:shrink-0">
            {children}
        </div>
    </header>
);

export default PosSaleHeader;
