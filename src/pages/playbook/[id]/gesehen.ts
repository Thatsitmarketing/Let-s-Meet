/**
 * Die Playbook Seite meldet sich hier, sobald sie im Browser angezeigt wird.
 * So zählen Linkprüfungen von Mailprogrammen (die kein JavaScript ausführen) nicht als Öffnen.
 */
import type { APIRoute } from 'astro';
import { aufrufMerken, zugangLesen, zugangStatus } from '../../../lib/playbooks';

export const POST: APIRoute = async ({ params }) => {
  const zugang = await zugangLesen(params.id ?? '');
  if (zugang && zugangStatus(zugang) === 'gueltig') await aufrufMerken(zugang.id);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
