/** Los registros nuevos usan un identificador interno hasta que el dueño guarda su RUC. */
export const isPlaceholderTaxId = (value: unknown): boolean => (
    typeof value === 'string' && /^TAX-/i.test(value.trim())
);
