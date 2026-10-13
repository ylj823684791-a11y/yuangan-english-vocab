export type Accent = 'us' | 'uk';

let curAudio: HTMLAudioElement | null = null;
const audioCache: Record<string, HTMLAudioElement | 'fail'> = {};

function canUseRealAudio(t: string): boolean {
  t = String(t).trim();
  if (!t || t.length > 90) return false;
  if (/[µ°℃×±]/.test(t)) return false;
  if (/[0-9].*\/.*[0-9]/.test(t)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\s.,'?!()&%/\-]*$/.test(t);
}

export function stopAllAudio() {
  if (curAudio) {
    try { curAudio.pause(); } catch { /* ignore */ }
    curAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function audioCandidates(text: string): string[] {
  if (!canUseRealAudio(text)) return [];
  const cands = [text];
  const stripped = text.replace(/\s*\([^)]*\)/g, '').trim();
  if (stripped && stripped !== text && canUseRealAudio(stripped)) cands.push(stripped);
  if (text.includes('/')) {
    const first = text.split('/')[0].trim();
    if (first && !cands.includes(first) && canUseRealAudio(first)) cands.push(first);
  }
  return cands;
}

function pickEnglishVoice(preferUk: boolean): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) =>
    v.lang.toLowerCase().startsWith('en'),
  );
  const preferLang = preferUk ? 'en-gb' : 'en-us';
  const preferredNames = preferUk
    ? [/Google UK English/i, /Daniel/i, /Microsoft.*(George|Libby|Ryan)/i]
    : [/Google US English/i, /Samantha/i, /Microsoft.*(Aria|Jenny|Guy|Zira|Ava)/i];
  for (const re of preferredNames) {
    const hit = voices.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return (
    voices.find((v) => v.lang.toLowerCase() === preferLang) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(preferUk ? 'en-gb' : 'en-us')) ||
    voices[0]
  );
}

function speakTTS(text: string, accent: Accent) {
  if (!('speechSynthesis' in window)) return Promise.reject(new Error('no-tts'));
  return new Promise<void>((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickEnglishVoice(accent === 'uk');
    if (voice) u.voice = voice;
    u.lang = voice?.lang || (accent === 'uk' ? 'en-GB' : 'en-US');
    u.rate = 0.88;
    u.onend = () => resolve();
    u.onerror = () => reject(new Error('tts-error'));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

function speakChain(
  cands: string[],
  idx: number,
  accent: Accent,
  onStatus?: (s: 'loading' | 'playing' | 'fallback' | 'error') => void,
): Promise<void> {
  if (idx >= cands.length) {
    onStatus?.('fallback');
    return speakTTS(cands[0] || '', accent);
  }
  const text = cands[idx];
  const key = `${accent}:${text.toLowerCase()}`;
  let a = audioCache[key];
  if (a === 'fail') return speakChain(cands, idx + 1, accent, onStatus);

  if (!a) {
    const type = accent === 'uk' ? 1 : 2;
    a = new Audio(
      `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}`,
    );
    audioCache[key] = a;
  }

  return new Promise((resolve, reject) => {
    const audio = a as HTMLAudioElement;
    const fail = () => {
      audioCache[key] = 'fail';
      speakChain(cands, idx + 1, accent, onStatus).then(resolve, reject);
    };
    audio.onerror = fail;
    audio.onended = () => resolve();
    try { audio.currentTime = 0; } catch { /* ignore */ }
    curAudio = audio;
    onStatus?.('playing');
    const pr = audio.play();
    if (pr && pr.catch) pr.catch(fail);
  });
}

export async function speakWord(
  text: string,
  accent: Accent = 'us',
  onStatus?: (s: 'loading' | 'playing' | 'fallback' | 'error') => void,
): Promise<void> {
  text = String(text).trim();
  if (!text) return;
  stopAllAudio();
  onStatus?.('loading');
  const cands = audioCandidates(text);
  try {
    if (cands.length) await speakChain(cands, 0, accent, onStatus);
    else {
      onStatus?.('fallback');
      await speakTTS(text, accent);
    }
  } catch {
    onStatus?.('error');
  }
}

export function warmVoices() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices();
  });
}
