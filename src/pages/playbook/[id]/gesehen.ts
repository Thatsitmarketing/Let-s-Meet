/**
 * Die Playbook Seite meldet sich hier, sobald sie im Browser angezeigt wird.
 * So zählen Linkprüfungen von Mailprogrammen (die kein JavaScript ausführen) nicht als Öffnen.
 */
import type { APIRoute } from 'astro';
import { crmMelden } from '../../../lib/crm';
import { aufrufMerken, istPlaybook, PLAYBOOKS, zugangLesen, zugangStatus } from '../../../lib/playbooks';

export const POST: APIRoute = async ({ params, locals }) => {
  const zugang = await zugangLesen(params.id ?? '');
  if (zugang && zugangStatus(zugang) === 'gueltig') {
    await aufrufMerken(zugang.id);
    // An Close höchstens einmal am Tag melden, beim ersten Öffnen mit Notiz
    const heute = new Date().toISOString().slice(0, 10);
    if (!zugang.zuletzt_geoeffnet || zugang.zuletzt_geoeffnet.slice(0, 10) !== heute) {
      locals.cfContext.waitUntil(
        crmMelden('playbook.geoeffnet', {
          zugang_id: zugang.id,
          email: zugang.email,
          playbook: zugang.playbook,
          playbook_name: istPlaybook(zugang.playbook) ? PLAYBOOKS[zugang.playbook].name : 'Playbook',
          erstmals: !zugang.erstmals_geoeffnet,
        }),
      );
    }
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
