import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PwaUpdateBanner } from '../components/PwaUpdateNotice';
import {
    PwaServiceWorkerContainer,
    subscribeToPwaControllerUpdates,
} from '../utils/pwaUpdate';

class FakeServiceWorkerContainer extends EventTarget implements PwaServiceWorkerContainer {
    controller: object | null;

    constructor(controller: object | null) {
        super();
        this.controller = controller;
    }

    takeControl(controller: object | null) {
        this.controller = controller;
        this.dispatchEvent(new Event('controllerchange'));
    }
}

describe('aviso de actualización PWA', () => {
    it('ignora la primera instalación y avisa cuando un SW posterior toma control', () => {
        const serviceWorker = new FakeServiceWorkerContainer(null);
        const onUpdateReady = vi.fn();
        const unsubscribe = subscribeToPwaControllerUpdates(serviceWorker, onUpdateReady);

        serviceWorker.takeControl({ version: 'primera-instalacion' });
        expect(onUpdateReady).not.toHaveBeenCalled();

        serviceWorker.takeControl({ version: 'actualizacion' });
        expect(onUpdateReady).toHaveBeenCalledTimes(1);

        unsubscribe();
        serviceWorker.takeControl({ version: 'actualizacion-posterior' });
        expect(onUpdateReady).toHaveBeenCalledTimes(1);
    });

    it('no duplica el aviso si controllerchange conserva el mismo controller', () => {
        const controller = { version: 'actual' };
        const serviceWorker = new FakeServiceWorkerContainer(controller);
        const onUpdateReady = vi.fn();

        subscribeToPwaControllerUpdates(serviceWorker, onUpdateReady);
        serviceWorker.takeControl(controller);
        serviceWorker.takeControl({ version: 'nueva' });

        expect(onUpdateReady).toHaveBeenCalledTimes(1);
    });

    it('pide terminar o aparcar la venta y ofrece una recarga explícita', () => {
        const html = renderToStaticMarkup(<PwaUpdateBanner onReload={() => undefined} />);

        expect(html).toContain('Actualización lista');
        expect(html).toContain('Aparcá o terminá la venta antes de recargar');
        expect(html).toContain('Recargar Nortex');
        expect(html).toContain('role="alert"');
        expect(html).toContain('print:hidden');
    });
});
