/**
 * Aufbau des Wertes im signierten Sitzungscookie `lm_sitzung`: `{nutzerId}|{ablauf}` und optional `|2fa`.
 * Das Flag steht nur, wenn die Sitzung über den Tool Wechsel (/auth/switch/in) entstanden ist, also
 * in einem anderen Tool mit 2FA angemeldet wurde. Die Anmeldung per Passwort hier hat keine 2FA.
 * Alte Cookies ohne Flag bleiben gültig und gelten als ohne 2FA.
 */
export interface SitzungsWert {
  id: string;
  ablauf: number;
  twofa: boolean;
}

export function sitzungWertBauen(id: string, ablauf: number, twofa = false) {
  return `${id}|${ablauf}${twofa ? '|2fa' : ''}`;
}

export function sitzungWertLesen(wert: string): SitzungsWert | null {
  const [id, ablauf, flag] = wert.split('|');
  const zeit = Number(ablauf);
  if (!id || !Number.isFinite(zeit)) return null;
  return { id, ablauf: zeit, twofa: flag === '2fa' };
}
