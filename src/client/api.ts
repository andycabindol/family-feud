import type { Pack } from '../shared/types';
import { getPin } from './net';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), 'x-host-pin': getPin() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  listPacks: () => request<Pack[]>('/api/packs'),
  savePack: (pack: Pack) =>
    request<Pack>(`/api/packs/${encodeURIComponent(pack.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pack),
    }),
  deletePack: (id: string) => request<{ ok: true }>(`/api/packs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  info: () => request<{ lan: string[] }>('/api/info'),
  played: () => request<Record<string, string[]>>('/api/played'),
  clearPlayed: (themeIds: string[]) =>
    request<Record<string, string[]>>('/api/played/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themeIds }),
    }),
};

export function download(filename: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
