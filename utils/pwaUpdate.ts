/**
 * Superficie mínima del contenedor del Service Worker. Mantenerla inyectable
 * permite probar el ciclo controllerchange sin depender de un navegador real.
 */
export type PwaServiceWorkerContainer = {
    readonly controller: object | null;
    addEventListener(type: 'controllerchange', listener: EventListener): void;
    removeEventListener(type: 'controllerchange', listener: EventListener): void;
};

/**
 * Avisa únicamente cuando una página que YA estaba controlada pasa a un
 * Service Worker distinto. El primer controller de una instalación nueva se
 * recuerda, pero no se anuncia como actualización.
 */
export function subscribeToPwaControllerUpdates(
    serviceWorker: PwaServiceWorkerContainer | null | undefined,
    onUpdateReady: () => void,
): () => void {
    if (!serviceWorker) return () => undefined;

    let previousController = serviceWorker.controller;

    const handleControllerChange: EventListener = () => {
        const nextController = serviceWorker.controller;
        const hadController = previousController !== null;
        const controllerChanged = nextController !== previousController;

        previousController = nextController;

        if (hadController && nextController !== null && controllerChanged) {
            onUpdateReady();
        }
    };

    serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
        serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
}
