import { z } from 'zod';

const idsSchema = z.string().min(1).max(19200).transform(value => value.split(','))
    .pipe(z.array(z.string().min(1).max(191).regex(/^[A-Za-z0-9_-]+$/)).min(1).max(100));

/** undefined conserva el listado existente; vacío o inválido nunca significa todo. */
export function parseProductRefreshIds(raw: unknown): string[] | undefined {
    if (raw === undefined) return undefined;
    return [...new Set(idsSchema.parse(raw))];
}
