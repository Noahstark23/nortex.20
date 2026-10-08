import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/productionBoxQuantity.qa.test.ts', 'tests/posActivation.test.ts'],
    },
});
