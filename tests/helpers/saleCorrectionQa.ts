import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

type QaResponse = { status: number; body: any };
export type QaPost = (path: string, body: unknown) => Promise<QaResponse>;

function expectStatus(result: QaResponse, expected: number) {
    expect(result.status, JSON.stringify(result.body, (key, value) => /token|password|secret/i.test(key) ? '[redacted]' : value)).toBe(expected);
}

/** Crea un miembro mediante invitación y aceptación reales; no envía correo. */
export async function inviteQaMember(post: QaPost, role: 'MANAGER' | 'CASHIER' | 'VIEWER' | 'VENDEDOR') {
    const email = `qa-member-${randomUUID()}@example.invalid`;
    const password = `Qa-${randomUUID()}-Seguro!`;
    const invitation = await post('/api/team/invite', { email, role });
    expectStatus(invitation, 200);
    const accepted = await post(`/api/invite/${invitation.body.invitation.token}/accept`, { name: `QA ${role}`, password });
    expectStatus(accepted, 200);
    return { email, password, id: accepted.body.user.id as string, token: accepted.body.token as string };
}

/** Recorre todos los controles: solicitar, autenticar aprobador distinto y aprobar. */
export async function approveQaCorrection(
    post: QaPost,
    approver: { email: string; password: string },
    command: { saleId: string; kind: 'RETURN' | 'VOID'; reason: string;
        resolution?: 'REFUND'; refundMethod?: 'CASH' | 'CARD' | 'QR' | 'TRANSFER';
        lines?: Array<{ saleItemId: string; quantity: string; disposition: 'RESTOCK' | 'QUARANTINE' | 'LOSS' }> },
): Promise<string> {
    const request = await post('/api/sale-corrections', { clientEventId: randomUUID(), ...command });
    expectStatus(request, 201);
    const grant = await post('/api/auth/approval-grants', { email: approver.email, password: approver.password });
    expectStatus(grant, 201);
    const approved = await post(`/api/sale-corrections/${request.body.id}/approve`, { grantToken: grant.body.grantToken });
    expectStatus(approved, 200);
    expect(approved.body.status).toBe('APPROVED');
    return request.body.id;
}
