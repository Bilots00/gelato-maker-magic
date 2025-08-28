// src/lib/supabaseFetch.ts
const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!BASE || !ANON) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export async function supabaseFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${ANON}`);
  if (init.method && init.method !== 'GET' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} – ${text}`);
  }
  return res.json() as Promise<T>;
}

export const getTemplate = (templateId: string) =>
  supabaseFetch(`/functions/v1/gelato-get-template?templateId=${encodeURIComponent(templateId)}`);

export const bulkCreate = (payload: unknown) =>
  supabaseFetch(`/functions/v1/gelato-bulk-create`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
