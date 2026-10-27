'use strict';

// الواجهة لا تخزّن نصًا قرآنيًا ولا تُنشئ آيات؛ جميع الآيات تُجلب من مصدر الرسم العثماني.
const $ = (id) => document.getElementById(id);
const arabicNumber = (number) => Number(number).toLocaleString('ar-SA');
const pad = (n) => String(n).padStart(3, '0');
const keyFor = (a) => `${a.surah.number}:${a.numberInSurah}`;
const keyOf = (surah, ayah) => `${surah}:${ayah}`;
const audio = $('quran-audio');
const message = (text) => { $('player-message').textContent = text; };
const state = {
  page: 1,
  pageVerses: [],
  selectedKey: null,
  activeKey: null,
  activeWordIndex: -1,
  focus: true,
  timing: null,
  chapterPlaying: null,
  fallbackVerse: null,
  trackMode: null,
  loadPageToken: 0,
  playToken: 0,
  followPagePending: null,
  timingCache: new Map(),
  verseCache: new Map(),
  lastFollowKey: null,
  loadChapterPromise: null,
  chapterList: [],
  userSeeking: false,
  pendingSelection: false,
  quranInitialized: false
};

async function json(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const n = Math.floor(seconds);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
let toastTimeout;
function toast(content) {
  const node = $('toast');
  node.textContent = content;
  node.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => node.classList.remove('show'), 3300);
}
function setSync(text, detailedText) {
  $('sync-badge').textContent = text;
  if (detailedText) message(detailedText);
}

