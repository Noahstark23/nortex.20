// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SuperAdmin from '../components/SuperAdmin';
import { syntheticAdminOverview } from './fixtures/adminOverview';

vi.mock('swr', async importOriginal => ({ ...await importOriginal<typeof import('swr')>(), default: () => ({ data: syntheticAdminOverview, error: null, isLoading: false, isValidating: false, mutate: vi.fn() }) }));
vi.mock('../components/AdminMotorizadosKYC', () => ({ default: () => null }));
vi.mock('../components/admin/AssistantBudgetRequests', () => ({ AssistantBudgetRequests: () => null }));
vi.mock('../components/admin/AssistantPilotActivation', () => ({ AssistantPilotActivation: () => null }));
vi.mock('../components/admin/AssistantKnowledgeEditorial', () => ({ AssistantKnowledgeEditorial: ({ onPendingWorkChange }: {
  onPendingWorkChange?: (pending: boolean) => void;
}) => <button type="button" onClick={() => onPendingWorkChange?.(true)}>Escribir observación editorial</button> }));

afterEach(() => { cleanup(); localStorage.clear(); });

it('LOGOUT conserva la sesión cuando existe una observación editorial sin enviar', () => {
  localStorage.setItem('nortex_token', 'synthetic-superadmin-session');
  localStorage.setItem('nortex_user', JSON.stringify({ id: 'synthetic-admin', role: 'SUPER_ADMIN' }));
  render(<SuperAdmin />);
  fireEvent.click(screen.getByRole('button', { name: 'Escribir observación editorial' }));
  fireEvent.click(screen.getByRole('button', { name: 'LOGOUT' }));
  expect(localStorage.getItem('nortex_token')).toBe('synthetic-superadmin-session');
  expect(screen.getByRole('alert')).toHaveTextContent(/guardá o descartá/i);
});
