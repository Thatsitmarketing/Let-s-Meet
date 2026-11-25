// Typen für src/lib/thatsit-link.mjs (Kopie aus dem Repo thatsit-hub, nicht von Hand ändern)
export interface LinkApp { id: string; name: string; long: string; url: string; confirmed: boolean }
export interface LinkUser { email: string; name?: string; role?: string; twofa?: boolean }
export interface LinkOptionen {
  appId: string;
  secret: string;
  allowedEmails?: string | string[];
  resolveUser?: (user: { email: string; name?: string; role?: string }) => Promise<any | null> | any | null;
  urls?: Record<string, string>;
  seenJti?: (jti: string, exp: number) => Promise<boolean> | boolean;
  require2fa?: boolean;
  now?: () => number;
}
export interface Link {
  apps: LinkApp[];
  out(request: Request, user: LinkUser | null): Promise<Response>;
  in(request: Request, optionen: { startSession: (user: any, next: string) => Promise<Response> | Response }): Promise<Response>;
}
export const APPS: LinkApp[];
/** Tool mit echter 2FA: Wechsel ohne 2FA Beleg führt dorthin statt in eine Sackgasse. */
export const HOME_ID: string;
export function createLink(optionen: LinkOptionen): Link;
export function signToken(secret: string, payload: Record<string, unknown>): Promise<string>;
export function verifyToken(secret: string, token: string, optionen?: { typ?: string; aud?: string; now?: number }): Promise<Record<string, any>>;
export function safeNext(next: unknown): string;
