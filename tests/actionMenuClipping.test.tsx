// @vitest-environment jsdom

/**
 * BUG REPORTADO POR UN CLIENTE (2026-09-14): en la ficha de producto, al abrir
 * el menú "⋮" sólo se ve su franja superior. Reproducible en laptop, tablet y
 * celular por igual — o sea, NO es colisión con el viewport: es recorte por un
 * contenedor ancestro.
 *
 * La causa: `.nx-stock-pane` lleva `overflow: hidden` para que sus hijos
 * respeten el `border-radius: 22px` (components/inventory/stockWorkspace.css:4),
 * y el "⋮" es el ÚLTIMO elemento del panel. El menú abría con `top-full` —hacia
 * abajo— dentro de ese contenedor, así que quedaba decapitado. En móvil el
 * panel viaja dentro de `.nx-fluid-sheet-panel`, que además de `overflow:hidden`
 * tiene `will-change: transform`: eso crea un containing block, de modo que ni
 * un `position: fixed` sin portal escaparía.
 *
 * Esta prueba fija la CONDUCTA que lo impide: el menú no puede ser descendiente
 * de un ancestro que recorta. jsdom no calcula layout, así que no puede
 * observarse el recorte en píxeles; lo que sí se puede probar —y es lo que de
 * verdad falla— es la relación de contención en el árbol.
 */
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ActionMenu } from '../components/ui/ActionMenu';

afterEach(cleanup);

/** Reproduce el ancestro real: recorta igual que `.nx-stock-pane`. */
const PanelQueRecorta = ({ children }: { children: ReactNode }) => (
    <section data-testid="panel" style={{ overflow: 'hidden', borderRadius: '22px' }}>
        <div>Contenido de la ficha</div>
        <div data-testid="tools">{children}</div>
    </section>
);

const abrir = (nombre = 'Más acciones de Martillo') => {
    fireEvent.click(screen.getByRole('button', { name: nombre }));
};

describe('menú de acciones dentro de un contenedor que recorta', () => {
    it('no queda atrapado dentro del ancestro con overflow hidden', () => {
        render(
            <PanelQueRecorta>
                <ActionMenu
                    label="Más acciones de Martillo"
                    items={[
                        { label: 'Publicar en catálogo', onClick: vi.fn() },
                        { label: 'Registrar pérdida o sobrante', onClick: vi.fn() },
                    ]}
                />
            </PanelQueRecorta>,
        );

        abrir();

        const menu = screen.getByRole('menu');
        const panel = screen.getByTestId('panel');

        // El corazón del bug: si el menú vive adentro del panel, el
        // `overflow: hidden` del panel lo recorta y el usuario sólo ve su borde.
        expect(panel.contains(menu)).toBe(false);
    });

    it('abre hacia arriba cuando no hay lugar abajo', () => {
        // El "⋮" es el último elemento de la ficha: abajo casi nunca hay lugar.
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            top: 700, bottom: 744, left: 300, right: 344, width: 44, height: 44,
            x: 300, y: 700, toJSON: () => ({}),
        } as DOMRect);
        vi.stubGlobal('innerHeight', 760);

        render(
            <ActionMenu
                label="Más acciones de Martillo"
                items={[{ label: 'Publicar en catálogo', onClick: vi.fn() }]}
            />,
        );
        abrir();

        // Con el disparador a 16px del borde inferior, anclar el tope del menú
        // ahí lo deja fuera de la pantalla. Debe anclarse por abajo.
        expect(screen.getByRole('menu')).toHaveAttribute('data-placement', 'top');
        vi.restoreAllMocks();
    });

    it('abre hacia abajo cuando sí hay lugar', () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            top: 100, bottom: 144, left: 300, right: 344, width: 44, height: 44,
            x: 300, y: 100, toJSON: () => ({}),
        } as DOMRect);
        vi.stubGlobal('innerHeight', 760);

        render(
            <ActionMenu
                label="Más acciones de Martillo"
                items={[{ label: 'Publicar en catálogo', onClick: vi.fn() }]}
            />,
        );
        abrir();

        expect(screen.getByRole('menu')).toHaveAttribute('data-placement', 'bottom');
        vi.restoreAllMocks();
    });

    it('un click dentro del menú no lo cierra', () => {
        // Con portal, el menú ya NO está dentro del contenedor del disparador.
        // Un guard de "click afuera" que sólo mire ese contenedor cerraría el
        // menú antes de que el botón reciba su click: la opción sería
        // inelegible. Es la forma exacta en que este arreglo se rompe.
        render(
            <ActionMenu
                label="Más acciones de Martillo"
                items={[{ label: 'Publicar en catálogo', onClick: vi.fn() }]}
            />,
        );
        abrir();

        fireEvent.mouseDown(screen.getByRole('menu'));

        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('elegir una opción la ejecuta y cierra el menú', () => {
        const publicar = vi.fn();
        render(
            <ActionMenu
                label="Más acciones de Martillo"
                items={[{ label: 'Publicar en catálogo', onClick: publicar }]}
            />,
        );
        abrir();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Publicar en catálogo' }));

        expect(publicar).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('cierra con Escape y con un click afuera', () => {
        render(
            <div>
                <button type="button">Otra cosa</button>
                <ActionMenu
                    label="Más acciones de Martillo"
                    items={[{ label: 'Publicar en catálogo', onClick: vi.fn() }]}
                />
            </div>,
        );

        abrir();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        abrir();
        fireEvent.mouseDown(screen.getByRole('button', { name: 'Otra cosa' }));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('conserva el divisor antes de una acción destructiva', () => {
        render(
            <ActionMenu
                label="Más acciones de Martillo"
                items={[
                    { label: 'Publicar en catálogo', onClick: vi.fn() },
                    { label: 'Eliminar producto', onClick: vi.fn(), danger: true },
                ]}
            />,
        );
        abrir();

        expect(screen.getByRole('separator')).toBeInTheDocument();
    });
});
