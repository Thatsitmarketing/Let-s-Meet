import type { APIRoute } from 'astro';
import { signieren } from '../../../../lib/auth';
import { googleAktiv, googleAuthUrl } from '../../../../lib/google';

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  if (!googleAktiv()) return redirect('/app/integrationen?google_fehler=1');
  const state = await signieren(`${locals.gastgeber!.id}|${Date.now() + 10 * 60_000}`, 'oauth');
  return redirect(googleAuthUrl(`${url.origin}/api/google/rueckruf`, state));
};
