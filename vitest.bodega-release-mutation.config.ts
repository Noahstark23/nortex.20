import { defineConfig } from 'vitest/config';
import base from './vitest.stryker.config';

// Compuerta dirigida del cambio de cantidades/bodega; no acredita el alcance global.
export default defineConfig({
    ...base,
    test: {
        ...base.test,
        include: [
            'tests/quantityLegacyResolver.mutation.test.ts',
            'tests/quantityLegacyRules.test.ts',
            'tests/stockTransferQuantity.test.ts',
            'tests/stockTransferQuantity.mutation.test.ts',
            'tests/purchasePackaging.test.ts',
            'tests/purchasePackaging.mutation.test.ts',
            'tests/posActivation.test.ts',
            'tests/bodegaReceivingReviewInput.test.ts',
            'tests/cashCloseJournalMutation.test.ts',
        ],
    },
});
