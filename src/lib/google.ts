/**
 * Google Kalender: OAuth, Belegtzeiten (freeBusy) und Termine mit Google Meet Link.
 * Alles über fetch, ohne SDK. Ohne GOOGLE_CLIENT_ID bleibt die Integration aus.
 */
import { env } from 'cloudflare:workers';
import { ausfuehren } from './db';
import type { Nutzer } from './typen';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
].join(' ');

export function googleAktiv() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleCodeTauschen(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google Token ${res.status}: ${await res.text()}`);
  const daten = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
  let email: string | null = null;
  if (daten.id_token) {
    try {
      const nutzlast = JSON.parse(atob(daten.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      email = nutzlast.email ?? null;
    } catch {
      email = null;
    }
  }
  return { ...daten, email };
}

async function zugriffstoken(nutzer: Nutzer): Promise<string | null> {
  if (!googleAktiv() || !nutzer.google_refresh_token) return null;
  if (nutzer.google_access_token && nutzer.google_token_ablauf && nutzer.google_token_ablauf > Date.now() + 60_000) {
    return nutzer.google_access_token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: nutzer.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    console.error('Google Token Erneuerung fehlgeschlagen', res.status, await res.text());
    return null;
  }
  const daten = (await res.json()) as { access_token: string; expires_in: number };
  const ablauf = Date.now() + daten.expires_in * 1000;
  await ausfuehren(
    'UPDATE nutzer SET google_access_token = ?, google_token_ablauf = ? WHERE id = ?',
    daten.access_token,
    ablauf,
    nutzer.id,
  );
  nutzer.google_access_token = daten.access_token;
  nutzer.google_token_ablauf = ablauf;
  return daten.access_token;
}

/** Belegte Zeiten aus dem Google Kalender. Bei Fehlern leer, damit Buchungen weiter möglich sind. */
export async function googleBelegt(nutzer: Nutzer, vonUtc: Date, bisUtc: Date): Promise<{ start: number; ende: number }[]> {
  const token = await zugriffstoken(nutzer);
  if (!token) return [];
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        timeMin: vonUtc.toISOString(),
        timeMax: bisUtc.toISOString(),
        items: [{ id: nutzer.google_kalender_id || 'primary' }],
      }),
    });
    if (!res.ok) throw new Error(`freeBusy ${res.status}`);
    const daten = (await res.json()) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };
    return Object.values(daten.calendars ?? {}).flatMap((k) =>
      (k.busy ?? []).map((b) => ({ start: Date.parse(b.start), ende: Date.parse(b.end) })),
    );
  } catch (fehler) {
    console.error('Google Belegtzeiten nicht abrufbar', fehler);
    return [];
  }
}

export async function googleTerminAnlegen(
  nutzer: Nutzer,
  termin: {
    titel: string;
    beschreibung: string;
    start: string;
    ende: string;
    gastEmail: string;
    gastName: string;
    ort?: string | null;
    mitMeet: boolean;
    buchungId: string;
  },
): Promise<{ id: string; meetUrl: string | null } | null> {
  const token = await zugriffstoken(nutzer);
  if (!token) return null;
  const koerper: Record<string, unknown> = {
    summary: termin.titel,
    description: termin.beschreibung,
    start: { dateTime: termin.start },
    end: { dateTime: termin.ende },
    attendees: [{ email: termin.gastEmail, displayName: termin.gastName }],
    location: termin.ort ?? undefined,
    reminders: { useDefault: true },
  };
  if (termin.mitMeet) {
    koerper.conferenceData = {
      createRequest: { requestId: termin.buchungId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  const kalender = encodeURIComponent(nutzer.google_kalender_id || 'primary');
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${kalender}/events?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    },
  );
  if (!res.ok) {
    console.error('Google Termin nicht angelegt', res.status, await res.text());
    return null;
  }
  const daten = (await res.json()) as { id: string; hangoutLink?: string };
  return { id: daten.id, meetUrl: daten.hangoutLink ?? null };
}

export async function googleTerminLoeschen(nutzer: Nutzer, eventId: string) {
  const token = await zugriffstoken(nutzer);
  if (!token) return;
  const kalender = encodeURIComponent(nutzer.google_kalender_id || 'primary');
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${kalender}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error('Google Termin nicht gelöscht', res.status, await res.text());
  }
}
