// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import TaskGuide from '../components/learning/TaskGuide';
import PracticeExercise from '../components/learning/PracticeExercise';
import { guideAt } from '../utils/learningGuides';
import { maybeAutostartTour } from '../utils/tours';

const scope = (tenant: string, user = 'u1') => localStorage.setItem('nortex_user', JSON.stringify({ id: user, tenant: { id: tenant } }));
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('guías junto al trabajo', () => {
  it('conserva otros parámetros y el hash, sin overlay ni temporizador', () => {
    window.history.replaceState({ marker: 'keep' }, '', '/app/pos?tour=pos&first_sale=1#cart');
    const listener = vi.fn(); window.addEventListener('nortex:learning-guide', listener);
    maybeAutostartTour();
    expect(listener).toHaveBeenCalledOnce();
    expect(window.location.search).toBe('?first_sale=1'); expect(window.location.hash).toBe('#cart');
    expect(window.history.state.marker).toBe('keep');
    window.removeEventListener('nortex:learning-guide', listener);
  });
  it('rechaza IDs heredados y guías de otra pantalla', () => {
    expect(guideAt('__proto__', '/app/inventory')).toBeNull();
    expect(guideAt('pos', '/app/inventory')).toBeNull();
  });
  it('permite trabajar, pausar y recuperar la indicación sin completar operaciones', () => {
    scope('a'); const fetch = vi.spyOn(window, 'fetch');
    const view = render(<MemoryRouter initialEntries={['/app/inventory?tour=inv']}><TaskGuide /><input aria-label="carrito conservado" defaultValue="2 artículos" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente indicación' }));
    expect(screen.getByRole('heading', { name: 'Agregá solo lo que falta' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pausar guía' }));
    expect(screen.queryByText('Agregá solo lo que falta')).toBeNull();
    expect(screen.getByLabelText('carrito conservado')).toHaveValue('2 artículos');
    expect(screen.queryByRole('dialog')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    view.unmount();
    render(<MemoryRouter initialEntries={['/app/inventory?tour=inv']}><TaskGuide /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Agregá solo lo que falta' })).toBeVisible();
  });
  it('no comparte avance de instrucciones entre cuentas', () => {
    scope('a'); const v = render(<MemoryRouter initialEntries={['/app/inventory?tour=inv']}><TaskGuide /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente indicación' })); v.unmount(); scope('b');
    render(<MemoryRouter initialEntries={['/app/inventory?tour=inv']}><TaskGuide /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Primero, buscá si ya existe' })).toBeVisible();
  });
  it('informa un control ausente y no pulsa botones operativos', () => {
    render(<MemoryRouter initialEntries={['/app/inventory?tour=inv']}><TaskGuide /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar dónde' }));
    expect(screen.getByRole('status')).toHaveTextContent('aún no está disponible');
  });
});

describe('ejercicios de práctica sin datos de negocio', () => {
  it('enseña a separar nombre/marca/precio y corrige sin borrar entradas', () => {
    const fetch = vi.spyOn(window, 'fetch');
    render(<PracticeExercise kind="inv" onClose={vi.fn()} onReal={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Arroz 1 kg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha de práctica' }));
    expect(screen.getByRole('alert')).toHaveTextContent('marca'); expect(screen.getByLabelText('Nombre')).toHaveValue('Arroz 1 kg');
    fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Del Campo' } });
    fireEvent.change(screen.getByLabelText('Precio de venta'), { target: { value: '35,00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha de práctica' }));
    expect(screen.getByRole('status')).toHaveTextContent('0 unidades'); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['compras', 'fiado'] as const)('exige revisión y confirmación explícita del ejemplo %s', (kind) => {
    const fetch = vi.spyOn(window, 'fetch');
    render(<PracticeExercise kind={kind} onClose={vi.fn()} onReal={vi.fn()} />);
    if (kind === 'compras') {
      fireEvent.change(screen.getByLabelText('Cantidad recibida (unidades)'), { target: { value: '6' } });
      fireEvent.change(screen.getByLabelText('Costo por unidad'), { target: { value: '25' } });
    } else fireEvent.change(screen.getByLabelText('Efectivo recibido'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /Revisar .* de práctica/ }));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Corregir datos' }));
    expect(screen.getByLabelText(kind === 'compras' ? 'Costo por unidad' : 'Efectivo recibido')).toHaveValue(kind === 'compras' ? '25' : '50');
    fireEvent.click(screen.getByRole('button', { name: /Revisar .* de práctica/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar solo el ejemplo' }));
    expect(screen.getByRole('status')).toHaveTextContent(kind === 'compras' ? '6 unidades' : '150 pendientes');
    expect(fetch).not.toHaveBeenCalled();
  });
});
