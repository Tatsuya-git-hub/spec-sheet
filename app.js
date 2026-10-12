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
     ・端数のマスは空き（CSS で非表示）。端数がなるべく出ない列×行を選ぶ
     ・左右の面積配分と列数・行数を毎回自動計算し、
       共通仕様のカードが付加価値仕様より気持ち大きくなる解を選ぶ
   ============================================================= */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------------- 作り方（モード） ----------------
     single : 分類を持たず、仕様を1つのまとまりとして並べる
     dual   : 共通仕様 ＋ 付加価値仕様の2ブロックに分けて並べる

     入力はモードごとに別のキーで保存する。行き来しても互いを壊さない。
     dual 側は以前からのキーをそのまま使う（保存済みの入力を失わないため） */
  const MODES = ['single', 'dual'];
  const STORE = { single: 'spec-sheet-single-v1', dual: 'spec-sheet-v3' };
  let mode = 'dual';
  const storeKey = () => STORE[mode];

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

  /* 見え方の微調整スライダー ［入力id / state のキー］
     id は in-<id> / <id>-val という命名で builder.html に置いてある */
  const ZOOMS = [['zicon', 'zIcon'], ['zgap', 'zGap'], ['ztext', 'zText']];

  /* ---------------- state ---------------- */
  let state = null;
  let uid = 0;

  const presetById = (id) => (window.SPEC_MASTER.labelPresets || []).find((p) => p.id === id) || null;

  /* 文字列を短い値にまとめる（指紋用）。
     アイコンは data URL だと数十万文字になるので、そのまま指紋に入れない */
  function hash32(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /* マスタの項目構成の指紋。data.js の項目を足し引きしたり、
     アイコンを差し替えたら値が変わるので、保存済みの入力より
     新しいマスタを優先できる（load() で使用）
     ★アイコンも指紋に含める。含めないと、名称が同じままアイコンだけ
       追加した場合に、保存済みの「アイコン無し」が残ってしまう */
  function masterSig() {
    const m = window.SPEC_MASTER;
    const ids = (g) => m[g].map((s) => `${s.id}:${s.name}:${hash32(s.icon || '')}`).join(',');
    return `${ids('common')}|${ids('premium')}`;
  }

  /* 関連するものが隣り合う並び（data-master.js の groupOrder）での位置 */
  function gIdx(s) {
    const i = (window.SPEC_MASTER.groupOrder || []).indexOf(s.group);
    return i < 0 ? 999 : i;
  }

  function fromMaster() {
    const m = window.SPEC_MASTER;
    const pr = presetById(m.meta.labelPreset) || m.labelPresets[0];
    const item = (s, on) => ({ id: s.id, name: s.name, sub: s.sub || '', icon: s.icon || '', on });
    /* 1軸は共通・付加価値の区別を持たないので、両方を1本のリストにして
       候補として並べる。どれを載せるかは物件ごとなので既定は全てOFF。
       2軸は従来どおり（共通=既定ON / 付加価値=既定OFF） */
    /* 1軸は関連するものが隣り合うよう、groupOrder の順に並べ直す
       （sort は安定なので、同じ group の中は共通 → 付加価値・書いた順のまま） */
    const groups = (mode === 'single')
      ? { common: [...m.common, ...m.premium].sort((a, b) => gIdx(a) - gIdx(b)).map((s) => item(s, false)), premium: [] }
      : { common: m.common.map((s) => item(s, true)), premium: m.premium.map((s) => item(s, false)) };
    return {
      v: 7,
      sig: masterSig(),
      title: m.meta.title,
      titleEn: m.meta.titleEn || '',
      prop: '',
      lead: m.meta.lead,
      footerNote: m.meta.footerNote || '',
      labelPreset: pr.id,
      commonEn: pr.cEn,  commonLabel: pr.c,  commonNote: pr.cn,
      premiumEn: pr.pEn, premiumLabel: pr.p, premiumNote: pr.pn,
      theme: 'light',      // 出力テーマ: 'light'（白地・既定）/ 'dark'（黒基調）
      /* 紙面の上の帯に置く写真。heroImg が空ならマスタの写真（meta.photo）。
         画面から選んだ写真だけを heroImg に持つ（マスタの写真は data.js にあるので保存しない） */
      heroOn: true,
      heroImg: '',
      /* 付加価値仕様もアイコンで並べる（既定）。
         以前はアイコンが未整備だったので文字タイルを既定にしていたが、
         全項目そろったのでアイコンに戻した。チェックを外せば文字タイル */
      premiumPhoto: true,
      showSub: false,      // カードの補足テキスト（既定は出さない。名前だけのほうがすっきり読める）
      ratio: 118,          // 共通仕様カードの面積 ÷ 付加価値仕様カードの面積（%）
      /* 1軸のときの、カード上のブロック見出し。
         紙面のタイトルと内容が重なりやすいので既定は出さない */
      showBlockHead: false,
      /* 1軸のとき、アイコンを使わず文字だけで並べるか。
         アイコン未整備の項目が混ざると点線の枠が目立つため、
         整備が済むまでの逃げ道として用意している */
      textOnly: false,
      /* 見え方の微調整。いずれも自動計算した寸法に対する倍率（%）で、
         100 = これまでの見え方。件数から寸法を決める仕組みは変えないので、
         何件選んでも余白は残らない
           zIcon … アイコン画像が台座のどこまでを占めるか（100で台座に接する）
           zGap  … カードの間隔（--cell-gap への倍率。0で隙間なし）
           zText … 仕様名・補足の文字サイズ */
      zIcon: 88,           // 既定は 88%（面いっぱいより少し引いたほうが板の余白がきれい）
      zGap: 100,
      zText: 100,
      common: groups.common,
      premium: groups.premium,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(storeKey());
      if (!raw) return fromMaster();
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.common) || !Array.isArray(s.premium)) return fromMaster();
      // data.js の項目構成が変わっていたら、保存済みの入力は捨てて新しいマスタを使う
      if (s.sig !== masterSig()) return fromMaster();
      const merged = Object.assign(fromMaster(), s);
      /* v3 までは付加価値仕様もアイコンの面だった。既定を文字タイルに
         変えたので、保存済みの設定にも一度だけ反映する
         （他の入力は残す。戻したい人はチェックを入れ直せる） */
      if ((s.v || 0) < 4) { merged.premiumPhoto = false; merged.v = 4; }
      /* v4 までは黒地が既定で、写真の列はなかった。白地＋写真を既定に
         したので一度だけ反映する（黒地に戻したい人はテーマを切り替えられる） */
      if ((s.v || 0) < 5) { merged.theme = 'light'; merged.heroOn = true; merged.v = 5; }
      /* v5 までは付加価値仕様が文字タイル既定。アイコンがそろったので一度だけアイコンに */
      if ((s.v || 0) < 6) { merged.premiumPhoto = true; merged.v = 6; }
      /* v6 までは補足テキストが既定で表示・アイコン100%。既定を非表示・88% にしたので一度だけ反映する */
      if ((s.v || 0) < 7) { merged.showSub = false; merged.zIcon = 88; merged.v = 7; }
      /* 保険：保存側のアイコンが空なら、マスタの絵を使う
         （指紋が一致していても、画面上で消した以外の理由で
           空のままになっているケースを拾う） */
      const m = window.SPEC_MASTER;
      const byId = {};   // 1軸では両方が1つのリストに入るので、id で引く
      [...m.common, ...m.premium].forEach((x) => { byId[x.id] = x.icon || ''; });
      ['common', 'premium'].forEach((g) => {
        merged[g].forEach((it) => {
          if (!it.icon && !it.iconOff && byId[it.id]) it.icon = byId[it.id];
        });
      });
      return merged;
    } catch (e) { return fromMaster(); }
  }
  function save() {
    try { localStorage.setItem(storeKey(), JSON.stringify(state)); }
    catch (e) { console.warn('保存できませんでした（画像が多すぎる可能性があります）', e); }
  }

  /* ---------------- アイコンの出し分け ----------------
     アイコンは背景を透過してあり、黒い紙面用（線がアイボリー）と
     明るい紙面用（線が紺）の2枚をマスタに持っている。
     画面上で差し替えた画像は1枚しかないので、どちらの紙面でもそれを使う
     （マスタと同じ画像のときだけ黒用に差し替える） */
  function iconFor(it, theme) {
    if (!it.icon) return '';
    if (theme !== 'dark') return it.icon;
    const m = window.SPEC_MASTER;
    const src = [...m.common, ...m.premium].find((x) => x.id === it.id);
    return (src && src.iconDark && src.icon === it.icon) ? src.iconDark : it.icon;
  }

  /* ---------------- 汎用 ---------------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const leadHtml = (s) => esc(s || '').replace(/\*\*(.+?)\*\*/g, '<span class="em">$1</span>');

  /* アイコン画像を data URL にする
     ・SVG はそのまま通す（拡大しても劣化しないので加工不要）
     ・それ以外は縮小して PNG。JPEGにすると背景の透明が黒く潰れるので使わない */
  /* type … 'image/png'（アイコン・既定）/ 'photo'（写真）。
     写真は PNG のままだと重く、localStorage（5MB程度）を圧迫するので、
     透過を残せる WebP にする（書き出せないブラウザは PNG のまま） */
  function toDataUrl(file, maxW = 512, type = 'image/png') {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        if (file.type === 'image/svg+xml') { resolve(fr.result); return; }
        const img = new Image();
        img.onload = () => {
          const r = Math.min(1, maxW / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * r);
          c.height = Math.round(img.height * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(type === 'photo' ? c.toDataURL('image/webp', 0.85) : c.toDataURL(type));
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
    $('in-blockhead').checked     = !!state.showBlockHead;
    $('in-textonly').checked      = !!state.textOnly;
    $('in-hero').checked          = !!state.heroOn;
    $('btn-hero-reset').disabled  = !state.heroImg;
    $('in-ratio').value   = state.ratio;
    $('ratio-val').value  = `×${(state.ratio / 100).toFixed(2)}`;
    ZOOMS.forEach(([id, key]) => {
      $(`in-${id}`).value = state[key];
      $(`${id}-val`).value = `${state[key]}%`;
    });

    $('head-common').textContent = (mode === 'single')
      ? '仕様'
      : (state.commonLabel || '左ブロック');
    $('head-premium').textContent = state.premiumLabel || '右ブロック';

    renderList('common',  $('list-common'),  $('count-common'));
    renderList('premium', $('list-premium'), $('count-premium'));
    if (mode === 'dual') renderPool();
  }

  function buildPresetSelect() {
    const sel = $('in-preset');
    sel.innerHTML = '';
    (window.SPEC_MASTER.labelPresets || []).forEach((p) => {
      sel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.name)}</option>`);
    });
    sel.insertAdjacentHTML('beforeend', '<option value="custom">カスタム（手入力）</option>');
  }

  /* 1軸：全項目をチェックで選ぶ一覧。
     2軸：載せた項目だけを並び順どおりに出す一覧（選ぶのは上の「仕様を選ぶ」）。
     2軸で外した項目は state の中に on:false で残る（候補一覧から戻せる） */
  function renderList(group, ul, counter) {
    const items = state[group];
    const dual = mode === 'dual';
    ul.innerHTML = '';
    items.forEach((it, i) => {
      if (dual && !it.on) return;
      const li = document.createElement('li');
      li.className = 'row' + (it.on ? '' : ' row--off');
      li.dataset.id = it.id;

      const th = thumb(it);

      const nm = document.createElement('input');
      nm.className = 'row__name'; nm.type = 'text'; nm.value = it.name;
      nm.title = '仕様名（簡潔に）';
      nm.onchange = () => { it.name = nm.value; commit(); };

      const sb = document.createElement('input');
      sb.className = 'row__sub'; sb.type = 'text'; sb.value = it.sub || '';
      sb.placeholder = '補足'; sb.title = 'カードに小さく出る補足';
      sb.onchange = () => { it.sub = sb.value; commit(); };

      const up = btn('↑', 'row__btn', '上へ', () => move(group, i, -1));
      const dn = btn('↓', 'row__btn', '下へ', () => move(group, i, +1));
      if (dual) {
        li.append(grip(li), th, nm, sb, up, dn,
          btn('×', 'row__btn row__btn--del', 'この仕様を外す（上の一覧には残ります）', () => { it.on = false; commit(); }));
      } else {
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = it.on; cb.title = '紙面に掲載する';
        cb.onchange = () => { it.on = cb.checked; commit(); };
        li.append(cb, th, nm, sb, up, dn,
          btn('×', 'row__btn row__btn--del', 'この行を削除', () => { items.splice(i, 1); commit(); }));
      }
      ul.appendChild(li);
    });
    if (dual && !ul.children.length) {
      ul.insertAdjacentHTML('beforeend', '<li class="row row--empty">ここに仕様をドラッグ（または上の一覧で選ぶ）</li>');
    }
    counter.textContent = dual
      ? `${items.filter((x) => x.on).length}`
      : `${items.filter((x) => x.on).length} / ${items.length}`;
  }

  /* 2軸の候補一覧：全ての仕様を関連順に並べ、共通／付加価値のどちらに載せるかを選ぶ */
  function renderPool() {
    const ul = $('list-pool');
    const all = [];
    ['common', 'premium'].forEach((g) => state[g].forEach((it) => all.push({ it, g })));
    const order = {};
    const m = window.SPEC_MASTER;
    [...m.common, ...m.premium].sort((a, b) => gIdx(a) - gIdx(b)).forEach((s, k) => { order[s.id] = k; });
    all.forEach((x, k) => { x.k = (x.it.id in order) ? order[x.it.id] : 10000 + k; });
    all.sort((a, b) => a.k - b.k);

    ul.innerHTML = '';
    all.forEach(({ it, g }) => {
      const li = document.createElement('li');
      li.className = 'row pool__row' + (it.on ? ' is-placed' : '');
      li.dataset.id = it.id;
      const nm = document.createElement('span');
      nm.className = 'pool__name';
      nm.textContent = it.name || '（名称なし）';
      if (it.sub) nm.insertAdjacentHTML('beforeend', `<small>${esc(it.sub)}</small>`);
      const chip = (target, label) => btn(label, 'chip' + (it.on && g === target ? ' is-on' : ''),
        `${label}に載せる／外す`, () => {
          if (it.on && g === target) { it.on = false; commit(); }
          else placeItem(it.id, target, null);
        });
      li.append(grip(li), thumb(it), nm, chip('common', '共通'), chip('premium', '付加価値'));
      // 画面で足した項目だけは、ここで消せる（マスタの項目は外すだけにする）
      if (!(it.id in order)) {
        li.append(btn('×', 'row__btn row__btn--del', 'この項目を削除', () => {
          state[g].splice(state[g].indexOf(it), 1); commit();
        }));
      }
      ul.appendChild(li);
    });
    $('count-pool').textContent = `${all.filter((x) => x.it.on).length} / ${all.length}`;
  }

  /* サムネイル（クリックでアイコン差し替え / Shift+クリックで削除） */
  function thumb(it) {
    const th = document.createElement('span');
    th.className = 'row__thumb';
    th.title = 'クリックでアイコンを選択 / Shift+クリックで削除';
    // 操作パネルは白地なので、サムネイルは明るい紙面用の絵（紺の線）を出す
    if (it.icon) th.style.backgroundImage = `url("${iconFor(it, 'light')}")`;
    else th.textContent = '＋';
    /* 消したことを iconOff で覚える。覚えないと、次に開いたとき
       マスタの絵で埋め戻されて消えない */
    th.onclick = (ev) => {
      if (ev.shiftKey) { it.icon = ''; it.iconOff = true; commit(); }
      else pickImage(it);
    };
    return th;
  }

  /* ドラッグの持ち手。行全体を常に draggable にすると、名前の入力欄で
     文字を選ぼうとしただけで行が動いてしまうので、持ち手を押したときだけ有効にする */
  function grip(li) {
    const g = document.createElement('span');
    g.className = 'row__grip'; g.textContent = '⋮⋮'; g.title = 'ドラッグで移動';
    g.onpointerdown = () => { li.draggable = true; };
    li.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', li.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('is-dragging');
    };
    li.ondragend = () => { li.draggable = false; li.classList.remove('is-dragging'); clearDropMarks(); };
    return g;
  }

  function btn(label, cls, title, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label; b.title = title; b.onclick = fn;
    return b;
  }
  /* 隣と入れ替える。2軸の一覧は載せた項目しか出していないので、
     外している項目は飛ばして、見えている隣と入れ替える */
  function move(group, i, d) {
    const a = state[group];
    let j = i + d;
    if (mode === 'dual') while (j >= 0 && j < a.length && !a[j].on) j += d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    commit();
  }

  /* 項目を共通／付加価値のどちらかに載せる。beforeId の前に入れる（null なら末尾） */
  function placeItem(id, group, beforeId) {
    let it = null;
    ['common', 'premium'].forEach((g) => {
      const k = state[g].findIndex((x) => x.id === id);
      if (k >= 0) it = state[g].splice(k, 1)[0];
    });
    if (!it) return;
    it.on = true;
    const a = state[group];
    const at = (beforeId && beforeId !== id) ? a.findIndex((x) => x.id === beforeId) : -1;
    if (at >= 0) a.splice(at, 0, it); else a.push(it);
    commit();
  }

  /* ---------------- ドラッグ＆ドロップで選ぶ（2軸） ----------------
     落とし先：共通／付加価値のリスト（落とした行の前に入る）、
              プレビューのブロック（落としたカードの前に入る）、
              候補一覧（外す）
     タブレットではドラッグが効かない端末もあるので、候補一覧のボタンでも
     同じことができるようにしてある */
  function clearDropMarks() {
    document.querySelectorAll('.is-drop-before, .is-drop-end, .is-over')
      .forEach((el) => el.classList.remove('is-drop-before', 'is-drop-end', 'is-over'));
  }
  function rowAfter(ul, y) {
    for (const li of ul.querySelectorAll('.row[data-id]:not(.is-dragging)')) {
      const r = li.getBoundingClientRect();
      if (y < r.top + r.height / 2) return li;
    }
    return null;
  }
  document.querySelectorAll('[data-drop]').forEach((ul) => {
    const target = ul.dataset.drop;
    ul.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      ul.classList.add('is-over');
      if (target === 'pool') return;
      const before = rowAfter(ul, e.clientY);
      if (before) before.classList.add('is-drop-before'); else ul.classList.add('is-drop-end');
    });
    ul.addEventListener('dragleave', (e) => { if (!ul.contains(e.relatedTarget)) clearDropMarks(); });
    ul.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      clearDropMarks();
      if (!id) return;
      if (target === 'pool') {
        ['common', 'premium'].forEach((g) => state[g].forEach((x) => { if (x.id === id) x.on = false; }));
        commit();
        return;
      }
      const before = rowAfter(ul, e.clientY);
      placeItem(id, target, before ? before.dataset.id : null);
    });
  });

  /* ---------------- アイコンの選択 ---------------- */
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
    try { pickTarget.icon = await toDataUrl(f); commit(); }
    catch (err) { alert('画像を読み込めませんでした'); }
  });

  /* ---------------- 写真の選択 ---------------- */
  function heroSrc() {
    if (!state.heroOn) return '';
    return state.heroImg || window.SPEC_MASTER.meta.photo || '';
  }
  async function setHero(file) {
    if (!file || !/^image\//.test(file.type)) return false;
    try { state.heroImg = await toDataUrl(file, 1600, 'photo'); state.heroOn = true; commit(); }
    catch (err) { alert('画像を読み込めませんでした'); }
    return true;
  }
  $('hero-picker').addEventListener('change', (e) => setHero(e.target.files && e.target.files[0]));

  /* スクリーンショットの貼り付け
     ・Ctrl+V：画面のどこで押しても、クリップボードに画像があれば写真に入れる
       （文字だけのときは何もしないので、入力欄への貼り付けはそのまま効く）
     ・「貼り付け」ボタン：Clipboard API で読む。使えないブラウザでは Ctrl+V を案内
     ・ドラッグ＆ドロップ：枠の上に落とす */
  document.addEventListener('paste', (e) => {
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const it = items.find((x) => x.kind === 'file' && /^image\//.test(x.type));
    if (!it) return;
    e.preventDefault();
    setHero(it.getAsFile());
  });
  $('btn-hero-paste').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('unsupported');
      for (const ci of await navigator.clipboard.read()) {
        const type = ci.types.find((t) => t.startsWith('image/'));
        if (type) { setHero(await ci.getType(type)); return; }
      }
      alert('クリップボードに画像がありません。スクショを撮ってからもう一度押してください');
    } catch (err) {
      alert('このブラウザではボタンから読めません。画面上で Ctrl+V（Mac は ⌘+V）を押してください');
    }
  });
  const drop = $('hero-drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    setHero(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  /* =============================================================
     紙面
     ============================================================= */
  function renderSheet() {
    // --- 出力テーマ ---
    const sheetEl = $('sheet');
    sheetEl.dataset.theme = state.theme;

    /* --- 写真（上の帯・見出しの右）---
       帯があるかどうかでカードの入る高さが変わるので、レイアウト計算より先に決める */
    const hero = heroSrc();
    sheetEl.classList.toggle('sheet--visual', !!hero);
    $('sheet-visual').style.backgroundImage = hero ? `url('${hero}')` : '';

    /* --- 見え方の微調整（倍率）---
       カード間隔は CSS 変数と planLayout の両方に渡す。片方だけだと
       計算上の寸法と実際のグリッドがずれて、紙面がはみ出す */
    const gapMm = GAP_CELL * (state.zGap / 100);
    sheetEl.style.setProperty('--cell-gap', `${gapMm.toFixed(2)}mm`);
    sheetEl.style.setProperty('--icon-scale', (state.zIcon / 100).toFixed(3));

    /* --- 1軸のブロック見出し --- */
    $('head-block-common').style.display =
      (mode === 'single' && !state.showBlockHead) ? 'none' : '';

    document.querySelectorAll('.themetoggle__btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.theme === state.theme);
    });

    // --- 文字まわり ---
    $('sheet-title').textContent   = state.title;
    $('sheet-titleen').textContent = state.titleEn;

    /* 写真は見出しの右から始める。見出しの文言で長さが変わるので実測する
       （プレビューは拡大縮小しているので、その倍率で割って紙面上の寸法に戻す） */
    if (hero && sheetEl.offsetWidth) {
      const sr = sheetEl.getBoundingClientRect();
      const k  = sr.width / sheetEl.offsetWidth || 1;
      const hr = $('sheet-title').parentElement.getBoundingClientRect();
      sheetEl.style.setProperty('--visual-left', `${((hr.right - sr.left) / k).toFixed(1)}px`);
    }
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
      $('sheet-common').innerHTML =
        '<div class="empty">載せたい仕様を、左のリストから選んでください</div>';
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

    /* 1軸のときのカードの見せ方。アイコンが未整備の項目を混ぜて並べると
       点線の枠が目立つので、文字だけで並べる選択もできるようにする */
    const kindC = (mode === 'single' && state.textOnly) ? 'text' : 'icon';

    // --- レイアウトを決める ---
    const plan = planLayout({
      nC: common.length,
      nP: premium.length,
      availW, H: fillH,
      gap: mm(gapMm),
      ratio: state.ratio / 100,
      textP: !state.premiumPhoto,
      textC: kindC === 'text',
    });

    // --- 適用 ---
    if (both) {
      bc.style.flex = `${plan.split} 1 0`;
      bp.style.flex = `${1 - plan.split} 1 0`;
    } else {
      bc.style.flex = '1 1 100%';
      bp.style.flex = '1 1 100%';
    }
    if (common.length)  paint($('sheet-common'),  common,  plan.C, kindC, state.commonEn);
    if (premium.length) paint($('sheet-premium'), premium, plan.P, state.premiumPhoto ? 'icon' : 'text', state.premiumEn);

    // --- 情報表示（調整用）---
    const f = (x) => `${Math.round(toMm(x.w))}×${Math.round(toMm(x.h))}mm`;
    const parts = [];
    if (common.length)  parts.push(`${state.commonLabel} ${plan.C.cols}列×${plan.C.rows}行 ${f(plan.C)}`);
    if (premium.length) parts.push(`${state.premiumLabel} ${plan.P.cols}列×${plan.P.rows}行 ${f(plan.P)}`);
    if (both) parts.push(`面積比 ×${(plan.C.w * plan.C.h / (plan.P.w * plan.P.h)).toFixed(2)}`);
    $('layout-info').textContent = parts.join('／');
  }

  /* 仕様名の幅（em）の見積もり。全角=1・半角=0.6、字間 .06em ぶんを足す */
  const PT_MM = 0.3528;
  function nameEm(s) {
    return [...(s.name || '')].reduce((a, ch) => a + (ch.charCodeAt(0) < 0x2000 ? 0.6 : 1) + 0.06, 0);
  }

  /* ---- グリッドを描く ----
     第4引数は「カードの種類」。グローバルの mode（作り方）とは別物なので
     名前を分けている */
  function paint(el, items, box, kind, enLabel) {
    el.style.gridTemplateColumns = `repeat(${box.cols}, 1fr)`;
    el.style.gridTemplateRows    = `repeat(${box.rows}, 1fr)`;
    // カード幅（mm）に応じて名称サイズを決める（視認性の確保）
    // アイコン側は文字を欲張るとアイコンの面が潰れるので控えめに
    const wMm = toMm(box.w), hMm = toMm(box.h);
    let pt;
    if (kind === 'text') {
      /* 文字タイルは絵の面が無いので、字を大きく取って面をもたせる。
         高さも見る（縦長のセルになったときに字が小さいままだと
         中央に小さく文字が浮いて、余白が抜けて見える） */
      pt = Math.min(14, Math.max(8, Math.min(wMm * 0.215, hMm * 0.46)));
    } else {
      /* アイコンに文字は入れないので、仕様名はここで読ませる。
         カード幅に対して大きめに取る。1行に収まらない長い名前だけは
         描いたあとにそのカードだけ縮める（下の fitNames） */
      pt = Math.min(14, Math.max(8.5, Math.min(wMm * 0.24, hMm * 0.24)));
    }
    // 倍率は上限・下限を当てたあとに掛ける（先に掛けると上限で潰れて効かない）
    el.style.setProperty('--name-size', `${(pt * state.zText / 100).toFixed(2)}pt`);

    let html = items.map((s) => (kind === 'text' ? textHtml(s) : cardHtml(s))).join('');
    for (let i = items.length; i < box.cols * box.rows; i++) {
      html += `<div class="card card--filler"><span>${esc(enLabel || '')}</span></div>`;
    }
    el.innerHTML = html;
    if (kind !== 'text') fitNames(el, items, wMm, pt * state.zText / 100);
  }

  /* 長い名前は、そのカードだけ1行に収まる大きさまで縮める。
     2行に割れると、等サイズのカードで名前の位置がそろわなくなる。
     ほかのカードは大きいままにしたいので、ブロック全体は縮めない */
  function fitNames(el, items, wMm, pt) {
    items.forEach((s, i) => {
      const name = el.children[i] && el.children[i].querySelector('.card__name');
      if (!name) return;
      const own = pt * (s.name.length >= 11 ? 0.84 : 1);   // .card--long の縮みと同じ
      const fit = (wMm - 4.6) / nameEm(s) / PT_MM;
      if (fit < own) name.style.fontSize = `${Math.max(5.5, fit).toFixed(2)}pt`;
    });
  }

  /* 補足が空の項目でも枠だけ残す。同じ行のカードで名称の高さが
     ずれると、等サイズのはずのカードがそろって見えなくなるため */
  function bodyHtml(s) {
    const sub = state.showSub ? `<span class="card__sub">${esc(s.sub || '')}</span>` : '';
    return `<div class="card__body"><span class="card__name">${esc(s.name)}</span>${sub}</div>`;
  }
  /* アイコンカード：上にアイコン、下に名称。アイコン未設定なら枠だけ出す */
  function cardHtml(s) {
    const long = s.name.length >= 11 ? ' card--long' : '';
    const icon = s.icon
      ? `<span class="card__icon" style="background-image:url('${iconFor(s, state.theme)}')"></span>`
      : '<span class="card__icon card__icon--none"></span>';
    return `<div class="card card--icon${long}" data-id="${esc(s.id)}">${icon}${bodyHtml(s)}</div>`;
  }
  const textHtml = (s) =>
    `<div class="card card--text${s.name.length >= 11 ? ' card--long' : ''}" data-id="${esc(s.id)}">${bodyHtml(s)}</div>`;

  /* ---- レイアウト計算 -------------------------------------------
     カードは等サイズ・余白なしを前提に、
       ・セル比がほぼ正方（アイコン）/ 横長（文字）の目標に近い
       ・共通仕様カードの面積 ÷ 付加価値仕様カードの面積 ≒ ratio
       ・端数マス（フィラー）が少ない
     を満たす (左右配分, 列数, 行数) を全探索で選ぶ。
     --------------------------------------------------------------- */
  function planLayout({ nC, nP, availW, H, gap, ratio, textP, textC }) {
    const T_ICON = 1.06;    // 目標セル比 幅/高（アイコン＋名称なので、ほぼ正方）
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
      const isText = nC ? !!textC : !!textP;
      const target = isText ? T_TEXT : T_ICON;
      let best = null;
      for (let r = 1; r <= n; r++) {
        const c = cell(availW, n, r);
        const s = fit(c, target, mm(isText ? 30 : 18)) + c.waste * 0.10;
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
        const eC = fit(C, T_ICON, mm(20));
        if (!isFinite(eC)) continue;
        for (let rP = 1; rP <= nP; rP++) {
          const P = cell(Wp, nP, rP);
          const eP = fit(P, textP ? T_TEXT : T_ICON, textP ? mm(30) : mm(18));
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
     プレビュー上でのドラッグ並べ替え
     ------------------------------------------------------------
     ・掴んだカードを離した場所に「挿入」する。入れ替えではないので、
       間のカードが1つずつ後ろ（前）へずれていく
     ・マウスとタッチを1つの処理で扱うため Pointer Events を使う
       （HTML5 の draggable 属性はタブレットで動かない）
     ・並べ替えられるのは同じブロックの中だけ。分類はチェックボックス側で
       変える（ドラッグで分類が変わると、並べ替えのつもりの操作で
       事故が起きる）
     ・動かすのは紙面に出ている項目だけ。外している項目は state の中の
       位置を動かさないので、チェックを入れ直すと元の場所に戻る
     ============================================================= */
  let drag = null;

  /* 座標の上にあるカードを返す。
     端数マス（フィラー）の上なら「最後の項目」を返して末尾送りにする */
  function cardUnder(box, x, y) {
    let last = null;
    for (const el of box.children) {
      if (el.dataset.id) last = el;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return el.dataset.id ? el : lastItemCard(box);
      }
    }
    return null;
  }
  function lastItemCard(box) {
    const a = box.querySelectorAll('.card[data-id]');
    return a.length ? a[a.length - 1] : null;
  }

  /* 紙面上の並びを state に書き戻す */
  function applyOrder(group, ids) {
    const arr = state[group];
    const slots = [];                       // 表示中の項目が入っている位置
    arr.forEach((it, i) => { if (it.on && it.name.trim()) slots.push(i); });
    const byId = {};
    arr.forEach((it) => { byId[it.id] = it; });
    ids.forEach((id, k) => {
      if (byId[id] && slots[k] !== undefined) arr[slots[k]] = byId[id];
    });
  }

  const sheetEl = $('sheet');

  sheetEl.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;   // 右クリックは無視
    const card = ev.target.closest('.card[data-id]');
    if (!card || !card.parentElement.dataset.group) return;
    drag = { card, box: card.parentElement, x: ev.clientX, y: ev.clientY, live: false };
    /* 捕捉するのはカードではなく紙面。カードは並べ替えで DOM を移動するので、
       カードに捕捉させると移動した瞬間に取りこぼす可能性がある */
    try { sheetEl.setPointerCapture(ev.pointerId); } catch (e) { /* 捕捉できなくても並べ替え自体は動く */ }
  });

  sheetEl.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.live) {
      // 少し動かしてから開始する（ただのクリックで並びが変わらないように）
      if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) < 6) return;
      drag.live = true;
      drag.card.classList.add('is-dragging');
      document.body.classList.add('is-reordering');
    }
    ev.preventDefault();
    const over = cardUnder(drag.box, ev.clientX, ev.clientY);
    if (!over || over === drag.card) return;
    // 掴んだカードより後ろのカードに乗ったら、その後ろへ入れる
    const after = !!(drag.card.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING);
    drag.box.insertBefore(drag.card, after ? over.nextSibling : over);
  });

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.card.classList.remove('is-dragging');
    document.body.classList.remove('is-reordering');
    if (!d.live) return;
    applyOrder(d.box.dataset.group,
      [...d.box.querySelectorAll('.card[data-id]')].map((el) => el.dataset.id));
    commit();
  }
  sheetEl.addEventListener('pointerup', endDrag);
  sheetEl.addEventListener('pointercancel', endDrag);

  /* 一覧の行をプレビューのブロックへ落としたとき（2軸）：落としたカードの前に入れる */
  sheetEl.addEventListener('dragover', (e) => {
    if (mode !== 'dual') return;
    const grid = e.target.closest('[data-group]');
    if (!grid) return;
    e.preventDefault();
    clearDropMarks();
    grid.classList.add('is-over');
  });
  sheetEl.addEventListener('dragleave', (e) => { if (!sheetEl.contains(e.relatedTarget)) clearDropMarks(); });
  sheetEl.addEventListener('drop', (e) => {
    if (mode !== 'dual') return;
    const grid = e.target.closest('[data-group]');
    const id = e.dataTransfer.getData('text/plain');
    clearDropMarks();
    if (!grid || !id) return;
    e.preventDefault();
    const card = e.target.closest('.card[data-id]');
    placeItem(id, grid.dataset.group, card ? card.dataset.id : null);
  });

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
      // 1軸のときは左パネルの見出しを「仕様」で固定する（ブロックは1つなので）
      if (opts.head && mode !== 'single') $(opts.head).textContent = $(id).value || '—';
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
    b.onclick = () => { state.theme = b.dataset.theme; save(); renderSheet(); };   // 絵も差し替わる
  });

  $('in-premium-photo').addEventListener('change', (e) => { state.premiumPhoto = e.target.checked; commit(); });
  $('in-show-sub').addEventListener('change',      (e) => { state.showSub      = e.target.checked; commit(); });
  $('in-blockhead').addEventListener('change',     (e) => { state.showBlockHead = e.target.checked; commit(); });
  $('in-textonly').addEventListener('change',      (e) => { state.textOnly      = e.target.checked; commit(); });
  $('in-hero').addEventListener('change',          (e) => { state.heroOn        = e.target.checked; commit(); });
  $('btn-hero-pick').addEventListener('click', () => { $('hero-picker').value = ''; $('hero-picker').click(); });
  $('btn-hero-reset').addEventListener('click', () => { state.heroImg = ''; commit(); });
  $('in-ratio').addEventListener('input', (e) => {
    state.ratio = Number(e.target.value);
    $('ratio-val').value = `×${(state.ratio / 100).toFixed(2)}`;
    save(); renderSheet();
  });

  /* 見え方の微調整（倍率）。件数から寸法を決める仕組みは通したまま、
     その結果に倍率を掛けるだけなので、どこを動かしても余白は残らない */
  ZOOMS.forEach(([id, key]) => {
    $(`in-${id}`).addEventListener('input', (e) => {
      state[key] = Number(e.target.value);
      $(`${id}-val`).value = `${state[key]}%`;
      save(); renderSheet();
    });
  });
  $('btn-zreset').onclick = () => {
    const def = fromMaster();   // 既定値はマスタから作った初期状態と同じにする
    ZOOMS.forEach(([, key]) => { state[key] = def[key]; });
    commit();
  };

  document.querySelectorAll('[data-bulk]').forEach((b) => {
    b.onclick = () => {
      const [group, how] = b.dataset.bulk.split(':');
      state[group].forEach((x) => { x.on = (how === 'all'); });
      commit();
    };
  });
  document.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => {
      const group = b.dataset.add;
      state[group].push({ id: `x-${group}-${++uid}`, name: '新しい仕様', sub: '', icon: '', on: true });
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
    localStorage.removeItem(storeKey());   // 今のモードの分だけ消す
    state = fromMaster(); commit();
  };

  /* ---------------- 作り方の切替 ----------------
     モードごとに入力を別に保存しているので、行き来しても
     もう一方の入力は残る。URL の ?mode= も合わせて書き換えて、
     ブックマークや共有リンクで同じ作り方から始められるようにする */
  function setMode(m, opts = {}) {
    if (!MODES.includes(m)) m = 'dual';
    if (state && m === mode) return;
    if (state) save();                 // 切り替える前に、今の入力を保存
    mode = m;
    document.body.dataset.mode = mode;
    document.querySelectorAll('.modetabs__btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    });
    if (!opts.keepState) state = load();
    if (!opts.silent) {
      const u = new URL(location.href);
      u.searchParams.set('mode', mode);
      history.replaceState(null, '', u);
    }
    if (opts.boot) return;             // 起動時は下でまとめて描く
    buildPresetSelect(); commit(); fitZoom();
  }
  document.querySelectorAll('.modetabs__btn').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode);
  });

  $('zoom').addEventListener('input', (e) => applyZoom(Number(e.target.value) / 100));
  // 画面が狭いときは回転・リサイズで収まり直す
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 1080) fitZoom();
    else applyZoom(Number($('zoom').value) / 100);
  });
  window.addEventListener('beforeprint', renderSheet);
  window.addEventListener('afterprint', renderSheet);

  /* ---------------- 起動 ---------------- */
  const q = new URLSearchParams(location.search);
  // ?mode=single | dual … スタートページのどちらの入口から来たか
  setMode(q.get('mode') || 'dual', { silent: true, boot: true });   // ここで state を読む

  // ?demo=n … 保存内容を無視し、n件ON（既定4件）にした状態で表示
  const demo = q.get('demo');
  if (demo !== null) {
    state = fromMaster();
    const k = Number(demo) || 4;
    const list = (mode === 'single') ? state.common : state.premium;
    list.forEach((p, i) => { p.on = i < k; });
  }
  if (q.get('theme') === 'light' || q.get('theme') === 'dark') state.theme = q.get('theme');
  buildPresetSelect();
  commit();
  fitZoom();

  /* 1ファイル版（build.py）で画面を切り替えた直後に呼ぶ。
     非表示のあいだは幅・高さが 0 で測れないため、表示後に組み直す */
  window.SPEC_REFRESH = () => { commit(); fitZoom(); };

  /* 1ファイル版・公開版で、スタート画面の入口に応じた作り方に切り替える。
     URL は書き換えない（#builder-single のようなハッシュで管理しているため） */
  window.SPEC_SET_MODE = (m) => setMode(m, { silent: true });
})();
