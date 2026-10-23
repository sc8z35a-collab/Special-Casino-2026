/* 演出設定: which of the game's effects play, chosen by the player in
   js/ui/effects.js and kept on this device. Every effect can be switched off
   on its own; シンプル演出 switches all of them off at once (and back to the
   player's own choice). Someone whose system asks for reduced motion starts
   with シンプル演出. What is off shows on <html> as fx-off-<id> (the CSS
   leaves it out) and in BR.fx.on(id) (the scripts skip it). Only the show is
   left out, never the game: wins are paid and shown, and what comes after
   them happens as before. (BR.FX in js/render/fx.js is the BIG WIN overlay.) */
(function (BR) {
  'use strict';

  var KEY = 'blockbuster-reels/effects';

  // [id, name, what it is], in the order the settings list them
  var GROUPS = [
    { name: 'スロット', items: [
      ['spin', 'スピンの光', 'SPINを押したときの光と、リールが止まるときの火花・絵柄の弾み'],
      ['reach', 'リーチ演出', 'チャンス！・激アツ！！の文字と、燃えるリール・炎・稲妻'],
      ['line', 'ラインの演出', 'そろった絵柄が光る予告、当たり絵柄をつなぐ稲妻、ラインを走る光'],
      ['symbols', '当たり絵柄の動き', '当たった絵柄が飛び出して動く（7が燃える・ダイヤがきらめく など）'],
      ['combo', '小当たり・COMBO', 'WIN欄の光と浮かぶ金額、連続当たりのCOMBOバッジ'],
      ['bigwin', 'BIG WIN演出', 'BIG WIN・SUPER BIG WINの全画面演出（オフでも金額はWIN欄に出ます）'],
      ['model3d', '3Dの文字・報酬演出', '当たり・LEVEL UP・VIP延長を3Dで表示（オフで従来の文字）'],
      ['fever', 'FEVER演出', '5回連続の当たりで画面が燃える演出'],
      ['curtain', '入場の幕', 'タイトル画面からカジノに入るときの幕と光'],
      ['glint', '待機中のきらめき', '何もしていないときに絵柄がきらっと光る']
    ] },
    { name: '画面全体', items: [
      ['coins', 'コインの演出', 'お金が入るときに財布へ飛んでくるコインと、コインの雨'],
      ['particles', '光の粒・紙吹雪', '火花・星・光の輪・稲妻・紙吹雪'],
      ['flash', '画面のフラッシュ', '画面全体がぱっと光る演出'],
      ['shake', '画面の揺れ', '大当たりなどで画面が揺れる演出'],
      ['celebrate', 'お祝い演出', 'LEVEL UP!・ログインボーナス・購入・報酬・対決の結果などの文字と光']
    ] },
    { name: 'メニュー・ボタン', items: [
      ['screens', '画面の切り替え', '画面やダイアログが開くときの動き'],
      ['rows', 'リストの動き', 'リストの行が順番に入ってくる動き'],
      ['notices', '通知の動き', '通知やメッセージが弾んで出てくる動き'],
      ['pops', 'ボタン・バッジの弾み', '押したボタンの弾みと光、バッジの揺れ、ボタンのうながし']
    ] }
  ];
  var IDS = [];
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { IDS.push(it[0]); }); });

  var calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var state = { simple: calm, off: {} };
  var listeners = [];

  function load() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* nothing saved, or no storage */ }
    if (!saved || typeof saved !== 'object') return;
    state.simple = !!saved.simple;
    (Array.isArray(saved.off) ? saved.off : []).forEach(function (id) {
      if (IDS.indexOf(id) >= 0) state.off[id] = true;
    });
  }
  function save() {
    var data = { simple: state.simple, off: IDS.filter(function (id) { return state.off[id]; }) };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* only for this visit */ }
  }

  function on(id) { return !state.simple && !state.off[id]; }

  // <html class="fx-simple fx-off-..."> for the CSS
  function apply() {
    var cl = document.documentElement.classList;
    cl.toggle('fx-simple', state.simple);
    IDS.forEach(function (id) { cl.toggle('fx-off-' + id, !on(id)); });
  }
  function changed() {
    save();
    apply();
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { if (window.console) console.warn(e); }
    });
  }

  // One effect on or off. With シンプル演出 on, the others stay off as they
  // are shown: only this one changes.
  function set(id, value) {
    if (IDS.indexOf(id) < 0) return;
    if (state.simple) {
      state.simple = false;
      IDS.forEach(function (k) { state.off[k] = true; });
    }
    if (value) delete state.off[id];
    else state.off[id] = true;
    changed();
  }
  // シンプル演出 on: everything off; off again: the player's own choice comes
  // back (all of them, when that choice was nothing at all)
  function setSimple(value) {
    state.simple = !!value;
    if (!state.simple && IDS.every(function (k) { return state.off[k]; })) state.off = {};
    changed();
  }
  function reset() {
    state.simple = false;
    state.off = {};
    changed();
  }

  load();
  apply();

  BR.fx = {
    groups: GROUPS,
    ids: IDS,
    on: on,
    simple: function () { return state.simple; },
    set: set,
    setSimple: setSimple,
    reset: reset,
    // told after every change (the switches, effects that are under way)
    onChange: function (fn) { listeners.push(fn); }
  };
})(window.BR = window.BR || {});
