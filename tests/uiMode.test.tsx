// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useUiMode } from '../hooks/useUiMode';

function Consumer({ name }: { name: string }) {
    const [mode, setMode] = useUiMode();
    return <button onClick={() => setMode(previous => previous === 'simple' ? 'full' : 'simple')}>{name}: {mode}</button>;
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it('actualiza todos los consumidores en la misma ventana y persiste la preferencia', () => {
    render(<><Consumer name="Menú" /><Consumer name="POS" /></>);
    fireEvent.click(screen.getByText('Menú: simple'));
    expect(screen.getByText('POS: full')).toBeInTheDocument();
    expect(localStorage.getItem('nortex_ui_mode')).toBe('full');
    fireEvent.click(screen.getByText('POS: full'));
    expect(screen.getByText('Menú: simple')).toBeInTheDocument();
});

it('usa el tenant del POS para el valor inicial y da prioridad a una elección explícita', () => {
    localStorage.setItem('nortex_tenant_data', JSON.stringify({ type: 'LENDER' }));
    const view = render(<Consumer name="Menú" />);
    expect(screen.getByText('Menú: full')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Menú: full'));
    view.unmount();
    localStorage.setItem('nortex_tenant_data', 'malformed');
    render(<Consumer name="POS" />);
    expect(screen.getByText('POS: simple')).toBeInTheDocument();
});

it('ignora eventos de otra preferencia y retira todos sus listeners al desmontar', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<Consumer name="POS" />);
    localStorage.setItem('nortex_ui_mode', 'full');
    fireEvent(window, new StorageEvent('storage', { key: 'unrelated' }));
    expect(screen.getByText('POS: simple')).toBeInTheDocument();
    fireEvent(window, new StorageEvent('storage', { key: 'nortex_ui_mode' }));
    expect(screen.getByText('POS: full')).toBeInTheDocument();
    view.unmount();
    for (const [name, listener] of add.mock.calls.filter(([name]) => ['storage', 'nortex:ui-mode-changed'].includes(name))) {
        expect(remove).toHaveBeenCalledWith(name, listener);
    }
});
