import { STORAGE_KEY, initialProgress, type Progress } from '../data/types';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialProgress();
    return { ...initialProgress(), ...JSON.parse(raw) };
  } catch {
    return initialProgress();
  }
}

export function saveProgress(p: Progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export function exportProgress(p: Progress): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), progress: p }, null, 2);
}

export function importProgress(json: string): Progress {
  const data = JSON.parse(json);
  const p = data.progress || data;
  return { ...initialProgress(), ...p };
}

export function touchStreak(p: Progress): Progress {
  const today = new Date().toISOString().slice(0, 10);
  if (p.lastStudy === today) return p;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streak = p.lastStudy === yesterday ? p.streak + 1 : 1;
  return { ...p, lastStudy: today, streak: Math.max(1, streak) };
}

export function toggleTerm(list: string[], term: string): string[] {
  return list.includes(term) ? list.filter((t) => t !== term) : [...list, term];
}
