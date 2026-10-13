import type { Progress } from '../data/types';

const TOKEN_KEY = 'yg-english-auth-token';
const USER_KEY = 'yg-english-auth-user';

export type AuthUser = { username: string; token: string };

function apiBase(): string {
  // Same-origin in production; Vite proxy in local `npm run dev`
  return '';
}

export function loadAuth(): AuthUser | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const username = localStorage.getItem(USER_KEY);
    if (!token || !username) return null;
    return { token, username };
  } catch {
    return null;
  }
}

export function saveAuth(user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, user.token);
  localStorage.setItem(USER_KEY, user.username);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
  let body: { error?: string } & T;
  try {
    body = (await res.json()) as { error?: string } & T;
  } catch {
    throw new Error(res.ok ? '响应解析失败' : `请求失败 (${res.status})`);
  }
  if (!res.ok) throw new Error(body.error || `请求失败 (${res.status})`);
  return body;
}

export async function register(username: string, password: string): Promise<AuthUser> {
  const data = await request<{ token: string; username: string }>('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  const user = { token: data.token, username: data.username };
  saveAuth(user);
  return user;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const data = await request<{ token: string; username: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  const user = { token: data.token, username: data.username };
  saveAuth(user);
  return user;
}

export async function logout(token: string | null) {
  try {
    if (token) {
      await request('/api/logout', { method: 'POST', token, body: '{}' });
    }
  } catch {
    /* ignore */
  }
  clearAuth();
}

export async function fetchCloudProgress(token: string): Promise<Progress | null> {
  const data = await request<{ progress: Progress | null }>('/api/progress', {
    method: 'GET',
    token,
  });
  return data.progress;
}

export async function pushCloudProgress(token: string, progress: Progress): Promise<void> {
  await request('/api/progress', {
    method: 'PUT',
    token,
    body: JSON.stringify({ progress }),
  });
}

/** Prefer cloud when it has more learning signal; otherwise keep local. */
export function mergeProgress(local: Progress, cloud: Progress | null): Progress {
  if (!cloud) return local;
  const localScore =
    local.known.length + local.learning.length + local.saved.length + local.wrong.length + local.streak;
  const cloudScore =
    cloud.known.length + cloud.learning.length + cloud.saved.length + cloud.wrong.length + cloud.streak;
  if (cloudScore === 0 && localScore > 0) return local;
  if (localScore === 0) return { ...cloud };
  // Union lists, take max streak, prefer newer-looking profile/accent from the richer side
  const richer = cloudScore >= localScore ? cloud : local;
  const other = cloudScore >= localScore ? local : cloud;
  const uniq = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));
  return {
    profile: richer.profile || other.profile || '默认档案',
    known: uniq(local.known, cloud.known),
    learning: uniq(local.learning, cloud.learning).filter((t) => !uniq(local.known, cloud.known).includes(t)),
    saved: uniq(local.saved, cloud.saved),
    wrong: uniq(local.wrong, cloud.wrong),
    streak: Math.max(local.streak || 0, cloud.streak || 0),
    lastStudy: [local.lastStudy, cloud.lastStudy].filter(Boolean).sort().reverse()[0],
    accent: richer.accent || other.accent || 'us',
  };
}
