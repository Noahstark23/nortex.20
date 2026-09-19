import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleHelp, Loader2, PlayCircle, RefreshCw, ShoppingCart } from 'lucide-react';
import { useActivationJourney, type ActivationSession } from '../../hooks/useActivationJourney';
import { trackEvent } from '../../utils/analytics';

/** Una acción operativa antes de las cifras, tanto al empezar como al volver. */
export const HomeSalesJourney: React.FC<{ session: ActivationSession }> = ({ session }) => {
    const navigate = useNavigate();
    const progress = useActivationJourney(session);
    const recordedFirstView = useRef(false);

    useEffect(() => {
        if (progress.status !== 'ready' || progress.journey !== 'first' || recordedFirstView.current) return;
        recordedFirstView.current = true;
        trackEvent('activation_first_sale_viewed', {
            source: 'mi_negocio',
            has_products: progress.hasProduct,
            onboarding_step: progress.hasProduct ? 'checkout' : 'product',
        });
    }, [progress.status, progress.journey, progress.hasProduct]);

    const content = progress.journey === 'first'
        ? {
            label: 'Empezá acá', title: 'Hacé tu primera venta', action: 'Registrar primera venta',
            description: progress.hasProduct
                ? 'Elegí un producto de tu catálogo, cobrá y confirmá la venta de tu cliente.'
                : 'Cargá un producto con su nombre, precio y existencia real. Después cobrá la venta de tu cliente.',
        }
        : progress.journey === 'next'
            ? {
                label: 'Ya registraste una venta', title: 'Seguí con tu próximo cliente', action: 'Registrar otra venta',
                description: 'Usá los productos que ya guardaste. Si alguno se agotó, revisá la existencia real antes de venderlo.',
            }
            : {
                label: 'Tu día de trabajo', title: 'Tu próxima venta', action: 'Vender',
                description: 'Buscá o escaneá un producto y cobrá a tu cliente. También podés agregar productos desde la caja.',
            };

    const startSale = () => {
        const first = progress.journey === 'first';
        trackEvent(first ? 'activation_first_sale_started' : 'activation_return_sale_started', {
            source: 'mi_negocio',
            has_products: progress.hasProduct,
            onboarding_step: first && !progress.hasProduct ? 'product' : 'checkout',
        });
        navigate(first ? '/app/pos?first_sale=1' : '/app/pos');
    };

    return (
        <section aria-labelledby="home-sales-title" className="nx-canvas-card p-5 sm:p-7 mb-6">
            <p className="nx-tone-positive text-sm font-bold mb-2">{content.label}</p>
            <h2 id="home-sales-title" className="nx-module-header nx-canvas-text text-2xl sm:text-3xl font-extrabold leading-tight">
                {content.title}
            </h2>
            <p className="nx-canvas-muted mt-3 max-w-xl leading-relaxed">{content.description}</p>
            <button
                type="button"
                onClick={startSale}
                className="nx-fluid-press mt-5 min-h-[52px] w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3 bg-brand border border-brand text-brand-on font-extrabold rounded-control hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
                <ShoppingCart size={20} aria-hidden="true" />{content.action}<ArrowRight size={20} aria-hidden="true" />
            </button>
            {progress.status === 'loading' && (
                <p role="status" className="nx-canvas-muted mt-3 flex items-center gap-2 text-sm">
                    <Loader2 size={15} aria-hidden="true" className="animate-spin" /> Cargando tu progreso…
                </p>
            )}
            {progress.status === 'error' && (
                <div role="alert" className="nx-tone-warning mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span>No pudimos cargar tu progreso. Podés seguir vendiendo.</span>
                    <button type="button" onClick={progress.retry} className="nx-fluid-press min-h-tap inline-flex items-center gap-1 rounded-control px-2 font-bold underline underline-offset-2">
                        <RefreshCw size={15} aria-hidden="true" /> Reintentar
                    </button>
                </div>
            )}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--nx-canvas-border)] pt-3">
                <button
                    type="button"
                    onClick={() => {
                        trackEvent('activation_practice_started', { source: 'mi_negocio' });
                        navigate('/demo?source=onboarding');
                    }}
                    className="nx-fluid-press nx-canvas-muted min-h-tap inline-flex items-center gap-2 rounded-control text-sm font-semibold"
                >
                    <PlayCircle size={17} aria-hidden="true" /> Practicar sin guardar datos
                </button>
                <button type="button" onClick={() => navigate('/app/ayuda')} className="nx-fluid-press nx-canvas-muted min-h-tap inline-flex items-center gap-2 rounded-control text-sm font-semibold">
                    <CircleHelp size={17} aria-hidden="true" /> Necesito ayuda
                </button>
            </div>
        </section>
    );
};
