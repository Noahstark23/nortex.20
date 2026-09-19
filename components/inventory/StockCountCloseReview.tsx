import React from 'react';
type ReviewItem = { id: string; counted: number | null; expected: number; bookStockAtCapture?: number | string | null; product: { name: string; unit: string } };
/** Solo presenta capturas confirmadas. El servidor vuelve a validar el cierre. */
export function StockCountCloseReview({ items }: { items: ReviewItem[] }) {
    const differences = items.filter(item => item.counted !== null && item.counted !== Number(item.bookStockAtCapture ?? item.expected));
    return <section className="nx-count-close-review" aria-label="Productos que cambiarán">
        <h3>{differences.length ? `${differences.length} ${differences.length === 1 ? 'producto con diferencia' : 'productos con diferencias'}` : 'Las cantidades contadas coinciden'}</h3>
        {differences.length > 0 && <ul>{differences.map(item => <li key={item.id}>
            <strong>{item.product.name}</strong>
            <span>Sistema: {item.bookStockAtCapture ?? item.expected} {item.product.unit} → Contado: {item.counted} {item.product.unit}</span>
        </li>)}</ul>}
    </section>;
}
