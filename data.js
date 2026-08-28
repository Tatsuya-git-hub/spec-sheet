/* =============================================================
   仕様マスタ（記載情報の定義。ここだけ編集すれば画面に反映されます）
   - name : カード上の主表記（短く・簡潔に）
   - sub  : name の下に小さく出る補足（省略可）
   - image: 'images/xxx.jpg' のような相対パスでも指定可
            （空ならプレースホルダ。画面上からアップロードも可）
   - 並び順はこの配列の順番
   ============================================================= */
window.SPEC_MASTER = {
  meta: {
    title: '仕様設備一覧',
    titleEn: 'SPECIFICATIONS',
    lead: '築年数経過後も**選ばれる賃貸**であるために。長期安定経営を支える仕様をご提案します。',
    labelPreset: 'default',
    footerNote: '',
  },

  /* -------------------------------------------------------------
     2軸の呼び方の候補（画面のセレクトで切り替え・比較できます）
       c/cn/cEn = 左（標準側）の 見出し / 補足 / 欧文
       p/pn/pEn = 右（採用側）の 見出し / 補足 / 欧文
     ------------------------------------------------------------- */
  labelPresets: [
    { id: 'default',  name: '共通仕様 / 付加価値仕様（現行）',
      c: '共通仕様',       cn: '全戸に標準装備',       cEn: 'COMMON',
      p: '付加価値仕様',   pn: '本計画での採用仕様',   pEn: 'VALUE ADDED' },

    { id: 'standard', name: '標準仕様 / 差別化仕様',
      c: '標準仕様',       cn: '長期安定経営の土台',   cEn: 'STANDARD',
      p: '差別化仕様',     pn: '本計画で採用',         pEn: 'DISTINCTION' },

    { id: 'premium',  name: '全戸標準仕様 / プレミアム仕様',
      c: '全戸標準仕様',   cn: '入居者が求める必須設備', cEn: 'STANDARD',
      p: 'プレミアム仕様', pn: '高額家賃帯に必要',     pEn: 'PREMIUM' },

    { id: 'base',     name: 'ベース仕様 / グレードアップ仕様',
      c: 'ベース仕様',     cn: '全戸共通',             cEn: 'BASE',
      p: 'グレードアップ仕様', pn: '本計画で上乗せ',   pEn: 'UPGRADE' },

    { id: 'chosen',   name: '基本装備 / 選ばれる装備',
      c: '基本装備',       cn: 'いま当たり前の設備',   cEn: 'ESSENTIAL',
      p: '選ばれる装備',   pn: '競合と差がつく設備',   pEn: 'SELECTED' },
  ],

  /* 共通仕様：基本は全掲載。必要に応じて個別に外す（デフォルトON） */
  common: [
    { id: 'c-delivery',  name: '宅配ボックス',       sub: '24時間受取',       image: '' },
    { id: 'c-floorheat', name: '床暖房',             sub: '全戸標準',         image: '' },
    { id: 'c-dishwash',  name: '食洗機',             sub: 'ビルトイン',       image: '' },
    { id: 'c-workspace', name: '在宅勤務スペース',   sub: 'ワークカウンター', image: '' },
    { id: 'c-toilet',    name: 'タンクレストイレ',   sub: '節水型',           image: '' },
    { id: 'c-wic',       name: 'ウォークインクローゼット', sub: '大容量収納',  image: '' },
    { id: 'c-internet',  name: 'インターネット無料', sub: '全戸対応',         image: '' },
    { id: 'c-security',  name: 'ホームセキュリティ', sub: 'SECOM',            image: '' },
  ],

  /* 付加価値仕様：物件ごとに採用するものを選択（デフォルトOFF） */
  premium: [
    { id: 'p-alcove',    name: '玄関アルコーブ',     sub: 'プライバシー確保', image: '' },
    { id: 'p-smartlock', name: 'スマートロック',     sub: 'キーレス施解錠',   image: '' },
    { id: 'p-ev',        name: '大きめエレベーター', sub: '13人乗り',         image: '' },
    { id: 'p-corner',    name: '全住戸角部屋',       sub: '二面採光',         image: '' },
    { id: 'p-living',    name: 'ワイドリビング',     sub: '開放感のある間口',  image: '' },
    { id: 'p-tile',      name: '玄関タイル',         sub: '質感のある足元',   image: '' },
    { id: 'p-bath',      name: '大きめユニットバス', sub: '1618サイズ',       image: '' },
    { id: 'p-door',      name: 'ハイグレード建具',   sub: '高級マンション仕様', image: '' },
  ],
};
