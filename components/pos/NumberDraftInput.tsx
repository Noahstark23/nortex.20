import React, { useEffect, useRef, useState } from 'react';
import { sanitizeDecimalInput, toDecimal } from '../../utils/money';

// Input numérico controlado para estado `number` (cantidad, % descuento por
// ítem): mantiene un BORRADOR string para que se puedan teclear decimales
// ("1." no se "come" el punto) y commitea el número parseado. Nunca type="number".
export const NumberDraftInput: React.FC<{
    value: number;
    onCommit: (n: number) => void;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
    allowZero?: boolean;
    ariaInvalid?: boolean;
    describedBy?: string;
}> = ({ value, onCommit, className, placeholder, ariaLabel, allowZero, ariaInvalid, describedBy }) => {
    const [draft, setDraft] = useState<string>(value ? String(value) : '');
    const lastCommitted = useRef<number>(value);

    useEffect(() => {
        // Resync solo si el valor externo cambió por algo distinto a este input
        // (botones +/-, reset de carrito) — no pisamos el borrador propio.
        if (value !== lastCommitted.current) {
            setDraft(value ? String(value) : '');
            lastCommitted.current = value;
        }
    }, [value]);

    return (
        <input
            type="text"
            inputMode="decimal"
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={describedBy}
            className={className}
            value={draft}
            onChange={(e) => {
                const s = sanitizeDecimalInput(e.target.value);
                setDraft(s);
                if (s === '' && !allowZero) return; // permitir borrar sin forzar 0
                const n = toDecimal(s).toNumber();
                lastCommitted.current = n;
                onCommit(n);
            }}
        />
    );
};
