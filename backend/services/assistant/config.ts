/** Interruptores consultados en cada operación; apagados antes de migrar. */
export function getAssistantFlags() {
    return {
        enabled: process.env.NORTEX_ASSISTANT_ENABLED === 'true',
        languageEnabled: process.env.NORTEX_ASSISTANT_LANGUAGE_ENABLED === 'true',
        extractionEnabled: process.env.NORTEX_ASSISTANT_EXTRACTION_ENABLED === 'true',
        executionEnabled: process.env.NORTEX_ASSISTANT_EXECUTION_ENABLED === 'true',
        operationsEnabled: process.env.NORTEX_ASSISTANT_OPERATIONS_ENABLED === 'true',
        actionsEnabled: process.env.NORTEX_ASSISTANT_ACTIONS_ENABLED === 'true',
        promotionsEnabled: process.env.NORTEX_PROMOTIONS_ENABLED === 'true',
        privateWhatsappEnabled: process.env.NORTEX_ASSISTANT_PRIVATE_WHATSAPP_ENABLED === 'true',
    };
}

export const isAssistantEnabled = () => getAssistantFlags().enabled;
