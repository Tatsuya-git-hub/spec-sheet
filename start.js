/* =============================================================
   スタートページ：紙面モックの「自動組版」演出
   ------------------------------------------------------------
   ヒーロー右側のA4モックで、カードを1枚ずつ流し込んで整列させる。
   件数の違うシーンを順に見せることで、
   「件数に応じて列数・行数が組み替わる」というツールの挙動を
   説明文なしで伝えるのが目的。

   ・JSが動かない環境では、HTMLに書いてあるカードがそのまま出る
     （このスクリプトが .is-anim を付けて初めて演出が有効になる）
   ・画面外／タブ非表示のあいだは止める（電池とCPUのため）
   ・prefers-reduced-motion では動かさず、静止した状態を見せる
   ============================================================= */
(() => {
  'use strict';

  const visual = document.getElementById('hero-visual');
  const gc = document.getElementById('mock-common');
  const gp = document.getElementById('mock-premium');
  const bar = document.getElementById('mock-bar');
  if (!visual || !gc || !gp || !bar) return;

  /* 見せるシーン: c=共通仕様の件数 / p=付加価値仕様の件数 / 列数 */
  const SCENES = [
    { c: 6, p: 2, cCols: 3, pCols: 1 },
    { c: 9, p: 4, cCols: 3, pCols: 2 },
    { c: 4, p: 6, cCols: 2, pCols: 2 },
  ];

  const STEP = 70;    // カード1枚ずつの間隔
  const IN   = 520;   // 1枚が入り終わるまで
  const HOLD = 2400;  // 組み終わってからの静止
  const OUT  = 420;   // 消えるまで

  let scene = 0;
  let timer = null;
  let running = false;

  /* ---- グリッドを作り直す（アニメ前の状態で置く）---- */
  function build(grid, n, cols) {
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.textContent = '';
    const frag = document.createDocumentFragment();
    for (let k = 0; k < n; k++) {
      const cell = document.createElement('i');
      const tick = document.createElement('b');
      tick.className = 'mock__tick';
      tick.textContent = '✓';
      cell.appendChild(tick);
      frag.appendChild(cell);
    }
    grid.appendChild(frag);
    return Array.prototype.slice.call(grid.children);
  }

  const wait = (fn, ms) => { timer = setTimeout(fn, ms); };

  /* ---- 1シーン分の流れ ---- */
  function play() {
    const s = SCENES[scene];
    bar.textContent = 'COMPOSING…';

    // 左（共通仕様）→ 右（付加価値仕様）の順に流し込む
    const cells = build(gc, s.c, s.cCols).concat(build(gp, s.p, s.pCols));
    cells.forEach((el, k) => {
      el.style.transitionDelay = `${k * STEP}ms`;
      el.firstChild.style.animationDelay = `${k * STEP}ms`;
    });

    // 同じフレームでクラスを付けるとトランジションが走らないので2フレーム待つ
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!running) return;
      cells.forEach((el) => el.classList.add('is-in'));
    }));

    wait(() => {
      bar.textContent = `A4 LANDSCAPE ／ ${s.c + s.p} items`;
      wait(() => {
        cells.forEach((el) => { el.style.transitionDelay = '0ms'; el.classList.add('is-out'); });
        wait(() => { scene = (scene + 1) % SCENES.length; play(); }, OUT);
      }, HOLD);
    }, (cells.length - 1) * STEP + IN);
  }

  /* ---- 静止した状態（動きを減らす設定のとき）---- */
  function still() {
    const s = SCENES[1];
    const cells = build(gc, s.c, s.cCols).concat(build(gp, s.p, s.pCols));
    cells.forEach((el) => el.classList.add('is-in'));
    bar.textContent = `A4 LANDSCAPE ／ ${s.c + s.p} items`;
  }

  /* ---- 再生の制御 ---- */
  function stop() { running = false; clearTimeout(timer); }
  function start() { if (running) return; running = true; play(); }

  gc.classList.add('is-anim');
  gp.classList.add('is-anim');

  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    still();
    return;
  }

  let onScreen = true;
  let visible = !document.hidden;
  const sync = () => { (onScreen && visible) ? start() : stop(); };

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    sync();
  });

  if (window.IntersectionObserver) {
    new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      sync();
    }, { threshold: 0.15 }).observe(visual);
  } else {
    sync();
  }
})();
