import { readFileSync } from 'node:fs';

const directed = JSON.parse(readFileSync(new URL('./stryker-assistant.config.json', import.meta.url), 'utf8'));
export default {
    ...directed,
    testFiles: [],
    mutate: ['backend/services/assistant/budget.ts:16-19'],
    htmlReporter: { fileName: 'reports/assistant-mutation-global-check/index.html' },
    jsonReporter: { fileName: 'reports/assistant-mutation-global-check/mutation.json' },
};
