(function () {
  'use strict';

  /* ================= 数据 ================= */
  const DATA = (typeof VOCAB !== 'undefined' && Array.isArray(VOCAB)) ? VOCAB : [];

  const DATA_BASE = (function () {
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src || '';
        if (/data\.js(?:\?|#|$)/.test(src)) return src.replace(/[^/]*$/, '');
      }
    } catch (e) { /* ignore */ }
    return '';
  })();

  const items = DATA
    .map(v => ({
      word: String(v.word || '').trim(),
      examples: Array.isArray(v.examples) ? v.examples : [],
      etymology: String(v.etymology || '')
    }))
    .filter(v => v.word)
    .sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

  items.forEach((v, i) => { v.idx = i; });

  /* ============ 重复词检测 ============ */
  const wordCount = new Map();
  items.forEach(v => {
    const k = v.word.toLowerCase();
    wordCount.set(k, (wordCount.get(k) || 0) + 1);
  });
  const dupWords = new Set();
  const dupLists = new Map();
  wordCount.forEach((c, k) => { if (c > 1) dupWords.add(k); });
  items.forEach(v => {
    const k = v.word.toLowerCase();
    if (!dupWords.has(k)) return;
    if (!dupLists.has(k)) dupLists.set(k, []);
    dupLists.get(k).push(v.idx);
  });
  if (dupWords.size) {
    console.warn('检测到重复词条（后者的数据会覆盖前者）:',
      [...dupWords].map(k =>
        items.filter(x => x.word.toLowerCase() === k).map(x => x.word).join(' / ')
      ));
  }

  const byWord = new Map();
  items.forEach(v => byWord.set(v.word, v));

  const letters = new Set(items.map(v => v.word[0].toUpperCase()));

  /* ================= DOM ================= */
  const el = id => document.getElementById(id);
  const listBody = el('list-body');
  const vsSizer = el('vs-sizer');
  const vsContent = el('vs-content');
  const azbar = el('azbar');
  const exCard = el('ex-card');
  const etCard = el('et-card');
  const vList = el('view-list');
  const vEx = el('view-examples');
  const vEt = el('view-etym');
  const vTest = el('view-test');
  const testTitle = el('test-title');
  const testLeft = el('test-left');
  const testRight = el('test-right');
  const testStatus = el('test-status');
  const testExitBtn = el('test-exit');
  const testRestartBtn = el('test-restart');
  const hint = el('hint');
  const countEl = el('count');
  const toastEl = el('toast');

  const HINTS = {
    list: '左键：例句 · 右键：词源 · 右上角「测」进入该字母测试',
    ex: '点击空白处返回列表 · 点击文本不返回 · 右键：查看词源',
    et: '左键：返回列表 · 右键：返回例句 · 音标旁按钮可播放发音',
    test: '拖动右栏单词到左栏空格 · 或先点单词再点空格 · 右上角 ✕ 退出'
  };

  let pendingLetter = null;
  let pendingFlashIdx = null;

  countEl.textContent = items.length + ' 词';

  /* ================= 工具 ================= */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function inlineMd(s) {
    return escapeHtml(s)
      .replace(/\\\*/g, '&#42;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  let toastTimer = null;
  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2200);
  }

  /* ============ 词源字段解析 ============ */
  const RE_AUDIO = /\s*·\s*音频：(\S+)\s*$/;
  const RE_PHONETIC = /\s*·\s*音标：\/([^/]+)\/\s*$/;

  function parseEtymology(raw) {
    let s = String(raw || '');
    let audio = null;
    let phonetic = null;
    const mAudio = s.match(RE_AUDIO);
    if (mAudio) { audio = mAudio[1]; s = s.slice(0, mAudio.index); }
    const mPh = s.match(RE_PHONETIC);
    if (mPh) { phonetic = mPh[1]; s = s.slice(0, mPh.index); }
    return { etymology: s, phonetic, audio };
  }

  function resolveAudioPath(p) {
    if (!p) return p;
    if (/^[a-z]+:\/\//i.test(p) || p.startsWith('//') || p.startsWith('/')) return p;
    return DATA_BASE ? DATA_BASE + p : p;
  }

  /* ============ 音频播放控制 ============ */
  let currentAudio = null;
  let currentAudioBtn = null;

  function resetAudioBtn(btn) {
    if (!btn) return;
    btn.classList.remove('playing');
    const icon = btn.querySelector('.audio-icon');
    const label = btn.querySelector('.audio-label');
    if (icon) icon.textContent = '🔊';
    if (label) label.textContent = '播放发音';
  }

  function stopAudio() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) { /* ignore */ }
      currentAudio = null;
    }
    if (currentAudioBtn) {
      resetAudioBtn(currentAudioBtn);
      currentAudioBtn = null;
    }
  }

  function playAudio(btn) {
    const src = btn.dataset.src;
    if (!src) return;
    if (currentAudio && currentAudioBtn === btn && !currentAudio.paused) {
      stopAudio();
      return;
    }
    stopAudio();
    const audio = new Audio(src);
    currentAudio = audio;
    currentAudioBtn = btn;
    btn.classList.add('playing');
    const icon = btn.querySelector('.audio-icon');
    const label = btn.querySelector('.audio-label');
    if (icon) icon.textContent = '⏸';
    if (label) label.textContent = '停止';
    audio.addEventListener('ended', () => { if (currentAudio === audio) stopAudio(); });
    audio.addEventListener('error', () => {
      if (currentAudio === audio) stopAudio();
      toast('无法播放音频：' + src);
    });
    const p = audio.play();
    if (p && p.catch) {
      p.catch(err => {
        stopAudio();
        toast('浏览器拒绝播放：' + (err && err.message ? err.message : '未知错误'));
      });
    }
  }

  /* ================= 路由 ================= */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/');
    return {
      view: parts[0] || 'list',
      word: parts[1] ? decodeURIComponent(parts[1]) : null
    };
  }
  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }
  const goEx = w => go('#/ex/' + encodeURIComponent(w));
  const goEt = w => go('#/et/' + encodeURIComponent(w));
  const goList = w => go('#/list' + (w ? '/' + encodeURIComponent(w) : ''));
  const goTest = L => go('#/test/' + encodeURIComponent(L));
  function currentWord() {
    const { word } = parseHash();
    return word && byWord.has(word) ? word : null;
  }

  /* ================= 顶栏高度同步 ================= */
  function syncTopbarHeight() {
    const tb = document.querySelector('.topbar');
    if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  }
  syncTopbarHeight();
  window.addEventListener('resize', syncTopbarHeight);

  /* ================= 视图切换 ================= */
  function switchView(name) {
    stopAudio();
    vList.classList.toggle('hidden', name !== 'list');
    vEx.classList.toggle('hidden', name !== 'ex');
    vEt.classList.toggle('hidden', name !== 'et');
    vTest.classList.toggle('hidden', name !== 'test');
    hint.textContent = HINTS[name];
    document.body.dataset.view = name;
    if (name === 'test') syncTopbarHeight();
  }

  /* ================= 虚拟列表 ================= */
  const ROW_H = 32;
  const HEADER_H = 34;
  const COL_MIN = 190;
  const GAP_X = 24;
  const BUFFER = 400;

  let rows = [];
  let totalHeight = 0;
  let cols = 1;
  let letterRowIndex = new Map();
  let wordRowIndex = new Map();
  let lastStart = -1, lastEnd = -1;
  let rafPending = false;

  function computeCols() {
    const w = listBody.clientWidth || vList.clientWidth || 800;
    return Math.max(1, Math.floor((w + GAP_X) / (COL_MIN + GAP_X)));
  }

  function buildRows() {
    cols = computeCols();
    rows = [];
    letterRowIndex = new Map();
    wordRowIndex = new Map();
    let top = 0;
    const groups = new Map();
    for (const it of items) {
      const L = it.word[0].toUpperCase();
      if (!groups.has(L)) groups.set(L, []);
      groups.get(L).push(it);
    }
    for (const [L, arr] of groups) {
      letterRowIndex.set(L, rows.length);
      rows.push({ type: 'header', letter: L, top, height: HEADER_H });
      top += HEADER_H;
      for (let i = 0; i < arr.length; i += cols) {
        const slice = arr.slice(i, i + cols);
        for (const it of slice) wordRowIndex.set(it.idx, rows.length);
        rows.push({ type: 'words', letter: L, items: slice, top, height: ROW_H });
        top += ROW_H;
      }
    }
    totalHeight = top;
    vsSizer.style.height = totalHeight + 'px';
  }

  function rowHtml(r) {
    if (r.type === 'header') {
      return '<div class="vs-row vs-header" style="top:' + r.top + 'px;height:' + r.height + 'px">'
        + '<h2>' + r.letter + '</h2>'
        + '<button class="test-btn" type="button" data-letter="' + r.letter + '"'
        + ' title="测试 ' + r.letter + ' 开头的单词">测</button>'
        + '</div>';
    }
    let h = '<div class="vs-row vs-words" style="top:' + r.top + 'px;height:' + r.height + 'px;'
      + 'grid-template-columns:repeat(' + cols + ',1fr);gap:0 ' + GAP_X + 'px">';
    for (const it of r.items) {
      const isDup = dupWords.has(it.word.toLowerCase());
      h += '<button class="word-btn" data-idx="' + it.idx + '" title="' + escapeHtml(it.word) + '">'
        + escapeHtml(it.word)
        + (isDup ? '<span class="dup-dot" aria-hidden="true"></span>' : '')
        + '</button>';
    }
    h += '</div>';
    return h;
  }

  function renderVisible(force) {
    if (document.body.dataset.view !== 'list') return;
    if (!rows.length) return;
    const rect = listBody.getBoundingClientRect();
    const listTopDoc = rect.top + window.scrollY;
    const viewTop = window.scrollY - listTopDoc - BUFFER;
    const viewBottom = window.scrollY - listTopDoc + window.innerHeight + BUFFER;

    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].top + rows[mid].height < viewTop) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - 1);

    lo = start; hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].top < viewBottom) lo = mid + 1;
      else hi = mid;
    }
    const end = Math.min(rows.length, lo + 1);

    if (!force && start === lastStart && end === lastEnd) return;
    lastStart = start; lastEnd = end;

    let html = '';
    for (let i = start; i < end; i++) html += rowHtml(rows[i]);
    vsContent.innerHTML = html;

    if (pendingFlashIdx !== null) {
      const btn = vsContent.querySelector('[data-idx="' + pendingFlashIdx + '"]');
      if (btn) {
        btn.classList.add('flash');
        setTimeout(() => btn.classList.remove('flash'), 1600);
        pendingFlashIdx = null;
      }
    }
  }

  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderVisible(false);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('resize', () => {
    const newCols = computeCols();
    if (newCols !== cols) buildRows();
    lastStart = lastEnd = -1;
    renderVisible(true);
  });

  function docListTop() {
    return listBody.getBoundingClientRect().top + window.scrollY;
  }

  function scrollToWord(word) {
    if (!byWord.has(word)) return;
    const idx = byWord.get(word).idx;
    const rowIdx = wordRowIndex.get(idx);
    if (rowIdx === undefined) return;
    const r = rows[rowIdx];
    const target = docListTop() + r.top - 120;
    window.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
    pendingFlashIdx = idx;
    lastStart = lastEnd = -1;
    renderVisible(true);
  }

  function scrollToLetter(L) {
    const rowIdx = letterRowIndex.get(L);
    if (rowIdx === undefined) return;
    const r = rows[rowIdx];
    const target = docListTop() + r.top - 70;
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  /* ================= 列表交互 ================= */
  listBody.addEventListener('click', e => {
    const testBtn = e.target.closest('.test-btn');
    if (testBtn) {
      e.preventDefault();
      goTest(testBtn.dataset.letter);
      return;
    }
    const btn = e.target.closest('.word-btn');
    if (!btn) return;
    const idx = +btn.dataset.idx;
    const it = items[idx];
    if (!it) return;
    const k = it.word.toLowerCase();
    if (dupWords.has(k)) {
      const all = dupLists.get(k) || [];
      const pos = all.indexOf(idx) + 1;
      toast('“' + it.word + '”有 ' + all.length + ' 个重复条目，当前为第 '
        + pos + ' 个；将打开最后一个同名条目');
    }
    goEx(it.word);
  });

  listBody.addEventListener('contextmenu', e => {
    if (e.target.closest('.test-btn')) return;
    const btn = e.target.closest('.word-btn');
    if (!btn) return;
    e.preventDefault();
    const idx = +btn.dataset.idx;
    const it = items[idx];
    if (it) goEt(it.word);
  });

  /* ================= 例句 / 词源交互 ================= */
  vEx.addEventListener('click', e => {
    if (e.target.closest('.no-back')) return;
    if (window.getSelection && String(window.getSelection()).length > 0) return;
    const w = currentWord();
    if (w) goList(w);
  });
  vEx.addEventListener('contextmenu', e => {
    const w = currentWord();
    if (!w) return;
    e.preventDefault();
    goEt(w);
  });

  vEt.addEventListener('click', e => {
    const audioBtn = e.target.closest('.audio-btn');
    if (audioBtn) { playAudio(audioBtn); return; }
    const w = currentWord();
    if (w) goList(w);
  });
  vEt.addEventListener('contextmenu', e => {
    if (e.target.closest('.audio-btn')) return;
    const w = currentWord();
    if (!w) return;
    e.preventDefault();
    goEx(w);
  });

  [exCard, etCard].forEach(card => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', e => {
      if (e.target.closest('.audio-btn')) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        const w = currentWord();
        if (w) goList(w);
      }
    });
  });

  /* ================= 渲染例句 / 词源 ================= */
  function renderExamples(word) {
    const it = byWord.get(word);
    if (!it) return;
    let html = '<h1 class="card-title no-back">' + escapeHtml(it.word) + '</h1>';
    html += '<p class="card-sub no-back">例句 · 共 ' + it.examples.length + ' 条</p>';
    html += '<ol class="ex-list no-back">';
    for (const ex of it.examples) html += '<li>' + escapeHtml(ex) + '</li>';
    html += '</ol><p class="card-tip no-back">点击卡片空白处返回列表 · 点击文本不返回 · 右键查看词源</p>';
    exCard.innerHTML = html;
    switchView('ex');
    window.scrollTo(0, 0);
  }

  function renderEtymology(word) {
    const it = byWord.get(word);
    if (!it) return;
    const parsed = parseEtymology(it.etymology);
    let html = '<h1 class="card-title">' + escapeHtml(it.word) + '</h1>';
    html += '<p class="card-sub">词源</p>';
    if (parsed.phonetic || parsed.audio) {
      html += '<div class="meta-row">';
      if (parsed.phonetic) {
        html += '<span class="phonetic">/' + escapeHtml(parsed.phonetic) + '/</span>';
      }
      if (parsed.audio) {
        const src = resolveAudioPath(parsed.audio);
        html += '<button class="audio-btn" type="button" data-src="' + escapeHtml(src) + '">'
             +  '<span class="audio-icon">🔊</span>'
             +  '<span class="audio-label">播放发音</span>'
             +  '</button>';
      }
      html += '</div>';
    }
    const body = (parsed.etymology && parsed.etymology.trim())
      ? inlineMd(parsed.etymology)
      : '（暂无词源）';
    html += '<p class="etym">' + body + '</p>';
    html += '<p class="card-tip">左键返回列表 · 右键返回例句 · 音标旁按钮可播放发音</p>';
    etCard.innerHTML = html;
    switchView('et');
    window.scrollTo(0, 0);
  }

  /* ================================================================
     测试界面
     ================================================================ */

  const BLANK_MARK = '\u0000BLANK\u0000';

  let testState = null;
  let selectedChip = null;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getBaseWord(word) {
    return String(word).replace(/\s*[\(（].*?[\)）]\s*/g, '').trim();
  }

  function makeBlankedSentence(sentence, baseWord) {
    const escaped = escapeRegExp(baseWord);
    let m = sentence.match(new RegExp('\\b(' + escaped + ')\\b', 'i'));
    if (!m) m = sentence.match(new RegExp('\\b(' + escaped + '[a-z]{0,3})\\b', 'i'));
    if (m) {
      return sentence.slice(0, m.index) + BLANK_MARK + sentence.slice(m.index + m[0].length);
    }
    return sentence.replace(/[.!?]?\s*$/, '') + ' ' + BLANK_MARK + '.';
  }

  function renderTest(letter) {
    letter = String(letter || '').toUpperCase();
    const group = items.filter(it => (it.word[0] || '').toUpperCase() === letter);
    if (!group.length) {
      toast('字母 ' + letter + ' 下没有单词');
      goList();
      return;
    }
    buildTest(letter, group);
    syncTopbarHeight();
    switchView('test');
  }

  function buildTest(letter, group) {
    selectedChip = null;

    const leftItems = group.map(it => {
      const base = getBaseWord(it.word);
      const exs = it.examples.length ? it.examples : [it.word];
      const prefer = exs.filter(s => makeBlankedSentence(s, base).indexOf(BLANK_MARK) !== -1);
      const pool = prefer.length ? prefer : exs;
      const sentence = pool[Math.floor(Math.random() * pool.length)];
      return { sid: it.idx, word: it.word, base, sentence };
    });

    const rightItems = group.map(it => ({ word: it.word, base: getBaseWord(it.word) }));

    const shuffledLeft = shuffle(leftItems);
    const shuffledRight = shuffle(rightItems);

    testState = {
      letter,
      left: shuffledLeft,
      right: shuffledRight,
      answers: new Map(),     // sid -> base（小写）
      completed: 0,
      total: shuffledLeft.length,
      draggingEl: null
    };
    for (const li of shuffledLeft) {
      testState.answers.set(li.sid, li.base.toLowerCase());
    }

    testTitle.textContent = '字母 ' + letter + ' 测试 · ' + testState.total + ' 题';

    let lh = '';
    for (const li of shuffledLeft) {
      const blanked = makeBlankedSentence(li.sentence, li.base);
      const safe = escapeHtml(blanked).replace(
        new RegExp(BLANK_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        '<span class="blank" data-sid="' + li.sid + '">拖到这里</span>'
      );
      lh += '<div class="sentence">' + safe + '</div>';
    }
    testLeft.innerHTML = lh;

    let rh = '';
    for (const ri of shuffledRight) {
      rh += '<div class="word-chip" draggable="true"'
          + ' data-word="' + escapeHtml(ri.word) + '"'
          + ' data-base="' + escapeHtml(ri.base) + '">'
          + escapeHtml(ri.word) + '</div>';
    }
    testRight.innerHTML = rh;

    testStatus.textContent = '已正确 0 / ' + testState.total;
  }

  function handleDrop(chipEl, blankEl) {
    if (!testState || !chipEl || !blankEl) return;
    if (chipEl.classList.contains('used')) return;
    if (blankEl.classList.contains('filled-correct')) return;

    const sid = +blankEl.dataset.sid;
    if (!testState.answers.has(sid)) return;

    const answer = testState.answers.get(sid);
    const guess = (chipEl.dataset.base || chipEl.dataset.word || '').toLowerCase();

    blankEl.classList.remove('filled-wrong', 'filled-correct', 'dragover');

    if (guess === answer) {
      blankEl.textContent = chipEl.dataset.word;
      blankEl.classList.add('filled-correct');
      chipEl.classList.add('used');
      chipEl.classList.remove('selected');
      testState.completed++;
      if (testState.completed >= testState.total) {
        testStatus.textContent = '🎉 全部完成！可点右上角 ↻ 重来，或 ✕ 退出。';
      } else {
        testStatus.textContent = '已正确 ' + testState.completed + ' / ' + testState.total;
      }
    } else {
      blankEl.textContent = chipEl.dataset.word + ' ✗';
      blankEl.classList.add('filled-wrong');
      setTimeout(() => {
        if (!blankEl.classList.contains('filled-correct')) {
          blankEl.textContent = '拖到这里';
          blankEl.classList.remove('filled-wrong');
        }
      }, 900);
    }
  }

  /* ---- 拖拽（桌面） ---- */
  testRight.addEventListener('dragstart', e => {
    const chip = e.target.closest('.word-chip');
    if (!chip || chip.classList.contains('used')) { e.preventDefault(); return; }
    try {
      e.dataTransfer.setData('text/plain', chip.dataset.word || '');
      e.dataTransfer.effectAllowed = 'move';
    } catch (err) { /* ignore */ }
    chip.classList.add('dragging');
    if (testState) testState.draggingEl = chip;
  });
  testRight.addEventListener('dragend', e => {
    const chip = e.target.closest('.word-chip');
    if (chip) chip.classList.remove('dragging');
    if (testState) testState.draggingEl = null;
  });

  testLeft.addEventListener('dragover', e => {
    const blank = e.target.closest('.blank');
    if (!blank) return;
    if (blank.classList.contains('filled-correct')) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ }
    blank.classList.add('dragover');
  });
  testLeft.addEventListener('dragleave', e => {
    const blank = e.target.closest('.blank');
    if (blank) blank.classList.remove('dragover');
  });
  testLeft.addEventListener('drop', e => {
    const blank = e.target.closest('.blank');
    if (!blank) return;
    e.preventDefault();
    blank.classList.remove('dragover');
    if (testState && testState.draggingEl) {
      handleDrop(testState.draggingEl, blank);
    }
  });

  /* ---- 点击选中兜底（移动端 / 无拖拽环境） ---- */
  testRight.addEventListener('click', e => {
    const chip = e.target.closest('.word-chip');
    if (!chip || chip.classList.contains('used')) return;
    if (selectedChip === chip) {
      chip.classList.remove('selected');
      selectedChip = null;
      return;
    }
    if (selectedChip) selectedChip.classList.remove('selected');
    selectedChip = chip;
    chip.classList.add('selected');
  });

  testLeft.addEventListener('click', e => {
    const blank = e.target.closest('.blank');
    if (!blank) return;
    if (!selectedChip) return;
    if (selectedChip.classList.contains('used')) {
      selectedChip.classList.remove('selected');
      selectedChip = null;
      return;
    }
    const chip = selectedChip;
    chip.classList.remove('selected');
    selectedChip = null;
    handleDrop(chip, blank);
  });

  /* ---- 退出 / 重来 ---- */
  testExitBtn.addEventListener('click', () => {
    testState = null;
    selectedChip = null;
    goList();
  });

  testRestartBtn.addEventListener('click', () => {
    if (!testState) return;
    const letter = testState.letter;
    const group = items.filter(it => (it.word[0] || '').toUpperCase() === letter);
    buildTest(letter, group);
  });

  /* ================= 主渲染 ================= */
  function render() {
    const { view, word } = parseHash();

    if (view === 'test' && word) {
      renderTest(word);
      return;
    }
    if (view === 'ex' && word && byWord.has(word)) return renderExamples(word);
    if (view === 'et' && word && byWord.has(word)) return renderEtymology(word);

    switchView('list');
    if (!rows.length) buildRows();

    requestAnimationFrame(() => {
      if (document.body.dataset.view !== 'list') return;
      if (!items.length) {
        vsContent.innerHTML = '<p style="padding:20px;color:var(--muted)">暂无词汇，请在 js/data.js 中添加。</p>';
        return;
      }
      if (pendingLetter) {
        const L = pendingLetter;
        pendingLetter = null;
        renderVisible(true);
        scrollToLetter(L);
      } else if (word && byWord.has(word)) {
        scrollToWord(word);
      } else {
        window.scrollTo(0, 0);
        lastStart = lastEnd = -1;
        renderVisible(true);
      }
    });
  }

  /* ================= A–Z 索引条 ================= */
  (function buildAZ() {
    const ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    azbar.innerHTML = ALL.map(L => {
      const on = letters.has(L);
      return '<button class="az' + (on ? '' : ' off') + '" data-letter="' + L + '"'
        + (on ? '' : ' disabled') + '>' + L + '</button>';
    }).join('');
  })();

  azbar.addEventListener('click', e => {
    const b = e.target.closest('.az');
    if (!b || b.disabled) return;
    const L = b.dataset.letter;
    if (document.body.dataset.view === 'list') {
      scrollToLetter(L);
    } else {
      pendingLetter = L;
      location.hash = '#/list';
    }
  });

  /* ================= 启动 ================= */
  if (!location.hash) {
    try { history.replaceState(null, '', '#/list'); } catch (e) { /* ignore */ }
  }
  window.addEventListener('hashchange', render);
  render();
})();