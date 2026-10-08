import { readFileSync } from 'node:fs';
const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

// Alcance puro afectado por esta entrega; el reporte no sustituye la mutación global.
export default {
    ...base,
    vitest: { configFile: 'vitest.bodega-release-mutation.config.ts' },
    mutate: [
        'utils/productQuantityRules.ts',
        'utils/stockTransferQuantity.ts',
        'utils/purchasePackaging.ts',
        'utils/posActivation.ts',
        'utils/bodegaReceivingInput.ts',
        'backend/validation/schemas.ts:871-883',
    ],
    ignorePatterns: [...base.ignorePatterns, '**/.stryker-tmp/**'],
    reporters: ['json', 'clear-text'],
    jsonReporter: { fileName: 'reports/mutation-bodega/mutation.json' },
};