function navigate() {
  const route = (location.hash || '#home').replace('#', '');
  const valid = ['home', 'quran', 'articles', 'article-prayer', 'tasbeeh'];
  const destination = valid.includes(route) ? route : 'home';
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('active', screen.id === `screen-${destination}`);
  });
  document.querySelectorAll('[data-nav]').forEach((el) => {
    const nav = destination === 'article-prayer' ? 'articles' : destination;
    el.classList.toggle('active', el.dataset.nav === nav);
    if (el.dataset.nav === nav) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  if (destination === 'quran' && !state.quranInitialized) {
    state.quranInitialized = true;
    loadPage(1);
    loadChapters();
  }
  if (destination !== 'quran' && !audio.paused) audio.pause();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', navigate);

function drawArticle() {
  const host = $('article-content');
  if (!Array.isArray(window.PRAYER_ARTICLE)) return;
  const fragment = document.createDocumentFragment();
  for (const item of window.PRAYER_ARTICLE) {
    const el = document.createElement(item.type === 'h2' ? 'h2' : 'p');
    el.textContent = item.text;
    fragment.append(el);
  }
  host.replaceChildren(fragment);
}

// Quran pages: page grouping and text are from Al Quran Cloud's quran-uthmani edition.
async function loadChapters() {
  if (state.loadChapterPromise) return state.loadChapterPromise;
  state.loadChapterPromise = (async () => {
    try {
      const answer = await json('/api/chapters');
      if (!Array.isArray(answer.data) || answer.data.length !== 114) throw new Error('invalid');
      state.chapterList = answer.data;
      const select = $('surah-select');
      select.replaceChildren();
      for (const item of answer.data) {
        const option = document.createElement('option');
        option.value = String(item.number);
        option.textContent = `${arabicNumber(item.number)} — ${item.name}`;
        select.appendChild(option);
      }
      const selected = state.pageVerses[0]?.surah.number || 1;
      select.value = String(selected);
    } catch {
      const option = document.createElement('option');
      option.textContent = 'تعذر تحميل قائمة السور (استخدم رقم الصفحة)';
      $('surah-select').replaceChildren(option);
      state.loadChapterPromise = null;
    }
  })();
  return state.loadChapterPromise;
}
function getSurahName(number) {
  const fromChapterList = state.chapterList.find((item) => item.number === number);
  const fromPage = state.pageVerses.find((item) => item.surah.number === number);
  return fromChapterList?.name || fromPage?.surah.name || `السورة ${arabicNumber(number)}`;
}
function activeCard(key) {
  for (const item of document.querySelectorAll('.verse')) {
    const active = item.dataset.key === key;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  }
}
function clearWords() {
  for (const item of document.querySelectorAll('.active-word')) item.classList.remove('active-word');
  state.activeWordIndex = -1;
}
function applyActive(key, wordIndex = -1, scrollIntoView = false) {
  const newKey = key || null;
  if (state.activeKey !== newKey) {
    state.activeKey = newKey;
    clearWords();
    activeCard(newKey);
  }
  if (wordIndex !== state.activeWordIndex) {
    clearWords();
    const card = [...document.querySelectorAll('.verse')].find((el) => el.dataset.key === newKey);
    const word = card?.querySelector(`[data-word-index="${wordIndex}"]`);
    if (word) { word.classList.add('active-word'); state.activeWordIndex = wordIndex; }
  }
  if (scrollIntoView && key) {
    const card = [...document.querySelectorAll('.verse')].find((el) => el.dataset.key === key);
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
function renderPage() {
  const host = $('verse-list');
  const fragment = document.createDocumentFragment();
  let lastSurah = null;
  for (const ayah of state.pageVerses) {
    const key = keyFor(ayah);
    if (ayah.surah.number !== lastSurah) {
      lastSurah = ayah.surah.number;
      const separator = document.createElement('h2');
      separator.className = 'surah-separator';
      separator.textContent = getSurahName(lastSurah);
      fragment.appendChild(separator);
    }
    const verse = document.createElement('section');
    verse.className = 'verse';
    verse.dataset.key = key;
    verse.setAttribute('aria-label', `سورة ${ayah.surah.name} الآية ${arabicNumber(ayah.numberInSurah)}`);
    const heading = document.createElement('div');
    heading.className = 'verse-header';
    const label = document.createElement('span');
    label.className = 'verse-key';
    label.textContent = key;
    const playButton = document.createElement('button');
    playButton.className = 'verse-play';
    playButton.type = 'button';
    playButton.textContent = '▷ استمع للآية';
    playButton.setAttribute('aria-label', `تشغيل تلاوة الآية ${arabicNumber(ayah.numberInSurah)}`);
    playButton.addEventListener('click', () => startVerse(ayah, true));
    heading.append(label, playButton);
    verse.appendChild(heading);
    const text = document.createElement('div');
    text.className = 'verse-text';
    text.lang = 'ar';
    // نحتفظ بحروف وضبط النص من المصدر كما ورد تمامًا دون تطبيع أو استبدال.
    const words = ayah.text.trim().split(/\s+/u);
    words.forEach((word, index) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.wordIndex = String(index + 1);
      span.textContent = word;
      text.appendChild(span);
      if (index < words.length - 1) text.appendChild(document.createTextNode(' '));
    });
    const number = document.createElement('span');
    number.className = 'verse-number';
    number.textContent = arabicNumber(ayah.numberInSurah);
    number.setAttribute('aria-label', 'رقم الآية');
    text.appendChild(number);
    verse.appendChild(text);
    verse.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      state.selectedKey = key;
      state.pendingSelection = true;
      applyActive(key, -1);
      $('now-playing').textContent = `${ayah.surah.name} — الآية ${arabicNumber(ayah.numberInSurah)}`;
    });
    fragment.appendChild(verse);
  }
  host.replaceChildren(fragment);
  if (!state.selectedKey || !state.pageVerses.some((item) => keyFor(item) === state.selectedKey)) {
    state.selectedKey = keyFor(state.pageVerses[0]);
  }
  state.activeKey = null;
  applyActive(state.chapterPlaying ? state.activeKey : state.selectedKey);
}
async function loadPage(page, options = {}) {
  if (!Number.isInteger(page) || page < 1 || page > 604) { toast('اختر رقم صفحة من 1 إلى 604.'); return false; }
  const token = ++state.loadPageToken;
  if (!options.follow && !audio.paused) audio.pause();
  if (!options.follow) state.followPagePending = null;
  $('verse-list').innerHTML = '<div class="loading-state"><span class="loading-symbol">۞</span> جاري تحميل صفحة المصحف...</div>';
  try {
    const answer = await json(`/api/page?page=${page}`);
    if (!Array.isArray(answer.data?.ayahs) || !answer.data.ayahs.length) throw new Error('bad page');
    if (token !== state.loadPageToken) return false;
    state.page = page;
    state.pageVerses = answer.data.ayahs;
    for (const verse of state.pageVerses) state.verseCache.set(keyFor(verse), verse);
    if (options.selectedKey) state.selectedKey = options.selectedKey;
    else if (!options.follow) state.selectedKey = keyFor(state.pageVerses[0]);
    if (!options.follow) state.pendingSelection = true;
    $('page-number').value = String(page);
    $('mushaf-page').textContent = `الصفحة ${arabicNumber(page)}`;
    $('page-counter').textContent = `${arabicNumber(page)} / ٦٠٤`;
    $('page-reading-label').textContent = `الصفحة ${arabicNumber(page)} من ٦٠٤`;
    $('prev-page').disabled = page === 1;
    $('next-page').disabled = page === 604;
    $('mushaf-surah').textContent = getSurahName(state.pageVerses[0].surah.number);
    if (state.chapterList.length) $('surah-select').value = String(state.pageVerses[0].surah.number);
    renderPage();
    if (options.follow && state.lastFollowKey && state.pageVerses.some((a) => keyFor(a) === state.lastFollowKey)) {
      applyActive(state.lastFollowKey, -1, true);
    }
    return true;
  } catch {
    if (token !== state.loadPageToken) return false;
    $('verse-list').innerHTML = '';
    const outer = document.createElement('div');
    outer.className = 'error-state';
    const label = document.createElement('span');
    label.textContent = 'تعذر تحميل الصفحة من مصدر القرآن. لم نعرض نصًا بديلًا غير موثوق.';
    const retry = document.createElement('button');
    retry.textContent = 'أعد المحاولة';
    retry.addEventListener('click', () => loadPage(page));
    outer.append(label, retry);
    $('verse-list').appendChild(outer);
    return false;
  }
}
async function lookupVerse(surah, ayah) {
  const key = keyOf(surah, ayah);
  if (state.verseCache.has(key)) return state.verseCache.get(key);
  const answer = await json(`/api/verse?surah=${surah}&ayah=${ayah}`);
  const verse = answer.data;
  if (verse?.surah?.number !== surah || verse?.numberInSurah !== ayah || !Number.isInteger(verse.page)) {
    throw new Error('wrong verse');
  }
  state.verseCache.set(key, verse);
  return verse;
}
function validateAudioUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'api.kalamalah.com' || parsed.hostname.endsWith('.kalamalah.com'));
  } catch { return false; }
}
async function fetchTiming(surah) {
  if (state.timingCache.has(surah)) return state.timingCache.get(surah);
  const answer = await json(`/api/timing?surah=${surah}`);
  if (!Array.isArray(answer.recitation_timings) || !validateAudioUrl(answer.metadata?.recitation_info?.audio_url)) {
    throw new Error('timings invalid');
  }
  const validated = {
    surah,
    audio_url: answer.metadata.recitation_info.audio_url,
    verses: answer.recitation_timings.filter((item) =>
      typeof item.verse === 'string' && item.verse.startsWith(`${surah}:`) &&
      Number.isFinite(item.timestamps?.start_ms) && Number.isFinite(item.timestamps?.end_ms) &&
      item.timestamps.start_ms < item.timestamps.end_ms
    ).sort((a, b) => a.timestamps.start_ms - b.timestamps.start_ms)
  };
  if (!validated.verses.length) throw new Error('no timing');
  state.timingCache.set(surah, validated);
  return validated;
}
function getTimingVerse(timing, verse) {
  return timing?.verses?.find((item) => item.verse === verse);
}
function playIcon() {
  $('play-icon').textContent = audio.paused ? 'تشغيل' : 'إيقاف';
  $('play').setAttribute('aria-label', audio.paused ? 'تشغيل التلاوة' : 'إيقاف التلاوة مؤقتًا');
}
async function setAudioSource(url, seekSec, token) {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio.src = url;
  audio.load();
  if (audio.readyState < 1) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 16000);
      function cleanup() { clearTimeout(timeout); audio.removeEventListener('loadedmetadata', ok); audio.removeEventListener('error', bad); }
      function ok() { cleanup(); resolve(); }
      function bad() { cleanup(); reject(new Error('audio not available')); }
      audio.addEventListener('loadedmetadata', ok);
      audio.addEventListener('error', bad);
    });
  }
  if (token !== state.playToken) return false;
  if (seekSec > 0) audio.currentTime = Math.min(seekSec, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.01) : seekSec);
  return true;
}
async function startVerse(verse, shouldPlay = true) {
  if (!verse) return;
  const token = ++state.playToken;
  const surah = verse.surah.number;
  const key = keyFor(verse);
  state.selectedKey = key;
  state.pendingSelection = false;
  state.activeKey = null;
  applyActive(key, -1, true);
  $('now-playing').textContent = `${verse.surah.name} — الآية ${arabicNumber(verse.numberInSurah)}`;
  setSync('جاري تجهيز التلاوة', 'جاري تحميل التلاوة وبيانات توقيت الكلمات...');
  let timing = null;
  try { timing = await fetchTiming(surah); } catch { /* fallback: genuine Maher ayah audio, with no fabricated timing */ }
  if (token !== state.playToken) return;
  try {
    let url;
    let startSec = 0;
    const verseTiming = getTimingVerse(timing, key);
    if (timing && verseTiming) {
      url = timing.audio_url;
      startSec = verseTiming.timestamps.start_ms / 1000;
      state.trackMode = 'surah';
      state.chapterPlaying = surah;
      state.timing = timing;
      state.fallbackVerse = null;
      setSync('مزامنة التلاوة', 'تُبرز الآية والكلمة وفق أزمنة التسجيل المتاحة؛ عند عدم تطابق الكلمات، تُبرز الآية فقط.');
    } else {
      // لا نستخدم توقيت سورة على تسجيل آخر؛ كل تسجيل احتياطي يُشغَّل آيةً آيةً.
      url = `https://everyayah.com/data/MaherAlMuaiqly128kbps/${pad(surah)}${pad(verse.numberInSurah)}.mp3`;
      state.trackMode = 'verse';
      state.chapterPlaying = surah;
      state.timing = null;
      state.fallbackVerse = key;
      setSync('استماع بالآية', 'تلاوة ماهر المعيقلي تعمل آيةً آيةً؛ مزامنة الكلمة غير متاحة حاليًا لهذا التسجيل.');
    }
    // Same surah already loaded: no need to reload the audio file.
    const reuse = audio.currentSrc && audio.src === url && audio.readyState >= 1;
    if (reuse) { audio.currentTime = startSec; }
    else { const loaded = await setAudioSource(url, startSec, token); if (!loaded) return; }
    if (token !== state.playToken) return;
    syncPlayback();
    if (shouldPlay) await audio.play();
    playIcon();
  } catch {
    if (token !== state.playToken) return;
    audio.pause();
    playIcon();
    setSync('تعذّر تشغيل التلاوة', 'تعذّر تشغيل تسجيل الشيخ ماهر المعيقلي. تأكد من اتصالك بالإنترنت ثم أعد المحاولة.');
  }
}
function getCurrentTimedVerse(seconds) {
  if (!state.timing?.verses.length) return null;
  const ms = seconds * 1000;
  return state.timing.verses.find((v) => ms >= v.timestamps.start_ms && ms < v.timestamps.end_ms) || null;
}
function getMatchedWord(key, segs, now) {
  const card = [...document.querySelectorAll('.verse')].find((item) => item.dataset.key === key);
  const actualWords = card?.querySelectorAll('[data-word-index]');
  if (!actualWords?.length || !Array.isArray(segs) || !segs.length ||
      !segs.every((seg) => Array.isArray(seg) && seg.length >= 3)) return -1;
  const ids = segs.map((seg) => seg[0]);
  const distinct = new Set(ids);
  const correctlyIndexed = ids.every((id) => Number.isInteger(id) && id >= 1 && id <= actualWords.length);
  // نرفض التمييز على مستوى الكلمة إذا كانت مؤشرات المزامنة لا توافق تقسيم النص.
  if (!correctlyIndexed || distinct.size !== actualWords.length || Math.min(...ids) !== 1) return -1;
  const match = segs.find((seg) => Array.isArray(seg) &&
    Number.isFinite(seg[1]) && Number.isFinite(seg[2]) &&
    now * 1000 >= seg[1] && now * 1000 < seg[2]);
  return match?.[0] || -1;
}
function syncPlayback() {
  $('current-time').textContent = formatClock(audio.currentTime);
  $('total-time').textContent = formatClock(audio.duration);
  if (!state.userSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    $('seek').value = String(Math.floor(audio.currentTime / audio.duration * 1000));
  }
  if (state.trackMode === 'verse') {
    const key = state.fallbackVerse;
    if (key && state.pageVerses.some((item) => keyFor(item) === key)) applyActive(key, -1);
    return;
  }
  if (state.trackMode !== 'surah') return;
  const current = getCurrentTimedVerse(audio.currentTime);
  if (!current) { clearWords(); return; }
  const key = current.verse;
  state.lastFollowKey = key;
  if (!state.pageVerses.some((item) => keyFor(item) === key)) {
    if (state.followPagePending !== key) {
      state.followPagePending = key;
      const [surah, ayah] = key.split(':').map(Number);
      lookupVerse(surah, ayah).then((verse) => {
        if (state.followPagePending !== key) return;
        if (verse.page !== state.page) return loadPage(verse.page, { follow: true, selectedKey: key });
      }).catch(() => {}).finally(() => { if (state.followPagePending === key) state.followPagePending = null; });
    }
    return;
  }
  const wordIndex = getMatchedWord(key, current.audio_segments, audio.currentTime);
  applyActive(key, wordIndex, key !== state.activeKey);
  state.selectedKey = key;
  const [surahNum, ayahNum] = key.split(':').map(Number);
  $('now-playing').textContent = `${getSurahName(surahNum)} — الآية ${arabicNumber(ayahNum)}`;
}
async function selectedOrFirst() {
  if (!state.pageVerses.length) return null;
  return state.pageVerses.find((item) => keyFor(item) === state.selectedKey) || state.pageVerses[0];
}
async function moveVerse(direction, autoplay = true) {
  const current = await selectedOrFirst();
  if (!current) return;
  let surah = current.surah.number, ayah = current.numberInSurah + direction;
  if (ayah < 1) {
    if (surah === 1) return toast('أنت عند بداية المصحف.');
    surah--;
    const chapter = state.chapterList.find((item) => item.number === surah);
    if (chapter?.numberOfAyahs) ayah = chapter.numberOfAyahs;
    else {
      const firstPrevious = await lookupVerse(surah, 1);
      ayah = firstPrevious.surah.numberOfAyahs;
    }
  }
  if (ayah > current.surah.numberOfAyahs) {
    if (surah === 114) return toast('وصلت إلى آخر آية في المصحف.');
    surah++; ayah = 1;
  }
  try {
    const verse = await lookupVerse(surah, ayah);
    if (verse.page !== state.page) await loadPage(verse.page, { follow: true, selectedKey: keyFor(verse) });
    state.selectedKey = keyFor(verse);
    if (autoplay) await startVerse(verse, true);
    else applyActive(keyFor(verse), -1, true);
  } catch { toast('لم نتمكن من تحميل الآية التالية. أعد المحاولة.'); }
}
async function onAudioEnded() {
  playIcon();
  if (state.trackMode === 'verse') {
    const [s, a] = (state.fallbackVerse || '').split(':').map(Number);
    const verse = state.verseCache.get(keyOf(s, a));
    if (verse) { state.selectedKey = keyOf(s, a); await moveVerse(1, true); }
    return;
  }
  if (state.trackMode === 'surah' && state.chapterPlaying < 114) {
    try {
      const verse = await lookupVerse(state.chapterPlaying + 1, 1);
      if (verse.page !== state.page) await loadPage(verse.page, { follow: true, selectedKey: keyFor(verse) });
      await startVerse(verse, true);
    } catch { setSync('اكتملت السورة', 'يمكنك اختيار السورة التالية من القائمة.'); }
  }
}

