import { useEffect, useRef, useState } from 'react';

export type ExchangeCustomer = {
    id: string;
    name: string;
    phone?: string;
    creditLimit: number;
    currentDebt: number;
    storeCreditBalance: number;
    isBlocked: boolean;
    isWholesale?: boolean;
};

type Toast = (input: { tone: 'success'; title: string; message: string }) => void;

export const useStoreCreditCheckout = (
    token: string | null,
    headers: HeadersInit,
    showToast: Toast,
) => {
    const [useStoreCredit, setUseStoreCredit] = useState(false);
    const [sourceReturnId, setSourceReturnId] = useState<string | null>(null);
    const [exchangeCustomer, setExchangeCustomer] = useState<ExchangeCustomer | null>(null);
    const bootstrapped = useRef(false);

    useEffect(() => {
        if (bootstrapped.current || !token) return;
        bootstrapped.current = true;
        let pending: { customerId?: string; customerName?: string; returnId?: string } | null = null;
        try { pending = JSON.parse(sessionStorage.getItem('nortex_pending_exchange') ?? 'null'); } catch { return; }
        if (!pending?.customerId || !pending.returnId) return;
        const params = new URLSearchParams({ page: '1', pageSize: '100', search: pending.customerName ?? '' });
        void fetch(`/api/customers?${params.toString()}`, { headers })
            .then(async (response) => response.ok ? response.json() : null)
            .then((payload) => {
                const rows = Array.isArray(payload) ? payload : (payload?.customers ?? []);
                const raw = rows.find((customer: any) => customer.id === pending?.customerId);
                if (!raw) return;
                setExchangeCustomer({
                    ...raw,
                    creditLimit: Number(raw.creditLimit ?? 0),
                    currentDebt: Number(raw.currentDebt ?? 0),
                    storeCreditBalance: Number(raw.storeCreditBalance ?? 0),
                });
                setUseStoreCredit(true);
                setSourceReturnId(pending!.returnId!);
                showToast({ tone: 'success', title: 'Cambio listo para cobrar', message: 'El saldo de la devolución se aplicará a esta venta.' });
            })
            .catch(() => undefined);
    }, [headers, showToast, token]);

    const clear = () => {
        setUseStoreCredit(false);
        setSourceReturnId(null);
        setExchangeCustomer(null);
        sessionStorage.removeItem('nortex_pending_exchange');
    };

    return { useStoreCredit, setUseStoreCredit, sourceReturnId, exchangeCustomer, clear };
};
