/* =============================================================
   仕様一覧シート作成ツール - アプリ本体
   ------------------------------------------------------------
   データの流れ
     data.js (SPEC_MASTER)
        │ 初回 / 「マスタから再読込」
        ▼
     state { title, titleEn, prop, lead, labels, ratio, common[], premium[] }
        ├─ renderEditor() ─▶ 左パネル
        └─ renderSheet()  ─▶ .sheet（A4横）─ window.print() ─▶ PDF
     state は localStorage に自動保存

   レイアウト方針（planLayout）
     ・カードは各ブロック内で常に等サイズ（均等グリッド）
     ・端数のマスはフィラータイルで埋め、紙面に余白を残さない
     ・左右の面積配分と列数・行数を毎回自動計算し、
       共通仕様のカードが付加価値仕様より気持ち大きくなる解を選ぶ
   ============================================================= */
(() => {
  'use strict';

  const STORE_KEY = 'spec-sheet-v3';
  const $ = (id) => document.getElementById(id);

  /* ---------------- 単位 ---------------- */
  let PX_PER_MM = 96 / 25.4;
  (function measureMm() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:100mm;height:0';
    document.body.appendChild(probe);
    if (probe.offsetWidth) PX_PER_MM = probe.offsetWidth / 100;
    probe.remove();
  })();
  const mm  = (v) => v * PX_PER_MM;          // mm → px
  const toMm = (v) => v / PX_PER_MM;         // px → mm

  const GAP_BLOCKS = 6;   // ブロック間（mm）: style.css の .sheet__body gap と一致させる
  const GAP_CELL   = 2.4; // カード間（mm）  : tokens.css の --cell-gap と一致させる

  /* ---------------- state ---------------- */
  let state = null;
  let uid = 0;

  const presetById = (id) => (window.SPEC_MASTER.labelPresets || []).find((p) => p.id === id) || null;

  function fromMaster() {
    const m = window.SPEC_MASTER;
    const pr = presetById(m.meta.labelPreset) || m.labelPresets[0];
    return {
      v: 3,
      title: m.meta.title,
      titleEn: m.meta.titleEn || '',
      prop: '',
      lead: m.meta.lead,
      footerNote: m.meta.footerNote || '',
      labelPreset: pr.id,
      commonEn: pr.cEn,  commonLabel: pr.c,  commonNote: pr.cn,
      premiumEn: pr.pEn, premiumLabel: pr.p, premiumNote: pr.pn,
      theme: 'dark',       // 出力テーマ: 'dark'（黒基調）/ 'light'（明るめ）
      premiumPhoto: true,  // 付加価値仕様も写真で並べる
      showSub: true,       // カードの補足テキスト
      ratio: 118,          // 共通仕様カードの面積 ÷ 付加価値仕様カードの面積（%）
      // 共通仕様は既定ON / 付加価値仕様は既定OFF
      common:  m.common.map((s)  => ({ id: s.id, name: s.name, sub: s.sub || '', image: s.image || '', on: true })),
      premium: m.premium.map((s) => ({ id: s.id, name: s.name, sub: s.sub || '', image: s.image || '', on: false })),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return fromMaster();
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.common) || !Array.isArray(s.premium)) return fromMaster();
      return Object.assign(fromMaster(), s);
    } catch (e) { return fromMaster(); }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('保存できませんでした（画像が多すぎる可能性があります）', e); }
  }

  /* ---------------- 汎用 ---------------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const leadHtml = (s) => esc(s || '').replace(/\*\*(.+?)\*\*/g, '<span class="em">$1</span>');

  function toDataUrl(file, maxW = 900) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const r = Math.min(1, maxW / img.width);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * r);
          c.height = Math.round(img.height * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.84));
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* =============================================================
     左パネル
     ============================================================= */
  function renderEditor() {
    $('in-title').value   = state.title;
    $('in-titleen').value = state.titleEn;
    $('in-prop').value    = state.prop;
    $('in-lead').value    = state.lead;
    $('in-foot').value    = state.footerNote;
    $('in-cen').value     = state.commonEn;
    $('in-clabel').value  = state.commonLabel;
    $('in-cnote').value   = state.commonNote;
    $('in-pen').value     = state.premiumEn;
    $('in-plabel').value  = state.premiumLabel;
    $('in-pnote').value   = state.premiumNote;
    $('in-preset').value  = state.labelPreset;
    $('in-premium-photo').checked = !!state.premiumPhoto;
    $('in-show-sub').checked      = !!state.showSub;
    $('in-ratio').value   = state.ratio;
    $('ratio-val').value  = `×${(state.ratio / 100).toFixed(2)}`;

    $('head-common').textContent  = state.commonLabel  || '左ブロック';
    $('head-premium').textContent = state.premiumLabel || '右ブロック';

    renderList('common',  $('list-common'),  $('count-common'));
    renderList('premium', $('list-premium'), $('count-premium'));
  }

  function buildPresetSelect() {
    const sel = $('in-preset');
    sel.innerHTML = '';
    (window.SPEC_MASTER.labelPresets || []).forEach((p) => {
      sel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.name)}</option>`);
    });
    sel.insertAdjacentHTML('beforeend', '<option value="custom">カスタム（手入力）</option>');
  }

  function renderList(group, ul, counter) {
    const items = state[group];
    ul.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'row' + (it.on ? '' : ' row--off');

      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = it.on; cb.title = '紙面に掲載する';
      cb.onchange = () => { it.on = cb.checked; commit(); };

      const th = document.createElement('span');
      th.className = 'row__thumb';
      th.title = 'クリックで写真を選択 / Shift+クリックで写真を削除';
      if (it.image) th.style.backgroundImage = `url("${it.image}")`;
      else th.textContent = '＋';
      th.onclick = (ev) => { if (ev.shiftKey) { it.image = ''; commit(); } else pickImage(it); };

      const nm = document.createElement('input');
      nm.className = 'row__name'; nm.type = 'text'; nm.value = it.name;
      nm.title = '仕様名（簡潔に）';
      nm.onchange = () => { it.name = nm.value; commit(); };

      const sb = document.createElement('input');
      sb.className = 'row__sub'; sb.type = 'text'; sb.value = it.sub || '';
      sb.placeholder = '補足'; sb.title = 'カードに小さく出る補足';
      sb.onchange = () => { it.sub = sb.value; commit(); };

      li.append(cb, th, nm, sb,
        btn('↑', 'row__btn', '上へ', () => move(group, i, -1)),
        btn('↓', 'row__btn', '下へ', () => move(group, i, +1)),
        btn('×', 'row__btn row__btn--del', 'この行を削除', () => { items.splice(i, 1); commit(); }));
      ul.appendChild(li);
    });
    counter.textContent = `${items.filter((x) => x.on).length} / ${items.length}`;
  }

  function btn(label, cls, title, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label; b.title = title; b.onclick = fn;
    return b;
  }
  function move(group, i, d) {
    const a = state[group], j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    commit();
  }

  /* ---------------- 写真の選択 ---------------- */
  let pickTarget = null;
  function pickImage(item) {
    pickTarget = item;
    const fp = $('file-picker');
    fp.value = '';
    fp.click();
  }
  $('file-picker').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f || !pickTarget) return;
    try { pickTarget.image = await toDataUrl(f); commit(); }
    catch (err) { alert('画像を読み込めませんでした'); }
  });

  /* =============================================================
     紙面
     ============================================================= */
  function renderSheet() {
    // --- 出力テーマ ---
    $('sheet').dataset.theme = state.theme;
    document.querySelectorAll('.themetoggle__btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.theme === state.theme);
    });

    // --- 文字まわり ---
    $('sheet-title').textContent   = state.title;
    $('sheet-titleen').textContent = state.titleEn;
    $('sheet-prop').textContent    = state.prop;
    $('sheet-lead').innerHTML      = leadHtml(state.lead);
    $('en-common').textContent     = state.commonEn;
    $('label-common').textContent  = state.commonLabel;
    $('note-common').textContent   = state.commonNote;
    $('en-premium').textContent    = state.premiumEn;
    $('label-premium').textContent = state.premiumLabel;
    $('note-premium').textContent  = state.premiumNote;
    $('sheet-foot').textContent    = state.footerNote;
    $('foot-wrap').classList.toggle('sheet__foot--hidden', !state.footerNote.trim());

    const common  = state.common.filter((x)  => x.on && x.name.trim());
    const premium = state.premium.filter((x) => x.on && x.name.trim());
    $('cnt-common').textContent  = common.length  ? `${common.length} items`  : '';
    $('cnt-premium').textContent = premium.length ? `${premium.length} items` : '';

    // --- ブロックの表示・両方0件のときの逃げ ---
    const bc = $('block-common'), bp = $('block-premium');
    if (!common.length && !premium.length) {
      bc.classList.remove('block--hidden'); bp.classList.add('block--hidden');
      bc.style.flex = '1 1 100%';
      $('sheet-common').style.gridTemplateColumns = '1fr';
      $('sheet-common').innerHTML = '<div class="empty">掲載する仕様を選択してください</div>';
      $('layout-info').textContent = '';
      return;
    }
    bc.classList.toggle('block--hidden', common.length === 0);
    bp.classList.toggle('block--hidden', premium.length === 0);

    // --- 実寸を測る（リード文の行数で高さが変わるので毎回）---
    bc.style.flex = '1 1 0';
    bp.style.flex = '1 1 0';
    const bodyW = $('sheet-body').clientWidth;
    const fillH = (common.length ? $('sheet-common') : $('sheet-premium')).clientHeight;
    const both  = common.length > 0 && premium.length > 0;
    const availW = bodyW - (both ? mm(GAP_BLOCKS) : 0);

    // --- レイアウトを決める ---
    const plan = planLayout({
      nC: common.length,
      nP: premium.length,
      availW, H: fillH,
      gap: mm(GAP_CELL),
      ratio: state.ratio / 100,
      textP: !state.premiumPhoto,
    });

    // --- 適用 ---
    if (both) {
      bc.style.flex = `${plan.split} 1 0`;
      bp.style.flex = `${1 - plan.split} 1 0`;
    } else {
      bc.style.flex = '1 1 100%';
      bp.style.flex = '1 1 100%';
    }
    if (common.length)  paint($('sheet-common'),  common,  plan.C, 'photo', state.commonEn);
    if (premium.length) paint($('sheet-premium'), premium, plan.P, state.premiumPhoto ? 'photo' : 'text', state.premiumEn);

    // --- 情報表示（調整用）---
    const f = (x) => `${Math.round(toMm(x.w))}×${Math.round(toMm(x.h))}mm`;
    const parts = [];
    if (common.length)  parts.push(`${state.commonLabel} ${plan.C.cols}列×${plan.C.rows}行 ${f(plan.C)}`);
    if (premium.length) parts.push(`${state.premiumLabel} ${plan.P.cols}列×${plan.P.rows}行 ${f(plan.P)}`);
    if (both) parts.push(`面積比 ×${(plan.C.w * plan.C.h / (plan.P.w * plan.P.h)).toFixed(2)}`);
    $('layout-info').textContent = parts.join('／');
  }

  /* ---- グリッドを描く ---- */
  function paint(el, items, box, mode, enLabel) {
    el.style.gridTemplateColumns = `repeat(${box.cols}, 1fr)`;
    el.style.gridTemplateRows    = `repeat(${box.rows}, 1fr)`;
    // カード幅（mm）に応じて名称サイズを決める（視認性の確保）
    const wMm = toMm(box.w);
    const base = mode === 'text' ? wMm * 0.20 : wMm * 0.215;
    el.style.setProperty('--name-size', `${Math.min(13, Math.max(7, base)).toFixed(2)}pt`);

    let html = items.map((s) => (mode === 'text' ? textHtml(s) : cardHtml(s))).join('');
    for (let i = items.length; i < box.cols * box.rows; i++) {
      html += `<div class="card card--filler"><span>${esc(enLabel || '')}</span></div>`;
    }
    el.innerHTML = html;
  }

  function bodyHtml(s) {
    const sub = (state.showSub && s.sub) ? `<span class="card__sub">${esc(s.sub)}</span>` : '';
    return `<div class="card__body"><span class="card__name">${esc(s.name)}</span>${sub}</div>`;
  }
  function cardHtml(s) {
    const long = s.name.length >= 11 ? ' card--long' : '';
    if (!s.image) return `<div class="card card--noimg${long}">${bodyHtml(s)}</div>`;
    return `<div class="card${long}" style="background-image:url('${s.image}')">`
         + `<div class="card__scrim"></div>${bodyHtml(s)}</div>`;
  }
  const textHtml = (s) => `<div class="card card--text${s.name.length >= 11 ? ' card--long' : ''}">${bodyHtml(s)}</div>`;

  /* ---- レイアウト計算 -------------------------------------------
     カードは等サイズ・余白なしを前提に、
       ・セル比が縦長（写真）/ 横長（文字）の目標に近い
       ・共通仕様カードの面積 ÷ 付加価値仕様カードの面積 ≒ ratio
       ・端数マス（フィラー）が少ない
     を満たす (左右配分, 列数, 行数) を全探索で選ぶ。
     --------------------------------------------------------------- */
  function planLayout({ nC, nP, availW, H, gap, ratio, textP }) {
    const T_PHOTO = 0.78;   // 目標セル比 幅/高（縦長）
    const T_TEXT  = 4.2;    // 文字タイルは横長
    const cell = (W, n, r) => {
      const cols = Math.ceil(n / r);
      const w = (W - gap * (cols - 1)) / cols;
      const h = (H - gap * (r - 1)) / r;
      return { cols, rows: r, w, h, waste: cols * r - n };
    };
    const fit = (c, target, minW) => {
      if (c.w <= 0 || c.h <= 0) return Infinity;
      let s = Math.abs(Math.log((c.w / c.h) / target));
      if (c.w < minW) s += 1.4;
      if (c.h < mm(14)) s += 1.4;
      return s;
    };

    // 片側だけのとき
    if (!nC || !nP) {
      const n = nC || nP;
      const target = (!nC && textP) ? T_TEXT : T_PHOTO;
      let best = null;
      for (let r = 1; r <= n; r++) {
        const c = cell(availW, n, r);
        const s = fit(c, target, mm(18)) + c.waste * 0.10;
        if (!best || s < best.s) best = { s, c };
      }
      const box = best ? best.c : cell(availW, n, 1);
      return { split: 1, C: nC ? box : cell(availW, 1, 1), P: nP ? box : cell(availW, 1, 1) };
    }

    let best = null;
    for (let si = 35; si <= 78; si++) {
      const s = si / 100;
      const Wc = availW * s, Wp = availW * (1 - s);
      for (let rC = 1; rC <= nC; rC++) {
        const C = cell(Wc, nC, rC);
        const eC = fit(C, T_PHOTO, mm(20));
        if (!isFinite(eC)) continue;
        for (let rP = 1; rP <= nP; rP++) {
          const P = cell(Wp, nP, rP);
          const eP = fit(P, textP ? T_TEXT : T_PHOTO, textP ? mm(30) : mm(18));
          if (!isFinite(eP)) continue;
          const areaRatio = (C.w * C.h) / (P.w * P.h);
          const score = eC + eP
            + 1.9 * Math.abs(Math.log(areaRatio / ratio))
            + 0.10 * (C.waste + P.waste)
            + (C.w < P.w ? 0.5 : 0);            // 共通仕様の方が小さいのは避ける
          if (!best || score < best.score) best = { score, split: s, C, P };
        }
      }
    }
    if (!best) {
      return { split: 0.6, C: cell(availW * 0.6, nC, 1), P: cell(availW * 0.4, nP, 1) };
    }
    return { split: best.split, C: best.C, P: best.P };
  }

  /* =============================================================
     表示倍率
     ============================================================= */
  function applyZoom(z) {
    const sc = $('scaler');
    sc.style.transform = `scale(${z})`;
    const w = sc.offsetWidth, h = sc.offsetHeight;
    sc.style.marginRight  = `${w * (z - 1)}px`;
    sc.style.marginBottom = `${h * (z - 1)}px`;
    $('zoom-val').value = `${Math.round(z * 100)}%`;
  }
  /* 紙面が収まる倍率にする。スクロール枠の実寸から求めるので、
     画面幅が狭い端末（タブレット・スマホ）でもそのまま効く */
  function fitZoom() {
    const box = document.querySelector('.stage__scroll') || $('stage');
    const pad = 2 * (parseFloat(getComputedStyle(box).paddingLeft) || 0);
    // 画面の見える幅も上限にする（枠の実測が過大に出る場面でも紙面を収める）
    const vw = document.documentElement.clientWidth;
    const avail = Math.min(box.clientWidth, vw) - pad - 4;
    const min = Number($('zoom').min) / 100 || 0.25;
    const z = Math.max(min, Math.min(1, avail / $('scaler').offsetWidth));
    $('zoom').value = Math.round(z * 100);
    applyZoom(z);
  }

  /* ---------------- 反映 ---------------- */
  function commit() { save(); renderEditor(); renderSheet(); }

  /* =============================================================
     イベント
     ============================================================= */
  const bindText = (id, key, opts = {}) => {
    $(id).addEventListener('input', () => {
      state[key] = $(id).value;
      if (opts.custom) { state.labelPreset = 'custom'; $('in-preset').value = 'custom'; }
      if (opts.head) $(opts.head).textContent = $(id).value || '—';
      save(); renderSheet();
    });
  };
  bindText('in-title',   'title');
  bindText('in-titleen', 'titleEn');
  bindText('in-prop',    'prop');
  bindText('in-lead',    'lead');
  bindText('in-foot',    'footerNote');
  bindText('in-cen',    'commonEn',     { custom: true });
  bindText('in-clabel', 'commonLabel',  { custom: true, head: 'head-common' });
  bindText('in-cnote',  'commonNote',   { custom: true });
  bindText('in-pen',    'premiumEn',    { custom: true });
  bindText('in-plabel', 'premiumLabel', { custom: true, head: 'head-premium' });
  bindText('in-pnote',  'premiumNote',  { custom: true });

  $('in-preset').addEventListener('change', (e) => {
    const p = presetById(e.target.value);
    state.labelPreset = e.target.value;
    if (p) {
      state.commonEn = p.cEn;  state.commonLabel = p.c;  state.commonNote = p.cn;
      state.premiumEn = p.pEn; state.premiumLabel = p.p; state.premiumNote = p.pn;
    }
    commit();
  });

  document.querySelectorAll('.themetoggle__btn').forEach((b) => {
    b.onclick = () => { state.theme = b.dataset.theme; save(); renderSheet(); };
  });

  $('in-premium-photo').addEventListener('change', (e) => { state.premiumPhoto = e.target.checked; commit(); });
  $('in-show-sub').addEventListener('change',      (e) => { state.showSub      = e.target.checked; commit(); });
  $('in-ratio').addEventListener('input', (e) => {
    state.ratio = Number(e.target.value);
    $('ratio-val').value = `×${(state.ratio / 100).toFixed(2)}`;
    save(); renderSheet();
  });

  document.querySelectorAll('[data-bulk]').forEach((b) => {
    b.onclick = () => {
      const [group, mode] = b.dataset.bulk.split(':');
      state[group].forEach((x) => { x.on = (mode === 'all'); });
      commit();
    };
  });
  document.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => {
      const group = b.dataset.add;
      state[group].push({ id: `x-${group}-${++uid}`, name: '新しい仕様', sub: '', image: '', on: true });
      commit();
      const rows = document.querySelectorAll(`#list-${group} .row__name`);
      const last = rows[rows.length - 1];
      if (last) { last.focus(); last.select(); }
    };
  });

  $('btn-print').onclick = () => window.print();
  $('btn-reload').onclick = () => {
    if (!confirm('data.js のマスタ内容で作り直します。現在の入力は失われます。')) return;
    state = fromMaster(); commit();
  };
  $('btn-reset').onclick = () => {
    if (!confirm('入力をリセットします。よろしいですか？')) return;
    localStorage.removeItem(STORE_KEY);
    state = fromMaster(); commit();
  };

  $('zoom').addEventListener('input', (e) => applyZoom(Number(e.target.value) / 100));
  // 画面が狭いときは回転・リサイズで収まり直す
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 1080) fitZoom();
    else applyZoom(Number($('zoom').value) / 100);
  });
  window.addEventListener('beforeprint', renderSheet);
  window.addEventListener('afterprint', renderSheet);

  /* ---------------- 起動 ---------------- */
  state = load();
  // ?demo=n … 保存内容を無視し、付加価値仕様を先頭n件ON（既定4件）にした状態で表示
  const q = new URLSearchParams(location.search);
  const demo = q.get('demo');
  if (demo !== null) {
    state = fromMaster();
    const k = Number(demo) || 4;
    state.premium.forEach((p, i) => { p.on = i < k; });
  }
  if (q.get('theme') === 'light' || q.get('theme') === 'dark') state.theme = q.get('theme');
  buildPresetSelect();
  commit();
  fitZoom();

  /* 1ファイル版（build.py）で画面を切り替えた直後に呼ぶ。
     非表示のあいだは幅・高さが 0 で測れないため、表示後に組み直す */
  window.SPEC_REFRESH = () => { commit(); fitZoom(); };
})();
