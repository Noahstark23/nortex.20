export interface ProductPhotoSuggestions { name: string; brand: string; presentation: string; lines: string[]; }
/** Optical text is evidence to choose from, never authority over prices or stock. */
export function suggestProductFields(text: string): ProductPhotoSuggestions {
    const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length >= 2 && line.length <= 200).slice(0,40);
    const brand = lines.map(line => line.match(/^marca\s*[:：-]\s*(.{1,100})$/iu)?.[1]).find(Boolean) ?? '';
    const presentation = text.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|ml|litros?|gramos?|lb|oz|g)\b/iu)?.[0] ?? '';
    // No positional guess for a brand: users can pick a recognized line explicitly.
    const name = lines.find(line => !/^marca\s*[:：-]/iu.test(line) && !/\d/.test(line) && !/ingredientes|nutricional|fabricad|distribuid|registro|vencimiento|lote|www\.|https?:|instrucciones/iu.test(line)) ?? '';
    return {name, brand, presentation, lines};
}
