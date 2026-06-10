/**
 * NORTEX — WhatsApp · cola asíncrona EN MEMORIA.
 *
 * Por qué: Meta exige HTTP 200 en pocos segundos o reintenta y marca el número
 * como no saludable. El webhook persiste lo mínimo, encola, y responde 200; el
 * trabajo pesado (identidad + agente + LLM + envío) corre fuera del request.
 *
 * Límites honestos (MVP sin Redis):
 *  - La cola vive en el proceso → no sobrevive a un reinicio ni se reparte entre
 *    instancias. Aceptable con UNA instancia (el rate-limit y el caché de tenant
 *    ya son per-proceso). La idempotencia por waMessageId @unique evita
 *    duplicados si Meta reintenta tras un reinicio.
 *  - Interfaz deliberadamente mínima (enqueue) para sustituir por BullMQ/Redis
 *    sin tocar a los callers cuando se escale horizontalmente.
 */

export type JobHandler<T> = (job: T) => Promise<void>;

export class InMemoryQueue<T> {
    private readonly buffer: T[] = [];
    private active = 0;

    constructor(
        private readonly handler: JobHandler<T>,
        private readonly opts: { concurrency: number; maxRetries: number; label: string } = {
            concurrency: 2,
            maxRetries: 2,
            label: 'wa-inbound',
        }
    ) {}

    enqueue(job: T): void {
        this.buffer.push(job);
        this.pump();
    }

    get pending(): number {
        return this.buffer.length;
    }

    private pump(): void {
        while (this.active < this.opts.concurrency && this.buffer.length > 0) {
            const job = this.buffer.shift() as T;
            this.active += 1;
            void this.run(job, 0).finally(() => {
                this.active -= 1;
                this.pump();
            });
        }
    }

    private async run(job: T, attempt: number): Promise<void> {
        try {
            await this.handler(job);
        } catch (err) {
            if (attempt < this.opts.maxRetries) {
                const backoffMs = 250 * 2 ** attempt;
                await new Promise((r) => setTimeout(r, backoffMs));
                return this.run(job, attempt + 1);
            }
            console.error(`🟥 [${this.opts.label}] job descartado tras ${attempt + 1} intentos:`, err);
        }
    }
}
