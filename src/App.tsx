import { useEffect, useMemo, useRef, useState } from 'react';
import { categories, verifiedCount, wordCount, words } from './data/words';
import { ROLE_MAP, type Progress } from './data/types';
import {
  exportProgress,
  importProgress,
  loadProgress,
  saveProgress,
  toggleTerm,
  touchStreak,
} from './lib/progress';
import {
  clearAuth,
  fetchCloudProgress,
  loadAuth,
  login as apiLogin,
  logout as apiLogout,
  mergeProgress,
  pushCloudProgress,
  register as apiRegister,
  type AuthUser,
} from './lib/api';
import { speakWord, warmVoices } from './lib/speech';
import './App.css';

type Tab = 'home' | 'learn' | 'quiz' | 'library' | 'saved' | 'progress';

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: '首页', icon: '⌂' },
  { id: 'learn', label: '闪卡', icon: '◫' },
  { id: 'quiz', label: '测验', icon: '?' },
  { id: 'library', label: '词库', icon: 'Aa' },
  { id: 'saved', label: '收藏', icon: '★' },
  { id: 'progress', label: '进度', icon: '◔' },
];


function pickExample(word: { example: string; exampleZh: string; examples?: { example: string; exampleZh: string }[] }, salt: number) {
  const list = word.examples && word.examples.length
    ? word.examples
    : [{ example: word.example, exampleZh: word.exampleZh }];
  const idx = Math.abs(salt) % list.length;
  return list[idx] || list[0];
}

function shuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function SpeakBtn({
  text,
  accent,
}: {
  text: string;
  accent: 'us' | 'uk';
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'fallback' | 'error'>('idle');
  return (
    <button
      type="button"
      className={`speak-btn ${status}`}
      title="播放发音"
      aria-label={`朗读 ${text}`}
      onClick={(e) => {
        e.stopPropagation();
        setStatus('loading');
        void speakWord(text, accent, (s) => setStatus(s === 'playing' || s === 'fallback' ? s : s === 'error' ? 'error' : 'loading')).finally(() => {
          setTimeout(() => setStatus('idle'), 600);
        });
      }}
    >
      {status === 'loading' ? '…' : status === 'error' ? '!' : '🔊'}
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [role, setRole] = useState('全员');
  const [quality, setQuality] = useState('全部');
  const [flipped, setFlipped] = useState(false);
  const [cardSeed] = useState(() => Date.now() ^ Math.floor(Math.random() * 1e9));
  const [cardIndex, setCardIndex] = useState(0);
  const [quizSeed, setQuizSeed] = useState(() => Date.now());
  const [quizIndex, setQuizIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [auth, setAuth] = useState<AuthUser | null>(() => loadAuth());
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'ok' | 'pending' | 'err'>('idle');
  const cloudReady = useRef(false);
  const skipCloudPush = useRef(false);

  useEffect(() => {
    warmVoices();
    setProgress((p) => touchStreak(p));
  }, []);

  // Load cloud progress after login / on mount
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (!auth?.token) {
        cloudReady.current = true;
        setSyncState('idle');
        return;
      }
      setSyncState('pending');
      try {
        const cloud = await fetchCloudProgress(auth.token);
        if (cancelled) return;
        skipCloudPush.current = true;
        setProgress((local) => {
          const merged = mergeProgress(local, cloud);
          saveProgress(merged);
          return merged;
        });
        cloudReady.current = true;
        setSyncState('ok');
      } catch (e) {
        if (cancelled) return;
        cloudReady.current = true;
        setSyncState('err');
        const msg = e instanceof Error ? e.message : '云端同步失败';
        if (msg.includes('未登录') || msg.includes('401')) {
          clearAuth();
          setAuth(null);
        }
      }
    }
    cloudReady.current = false;
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [auth?.token]);

  // Persist locally always; debounce cloud push when logged in
  useEffect(() => {
    saveProgress(progress);
    if (!auth?.token || !cloudReady.current) return;
    if (skipCloudPush.current) {
      skipCloudPush.current = false;
      return;
    }
    setSyncState('pending');
    const t = window.setTimeout(() => {
      void pushCloudProgress(auth.token, progress)
        .then(() => setSyncState('ok'))
        .catch(() => setSyncState('err'));
    }, 800);
    return () => window.clearTimeout(t);
  }, [progress, auth?.token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words.filter((w) => {
      if (category !== '全部' && w.category !== category) return false;
      if (role !== '全员' && !ROLE_MAP[role]?.includes(w.category)) return false;
      if (quality === '核心' && w.priority !== '核心') return false;
      if (quality === '已核实' && w.status !== '已核实') return false;
      if (quality === '错题' && !progress.wrong.includes(w.term)) return false;
      if (quality === '收藏' && !progress.saved.includes(w.term)) return false;
      if (quality === '学习中' && !progress.learning.includes(w.term)) return false;
      if (q && !`${w.term} ${w.zh} ${w.definition} ${w.example}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, category, role, quality, progress.wrong, progress.saved, progress.learning]);

  const unmastered = useMemo(
    () => filtered.filter((w) => !progress.known.includes(w.term)),
    [filtered, progress.known],
  );

  const deck = useMemo(() => {
    const base = unmastered.length ? unmastered : filtered.length ? filtered : words;
    return shuffle(base, cardSeed);
  }, [unmastered, filtered, cardSeed]);

  const safeCardIndex = deck.length ? cardIndex % deck.length : 0;
  const card = deck[safeCardIndex];

  // Freeze the deck for the quiz session. Rebuilding when progress.known changes
  // (after a correct answer) used to swap the current question while `picked` stayed
  // set, so the next item looked already answered with the correct option highlighted.
  const quizDeck = useMemo(() => {
    const unknown = words.filter((w) => !progress.known.includes(w.term));
    const pool = unknown.length >= 4 ? unknown : words;
    return shuffle(pool, quizSeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only quizSeed: capture known at start/reset, not mid-quiz
  }, [quizSeed]);

  const safeQuizIndex = quizDeck.length ? quizIndex % quizDeck.length : 0;
  const quizWord = quizDeck[safeQuizIndex];

  const quizChoices = useMemo(() => {
    if (!quizWord) return [];
    const others = shuffle(
      quizDeck.filter((w) => w.term !== quizWord.term),
      quizSeed + quizIndex * 97,
    ).slice(0, 3);
    const opts = [...others.map((w) => w.zh), quizWord.zh];
    // dedupe meanings
    const unique = Array.from(new Set(opts));
    while (unique.length < 4) {
      const filler = words[(quizSeed + unique.length * 13) % words.length];
      if (!unique.includes(filler.zh)) unique.push(filler.zh);
      else unique.push(`${filler.zh}（${filler.category}）`);
    }
    return shuffle(unique.slice(0, 4), quizSeed + quizIndex * 131);
  }, [quizWord, quizDeck, quizSeed, quizIndex]);

  const knownSet = useMemo(() => new Set(progress.known), [progress.known]);
  const catStats = useMemo(() => {
    const map: Record<string, { total: number; known: number }> = {};
    for (const w of words) {
      if (!map[w.category]) map[w.category] = { total: 0, known: 0 };
      map[w.category].total++;
      if (knownSet.has(w.term)) map[w.category].known++;
    }
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [knownSet]);

  const todayPreview = useMemo(() => {
    const day = new Date().getDate();
    const start = (day * 11) % Math.max(1, words.length - 8);
    return words.slice(start, start + 8);
  }, []);

  const update = (fn: (p: Progress) => Progress) => setProgress((p) => fn(p));

  const markKnown = (term: string) =>
    update((p) => ({
      ...p,
      known: p.known.includes(term) ? p.known : [...p.known, term],
      learning: p.learning.filter((t) => t !== term),
    }));

  const markLearning = (term: string) =>
    update((p) => ({
      ...p,
      learning: p.learning.includes(term) ? p.learning : [...p.learning, term],
      known: p.known.filter((t) => t !== term),
    }));

  const toggleSaved = (term: string) =>
    update((p) => ({ ...p, saved: toggleTerm(p.saved, term) }));

  const nextCard = () => {
    if (!deck.length) return;
    setCardIndex((i) => (i + 1) % deck.length);
    setFlipped(false);
  };
  const prevCard = () => {
    if (!deck.length || safeCardIndex <= 0) return;
    setCardIndex((i) => i - 1);
    setFlipped(false);
  };

  const answerQuiz = (choice: string) => {
    if (picked || !quizWord) return;
    setPicked(choice);
    setAnswered((n) => n + 1);
    const ok = choice === quizWord.zh;
    if (ok) {
      setScore((s) => s + 1);
      markKnown(quizWord.term);
    } else {
      update((p) => ({
        ...p,
        wrong: p.wrong.includes(quizWord.term) ? p.wrong : [...p.wrong, quizWord.term],
        learning: p.learning.includes(quizWord.term) ? p.learning : [...p.learning, quizWord.term],
      }));
    }
  };

  const nextQuiz = () => {
    setPicked(null);
    setQuizIndex((i) => (i + 1) % Math.max(1, quizDeck.length));
  };

  // Defense in depth: any word change must clear selection so options start fresh.
  useEffect(() => {
    setPicked(null);
  }, [safeQuizIndex, quizWord?.term]);

  const resetQuiz = () => {
    setQuizSeed(Date.now());
    setQuizIndex(0);
    setPicked(null);
    setScore(0);
    setAnswered(0);
  };

  const runAuth = async (mode: 'login' | 'register') => {
    const username = authUser.trim();
    const password = authPass;
    if (username.length < 2) {
      setAuthMsg({ type: 'err', text: '请输入用户名（至少 2 个字符）' });
      return;
    }
    if (password.length < 4) {
      setAuthMsg({ type: 'err', text: '密码至少 4 位' });
      return;
    }
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      const user = mode === 'register' ? await apiRegister(username, password) : await apiLogin(username, password);
      setAuth(user);
      setAuthPass('');
      setAuthMsg({ type: 'ok', text: mode === 'register' ? '注册成功，进度将同步到云端' : '登录成功，正在拉取云端进度' });
    } catch (e) {
      setAuthMsg({ type: 'err', text: e instanceof Error ? e.message : '操作失败' });
    } finally {
      setAuthBusy(false);
    }
  };

  const runLogout = async () => {
    setAuthBusy(true);
    try {
      await apiLogout(auth?.token || null);
    } finally {
      setAuth(null);
      setSyncState('idle');
      setAuthMsg({ type: 'ok', text: '已退出登录（本机进度仍保留）' });
      setAuthBusy(false);
    }
  };

  const doExport = () => {
    const blob = new Blob([exportProgress(progress)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yuangan-english-progress-${progress.profile || 'default'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = importProgress(String(reader.result));
        setProgress(next);
        alert('进度已导入');
      } catch {
        alert('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  };

  const pct = Math.round((progress.known.length / Math.max(1, wordCount)) * 100);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">YG</div>
          <div>
            <b>远感外贸英语</b>
            <span>Water English Lab</span>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} type="button" className={tab === n.id ? 'active' : ''} onClick={() => setTab(n.id)}>
              <i>{n.icon}</i>
              {n.label}
              {n.id === 'saved' && progress.saved.length > 0 && (
                <em className="badge">{progress.saved.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="side-card">
          <span className="eyebrow">连续学习</span>
          <strong>
            {progress.streak} <small>天</small>
          </strong>
          <p className="muted tiny">档案：{progress.profile}</p>
          {auth ? (
            <p className="muted tiny" style={{ marginTop: 6 }}>
              账号：{auth.username}
            </p>
          ) : (
            <p className="muted tiny" style={{ marginTop: 6 }}>
              未登录 · 进度仅本机
            </p>
          )}
        </div>
      </aside>

      <main className="content">
        <header className="top">
          <div>
            <span className="eyebrow">CHONGQING YUANGAN TECHNOLOGY</span>
            <h1>
              {tab === 'home' && '从专业词汇开始，把产品讲给世界听'}
              {tab === 'learn' && '闪卡学习'}
              {tab === 'quiz' && '快速测验'}
              {tab === 'library' && '专业词库'}
              {tab === 'saved' && '收藏与错题'}
              {tab === 'progress' && '学习进度'}
            </h1>
            <p className="muted">
              合并千问 / Codex / 产品词表 · 共 {wordCount.toLocaleString()} 词 · 已核实 {verifiedCount}
            </p>
          </div>
          <div className="header-actions">
            {auth ? (
              <span className="auth-user" title="已登录，进度云同步">
                {auth.username}
                {syncState !== 'idle' && (
                  <span className={`sync-dot ${syncState}`} style={{ marginLeft: 6 }}>
                    <i />
                    {syncState === 'ok' ? '已同步' : syncState === 'pending' ? '同步中' : '同步失败'}
                  </span>
                )}
              </span>
            ) : (
              <button type="button" className="accent-pill" onClick={() => setTab('progress')}>
                登录同步
              </button>
            )}
            <label className="accent-pill">
              发音
              <select
                value={progress.accent}
                onChange={(e) =>
                  update((p) => ({ ...p, accent: e.target.value as 'us' | 'uk' }))
                }
              >
                <option value="us">美音</option>
                <option value="uk">英音</option>
              </select>
            </label>
            <div className="master-pill">已掌握 {progress.known.length}</div>
            <button type="button" className="primary" onClick={() => setTab('learn')}>
              开始学习 →
            </button>
          </div>
        </header>

        {tab === 'home' && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span>今日学习 · 连续 {progress.streak} 天</span>
                <h2>
                  水质仪表与外贸场景
                  <br />
                  一套词库练到底
                </h2>
                <p>
                  {auth
                    ? `已登录 ${auth.username}，学习进度会自动同步到云端，换手机也能接着学。`
                    : '登录后进度同步到云端；未登录时进度保存在本机，也可导出 JSON。'}
                </p>
                <button type="button" onClick={() => setTab('learn')}>
                  开始今日闪卡 →
                </button>
              </div>
            </section>
            <div className="metrics">
              {[
                ['总词汇', wordCount, '词'],
                ['已掌握', progress.known.length, '词'],
                ['学习中', progress.learning.length, '词'],
                ['进度', pct, '%'],
              ].map(([label, value, unit]) => (
                <article
                  key={String(label)}
                  style={label === '学习中' || label === '已掌握' ? { cursor: 'pointer' } : undefined}
                  onClick={() => {
                    if (label === '学习中') { setQuality('学习中'); setTab('library'); }
                    if (label === '已掌握') setTab('progress');
                  }}
                >
                  <b>
                    {value}
                    <small>{unit}</small>
                  </b>
                  <span>{label}</span>
                </article>
              ))}
            </div>
            <div className="home-grid">
              <section className="panel">
                <div className="section-head">
                  <h2>今日词汇预览</h2>
                  <button type="button" onClick={() => setTab('learn')}>
                    学习全部 →
                  </button>
                </div>
                <div className="preview-list">
                  {todayPreview.map((w) => (
                    <div key={w.term}>
                      <SpeakBtn text={w.term} accent={progress.accent} />
                      <strong>{w.term}</strong>
                      <span>{w.zh}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="section-head">
                  <h2>专业分类</h2>
                </div>
                <div className="cat-list">
                  {categories
                    .filter((c) => c !== '全部')
                    .slice(0, 10)
                    .map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setCategory(c);
                          setTab('library');
                        }}
                      >
                        <b>{c}</b>
                        <span>{words.filter((w) => w.category === c).length} 词</span>
                      </button>
                    ))}
                </div>
              </section>
            </div>
          </>
        )}

        {tab === 'learn' && card && (
          <>
            <div className="metrics slim">
              <article>
                <b>
                  {safeCardIndex + 1}
                  <small>/ {deck.length}</small>
                </b>
                <span>当前牌组</span>
              </article>
              <article>
                <b>{progress.known.length}</b>
                <span>已掌握</span>
              </article>
              <article>
                <b>{progress.wrong.length}</b>
                <span>错题</span>
              </article>
              <article>
                <b>{progress.saved.length}</b>
                <span>收藏</span>
              </article>
            </div>
            <div className="learn-grid">
              <section
                className={`flash ${flipped ? 'flipped' : ''}`}
                onClick={() => setFlipped((f) => !f)}
                onKeyDown={(e) => e.key === 'Enter' && setFlipped((f) => !f)}
                role="button"
                tabIndex={0}
              >
                <div className="flash-top">
                  <span>{card.category}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSaved(card.term);
                    }}
                  >
                    {progress.saved.includes(card.term) ? '★' : '☆'}
                  </button>
                </div>
                {!flipped ? (
                  <div className="flash-front">
                    <small>点击卡片查看释义</small>
                    <h2>{card.term}</h2>
                    <p>
                      {card.phonetic || '—'}{' '}
                      <SpeakBtn text={card.term} accent={progress.accent} />
                    </p>
                    <div className="chips">
                      <span>{card.level}</span>
                      <span>{card.priority || '扩展'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flash-back">
                    <small>{card.phonetic}</small>
                    <h2>{card.zh}</h2>
                    <div className="speak-block">
                      <div className="speak-line">
                        <b>英文释义</b>
                        <SpeakBtn text={card.definition} accent={progress.accent} />
                      </div>
                      <p>{card.definition}</p>
                      {card.definitionZh && <p className="zh-line">{card.definitionZh}</p>}
                    </div>
                    {card.collocation && (
                      <>
                        <b>常用搭配</b>
                        <p>{card.collocation}</p>
                      </>
                    )}
                  </div>
                )}
                <div className="flash-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={progress.learning.includes(card.term) ? 'selected' : ''}
                    onClick={() => { markLearning(card.term); nextCard(); }}
                  >
                    {progress.learning.includes(card.term) ? '✓ 已在学习中' : '加入学习中'}
                  </button>
                  <button type="button" className="ok" onClick={() => { markKnown(card.term); nextCard(); }}>
                    已掌握
                  </button>
                  <button
                    type="button"
                    className="prev"
                    onClick={prevCard}
                    disabled={safeCardIndex <= 0}
                  >
                    ← 上一个
                  </button>
                  <button type="button" className="next" onClick={nextCard}>
                    下一个 →
                  </button>
                </div>
              </section>
              <section className="panel context">
                <span className="eyebrow">IN CONTEXT</span>
                <h3>真实语境</h3>
                {(() => {
                  const ex = pickExample(card, cardSeed + safeCardIndex * 17);
                  return (
                <div className="speak-block">
                  <div className="speak-line">
                    <b>例句</b>
                    <SpeakBtn text={ex.example} accent={progress.accent} />
                  </div>
                  <blockquote>{ex.example}</blockquote>
                  <p className="zh-line">{ex.exampleZh || '（暂无中文翻译）'}</p>
                </div>
                  );
                })()}
                <div className="tip">
                  <b>来源</b>
                  <a href={card.sourceUrl} target="_blank" rel="noreferrer">
                    {card.source} ↗
                  </a>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={prevCard} disabled={safeCardIndex <= 0}>
                    ← 上一个
                  </button>
                  <button type="button" className="dark" onClick={nextCard}>
                    下一个 →
                  </button>
                </div>
              </section>
            </div>
          </>
        )}

        {tab === 'learn' && !card && (
          <div className="empty">当前筛选下没有可学单词，请到词库调整筛选条件。</div>
        )}

        {tab === 'quiz' && quizWord && (
          <section className="panel quiz">
            <div className="section-head">
              <div>
                <span className="eyebrow">QUICK CHECK</span>
                <h2>
                  “{quizWord.term}” 的中文是？
                </h2>
                <p className="muted">
                  得分 {score}/{answered || 0} · <SpeakBtn text={quizWord.term} accent={progress.accent} />
                </p>
              </div>
              <button type="button" onClick={resetQuiz}>
                重新开始
              </button>
            </div>
            <div className="options">
              {quizChoices.map((c) => (
                <button
                  key={`${safeQuizIndex}-${c}`}
                  type="button"
                  className={
                    picked
                      ? c === quizWord.zh
                        ? 'correct'
                        : c === picked
                          ? 'wrong'
                          : ''
                      : ''
                  }
                  onClick={() => answerQuiz(c)}
                  disabled={!!picked}
                >
                  {c}
                  <span>{picked && c === quizWord.zh ? '✓' : picked === c ? '×' : ''}</span>
                </button>
              ))}
            </div>
            {picked && (
              <div className="quiz-foot">
                <div className="quiz-explain">
                  <p>
                    {picked === quizWord.zh ? '回答正确！' : `正确答案：${quizWord.zh}`}
                  </p>
                  <div className="speak-block">
                    <div className="speak-line">
                      <b>英文释义</b>
                      <SpeakBtn text={quizWord.definition} accent={progress.accent} />
                    </div>
                    <p>{quizWord.definition}</p>
                    {quizWord.definitionZh && <p className="zh-line">{quizWord.definitionZh}</p>}
                  </div>
                  {(() => {
                    const ex = pickExample(quizWord, quizSeed + quizIndex);
                    return (
                  <div className="speak-block">
                    <div className="speak-line">
                      <b>例句</b>
                      <SpeakBtn text={ex.example} accent={progress.accent} />
                    </div>
                    <p>{ex.example}</p>
                    <p className="zh-line">{ex.exampleZh || '（暂无中文翻译）'}</p>
                  </div>
                    );
                  })()}
                </div>
                <button type="button" className="primary" onClick={nextQuiz}>
                  下一题 →
                </button>
              </div>
            )}
          </section>
        )}

        {tab === 'library' && (
          <section className="panel library">
            <div className="panel-head">
              <h2>行业词库 · {filtered.length.toLocaleString()} 条</h2>
              <div className="search">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索英文、中文或释义…"
                />
              </div>
            </div>
            <div className="filters">
              {categories.slice(0, 20).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={category === c ? 'selected' : ''}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="filters">
              <span className="eyebrow">岗位</span>
              {['全员', '外贸销售', '技术支持', '研发产品', '智慧水务', '泳池业务'].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={role === r ? 'selected' : ''}
                  onClick={() => setRole(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="filters">
              <span className="eyebrow">筛选</span>
              {['全部', '核心', '已核实', '错题', '收藏', '学习中'].map((q) => (
                <button
                  key={q}
                  type="button"
                  className={quality === q ? 'selected' : ''}
                  onClick={() => setQuality(q)}
                >
                  {q}
                </button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <div className="empty">没有匹配的词条，试试清空筛选。</div>
            ) : (
              <div className="word-list">
                {filtered.slice(0, 300).map((w) => (
                  <article key={w.term} className="lib-card">
                    <div>
                      <h3>
                        {w.term} <SpeakBtn text={w.term} accent={progress.accent} />
                      </h3>
                      <span>{w.phonetic || w.status}</span>
                    </div>
                    <div>
                      <b>{w.zh}</b>
                      <div className="speak-block compact">
                        <div className="speak-line">
                          <em>释义</em>
                          <SpeakBtn text={w.definition} accent={progress.accent} />
                        </div>
                        <p>{w.definition}</p>
                        {w.definitionZh && <p className="zh-line">{w.definitionZh}</p>}
                      </div>
                      {w.example && (() => {
                        const ex = pickExample(w, w.term.length * 13 + (w.examples?.length || 0));
                        return (
                        <div className="speak-block compact">
                          <div className="speak-line">
                            <em>例句</em>
                            <SpeakBtn text={ex.example} accent={progress.accent} />
                          </div>
                          <p>{ex.example}</p>
                          <p className="zh-line">{ex.exampleZh || '（暂无中文翻译）'}</p>
                        </div>
                        );
                      })()}
                    </div>
                    <span className="tag">{w.category}</span>
                    <button type="button" onClick={() => toggleSaved(w.term)}>
                      {progress.saved.includes(w.term) ? '★' : '☆'}
                    </button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() =>
                        progress.known.includes(w.term) ? markLearning(w.term) : markKnown(w.term)
                      }
                    >
                      {progress.known.includes(w.term) ? '取消掌握' : '掌握'}
                    </button>
                  </article>
                ))}
              </div>
            )}
            {filtered.length > 300 && (
              <p className="result-note">共 {filtered.length} 条，当前显示前 300 条，请继续缩小搜索范围。</p>
            )}
          </section>
        )}

        {tab === 'saved' && (
          <section className="panel">
            <div className="section-head">
              <h2>收藏 {progress.saved.length} · 错题 {progress.wrong.length}</h2>
              <button
                type="button"
                onClick={() => update((p) => ({ ...p, wrong: [] }))}
              >
                清空错题
              </button>
            </div>
            <h3 className="sub">收藏夹</h3>
            {progress.saved.length === 0 ? (
              <div className="empty">还没有收藏。在闪卡或词库点 ★ 即可加入。</div>
            ) : (
              <div className="word-list">
                {words
                  .filter((w) => progress.saved.includes(w.term))
                  .map((w) => (
                    <article key={w.term}>
                      <div>
                        <h3>
                          {w.term} <SpeakBtn text={w.term} accent={progress.accent} />
                        </h3>
                      </div>
                      <div>
                        <b>{w.zh}</b>
                      </div>
                      <span className="tag">{w.category}</span>
                      <button type="button" onClick={() => toggleSaved(w.term)}>
                        ★
                      </button>
                    </article>
                  ))}
              </div>
            )}
            <h3 className="sub">错题本</h3>
            {progress.wrong.length === 0 ? (
              <div className="empty">暂无错题。测验答错会自动记录。</div>
            ) : (
              <div className="word-list">
                {words
                  .filter((w) => progress.wrong.includes(w.term))
                  .map((w) => (
                    <article key={w.term}>
                      <div>
                        <h3>
                          {w.term} <SpeakBtn text={w.term} accent={progress.accent} />
                        </h3>
                      </div>
                      <div>
                        <b>{w.zh}</b>
                        <div className="speak-block compact">
                          <div className="speak-line">
                            <em>释义</em>
                            <SpeakBtn text={w.definition} accent={progress.accent} />
                          </div>
                          <p>{w.definition}</p>
                          {w.definitionZh && <p className="zh-line">{w.definitionZh}</p>}
                        </div>
                        <div className="speak-block compact">
                          <div className="speak-line">
                            <em>例句</em>
                            <SpeakBtn text={w.example} accent={progress.accent} />
                          </div>
                          <p>{w.example}</p>
                          <p className="zh-line">{w.exampleZh || '（暂无中文翻译）'}</p>
                        </div>
                      </div>
                      <span className="tag">{w.category}</span>
                      <button
                        type="button"
                        className="tiny-btn"
                        onClick={() =>
                          update((p) => ({
                            ...p,
                            wrong: p.wrong.filter((t) => t !== w.term),
                            known: p.known.includes(w.term) ? p.known : [...p.known, w.term],
                          }))
                        }
                      >
                        标为已掌握
                      </button>
                    </article>
                  ))}
              </div>
            )}
          </section>
        )}

        {tab === 'progress' && (
          <section className="panel progress-page">
            <div className="section-head">
              <div>
                <h2>学习档案与进度</h2>
                <p className="muted warn">
                  {auth
                    ? '已登录：进度会自动同步到服务器；本机仍保留一份缓存。建议偶尔导出 JSON 备份。'
                    : '未登录时进度只存在本机浏览器。注册/登录后即可跨设备同步。'}
                </p>
              </div>
            </div>
            <div className="auth-panel">
              <h3>{auth ? '云端账号' : '注册 / 登录（同步进度）'}</h3>
              {auth ? (
                <div className="auth-bar">
                  <span className="auth-user">{auth.username}</span>
                  <span className={`sync-dot ${syncState}`}>
                    <i />
                    {syncState === 'ok' ? '云端已同步' : syncState === 'pending' ? '正在同步…' : syncState === 'err' ? '同步失败' : '待命'}
                  </span>
                  <button type="button" disabled={authBusy} onClick={() => void runLogout()}>
                    退出登录
                  </button>
                </div>
              ) : (
                <div className="auth-form">
                  <label>
                    用户名
                    <input
                      value={authUser}
                      onChange={(e) => setAuthUser(e.target.value)}
                      placeholder="自己取一个"
                      autoComplete="username"
                      maxLength={32}
                    />
                  </label>
                  <label>
                    密码
                    <input
                      type="password"
                      value={authPass}
                      onChange={(e) => setAuthPass(e.target.value)}
                      placeholder="至少 4 位"
                      autoComplete="current-password"
                      maxLength={64}
                    />
                  </label>
                  <button type="button" className="primary" disabled={authBusy} onClick={() => void runAuth('login')}>
                    登录
                  </button>
                  <button type="button" disabled={authBusy} onClick={() => void runAuth('register')}>
                    注册
                  </button>
                </div>
              )}
              {authMsg && <p className={`auth-msg ${authMsg.type}`}>{authMsg.text}</p>}
              {!auth && (
                <p className="muted tiny" style={{ marginTop: 8 }}>
                  每人自己设用户名和密码即可，无需邮箱。同事各用各的账号，进度互不干扰。
                </p>
              )}
            </div>
            <div className="progress-form">
              <label>
                学习档案名（本机多销售可各用一名）
                <input
                  value={progress.profile}
                  onChange={(e) => update((p) => ({ ...p, profile: e.target.value || '默认档案' }))}
                  maxLength={32}
                />
              </label>
              <div className="row-actions">
                <button type="button" className="primary" onClick={doExport}>
                  导出进度 JSON
                </button>
                <button type="button" onClick={() => fileRef.current?.click()}>
                  导入进度
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) doImport(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (confirm('确定清空当前档案的学习进度？')) setProgress(initialLike(progress));
                  }}
                >
                  清空进度
                </button>
              </div>
            </div>
            <div className="metrics slim">
              <article>
                <b>{progress.known.length}</b>
                <span>已掌握</span>
              </article>
              <article>
                <b>{progress.learning.length}</b>
                <span>学习中</span>
              </article>
              <article>
                <b>{progress.saved.length}</b>
                <span>收藏</span>
              </article>
              <article>
                <b>{progress.streak}</b>
                <span>连续天数</span>
              </article>
            </div>
            <h3 className="sub">分类完成度</h3>
            <div className="cat-progress">
              {catStats.map(([name, s]) => (
                <div key={name}>
                  <div className="cat-progress-head">
                    <b>{name}</b>
                    <span>
                      {s.known}/{s.total}
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{ width: `${Math.round((s.known / Math.max(1, s.total)) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <nav className="mobile-nav">
        {NAV.map((n) => (
          <button key={n.id} type="button" className={tab === n.id ? 'active' : ''} onClick={() => setTab(n.id)}>
            <i>{n.icon}</i>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function initialLike(p: Progress): Progress {
  return {
    profile: p.profile,
    known: [],
    learning: [],
    saved: [],
    wrong: [],
    streak: 0,
    accent: p.accent,
  };
}
