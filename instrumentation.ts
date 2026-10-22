// Вызывается Next.js при старте сервера.
// Гuard по NEXT_RUNTIME гарантирует, что node:dns и undici
// не попадут в Edge Runtime (там они недоступны).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
