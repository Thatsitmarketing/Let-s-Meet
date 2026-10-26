/**
 * Schlanke Typen für die genutzten Cloudflare Schnittstellen.
 * Bewusst nicht @cloudflare/workers-types global eingebunden, weil diese die
 * Browser Typen (DOM) überschreiben, die die Clientskripte brauchen.
 */

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; duration?: number };
}

interface D1PreparedStatement {
  bind(...werte: unknown[]): D1PreparedStatement;
  first<T = unknown>(spalte?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(befehle: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<unknown>;
}

interface Fetcher {
  fetch(eingabe: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(versprechen: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

declare namespace Cloudflare {
  interface Env {}
}

interface ExportedHandler<E = Cloudflare.Env> {
  fetch?: (anfrage: Request, env: E, ctx: ExecutionContext) => Response | Promise<Response>;
  scheduled?: (ereignis: ScheduledController, env: E, ctx: ExecutionContext) => void | Promise<void>;
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}
