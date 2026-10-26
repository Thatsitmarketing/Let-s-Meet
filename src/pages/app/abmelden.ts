import type { APIRoute } from 'astro';
import { sitzungBeenden } from '../../lib/auth';

export const POST: APIRoute = ({ cookies, redirect }) => {
  sitzungBeenden(cookies);
  return redirect('/app/login');
};
