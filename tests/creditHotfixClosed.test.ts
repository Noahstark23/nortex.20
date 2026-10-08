// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CREDIT_HOTFIX as H, verifyCreditHotfixRelease } from '../scripts/verify-credit-hotfix-release.mjs';
import { verifyHotfixCi } from '../scripts/verify-credit-hotfix-run-evidence.mjs';

// Uses the real, inactive repository manifest. No mock of the manifest reader.
describe('closed historical credit release', () => {
    it.each(['promote', 'recover'])('blocks %s before Git, health or REST', async action => {
        const target = action === 'recover' ? H.base : H.candidate;
        const env = {
            CREDIT_HOTFIX_20261001: 'true', CREDIT_HOTFIX_ACTION: action,
            GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
            GITHUB_SHA: 'a'.repeat(40), GITHUB_SERVER_URL: 'https://github.com',
            GITHUB_REPOSITORY: H.repository, CANDIDATE_SHA: target,
            NORTEX_PRODUCTION_DEPLOY_ENABLED: 'true', PROD_URL: H.productionOrigin,
            PRODUCTION_CONFIRMATION: 'PROMOTE ' + target, SOLE_OWNER_CONFIRMATION: 'SOLE_OWNER ' + target,
        };
        const git = vi.fn(); const verifyHealth = vi.fn();
        const listWorkflowRuns = vi.fn();
        await expect(verifyCreditHotfixRelease({ env, phase: 'production', git, verifyHealth }))
            .rejects.toThrow('HOTFIX_MANIFEST_INVALID');
        await expect(verifyHotfixCi({ env, github: { rest: { actions: { listWorkflowRuns } } } }))
            .rejects.toThrow('HOTFIX_MANIFEST_INVALID');
        expect(git).not.toHaveBeenCalled();
        expect(verifyHealth).not.toHaveBeenCalled();
        expect(listWorkflowRuns).not.toHaveBeenCalled();
    });
});
