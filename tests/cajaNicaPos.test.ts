import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const pos = source('components/POS.tsx');
const layout = source('components/Layout.tsx');
const catalog = source('components/pos/CajaNicaCatalog.tsx');
const checkoutDock = source('components/pos/CajaNicaCheckout.tsx');

const between = (contents: string, start: string, end: string): string => {
    const startAt = contents.indexOf(start);
    const endAt = contents.indexOf(end, startAt + start.length);

    expect(startAt, `No se encontró el inicio del contrato: ${start}`).toBeGreaterThanOrEqual(0);
    expect(endAt, `No se encontró el final del contrato: ${end}`).toBeGreaterThan(startAt);
    return contents.slice(startAt, endAt);
};

describe('cobro sin atajos peligrosos', () => {
    it('valida el efectivo antes de la cola offline o el POST de venta', () => {
        const checkout = between(pos, 'const handleCheckout', 'const efectivoRecibidoDeLaVenta');
        const cashGuard = between(checkout, "if (method === 'CASH')", 'if (hasQuotationLines');
        const validationAt = checkout.indexOf('validateCashReceived(cashReceived, grandTotalD)');
        const offlineAt = checkout.indexOf('if (!navigator.onLine)');
        const postAt = checkout.indexOf("fetch('/api/sales'");

        expect(cashGuard).toContain('if (cashValidation.ok === false)');
        expect(cashGuard).toContain('setShowCashPreModal(true)');
        expect(cashGuard).toContain('playErrorBeep()');
        expect(cashGuard).toContain('return;');
        expect(validationAt).toBeGreaterThanOrEqual(0);
        expect(offlineAt).toBeGreaterThan(validationAt);
        expect(postAt).toBeGreaterThan(offlineAt);
    });

    it('Ctrl/Cmd+Enter abre recibido y vuelto en vez de registrar efectivo', () => {
        const ctrlEnter = between(pos, "if (e.key === 'Enter')", '// F-keys always work');

        expect(ctrlEnter).toContain('openCashCheckout()');
        expect(ctrlEnter).not.toMatch(/handleCheckout\(\s*['"]CASH['"]\s*\)/);
    });

    it('F9 comparte la misma entrada segura y bloquea repetición', () => {
        const f9 = between(pos, "case 'F9':", "case 'Escape':");

        expect(f9).toContain('e.repeat');
        expect(f9).toContain('showCashPreModal');
        expect(f9).toContain('openCashCheckout()');
        expect(f9).not.toMatch(/handleCheckout\(\s*['"]CASH['"]\s*\)/);
    });

    it('la caja guiada cobra efectivo directo y mantiene recibido/vuelto dentro del ticket', () => {
        const guidedCheckout = between(
            pos,
            'La caja guiada usa efectivo directo y expande recibido/vuelto',
            '!guidedSimpleMode && isCreditBlocked',
        );

        expect(guidedCheckout).toContain('<CajaNicaCheckout');
        expect(guidedCheckout).toContain('cashOpen={showCashPreModal}');
        expect(guidedCheckout).toContain('onOpenCash={openCashCheckout}');
        expect(guidedCheckout).toContain("onConfirmCash={() => { void handleCheckout('CASH'); }}");
        expect(guidedCheckout).toContain('onOtherPayment={openOtherPaymentCheckout}');
        expect(pos).toContain("const [showCashPreModal, setShowCashPreModal] = useState(false);");

        // El modo guiado no debe volver a abrir un modal centrado para el
        // efectivo: el estado ya vive en el ticket persistente.
        expect(pos).toContain('showCashPreModal && !guidedSimpleMode');
        expect(checkoutDock).toContain('validateCashReceived(cashReceived, total)');
        expect(checkoutDock).toContain('Cobrar {formatMoney(total)} en efectivo');
        expect(checkoutDock).toContain('Efectivo recibido');
        expect(checkoutDock).toContain('Vuelto');
        expect(checkoutDock).toContain('Falta {formatMoney(paymentError.shortfall)}');
        expect(checkoutDock).toContain('Otro pago');
        expect(checkoutDock).toContain('disabled={!ready || disabled || processing}');
    });
});

describe('búsqueda operable con Enter', () => {
    it('solo agrega un SKU exacto o una coincidencia única', () => {
        const searchKeyDown = between(pos, 'const handleSearchKeyDown', 'const resetReturnFlow');
        expect(searchKeyDown).toContain('resolverEnterBusqueda(indiceProductos, term)');
        expect(searchKeyDown).toContain("resolution.kind === 'ambiguous'");
        expect(searchKeyDown).toContain('Tocá el producto correcto');
        expect(searchKeyDown).toContain('const selected = resolution.product');
        expect(searchKeyDown).toContain('agregarDesdeGrilla(selected)');
        expect(searchKeyDown).toContain("setSearchTerm('')");
        expect(searchKeyDown).not.toContain('processScannedCode(term)');
    });

    it('conserva la búsqueda y anuncia el error cuando no hay coincidencias', () => {
        const searchKeyDown = between(pos, 'const handleSearchKeyDown', 'const resetReturnFlow');
        const noResult = between(searchKeyDown, "if (resolution.kind === 'none')", "if (resolution.kind === 'ambiguous')");

        expect(noResult).toContain('No encontramos');
        expect(noResult).toContain("type: 'error'");
        expect(noResult).toContain('playErrorBeep()');
        expect(noResult).not.toContain("setSearchTerm('')");
    });
});

describe('superficie de caja a ancho completo', () => {
    it('oculta navegación e instalación solo en /app/pos', () => {
        expect(layout).toContain("const isPosSurface = location.pathname === '/app/pos'");
        expect(layout).toContain("isPosSurface ? 'hidden' : 'hidden lg:flex'");
        expect(layout).toContain("isPosSurface ? 'hidden' : 'flex lg:hidden'");
        expect(layout).toContain('showMobileMenu && !isPosSurface');
        expect(layout).toContain("isPosSurface ? 'mb-0' : 'mb-16 lg:mb-0'");
        expect(layout).toContain('{!isPosSurface && <InstallPrompt />}');
    });
});

describe('catálogo táctil y accesible', () => {
    it('respeta el paso configurado desde la primera pulsación del producto', () => {
        const addToCart = between(pos, 'const addToCart = useCallback', 'const addPackToCart');

        expect(addToCart).toContain('const initialQuantity = repeatedCatalogAddIncrement(product)');
        expect(addToCart).toContain('quantity: initialQuantity');
        expect(addToCart).not.toContain('quantity: 1, cartLineId: product.id');
    });

    it('usa pestañas navegables por teclado con relación tab/panel', () => {
        expect(catalog).toContain('role="tablist"');
        expect(catalog).toContain('aria-label="Categorías de productos"');
        expect(catalog).toContain('role="tab"');
        expect(catalog).toContain('aria-selected={selected}');
        expect(catalog).toContain('aria-controls={panelId}');
        expect(catalog).toContain("event.key === 'ArrowRight'");
        expect(catalog).toContain("event.key === 'ArrowLeft'");
        expect(catalog).toContain("event.key === 'Home'");
        expect(catalog).toContain("event.key === 'End'");
        expect(catalog).toContain("role={categories.length > 0 ? 'tabpanel' : undefined}");
    });

    it('mantiene estructura de lista y no activa productos agotados', () => {
        expect(catalog).toContain('<ul className=');
        expect(catalog).toContain('<li key={product.id}');
        expect(catalog).toContain('type="button"');
        expect(catalog).toContain('aria-disabled={blocked || undefined}');
        expect(catalog).toContain('if (blocked) onBlocked(product)');
        expect(catalog).toContain('else onAdd(product)');
        expect(catalog).toContain('aria-live="polite"');
        expect(catalog).toContain('No encontramos productos para');
    });

    it('declara el recorte y ofrece continuar sin montar todo el catálogo', () => {
        expect(pos).toContain("return ['Todos', ...categories]");
        expect(pos).not.toContain('categories.slice(0, 4)');
        expect(catalog).toContain('products.length === totalProducts');
        expect(catalog).toContain('Quedan {totalProducts - products.length} por mostrar');
        expect(catalog).toContain('Mostrar más productos');
        expect(pos).toContain('onShowMore={() => setCajaVisibleLimit');
    });
});
