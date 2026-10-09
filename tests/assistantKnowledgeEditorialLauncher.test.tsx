// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssistantKnowledgeEditorial } from '../components/admin/AssistantKnowledgeEditorial';

vi.mock('../components/admin/knowledge/KnowledgeEditorialPanel', () => ({ default: function Fixture({ onPendingWorkChange }: { onPendingWorkChange?: (pending: boolean) => void }) {
    const [draft, setDraft] = useState('');
    return <label>Observación pendiente<input value={draft} onChange={event => { setDraft(event.target.value); onPendingWorkChange?.(event.target.value.length > 0); }} /></label>;
} }));
afterEach(cleanup);

it('abre bajo demanda y conserva la observación al ocultar y volver a abrir', async () => {
    const onPendingWorkChange = vi.fn();
    render(<AssistantKnowledgeEditorial onPendingWorkChange={onPendingWorkChange} />);
    expect(screen.queryByLabelText('Observación pendiente')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ayuda de NortexGPT' }));
    const input = await screen.findByLabelText('Observación pendiente');
    fireEvent.change(input, { target: { value: 'La recepción todavía debe aclararse.' } });
    expect(onPendingWorkChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar revisión de ayuda' }));
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar ayuda de NortexGPT' }));
    expect(screen.getByLabelText('Observación pendiente')).toBe(input);
    expect(input).toBeVisible();
    expect(input).toHaveValue('La recepción todavía debe aclararse.');
});