function initQuran() {
  $('mushaf').classList.add('is-focused');
  $('focus-toggle').addEventListener('change', (event) => $('mushaf').classList.toggle('is-focused', event.target.checked));
  $('prev-page').addEventListener('click', () => loadPage(state.page - 1));
  $('next-page').addEventListener('click', () => loadPage(state.page + 1));
  $('jump-page').addEventListener('click', () => loadPage(Number($('page-number').value)));
  $('page-number').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadPage(Number(event.target.value));
  });
  $('surah-select').addEventListener('change', async (event) => {
    const surah = Number(event.target.value);
    try {
      const firstVerse = await lookupVerse(surah, 1);
      await loadPage(firstVerse.page, { selectedKey: keyFor(firstVerse) });
      applyActive(keyFor(firstVerse), -1, true);
    } catch { toast('تعذّر الانتقال إلى السورة. أعد المحاولة.'); }
  });
  $('play').addEventListener('click', async () => {
    if (audio.src && audio.readyState >= 1 && audio.paused && state.trackMode && !state.pendingSelection) {
      try { await audio.play(); } catch { toast('تعذّر تشغيل التلاوة.'); }
    } else if (!audio.paused) audio.pause();
    else await startVerse(await selectedOrFirst(), true);
    playIcon();
  });
  $('next-verse').addEventListener('click', () => moveVerse(1, true));
  $('prev-verse').addEventListener('click', () => moveVerse(-1, true));
  $('seek').addEventListener('input', () => {
    state.userSeeking = true;
    if (Number.isFinite(audio.duration)) $('current-time').textContent = formatClock(audio.duration * Number($('seek').value) / 1000);
  });
  $('seek').addEventListener('change', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number($('seek').value) / 1000;
    state.userSeeking = false;
    syncPlayback();
  });
  audio.addEventListener('timeupdate', syncPlayback);
  audio.addEventListener('loadedmetadata', syncPlayback);
  // timeupdate وحده قد يفوّت الكلمات القصيرة؛ نحدّث التمييز حتى 20 مرة في الثانية.
  let animationFrame = 0;
  let lastUpdate = 0;
  const followAudio = (now) => {
    if (audio.paused) return;
    if (now - lastUpdate >= 50) { syncPlayback(); lastUpdate = now; }
    animationFrame = requestAnimationFrame(followAudio);
  };
  audio.addEventListener('play', () => { playIcon(); cancelAnimationFrame(animationFrame); lastUpdate = 0; animationFrame = requestAnimationFrame(followAudio); });
  audio.addEventListener('pause', () => { playIcon(); cancelAnimationFrame(animationFrame); });
  audio.addEventListener('ended', onAudioEnded);
  audio.addEventListener('error', () => {
    if (audio.src) setSync('مشكلة في الصوت', 'فشل تحميل الصوت من مصدر التلاوة. جرّب تشغيل الآية مرة أخرى.');
  });
}

// Electronic tasbeeh: saved locally on this device, no accounts or tracking.
const adhkar = [
  { id: 'subhan', text: 'سُبْحَانَ اللَّهِ' },
  { id: 'hamd', text: 'الْحَمْدُ لِلَّهِ' },
  { id: 'takbir', text: 'اللَّهُ أَكْبَرُ' },
  { id: 'tahlil', text: 'لَا إِلَهَ إِلَّا اللَّهُ' },
  { id: 'istighfar', text: 'أَسْتَغْفِرُ اللَّهَ' },
  { id: 'salawat', text: 'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ' }
];
const storageKey = 'sakeenah-tasbeeh-v1';
function getStoredTasbeeh() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (value && typeof value === 'object' && value.counts && Number.isInteger(value.goal)) return value;
  } catch { /* disabled storage */ }
  return { selected: 'subhan', goal: 33, counts: {} };
}
const tasbeeh = getStoredTasbeeh();
if (!adhkar.some((dhikr) => dhikr.id === tasbeeh.selected)) tasbeeh.selected = 'subhan';
if (tasbeeh.goal < 1 || tasbeeh.goal > 100000) tasbeeh.goal = 33;
function saveTasbeeh() {
  try { localStorage.setItem(storageKey, JSON.stringify(tasbeeh)); } catch { /* privacy mode */ }
}
function currentCount() { return Math.max(0, Number(tasbeeh.counts[tasbeeh.selected]) || 0); }
function renderTasbeeh() {
  for (const button of document.querySelectorAll('.dhikr-option')) {
    const selected = button.dataset.dhikr === tasbeeh.selected;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.querySelector('[data-count]').textContent = arabicNumber(Math.max(0, Number(tasbeeh.counts[button.dataset.dhikr]) || 0));
  }
  const dhikr = adhkar.find((item) => item.id === tasbeeh.selected);
  $('dhikr-current').textContent = dhikr.text;
  $('goal-count').value = String(tasbeeh.goal);
  $('count-current').textContent = String(currentCount());
  $('goal-progress').textContent = arabicNumber(currentCount());
  $('goal-total').textContent = arabicNumber(tasbeeh.goal);
  const complete = currentCount() >= tasbeeh.goal;
  $('progress-fill').style.width = `${Math.min(100, currentCount() / tasbeeh.goal * 100)}%`;
  $('tasbeeh-status').textContent = complete ? 'اكتمل هدفك، تبارك الله' : 'في طريقك إلى الهدف';
  $('tasbeeh-cheer').textContent = complete ? 'أتممت هدفك، يمكنك مواصلة الذكر' : 'كل ذكر يقرّبك إلى هدفك';
  for (const preset of document.querySelectorAll('[data-goal]')) {
    preset.classList.toggle('selected-goal', Number(preset.dataset.goal) === tasbeeh.goal);
  }
}
function setGoal(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100000) {
    toast('اختر هدفًا صحيحًا من 1 إلى 100000.');
    $('goal-count').value = String(tasbeeh.goal);
    return;
  }
  tasbeeh.goal = parsed;
  saveTasbeeh();
  renderTasbeeh();
}
function initTasbeeh() {
  const host = $('dhikr-list');
  for (const dhikr of adhkar) {
    const button = document.createElement('button');
    button.className = 'dhikr-option';
    button.type = 'button';
    button.dataset.dhikr = dhikr.id;
    const title = document.createElement('span');
    title.textContent = dhikr.text;
    const current = document.createElement('span');
    current.dataset.count = '';
    button.append(title, current);
    button.addEventListener('click', () => {
      tasbeeh.selected = dhikr.id;
      saveTasbeeh();
      renderTasbeeh();
    });
    host.appendChild(button);
  }
  $('goal-count').addEventListener('change', (event) => setGoal(event.target.value));
  $('goal-count').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.target.blur(); });
  for (const button of document.querySelectorAll('[data-goal]')) {
    button.addEventListener('click', () => setGoal(button.dataset.goal));
  }
  $('count-btn').addEventListener('click', () => {
    const prior = currentCount();
    tasbeeh.counts[tasbeeh.selected] = prior + 1;
    saveTasbeeh();
    renderTasbeeh();
    if (prior < tasbeeh.goal && prior + 1 >= tasbeeh.goal) {
      toast('ما شاء الله، أكملت هدفك!');
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    } else if (navigator.vibrate) navigator.vibrate(15);
  });
  $('reset-count').addEventListener('click', () => {
    tasbeeh.counts[tasbeeh.selected] = 0;
    saveTasbeeh();
    renderTasbeeh();
    toast('بدأ عد جديد لهذا الذكر.');
  });
  renderTasbeeh();
}

initQuran();
initTasbeeh();
drawArticle();
navigate();
