/* Vault workspace, uploads and previews. The controller injects its authenticated IO and UI helpers. */
window.createOpsVault = function(ctx) {
  'use strict';
  var $ = ctx.$, state = ctx.state, request = ctx.request, el = ctx.el, fmt = ctx.fmt, date = ctx.date, stamp = ctx.stamp, ago = ctx.ago, face = ctx.face, toast = ctx.toast, fail = ctx.fail, quietOk = ctx.quietOk, scrollTop = ctx.scrollTop, topBar = ctx.topBar, setCount = ctx.setCount, ask = ctx.ask, fact = ctx.fact, withCode = ctx.withCode, GB = ctx.GB;
  /* ------------------------------------------------------------ 保管庫 --- */
  /* The developer's own vault (their login shows it; the developer code lets
     them change it for 30 minutes), the backups they keep of any file, the
     vaults operators share (one for every two of them) and each operator's
     own: private, and their login is enough; the developer looks into every
     one (no changes). One room for all of them; what an operator keeps is 1GB
     until the developer approves more (with the limit they set). A file opens
     with a tap on its icon; everything else is in its ⋯ menu (or a right
     click, a long press), its 詳細 and its 💬. Files and folders are checked
     to move, download, back up or delete several at once (Shift: a range). */
  var vaultTimer = 0, moving = 0, v3d = null, viewing = null, viewUrl = '', pics = {}, vaultSig = '', lastPick = null, shown = {};
  var vaultWork = null, commentDrafts = {};
  function vaultWorkspace() { if (!vaultWork) vaultWork = createVaultTabs(); return vaultWork; }
  function resetVaultTabs() { if (vaultWork) vaultWork.reset(); commentDrafts = {}; }
  function openVaultDetails(f) {
    shown[f.id] = true;
    vaultWorkspace().open('details:' + f.id, '詳細：' + f.name, {
      show: function (pane) {
        var current = fileOf(f.id); pane.dataset.vaultFile = f.id; pane.replaceChildren();
        if (!current) { pane.appendChild(el('p', 'muted', 'このファイルは移動または削除されました')); return; }
        pane.appendChild(el('h3', '', current.name)); var actions = el('div', 'vault-tab-actions');
        if (!current.space && current.done && !current.implementedAt && canWrite()) {
          var link = el('button', 'btn primary', 'このファイルのURLを発行'); link.type = 'button'; link.addEventListener('click', function () { makeLink(current); }); actions.appendChild(link);
        }
        var comments = el('button', 'btn', 'コメントを開く'); comments.type = 'button'; comments.addEventListener('click', function () { openComments(current); }); actions.appendChild(comments); pane.appendChild(actions);
        pane.appendChild(detailsEl(current, fileKind(current)));
      }, close: function () { delete shown[f.id]; redrawCard(f.id); }
    });
  }
  // three.js for the 3D previews (ops/vault3d.js), loaded the first time it is needed
  function vault3d() {
    if (!v3d) {
      v3d = OpsLoad.load('../js/vendor/three-bundle.js').then(function () { return new Promise(function (ok, no) {
        var s = document.createElement('script');
        var meta = document.querySelector('meta[name="ops-vault3d"]');
        s.src = meta ? meta.content : 'vault3d.js';
        s.onload = function () { if (window.VAULT3D) ok(window.VAULT3D); else no(new Error('3Dを読み込めませんでした')); };
        s.onerror = function () { v3d = null; no(new Error('3Dを読み込めませんでした')); };
        document.head.appendChild(s);
      }); }).catch(function (e) { v3d = null; throw e; });
    }
    return v3d;
  }
  var KINDS_3D = /\.(glb|gltf|obj|fbx|stl|ply)$/i;
  function is3d(name) { return KINDS_3D.test(String(name || '')); }
  // (the developer's ticket goes with every call while they may change things; an operator has none)
  function vreq(method, path, body, as) {
    return request(method, path, body, state.vault && state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : {}, as).catch(function (err) {
      if (err.code === 'vault_locked' && state.vault && state.vault.ticket) relock('閲覧のみに戻りました。変更するには「編集する」から開発者コードを入力してください');
      throw err;
    });
  }
  function mb(n) {
    if (!n) return '0MB';
    if (n >= 1073741824) return (n / 1073741824).toFixed(n >= 10737418240 ? 0 : 1) + 'GB';
    return n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
  }
  // 2GB, 1.5GB: a limit in the shared vaults (one under 1GB in MB)
  function gb(n) { return n >= GB ? Math.round(n / GB * 10) / 10 + 'GB' : mb(n); }
  // nothing of the vault kept (closed, or someone else logged in)
  function resetVault() {
    resetVaultTabs();
    stopThumbnails(); thumbnails = {};
    state.vault = null;
    state.vaultMemo = '';
    shown = {};
    closeComments();
    state.vaultSpaces = null;
    state.vaultInfo = null;
    state.vaultSpace = '';
    state.vaultFiles = [];
    state.vaultFolders = [];
    state.vaultFolder = '';
    state.vaultIn = '';
    state.vaultPicked = {};
    state.vaultPage = 0;
    state.vaultRev = { files: '', spaces: '', full: 0 };
    vaultSig = '';
    lastPick = null;
    clearTimeout(vaultTimer);
  }
  // the developer back to looking only (the code's 30 minutes over, or 閉じる)
  function relock(message) {
    clearTimeout(vaultTimer);
    if (!state.vault) return Promise.resolve();
    state.vault.ticket = '';
    state.vault.until = 0;
    if (message) toast(message);
    vaultSig = '';
    renderVault();
    return loadVault();
  }
  // the developer: the developer code lets them change things for 30 minutes
  function unlockVault() {
    withCode({ title: '保管庫を編集する', text: '開発者コードを入れると、30分間 保管庫を変更できます（それまでは閲覧のみです）。', ok: '編集する' }).then(function (code) {
      if (code === null) return null;
      return request('POST', '/api/vault/open', { code: code }).then(function (r) {
        if (!state.vault) return null;
        state.vault.ticket = r.ticket;
        state.vault.until = r.until;
        state.vault.linkHours = r.linkHours;
        clearTimeout(vaultTimer);
        vaultTimer = setTimeout(function () { relock('30分たったので閲覧のみに戻りました'); }, Math.max(1000, r.until - Date.now() - 5000));
        toast('30分間 編集できます');
        vaultSig = '';
        renewPasses();
        return loadVault();
      });
    }).catch(fail);
  }
  // the vaults one sees (no code needed to look): the developer's own first
  // (the developer), one's own (an operator)
  function openLook(quiet) {
    if (state.vault || openLook.busy) return Promise.resolve();
    openLook.busy = true;
    return request('GET', '/api/vault/spaces').then(function (sp) {
      if (state.vault) return null;
      state.vault = { ticket: '', until: 0, chunk: sp.pool.chunk, maxBytes: sp.pool.maxBytes, fileBytes: sp.pool.fileBytes, used: sp.pool.used, store: sp.pool.store, me: sp.me, linkHours: sp.linkHours };
      state.vaultSpaces = sp;
      state.vaultSpeed = sp.speed || null;
      state.vaultSpace = state.developer ? '' : sp.personal ? sp.personal.id : sp.spaces.length ? sp.spaces[0].id : '';
      renderVault();
      // (the vaults were just asked for: the files only)
      return loadVault(false, sp);
    }, function (err) { if (!quiet) fail(err); }).then(function () { openLook.busy = false; });
  }
  // the vaults one sees and one's room, and the open one's files and folders
  // (`quiet`: from the timer, redrawn only when something changed). The
  // lists are light; from the timer the server only says "the same" while
  // nothing has changed (in full once in five minutes all the same).
  // (`known`: the vaults' answer that was just had, so it is not asked for again)
  function loadVault(quiet, known) {
    if (!state.vault) return Promise.resolve();
    var plan = vaultPlan(quiet);
    return Promise.all([known || vreq('GET', plan.paths[0]), plan.paths[1] ? vreq('GET', plan.paths[1]) : null]).then(function (rs) { gotVault(plan, rs); }, function (err) { return vaultFailed(plan, err); });
  }
  // what to ask for: the vaults one sees, and the open one's files (from the timer, with the revs it was given: "the same" while nothing changed)
  function vaultPlan(quiet) {
    var space = state.vaultSpace, none = !space && !state.developer, rv = state.vaultRev;
    var cheap = quiet && Date.now() - rv.full < 300000 && rv.space === space;
    var q = function (path, rev) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 'rev=' + encodeURIComponent(rev); };
    var filesPath = '/api/vault/files' + (space ? '?space=' + encodeURIComponent(space) : '');
    return { space: space, quiet: quiet, cheap: cheap, paths: [cheap && rv.spaces ? q('/api/vault/spaces', rv.spaces) : '/api/vault/spaces', none ? null : cheap && rv.files ? q(filesPath, rv.files) : filesPath] };
  }
  // asked again at the lists' pace while the vault is open (not while files go up or down), with the rest of the beat (ops/beat.js)
  function vaultAsk() {
    if (!quietOk() || !state.vault || moving || !$('#viewer').hidden || !$('#vmenu').hidden) return null;
    var plan = vaultPlan(true), h = state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : null;
    return plan.paths.filter(Boolean).map(function (p) { return { p: p, h: h, plan: plan }; });
  }
  function vaultGot(xs, q) { var plan = q[0].plan; gotVault(plan, [xs[0], plan.paths[1] ? xs[1] : null]); }
  function gotVault(plan, rs) {
    var sp = rs[0], r = rs[1], space = plan.space, rv = state.vaultRev;
    if (!state.vault || state.vaultSpace !== space) return;
    // (nothing changed: as it is)
    if (sp.same && (!r || r.same)) return;
    if (sp.same) sp = state.vaultSpaces;
    if (r && r.same) r = { space: state.vaultInfo, files: state.vaultFiles, folders: state.vaultFolders, all: state.vault.all, store: state.vault.store, rev: rv.files };
    rv.spaces = sp.rev || '';
    rv.files = r ? r.rev || '' : '';
    rv.space = space;
    if (!plan.cheap) rv.full = Date.now();
    if (sp.speed) state.vaultSpeed = sp.speed;
    state.vaultSpaces = sp;
    if (sp.requests) setCount('vault', sp.requests.length);
    state.vault.used = sp.pool.used;
    state.vault.maxBytes = sp.pool.maxBytes;
    state.vault.me = sp.me;
    if (sp.inDb !== undefined) state.vault.inDb = sp.inDb;
    state.vaultInfo = r ? r.space : null;
    state.vaultFiles = r ? r.files || [] : [];
    state.vaultFolders = r ? r.folders || [] : [];
    if (r) { state.vault.all = r.all; state.vault.store = r.store; }
    // (the code's ticket no longer good: looking only)
    if (r && r.locked && state.vault.ticket) { state.vault.ticket = ''; clearTimeout(vaultTimer); }
    // (a folder that went: back to the top; checks on what went)
    if (state.vaultFolder && !folderOf(state.vaultFolder)) state.vaultFolder = '';
    Object.keys(state.vaultPicked).forEach(function (id) { if (!fileOf(id) && !folderOf(id)) delete state.vaultPicked[id]; });
    // as it was: nothing redrawn (what is open on the page stays as it is)
    var sig = JSON.stringify([space, sp, state.vaultFiles, state.vaultFolders]);
    if (!plan.quiet || sig !== vaultSig) { vaultSig = sig; renderVault(); }
    if (commentsFor) renderComments();
    toBucket();
    renderResume();
    roomCame();
  }
  function vaultFailed(plan, err) {
    if (err && err.code === 'vault_locked' && state.vault && state.vault.ticket) relock('閲覧のみに戻りました。変更するには「編集する」から開発者コードを入力してください');
    // (a shared vault no longer there: back to the first one)
    var first = state.vaultSpaces && state.vaultSpaces.spaces[0], back = state.developer ? '' : first ? first.id : '';
    if (err && err.code === 'no_space' && state.vault && state.vaultSpace === plan.space && back !== plan.space) {
      state.vaultSpace = back;
      return loadVault();
    }
    if (!plan.quiet) fail(err);
    return null;
  }
  function fileOf(id) { return state.vaultFiles.filter(function (f) { return f.id === id; })[0] || null; }
  // another vault: from its top, nothing checked
  function goSpace(id) {
    if (!state.vault) return;
    if (id === state.vaultSpace) { goTop(); return; }
    resetVaultTabs();
    state.vaultRev.full = 0;
    state.vaultSpace = id;
    state.vaultIn = '';
    state.vaultInfo = null;
    state.vaultFiles = [];
    state.vaultFolders = [];
    state.vaultFolder = '';
    state.vaultPage = 0;
    clearPicks();
    setShow('all');
    vaultSig = '';
    renderVault();
    loadVault();
  }
  // すべて / 未実装 / 実装済み (the developer's vault)
  function setShow(v) {
    state.vaultShow = v;
    Array.prototype.forEach.call(document.querySelectorAll('#vault-filter .chip'), function (x) { x.classList.toggle('on', x.dataset.vf === v); });
  }
  // pieces kept in the database before R2 move into it while the vault is open
  var toBucketJob = null;
  function toBucket() {
    if (!state.vault || !state.vault.ticket || state.vault.store !== 'bucket' || !state.vault.inDb || toBucketJob) return;
    var total = state.vault.inDb, j = toBucketJob = job('R2 へ移動（データベースにある ' + fmt(total) + ' 部分）');
    j.set(0, total);
    (function step() {
      vreq('POST', '/api/vault/to-bucket').then(function (r) {
        j.set(total - r.left, total);
        if (r.left && r.moved && state.vault) return step();
        toBucketJob = null;
        if (state.vault) state.vault.inDb = r.left;
        if (r.left) j.fail('途中で止まりました（次に開いたときに続きから）'); else j.finish('すべて R2 に移しました');
        return null;
      }).catch(function (err) { toBucketJob = null; j.fail((err && err.message) || 'R2 に移せませんでした'); });
    })();
  }

  /* folders: the one open ('' the top), and what is in it */
  function folderOf(id) { return state.vaultFolders.filter(function (d) { return d.id === id; })[0] || null; }
  // the folders from the top down to `id`
  function trail(id) {
    var out = [];
    for (var d = folderOf(id); d && out.length < 10; d = folderOf(d.parent)) out.unshift(d);
    return out;
  }
  // the open vault's name at the top of its folders
  function kindNow() { return state.vaultInfo ? state.vaultInfo.kind : state.vaultSpace === 'backup' ? 'backup' : ''; }
  function rootName() { var k = kindNow(); return k === 'backup' ? 'バックアップ' : k === 'own' ? '個人保管庫' : k === 'pair' ? '共有保管庫' : '保管庫'; }
  function pathName(id) { return [rootName()].concat(trail(id).map(function (d) { return d.name; })).join(' / '); }
  function byName(a, b) { return a.name.localeCompare(b.name, 'ja'); }
  // the files of a folder (not the ones inside a file there; the backups:
  // every file at once, wherever it is)
  function filesIn(id) {
    var flat = state.vaultSpace === 'backup';
    return state.vaultFiles.filter(function (f) { return !f.parent && (flat || ((f.folder || '') === id && !f.inside)); });
  }
  /* files in a file: the ones in it (and in them), the files from the
     outermost down to `id`, and the list shown now (a file's, or a folder's) */
  function inFile(id) { return state.vaultFiles.filter(function (f) { return !f.parent && f.inside === id; }); }
  function inFileAll(id, seen) {
    if ((seen || 0) > 8) return [];
    return inFile(id).reduce(function (all, f) { return all.concat([f], inFileAll(f.id, (seen || 0) + 1)); }, []);
  }
  function fileTrail(id) {
    var out = [];
    for (var f = fileOf(id); f && out.length < 10; f = f.inside ? fileOf(f.inside) : null) out.unshift(f);
    return out;
  }
  function listed() { return state.vaultIn ? inFile(state.vaultIn) : filesIn(state.vaultFolder); }
  // a file's inside open: the files in it (none: another file can be put in, or made here)
  function goInside(f) {
    state.vaultIn = f.id;
    state.vaultFolder = f.folder || '';
    clearPicks();
    state.vaultPage = 0;
    renderVault();
    scrollTop();
  }
  // the top of the vault open now (its icon, its name, the 保管庫 tab again)
  function goTop() {
    if (!state.vault) return;
    var was = state.vaultFolder || state.vaultIn;
    state.vaultFolder = '';
    state.vaultIn = '';
    clearPicks();
    state.vaultPage = 0;
    renderVault();
    scrollTop();
    if (was) toast(rootName() + 'のいちばん上に戻りました');
  }
  function foldersIn(id) { return state.vaultFolders.filter(function (d) { return d.parent === id; }).sort(byName); }
  // where something can go: the top and every folder (not the `skip` ones nor what is inside them)
  function places(skip) {
    var out = state.vaultFolders.filter(function (d) {
      return !trail(d.id).some(function (x) { return skip.indexOf(x.id) >= 0; });
    }).map(function (d) { return { value: d.id, label: pathName(d.id) }; });
    out.sort(function (a, b) { return a.label.localeCompare(b.label, 'ja'); });
    return [{ value: '', label: rootName() + '（いちばん上）' }].concat(out);
  }
  // what one may do in the open vault: change it (the developer only looks into the others')
  function canWrite() { return !!(state.vaultInfo && state.vaultInfo.write); }
  // a checkmark on a file or a folder
  function checkEl(id, name) {
    var label = el('label', 'vault-check'), box = el('input');
    box.type = 'checkbox';
    box.dataset.vpick = id;
    box.checked = !!state.vaultPicked[id];
    box.setAttribute('aria-label', name + ' を選択');
    label.appendChild(box);
    label.appendChild(el('i'));
    return label;
  }
  // the icon of an item (a tap opens it): a folder, an APK, any other file
  // (its extension written on it)
  function iconEl(type, name, ext) {
    var b = el('button', 'vicon vicon-' + type);
    b.type = 'button';
    b.dataset.vopen = '1';
    b.title = '開く';
    b.setAttribute('aria-label', name + ' を開く');
    var img = el('img');
    img.src = 'icons/' + type + '.svg';
    img.alt = '';
    img.draggable = false;
    b.appendChild(img);
    if (ext) b.appendChild(el('span', 'vicon-ext', ext));
    return b;
  }
  // the ⋯ of an item: everything that can be done with it
  function moreBtn(name) {
    var b = el('button', 'vbtn vmore', '⋯');
    b.type = 'button';
    b.dataset.vact = 'menu';
    b.title = 'メニュー';
    b.setAttribute('aria-label', name + ' のメニュー');
    b.setAttribute('aria-haspopup', 'menu');
    return b;
  }
  function folderCard(d) {
    var row = el('article', 'vitem vault-folder' + (state.vaultPicked[d.id] ? ' picked' : ''));
    row.dataset.folder = d.id;
    row.appendChild(checkEl(d.id, d.name));
    row.appendChild(iconEl('folder', d.name));
    var main = el('div', 'vitem-main');
    main.appendChild(el('b', 'vault-name', d.name));
    var stats = folderStats(d);
    main.appendChild(el('small', 'vitem-sub', 'フォルダ・' + fmt(stats.files) + 'ファイル・' + mb(stats.bytes)));
    row.appendChild(main);
    var acts = el('div', 'vitem-acts');
    var detail = el('button', 'vbtn', '詳細'); detail.type = 'button'; detail.dataset.vact = 'details'; acts.appendChild(detail);
    acts.appendChild(moreBtn(d.name));
    row.appendChild(acts);
    return row;
  }
  function goFolder(id) {
    state.vaultFolder = id || '';
    state.vaultIn = '';
    clearPicks();
    state.vaultPage = 0;
    renderVault();
  }
  // what can be done with a folder (its ⋯, a right click)
  function folderMenu(d) {
    var items = [['開く', 'open'], ['詳細', 'details']], write = canWrite();
    if (write) items.push(['名前を変更', 'rename'], ['移動', 'move']);
    // (a folder's URL: only in the developer's own vault, like a file's)
    if (write && !d.space && state.vaultSpace !== 'backup') items.push(['このフォルダのURLを発行', 'link'], ['このフォルダのURLをすべて停止', 'stop']);
    if (state.developer && state.vault && state.vault.ticket) items.push(['中のファイルをすべてバックアップ', 'backup']);
    if (write) items.push(['削除', 'delete', 'danger']);
    return items;
  }
  function folderAct(d, act) {
    if (act === 'open') goFolder(d.id);
    else if (act === 'details') folderDetails(d);
    else if (act === 'rename') renameFolder(d);
    else if (act === 'move') moveFolder(d);
    else if (act === 'backup') backupItems([], [d], true);
    else if (act === 'link') makeLink(null, d);
    else if (act === 'stop') stopFolderLinks(d);
    else if (act === 'delete') deleteFolder(d);
  }
  function stopFolderLinks(d) {
    vreq('POST', '/api/vault/link/stop', { folder: d.id }).then(function (r) { toast('リンクを停止しました（' + r.stopped + '本）'); if (vaultWork) vaultWork.render('links'); }).catch(fail);
  }
  function folderStats(d) {
    var ids = {}; ids[d.id] = true;
    var pending = [d.id];
    while (pending.length) foldersIn(pending.shift()).forEach(function (x) { if (!ids[x.id]) { ids[x.id] = true; pending.push(x.id); } });
    // Every stored file counts once, including light versions and nested files.
    var files = state.vaultFiles.filter(function (f) { return ids[f.folder || '']; });
    return { files: files.length, folders: Object.keys(ids).length - 1, bytes: files.reduce(function (n, f) { return n + Number(f.size || 0); }, 0), unfinished: files.filter(function (f) { return !f.done; }).length };
  }
  function folderDetails(d) {
    vaultWorkspace().open('folder:' + d.id, '詳細：' + d.name, { show: function (pane) {
      pane.replaceChildren(); var current = folderOf(d.id); if (!current) { pane.appendChild(el('p', 'muted', 'このフォルダは移動または削除されました')); return; }
      var st = folderStats(current), facts = el('div', 'facts'); pane.appendChild(el('h3', '', current.name));
      if (!current.space && state.vaultSpace !== 'backup' && canWrite()) {
        var actions = el('div', 'vault-tab-actions'), link = el('button', 'btn primary', 'このフォルダのURLを発行');
        link.type = 'button'; link.addEventListener('click', function () { makeLink(null, current); }); actions.appendChild(link); pane.appendChild(actions);
      }
      fact(facts, '場所', pathName(current.id)); fact(facts, '作成日時', stamp(current.createdAt)); fact(facts, '容量', mb(st.bytes) + '（' + fmt(st.bytes) + 'バイト）'); fact(facts, 'ファイル', fmt(st.files) + '件'); fact(facts, 'サブフォルダ', fmt(st.folders) + '件'); fact(facts, 'アップロード途中', fmt(st.unfinished) + '件'); pane.appendChild(facts);
    } });
  }
  // the path above the list (保管庫 / 車 / 新車): each a way back
  function onFolder(e) {
    var crumb = e.target.closest('.vault-crumb');
    if (!crumb) return;
    if (crumb.dataset.infile) { var f = fileOf(crumb.dataset.infile); if (f) goInside(f); }
    else goFolder(crumb.dataset.folder);
  }
  function named(v) { return v.trim() ? '' : '名前を入れてください'; }
  function newFolder() {
    ask({ title: 'フォルダを作る', text: '「' + pathName(state.vaultFolder) + '」の中に作ります。', ok: '作る', input: { label: 'フォルダの名前' }, check: named }).then(function (name) {
      if (name === null) return null;
      return vreq('POST', '/api/vault/folders', { name: name, parent: state.vaultFolder, space: state.vaultSpace }).then(function () { toast('フォルダを作りました'); return loadVault(); });
    }).catch(fail);
  }
  function renameFolder(d) {
    ask({ title: 'フォルダの名前を変更', ok: '変更する', input: { label: 'フォルダの名前', value: d.name }, check: named }).then(function (name) {
      if (name === null || name.trim() === d.name) return null;
      return vreq('POST', '/api/vault/folders/update', { id: d.id, name: name }).then(function () { toast('名前を変更しました'); return loadVault(); });
    }).catch(fail);
  }
  function moveFolder(d) {
    ask({ title: '「' + d.name + '」を移動', ok: '移動する', select: { label: '移動先', options: places([d.id]), value: d.parent } }).then(function (to) {
      if (to === null || to === d.parent) return null;
      return vreq('POST', '/api/vault/folders/update', { id: d.id, parent: to }).then(function () { toast('移動しました'); return loadVault(); });
    }).catch(fail);
  }
  function deleteFolder(d) {
    ask({ title: '本当に削除しますか？', text: 'フォルダ「' + d.name + '」を削除します。中のファイルとフォルダは消えずに、ひとつ上（' + pathName(d.parent) + '）へ移ります。', ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/folders/delete', { id: d.id }).then(function () {
        if (trail(state.vaultFolder).some(function (x) { return x.id === d.id; })) state.vaultFolder = d.parent;
        toast('フォルダを削除しました');
        return loadVault();
      });
    }).catch(fail);
  }

  /* the checkmarks: what is listed here (the folders, then the files of every
     page), checked one by one, a range with Shift, or all at once */
  function shownItems() {
    var show = state.vaultShow;
    return (state.vaultIn ? [] : foldersIn(state.vaultFolder)).map(function (d) { return d.id; }).concat(listed().filter(function (f) {
      return show === 'all' || (show === 'used') === !!f.implementedAt;
    }).map(function (f) { return f.id; }));
  }
  function vaultPick(id, on) {
    if (on) state.vaultPicked[id] = folderOf(id) ? 'folder' : 'file';
    else delete state.vaultPicked[id];
  }
  function clearPicks() { state.vaultPicked = {}; lastPick = null; }
  function pickedFiles() { return state.vaultFiles.filter(function (f) { return state.vaultPicked[f.id] === 'file'; }); }
  function pickedFolders() { return state.vaultFolders.filter(function (d) { return state.vaultPicked[d.id] === 'folder'; }); }
  // a checkmark tapped (true: it was one)
  function onPick(e) {
    var box = e.target.closest('[data-vpick]');
    if (!box) return false;
    var id = box.dataset.vpick, ids = [id];
    if (e.shiftKey && lastPick && lastPick !== id) {
      var order = shownItems(), i = order.indexOf(lastPick), j = order.indexOf(id);
      if (i >= 0 && j >= 0) ids = order.slice(Math.min(i, j), Math.max(i, j) + 1);
    }
    ids.forEach(function (x) { vaultPick(x, box.checked); });
    lastPick = id;
    renderPicks();
    return true;
  }
  function pickAll(e) {
    var all = shownItems(), on = e.target.checked;
    all.forEach(function (id) { vaultPick(id, on); });
    lastPick = null;
    renderPicks();
  }
  // the checks on the page as they are now (nothing else redrawn)
  function renderPicks() {
    Array.prototype.forEach.call(document.querySelectorAll('#vault-list [data-vpick], #vault-folders [data-vpick]'), function (b) {
      b.checked = !!state.vaultPicked[b.dataset.vpick];
      var card = b.closest('.vitem');
      if (card) card.classList.toggle('picked', b.checked);
    });
    renderPicked();
  }
  function renderPicked() {
    var all = shownItems(), ids = Object.keys(state.vaultPicked), n = ids.length;
    var dirs = ids.filter(function (id) { return state.vaultPicked[id] === 'folder'; }).length;
    var here = all.filter(function (id) { return state.vaultPicked[id]; }).length;
    var bar = $('#vault-select'), box = $('#vault-pick-all');
    bar.hidden = !state.vaultInfo || !all.length;
    bar.classList.toggle('on', n > 0);
    box.checked = all.length > 0 && here === all.length;
    box.indeterminate = here > 0 && here < all.length;
    $('#vault-picked-n').textContent = n
      ? fmt(n) + '件を選択中' + (dirs ? '（フォルダ ' + fmt(dirs) + (n > dirs ? '・ファイル ' + fmt(n - dirs) : '') + '）' : '')
      : 'すべて選択（' + fmt(all.length) + '件）';
    $('#vault-select-hint').hidden = n > 0;
    $('#vault-picked').hidden = !n;
    var backups = state.vaultSpace === 'backup';
    $('#vault-picked-move').hidden = !canWrite() || backups;
    $('#vault-picked-delete').hidden = !canWrite();
    $('#vault-picked-backup').hidden = !(state.developer && state.vault && state.vault.ticket) || backups;
  }
  // a file's place as words: 保管庫 / 車 / model.glb
  function fileWhere(f) { return pathName(f.folder || '') + ' / ' + fileTrail(f.id).map(function (x) { return x.name; }).join(' / '); }
  // the files something can go into: any file of the vault (not a light copy,
  // not one being moved nor one inside those), as 'f:<id>'
  function fileTargets(files) {
    var skip = {};
    files.forEach(function (f) { skip[f.id] = true; inFileAll(f.id).forEach(function (x) { skip[x.id] = true; }); });
    return state.vaultFiles.filter(function (f) { return !f.parent && !skip[f.id] && f.space !== 'backup' && fileTrail(f.id).length < 8; })
      .map(function (f) { return { value: 'f:' + f.id, label: '📄 ' + fileWhere(f) + ' の中' }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label, 'ja'); });
  }
  // files and folders (the checked ones, or one file) into a folder; files
  // only, into a file too
  function moveItems(files, dirs) {
    var n = files.length + dirs.length;
    if (!n) return;
    var skip = dirs.map(function (d) { return d.id; });
    var options = places(skip).concat(dirs.length ? [] : fileTargets(files));
    ask({ title: fmt(n) + '件を移動', text: dirs.length ? '' : 'フォルダのほか、ほかのファイルの中（📄）にも移せます。', ok: '移動する', select: { label: '移動先', options: options, value: state.vaultIn ? 'f:' + state.vaultIn : state.vaultFolder } }).then(function (to) {
      if (to === null) return null;
      var into = to.indexOf('f:') === 0 ? to.slice(2) : '';
      var body = { ids: files.map(function (f) { return f.id; }), folders: skip };
      if (into) body.into = into; else body.folder = to;
      return vreq('POST', '/api/vault/move', body).then(function (r) {
        clearPicks();
        toast(fmt(r.moved) + '件を' + (into ? '「' + (fileOf(into) || { name: '' }).name + '」の中' : '「' + pathName(to) + '」') + 'へ移動しました');
        return loadVault();
      });
    }).catch(fail);
  }
  // every file in a folder and in the folders inside it (and the files in those files)
  function filesUnder(id) {
    var here = filesIn(id).reduce(function (all, f) { return all.concat([f], inFileAll(f.id)); }, []);
    return foldersIn(id).reduce(function (all, d) { return all.concat(filesUnder(d.id)); }, here);
  }
  // the checked files, and the files in the checked folders: saved one after another
  function downloadItems(files, dirs) {
    var seen = {};
    var list = dirs.reduce(function (all, d) { return all.concat(filesUnder(d.id)); }, files).filter(function (f) {
      if (seen[f.id] || !f.done) return false;
      seen[f.id] = true;
      return true;
    });
    if (!list.length) { toast('ダウンロードできるファイルがありません（アップロード途中のものは除きます）'); return; }
    (list.length > 1
      ? ask({ title: fmt(list.length) + '件をダウンロード', text: '1件ずつ順に保存します' + (dirs.length ? '（フォルダの中のファイルも含みます）' : '') + '。ブラウザに複数のファイルのダウンロードを確かめられたら「許可」してください。', ok: 'ダウンロード' })
      : Promise.resolve(true)
    ).then(function (ok) {
      if (!ok) return null;
      return list.reduce(function (p, f) { return p.then(function () { return download(f); }); }, Promise.resolve());
    }).catch(fail);
  }
  // the checked files go (for good, unless the developer backed them up);
  // the checked folders go, what is in them moves up
  function deleteItems(files, dirs) {
    if (state.vaultSpace === 'backup') files = files.filter(function (f) { return f.space === 'backup'; });
    var n = files.length + dirs.length;
    if (!n) { toast('バックアップでは、保管庫から削除されたファイルだけを削除できます'); return; }
    var size = files.reduce(function (s, f) { return s + f.size; }, 0), kept = files.filter(function (f) { return f.backup && f.space !== 'backup'; }).length, text = [];
    if (state.vaultSpace === 'backup') text.push('ファイル ' + fmt(files.length) + '件（' + mb(size) + '）をバックアップから完全に削除します（元に戻せません）。');
    else if (files.length) {
      text.push('ファイル ' + fmt(files.length) + '件（' + mb(size) + '）を削除します。' + (kept < files.length ? '保管庫から完全に消えます（元に戻せません）。' + (state.vaultSpace ? '' : 'リンクも使えなくなります。') : ''));
      if (kept) text.push('そのうち ' + fmt(kept) + '件は開発者のバックアップに残ります。');
    }
    if (dirs.length) text.push('フォルダ ' + fmt(dirs.length) + '個は削除され、中のファイルとフォルダは消えずにひとつ上へ移ります。');
    if (files.some(function (f) { return inFile(f.id).length; })) text.push('ファイルの中に入っているファイルは消えずに、ひとつ上へ移ります。');
    ask({ title: '本当に削除しますか？', text: fmt(n) + '件を削除します。\n' + text.join('\n'), ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return (files.length ? vreq('POST', '/api/vault/delete', { ids: files.map(function (f) { return f.id; }) }) : Promise.resolve()).then(function () {
        return dirs.length ? vreq('POST', '/api/vault/folders/delete', { ids: dirs.map(function (d) { return d.id; }) }) : null;
      }).then(function () {
        clearPicks();
        toast(fmt(n) + '件を削除しました');
        return loadVault();
      }, function (err) { fail(err); return loadVault(); });
    }).catch(fail);
  }

  // the developer backs up files (and every file in folders) of any vault;
  // `on` false: no longer
  function backupItems(files, dirs, on) {
    if (!files.length && !dirs.length) return;
    vreq('POST', '/api/vault/backup', { ids: files.map(function (f) { return f.id; }), folders: dirs.map(function (d) { return d.id; }), on: on }).then(function (r) {
      clearPicks();
      toast(r.changed ? fmt(r.changed) + '件を' + (on ? 'バックアップしました' : 'バックアップから外しました') : on ? 'もうバックアップしてあります' : 'バックアップしたものはありません');
      return loadVault();
    }).catch(fail);
  }
  // a file deleted from its vault goes back there from the backups
  function restoreBackup(f) {
    var from = f.backup && f.backup.removed ? f.backup.removed.where : '保管庫';
    ask({ title: '元の場所に戻しますか？', text: '「' + f.name + '」を' + from + 'に戻します（フォルダがなくなっていれば、いちばん上に戻ります）。バックアップはそのまま残ります。', ok: '戻す' }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/backups/restore', { id: f.id }).then(function (r) { toast(r.file.where + 'に戻しました'); return loadVault(); });
    }).catch(fail);
  }

  /* the vaults to choose from, one's room, whose the open one is */
  function renderSpaces() {
    var bar = $('#vault-spaces'), sp = state.vaultSpaces;
    bar.textContent = '';
    if (!sp) return;
    function what(x) { return x.files || x.folders ? fmt(x.files) + '件・' + mb(x.bytes) : '空'; }
    function chip(id, title, sub, cls) {
      var b = el('button', 'vspace' + (cls ? ' ' + cls : '') + (state.vaultSpace === id ? ' on' : ''));
      b.type = 'button';
      b.dataset.space = id;
      var t = el('span', 'vspace-who');
      t.appendChild(el('b', '', title));
      t.appendChild(el('small', '', sub));
      b.appendChild(t);
      bar.appendChild(b);
      return b;
    }
    if (state.developer) {
      var own = chip('', '開発者専用保管庫', what(sp.own), 'own');
      own.insertBefore(el('span', 'face vspace-mark', '開'), own.firstChild);
      var b = sp.backups || { files: 0, removed: 0, bytes: 0 };
      var bk = chip('backup', 'バックアップ', b.files ? fmt(b.files) + '件' + (b.removed ? '（削除済み ' + fmt(b.removed) + '）' : '') : '空', 'own');
      bk.insertBefore(el('span', 'face vspace-mark vspace-backup', '控'), bk.firstChild);
    } else if (sp.personal) {
      var mine = chip(sp.personal.id, 'あなたの個人保管庫', what(sp.personal), 'own');
      mine.insertBefore(face(sp.personal.owner || { name: state.name || '自' }), mine.firstChild);
    }
    if (sp.spaces.length) bar.appendChild(el('span', 'vspace-label', '共有保管庫（非公開・運営者ふたりごと）'));
    sp.spaces.forEach(function (x) {
      var b = chip(x.id, x.with.name + ' と共有', (x.with.operator ? '' : '運営者ではありません・') + what(x), x.with.operator ? '' : 'gone');
      b.insertBefore(face(x.with), b.firstChild);
      if (x.with.developer) b.querySelector('b').appendChild(el('span', 'tag maker', '開発者'));
    });
    if (sp.others && sp.others.length) {
      bar.appendChild(el('span', 'vspace-label', '運営者の保管庫（開発者だけ・閲覧のみ）'));
      sp.others.forEach(function (x) { chip(x.id, x.personal ? x.members[0].name + ' の個人保管庫' : x.members.map(function (m) { return m.name; }).join(' ⇄ '), what(x), 'look'); });
    }
  }
  function meterEl(used, limit) {
    var r = limit ? used / limit : 0;
    var m = el('span', 'meter' + (r >= 0.95 ? ' hot' : r >= 0.8 ? ' warm' : '')), i = el('i');
    i.style.width = Math.min(100, r * 100).toFixed(1) + '%';
    m.appendChild(i);
    return m;
  }
  function roomBtn(label, act, cls, data) {
    var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.dataset.room = act;
    Object.keys(data || {}).forEach(function (k) { b.dataset[k] = String(data[k]); });
    return b;
  }
  function renderRoom() {
    var box = $('#vault-room'), sp = state.vaultSpaces;
    box.textContent = '';
    box.hidden = !sp || !state.vault;
    if (box.hidden) return;
    if (state.developer) roomOfAll(box, sp); else roomOfMine(box, sp.me, sp.pool);
  }
  // an operator: what they keep in the shared vaults, their limit, their request
  function roomOfMine(box, me, pool) {
    var head = el('div', 'card-head');
    head.appendChild(el('b', '', '保管庫であなたが使える容量'));
    head.appendChild(el('span', 'time', me.approved ? '開発者が承認した上限（' + date(me.approved.at) + '）' : '標準（1人 ' + gb(me.free) + '）'));
    box.appendChild(head);
    var line = el('div', 'vroom-line');
    line.appendChild(el('b', '', mb(me.used) + ' / ' + gb(me.limit)));
    line.appendChild(meterEl(me.used, me.limit));
    box.appendChild(line);
    box.appendChild(el('p', 'muted vroom-note', 'あなたが送ったファイルの合計です（個人保管庫とどの共有保管庫の分も）。'
      + (me.approved ? '開発者が承認した上限まで保存できます（もっと必要なら、また申請できます）。' : gb(me.free) + 'を超えて保存するには、開発者の承認と上限の設定が必要です。')
      + '容量は開発者専用保管庫と共有です（保管庫全体の空き ' + mb(Math.max(0, pool.maxBytes - pool.used)) + '）。'));
    var a = el('div', 'acts');
    if (me.request) {
      a.appendChild(el('span', 'kind idea', '申請中：' + gb(me.request.bytes) + '（' + date(me.request.at, true) + '）'));
      if (me.request.reason) a.appendChild(el('span', 'muted vroom-why', '理由：' + me.request.reason));
      a.appendChild(roomBtn('申請を取り下げる', 'cancel', 'ghost'));
    } else {
      a.appendChild(roomBtn(me.approved ? 'さらに容量を申請' : '容量を申請', 'request', 'primary'));
      if (me.last) a.appendChild(el('span', 'kind ' + (me.last.status === 'approved' ? 'accepted' : 'rejected'), me.last.status === 'approved'
        ? '承認されました：上限 ' + gb(me.last.limit) + '（' + date(me.last.handledAt, true) + '）' : '前回の申請（' + gb(me.last.bytes) + '）は見送られました（' + date(me.last.handledAt, true) + '）'));
    }
    box.appendChild(a);
  }
  // the developer: the room of all the vaults, the requests, each operator's use and limit
  function roomOfAll(box, sp) {
    var head = el('div', 'card-head');
    head.appendChild(el('b', '', '容量の管理'));
    head.appendChild(el('span', 'time', '運営者は1人 ' + gb(sp.pool.free) + 'まで（共有・個人保管庫の合計。超えるには承認と上限の設定）'));
    box.appendChild(head);
    var shared = sp.spaces.concat(sp.others || []).reduce(function (s, x) { return s + x.bytes; }, 0);
    var line = el('div', 'vroom-line');
    line.appendChild(el('b', '', '保管庫全体 ' + mb(sp.pool.used) + ' / ' + mb(sp.pool.maxBytes)));
    line.appendChild(meterEl(sp.pool.used, sp.pool.maxBytes));
    box.appendChild(line);
    box.appendChild(el('p', 'muted vroom-note', '開発者専用保管庫 ' + mb(sp.own.bytes) + '・共有保管庫と個人保管庫 ' + mb(shared) + (sp.backups && sp.backups.bytes ? '・バックアップだけに残っているもの ' + mb(sp.backups.bytes) : '') + '（同じ容量を使います）。'));
    if (sp.requests.length) {
      box.appendChild(el('h4', 'vroom-sub', '容量の申請（' + fmt(sp.requests.length) + '件）'));
      sp.requests.forEach(function (r) {
        var p = sp.people.filter(function (x) { return x.id === r.user.id; })[0] || { used: 0, limit: sp.pool.free };
        var row = el('div', 'vroom-req');
        row.appendChild(face(r.user));
        var t = el('div', 'vroom-who');
        t.appendChild(el('b', '', r.user.name + '：' + gb(r.bytes) + ' を希望'));
        t.appendChild(el('small', '', '使用 ' + mb(p.used) + ' / ' + gb(p.limit) + '・' + date(r.at, true)));
        if (r.reason) t.appendChild(el('small', 'vroom-why', '理由：' + r.reason));
        row.appendChild(t);
        row.appendChild(roomBtn('承認して上限を決める', 'approve', 'primary', { id: r.id, bytes: r.bytes, name: r.user.name }));
        row.appendChild(roomBtn('見送る', 'decline', 'ghost', { id: r.id, name: r.user.name }));
        box.appendChild(row);
      });
    }
    if (sp.people.length) {
      box.appendChild(el('h4', 'vroom-sub', '運営者ごとの使用量（送ったファイルの合計）'));
      var t = el('table', 'srv-table vroom-people');
      sp.people.forEach(function (p) {
        var tr = el('tr'), th = el('th', '', p.name), td = el('td'), go = el('td', 'num');
        if (!p.operator) th.appendChild(el('small', '', '（運営者ではありません）'));
        td.appendChild(el('span', '', mb(p.used) + ' / ' + gb(p.limit) + (p.approved ? '（承認済みの上限・' + date(p.approved.at) + '）' : '（標準）')));
        td.appendChild(meterEl(p.used, p.limit));
        go.appendChild(roomBtn('上限を変更', 'limit', 'ghost', { user: p.id, name: p.name, limit: p.limit }));
        tr.appendChild(th);
        tr.appendChild(td);
        tr.appendChild(go);
        t.appendChild(tr);
      });
      box.appendChild(t);
    }
  }
  // a number of GB from a dialog, between `low` (not included unless `andLow`) and `high`
  function gbIn(v, low, high, andLow) {
    var n = Number(String(v).trim());
    return isFinite(n) && (andLow ? n >= low : n > low) && n <= high ? n : null;
  }
  function onRoom(e) {
    var b = e.target.closest('[data-room]');
    if (!b || !state.vaultSpaces) return;
    var d = b.dataset, pool = state.vaultSpaces.pool, free = pool.free / GB, most = pool.maxBytes / GB;
    var range = gb(pool.free) + 'より大きく ' + gb(pool.maxBytes) + 'まで';
    if (d.room === 'request') {
      var me = state.vaultSpaces.me, now = me.limit / GB;
      ask({
        title: '共有保管庫の容量を申請',
        text: '今の上限は ' + gb(me.limit) + '（使用 ' + mb(me.used) + '）です。開発者が承認すると、開発者が決めた上限まで使えるようになります（希望より小さいこともあります）。',
        ok: '申請する',
        input: { label: '希望する上限（GB・' + gb(me.limit) + 'より大きく ' + gb(pool.maxBytes) + 'まで）', value: String(Math.min(most, Math.max(2, Math.ceil(now * 2)))) },
        area: { label: '理由（任意・開発者に届きます）' },
        check: function (v) { return gbIn(v, now, most) === null ? gb(me.limit) + 'より大きく ' + gb(pool.maxBytes) + 'までの数を入れてください' : ''; }
      }).then(function (v) {
        if (v === null) return null;
        return vreq('POST', '/api/vault/quota/request', { bytes: Math.round(gbIn(v.value, now, most) * GB), reason: v.text }).then(function () { toast('申請しました。開発者の承認を待っています'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'cancel') {
      ask({ title: '申請を取り下げますか？', ok: '取り下げる' }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/quota/cancel', {}).then(function () { toast('申請を取り下げました'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'approve') {
      ask({
        title: d.name + ' さんの申請を承認',
        text: '希望は ' + gb(Number(d.bytes)) + ' です。承認するには上限を決めてください（' + range + '）。上限はあとから「上限を変更」で変えられます。',
        ok: '承認する',
        input: { label: '上限（GB）', value: String(Math.min(most, Math.round(Number(d.bytes) / GB * 10) / 10)) },
        check: function (v) { return gbIn(v, free, most) === null ? range + 'の数を入れてください' : ''; }
      }).then(function (v) {
        if (v === null) return null;
        return vreq('POST', '/api/vault/quota/decide', { id: Number(d.id), approve: true, limit: Math.round(gbIn(v, free, most) * GB) }).then(function () { toast(d.name + ' さんの申請を承認しました'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'decline') {
      ask({ title: d.name + ' さんの申請を見送りますか？', text: '上限は今のままです（' + d.name + ' さんには「見送られました」と表示されます）。', ok: '見送る' }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/quota/decide', { id: Number(d.id), approve: false }).then(function () { toast('見送りました'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'limit') {
      ask({
        title: d.name + ' さんの上限を変更',
        text: '今は ' + gb(Number(d.limit)) + ' です。' + gb(pool.free) + ' を入れると標準に戻ります（' + gb(pool.free) + 'を超える分には上限が必要です）。',
        ok: '変更する',
        input: { label: '上限（GB・' + gb(pool.free) + '〜' + gb(pool.maxBytes) + '）', value: String(Math.round(Number(d.limit) / GB * 10) / 10) },
        check: function (v) { return gbIn(v, free, most, true) === null ? gb(pool.free) + '〜' + gb(pool.maxBytes) + 'の数を入れてください' : ''; }
      }).then(function (v) {
        if (v === null) return null;
        var n = gbIn(v, free, most, true);
        return vreq('POST', '/api/vault/quota/set', { user: Number(d.user), limit: n <= free ? 0 : Math.round(n * GB) }).then(function () { toast(d.name + ' さんの上限を変更しました'); return loadVault(); });
      }).catch(fail);
    }
  }
  // the open vault: whose it is, and who sees it
  function renderHead() {
    var h = $('#vault-head'), info = state.vaultInfo, sp = state.vaultSpaces;
    h.textContent = '';
    if (!state.vault || !sp) return;
    var t = el('div', 'vault-head-text');
    var look = state.developer && !state.vault.ticket ? '閲覧のみ（変更するには右上の「編集する」から開発者コード）' : '';
    if (!info) {
      if (!state.developer && !sp.spaces.length && !sp.personal) t.appendChild(el('b', '', 'ほかの運営者がいないため、共有保管庫はまだありません'));
    } else if (info.kind === 'dev') {
      h.appendChild(el('span', 'face vspace-mark', '開'));
      t.appendChild(el('b', '', '開発者専用保管庫'));
      t.appendChild(el('small', '', look || '編集できます（' + stamp(state.vault.until).slice(11, 16) + 'まで）'));
    } else if (info.kind === 'backup') {
      h.appendChild(el('span', 'face vspace-mark vspace-backup', '控'));
      t.appendChild(el('b', '', 'バックアップ'));
      t.appendChild(el('small', '', '開発者がバックアップしたファイル（どの保管庫のものも）。保管庫から削除されても、ここに残ります' + (look ? '・' + look : '')));
    } else if (info.kind === 'own') {
      var owner = info.members[0];
      h.appendChild(face(owner));
      t.appendChild(el('b', '', info.mine ? 'あなたの個人保管庫' : owner.name + ' さんの個人保管庫'));
      t.appendChild(el('small', '', info.mine ? '非公開：あなたと開発者だけが見られます' : '閲覧のみ：開発者だけが見られます（変更はできません）'));
    } else {
      var mine = sp.spaces.filter(function (x) { return x.id === info.id; })[0];
      if (mine) {
        h.appendChild(face(mine.with));
        t.appendChild(el('b', '', mine.with.name + ' さんとの共有保管庫'));
        t.appendChild(el('small', '', !mine.with.operator ? '相手は運営者ではなくなりました（見る・整理・削除はできます。新しいファイルは入れられません）'
          : '非公開：' + (state.developer || mine.with.developer ? 'ふたりだけ' : 'ふたりと開発者だけ') + 'が見られます'));
      } else {
        info.members.forEach(function (m) { h.appendChild(face(m)); });
        t.appendChild(el('b', '', info.members.map(function (m) { return m.name + ' さん'; }).join(' ⇄ ') + 'の共有保管庫'));
        t.appendChild(el('small', '', '閲覧のみ：開発者だけが見られます（アップロード・変更・削除はできません）'));
      }
    }
    // (its icon: back to the top of it)
    Array.prototype.forEach.call(h.querySelectorAll('.face'), function (x) {
      x.classList.add('vault-home');
      x.dataset.vtop = '1';
      x.title = 'いちばん上に戻る';
      x.setAttribute('role', 'button');
      x.setAttribute('aria-label', 'この保管庫のいちばん上に戻る');
    });
    h.appendChild(t);
  }
  // how much is used (the rest when the mouse is on it)
  function vaultUsage() {
    var v = state.vault, u = $('#vault-usage');
    if (!v) { u.textContent = ''; u.title = ''; return; }
    if (!state.developer && v.me) {
      u.textContent = mb(v.me.used) + ' / ' + gb(v.me.limit);
      u.title = 'あなたの使用量（共有保管庫と個人保管庫の合計）・1ファイル ' + mb(v.fileBytes) + 'まで';
      return;
    }
    u.textContent = mb(v.used) + ' / ' + mb(v.maxBytes);
    u.title = '全体の使用量（すべての保管庫の合計）・1ファイル ' + mb(v.fileBytes) + 'まで・保存先 ' + (v.store === 'bucket' ? 'R2' : 'データベース');
  }
  var thumbnailLoad = null;
  function renderVault() {
    if (!window.VaultThumbnails) {
      if (!thumbnailLoad) thumbnailLoad = OpsLoad.load('vault-thumbnails.js').then(function () { thumbnailLoad = null; renderVault(); }, function (e) { thumbnailLoad = null; fail(e); });
      return;
    }
    stopThumbnails();
    stopThumbnails();
    var open = !!state.vault, info = state.vaultInfo;
    topBar();
    renderSpeed();
    $('#vault-title').textContent = '保管庫';
    $('#vault-main').hidden = !open;
    if (open) vaultWorkspace().refresh();
    // the developer: 編集する (the code) while looking only, 閉じる while changing
    var editing = open && state.developer && !!state.vault.ticket;
    $('#vault-unlock').hidden = !open || !state.developer || editing;
    $('#vault-lock').hidden = !editing;
    $('#vault-lock').title = editing ? stamp(state.vault.until) + 'まで編集できます（閉じると閲覧のみ）' : '';
    vaultUsage();
    var list = $('#vault-list'), folders = $('#vault-folders'), path = $('#vault-path');
    list.textContent = '';
    folders.textContent = '';
    path.textContent = '';
    $('#vault-pager').textContent = '';
    renderSpaces();
    renderRoom();
    renderHead();
    if (!open) return;
    // what the open vault lets one do: put files in (not after the other one
    // left), change, links (the developer's own)
    var own = !state.vaultSpace, add = !!(info && info.add);
    $('#vault-up').hidden = !canWrite();
    $('#vault-pick-files').hidden = !add;
    $('#vault-link').hidden = !own || !info;
    var links = state.vault.all || { live: 0 };
    $('#vault-link').textContent = links.live ? 'URL（有効 ' + links.live + '）' : 'URL';
    renderMemo();
    $('#vault-filter').hidden = !own || !info;
    $('#vault-path').hidden = !info || state.vaultSpace === 'backup';
    if (!info) { renderPicked(); renderResume(); return; }
    // where it is: 保管庫 / 車 / 新車 (each a way back)
    [{ id: '', name: rootName() }].concat(trail(state.vaultFolder)).forEach(function (d, i, a) {
      if (i) path.appendChild(el('span', 'muted', '/'));
      var b = el('button', 'vault-crumb' + (i === a.length - 1 && !state.vaultIn ? ' here' : ''), d.name);
      b.type = 'button';
      b.dataset.folder = d.id;
      path.appendChild(b);
    });
    // (a file whose inside was open, gone meanwhile: where it was)
    if (state.vaultIn && !fileOf(state.vaultIn)) state.vaultIn = '';
    fileTrail(state.vaultIn).forEach(function (f, i, a) {
      path.appendChild(el('span', 'muted', '/'));
      var b = el('button', 'vault-crumb vault-crumb-file' + (i === a.length - 1 ? ' here' : ''), f.name);
      b.type = 'button';
      b.dataset.infile = f.id;
      b.title = 'ファイル「' + f.name + '」の中';
      path.appendChild(b);
    });
    var inside = state.vaultIn ? [] : foldersIn(state.vaultFolder);
    inside.forEach(function (d) { folders.appendChild(folderCard(d)); });
    // a model's light copy shows with the model; 10 to a page
    var all = listed(), show = state.vaultShow;
    var tops = all.filter(function (f) { return show === 'all' || (show === 'used') === !!f.implementedAt; });
    var pages = Math.max(1, Math.ceil(tops.length / VAULT_PAGE));
    if (state.vaultPage >= pages) state.vaultPage = pages - 1;
    if (!all.length && !inside.length) list.appendChild(el('p', 'empty muted', state.vaultIn ? 'このファイルの中はまだ空です（アップロード・ドラッグ＆ドロップ・「＋」で入れられます）' : state.vaultFolder ? 'このフォルダは空です' : 'ファイルはまだありません'));
    else if (!tops.length && all.length) list.appendChild(el('p', 'empty muted', show === 'used' ? '実装済みのファイルはありません' : '未実装のファイルはありません'));
    tops.slice(state.vaultPage * VAULT_PAGE, (state.vaultPage + 1) * VAULT_PAGE).forEach(function (f) { list.appendChild(vaultCard(f)); });
    watchThumbnails();
    renderPager(pages, tops.length);
    renderPicked();
    renderResume();
  }
  var VAULT_PAGE = 60;
  // how fast the vault goes (the developer changes it, for everyone)
  var SPEED_NOTE = { limit: '上限速：最速の2倍の量を一度に、5ファイルずつ（通信量・端末のメモリを多く使います）', max: '最速：大きな部分（R2 では 16MB）を一度にたくさん、3ファイルずつ', fast: '高速：8MB の部分を一度に多めに、2ファイルずつ', normal: '標準：8MB の部分を少しずつ、1ファイルずつ' };
  function renderSpeed() {
    var box = $('#vault-speed-box'), sp = state.vaultSpeed;
    box.hidden = !state.vault || !sp;
    if (!sp) return;
    $('#vault-speed').value = sp.id;
    $('#vault-speed').disabled = !state.developer;
    box.title = (SPEED_NOTE[sp.id] || '') + (state.developer ? '（運営者全員に反映）' : '（速さは開発者だけが変えられます）');
  }
  function setVaultSpeed(v) {
    if (!state.developer || !state.vaultSpeed) { renderSpeed(); return; }
    vreq('POST', '/api/vault/speed', { speed: v }).then(function (r) {
      state.vaultSpeed = r.speed;
      if (state.vault) state.vault.chunk = r.chunk;
      renderSpeed();
      toast('保管庫の速さ：' + r.speed.name + '（' + SPEED_NOTE[r.speed.id].replace(/^[^：]+：/, '') + '。運営者全員に反映）');
      kick();
    }, function (err) { renderSpeed(); fail(err); });
  }
  function renderPager(pages, n) {
    var box = $('#vault-pager'), at = state.vaultPage;
    box.textContent = '';
    if (pages <= 1) return;
    function go(label, page, on, off) {
      var b = el('button', 'btn small' + (on ? ' primary' : ''), label);
      b.type = 'button';
      b.dataset.page = String(page);
      b.disabled = !!off;
      box.appendChild(b);
    }
    go('‹ 前へ', at - 1, false, at === 0);
    for (var i = 0; i < pages; i++) {
      // (many pages: the first, the last and the ones around this one)
      if (pages > 9 && i > 0 && i < pages - 1 && Math.abs(i - at) > 2) {
        if (!box.lastChild.classList.contains('gap')) box.appendChild(el('span', 'gap muted', '…'));
        continue;
      }
      go(String(i + 1), i, i === at);
    }
    go('次へ ›', at + 1, false, at === pages - 1);
    box.appendChild(el('span', 'muted', fmt(n) + '件中 ' + fmt(at * VAULT_PAGE + 1) + '〜' + fmt(Math.min(n, (at + 1) * VAULT_PAGE)) + '件目'));
  }
  function lightOf(f) { return state.vaultFiles.filter(function (x) { return x.parent === f.id && x.done; })[0] || null; }
  // the picture of a model, fetched once
  function picEl(f) {
    var p = el('div', 'vault-pic');
    p.dataset.vact = 'pic';
    if (pics[f.id]) { p.style.backgroundImage = 'url("' + pics[f.id] + '")'; return p; }
    // (the medium picture: tens of KB; up to five tries, then the card)
    VaultThumbnails.attempt(function () { return vreq('GET', '/api/vault/preview?id=' + f.id); }, 5, 1000).then(function (r) {
      pics[f.id] = r.preview || cardFor(f, true);
      p.style.backgroundImage = 'url("' + pics[f.id] + '")';
    }).catch(function () { p.style.backgroundImage = 'url("' + cardFor(f, true) + '")'; });
    return p;
  }
  // a file's card, big (nothing is downloaded to show what it is)
  function cardEl(f) {
    var p = el('div', 'vault-pic');
    p.dataset.vact = 'pic';
    pics[f.id] = pics[f.id] || cardFor(f, true);
    p.style.backgroundImage = 'url("' + pics[f.id] + '")';
    return p;
  }
  function modelFacts(facts, i, light) {
    fact(facts, '3Dモデル', String(i.format || '').toUpperCase() + '・三角形 ' + fmt(i.triangles) + '・頂点 ' + fmt(i.vertices) + '・メッシュ ' + fmt(i.meshes));
    fact(facts, 'マテリアル / テクスチャ', fmt(i.materials) + ' / ' + fmt(i.textures) + (i.maxTexture ? '（最大 ' + i.maxTexture + 'px）' : ''));
    if (i.size) fact(facts, '大きさ（幅×高さ×奥行き）', i.size.join(' × '));
    if (i.animations && i.animations.length) fact(facts, 'アニメーション', i.animations.map(function (a) { return (a.name || '-') + '（' + a.seconds + '秒）'; }).join('・'));
    if (i.skinned || i.morphs) fact(facts, 'ボーン / モーフ', fmt(i.skinned) + ' / ' + fmt(i.morphs));
    if (light) fact(facts, '軽量版', mb(light.size) + '（' + light.name + '）');
  }
  // what kind of item: 3Dモデル, APK, プログラム, テキスト, 画像, 動画, 音声, 圧縮, その他 (each counts one on a page)
  var CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|php|java|kt|kts|swift|go|rs|c|h|cpp|hpp|cc|cs|dart|lua|sh|bash|zsh|bat|cmd|ps1|sql|pl|r|scala|gd|vue|svelte|html?|css|scss|less|json|ya?ml|toml|ini|xml|gradle|glsl|hlsl|shader|wgsl)$/;
  function fileKind(f) {
    var n = String(f.name || '').toLowerCase(), t = String(f.type || '');
    if (is3d(n)) return ['3Dモデル', 'k3d'];
    if (/\.(apk|aab|apks|xapk)$/.test(n) || t === 'application/vnd.android.package-archive') return ['APK', 'kapk'];
    if (CODE_EXT.test(n)) return ['プログラム', 'kcode'];
    if (/^text\//.test(t) || /\.(txt|md|csv|tsv|log)$/.test(n)) return ['テキスト', 'ktext'];
    if (/^image\//.test(t) || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/.test(n)) return ['画像', 'kimg'];
    if (/^video\//.test(t) || /\.(mp4|mov|webm|mkv|m4v)$/.test(n)) return ['動画', 'kvid'];
    if (/^audio\//.test(t) || /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/.test(n)) return ['音声', 'kaud'];
    if (/\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/.test(n)) return ['圧縮', 'kzip'];
    return ['その他', 'koth'];
  }
  function isTextual(k) { return k === 'ktext' || k === 'kcode'; }
  // a file's icon: the APK one, or the file one with its extension on it
  function fileIcon(f, kind) {
    var ext = (/\.([A-Za-z0-9]{1,6})$/.exec(f.name || '') || [])[1] || '';
    var b = kind[1] === 'kapk' ? iconEl('apk', f.name) : iconEl('file', f.name, ext.toUpperCase());
    b.classList.add('vault-thumb');
    // (every finished file: its small picture, or the card drawn here: no file is left without one)
    if (f.done) b.dataset.thumbnail = f.id;
    return b;
  }
  // The picture of each finished file in the list: its card (drawn here, no traffic) at once; then the small
  // picture the server holds for it, fetched with the others on the screen in one request and kept in this
  // browser for next time (up to five tries; the card stays if it cannot come). A file with no small
  // picture at all (an old one) keeps its card; an editor's page makes a small image's own, once.
  var thumbnails = {}, cards = {}, thumbnailObserver = null, thumbnailEpoch = 0, thumbnailFetching = 0, thumbnailWaiting = [], thumbnailTimer = 0, backfillBusy = false, backfillQueue = [];
  function stopThumbnails() {
    thumbnailEpoch++; thumbnailWaiting = []; thumbnailFetching = 0; backfillQueue = []; backfillBusy = false; clearTimeout(thumbnailTimer);
    if (thumbnailObserver) thumbnailObserver.disconnect(); thumbnailObserver = null;
  }
  function sigOf(f) { return f.size + ':' + (f.doneAt || 0); }
  function cardFor(f, big) {
    var k = (big ? 'b' : 's') + f.id;
    return cards[k] || (cards[k] = VaultThumbnails.card({ name: f.name, size: f.size, kind: fileKind(f)[1] }, !!big));
  }
  function putPicture(b, src, real) {
    var img = el('img'); img.src = src; img.alt = ''; img.draggable = false; img.decoding = 'async';
    b.replaceChildren(img); b.classList.add('has-thumbnail'); b.classList.toggle('is-card', !real);
  }
  // the small pictures of some files, from this browser's keeping or the server (one request): { id: picture }
  function fetchPictures(files) {
    var got = {}, need = [];
    return VaultThumbnails.cache.use(state.name || '').then(function () {
      return Promise.all(files.map(function (f) { return VaultThumbnails.cache.get(f.id, sigOf(f)).then(function (src) { if (src) got[f.id] = src; else need.push(f); }); }));
    }).then(function () {
      if (!need.length) return got;
      return VaultThumbnails.attempt(function () {
        return vreq('GET', '/api/vault/thumbnails?ids=' + need.map(function (f) { return f.id; }).join(',')).then(function (r) {
          need.forEach(function (f) { var src = r.thumbnails && r.thumbnails[f.id]; if (src) { got[f.id] = src; VaultThumbnails.cache.put(f.id, sigOf(f), src); } });
        });
      }, 5, 1000).then(function () { return got; }, function () { return got; });
    });
  }
  function watchThumbnails() {
    var epoch = thumbnailEpoch;
    function see(b) {
      var f = fileOf(b.dataset.thumbnail);
      if (!f || epoch !== thumbnailEpoch) return;
      if (thumbnails[f.id]) { putPicture(b, thumbnails[f.id], true); return; }
      // (a file the server has a picture of: nothing is drawn while it comes, the card is only for a picture that cannot come; drawing a card
      // for each one first — a canvas, a text and a webp, thrown away a moment later — was most of what opening the list cost)
      if (f.thumbnail) { b.classList.add('is-wait'); thumbnailWaiting.push(b); clearTimeout(thumbnailTimer); thumbnailTimer = setTimeout(flush, 30); return; }
      putPicture(b, cardFor(f), false);
      if (canWrite() && fileKind(f)[1] === 'kimg' && f.size <= 256 * 1024) backfill(b, f);
    }
    function flush() {
      if (epoch !== thumbnailEpoch || thumbnailFetching >= 2 || !thumbnailWaiting.length) return;
      var batch = thumbnailWaiting.splice(0, 12).filter(function (b) { return b.isConnected; });
      var files = batch.map(function (b) { return fileOf(b.dataset.thumbnail); }).filter(Boolean);
      if (!files.length) { flush(); return; }
      thumbnailFetching++;
      fetchPictures(files).then(function (got) {
        if (epoch !== thumbnailEpoch) return;
        batch.forEach(function (b) {
          var f = fileOf(b.dataset.thumbnail);
          if (!f || !b.isConnected) return;
          b.classList.remove('is-wait');
          if (got[f.id]) { thumbnails[f.id] = got[f.id]; putPicture(b, got[f.id], true); }
          else putPicture(b, cardFor(f), false);
        });
      }).catch(function () {}).then(function () { if (epoch !== thumbnailEpoch) return; thumbnailFetching--; flush(); });
      flush();
    }
    // an old small image with no small picture yet: made here from the file (small enough to be cheap), kept on the server
    function backfill(b, f) {
      backfillQueue.push([b, f]);
      if (backfillBusy) return;
      backfillBusy = true;
      (function next() {
        var item = backfillQueue.shift();
        if (!item || epoch !== thumbnailEpoch) { backfillBusy = false; return; }
        fetchFile(item[1], null).then(function (blob) { return VaultThumbnails.fromFile(new File([blob], item[1].name, { type: item[1].type || '' }), 'kimg'); }).then(function (p) {
          if (!p.thumbnail || p.card) return null;
          thumbnails[item[1].id] = p.thumbnail;
          if (item[0].isConnected) putPicture(item[0], p.thumbnail, true);
          return vreq('POST', '/api/vault/meta', { id: item[1].id, thumbnail: p.thumbnail, preview: p.preview }).then(function () { item[1].thumbnail = true; item[1].preview = true; });
        }).catch(function () {}).then(next);
      })();
    }
    if (window.IntersectionObserver) thumbnailObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) { thumbnailObserver.unobserve(entry.target); see(entry.target); } });
    }, { root: $('#view-vault'), rootMargin: '100px' });
    document.querySelectorAll('#vault-list [data-thumbnail]').forEach(function (b) { if (thumbnailObserver) thumbnailObserver.observe(b); else see(b); });
  }
  // the beginning of a text or a program (its first piece), fetched once
  var texts = {};
  function textEl(f) {
    var p = el('pre', 'vault-text', '読み込み中…');
    if (texts[f.id] !== undefined) { p.textContent = texts[f.id]; return p; }
    // (the first 8KB only: a whole piece, up to 16MB, was fetched for twelve hundred characters)
    vreq('GET', '/api/vault/chunk?id=' + f.id + '&n=0&raw=1&head=8192', undefined, 'bytes').then(function (r) {
      var s = new TextDecoder().decode(r.bytes);
      texts[f.id] = Array.from(s).length > 1200 ? Array.from(s).slice(0, 1200).join('') + '\n…（続きはアイコンをタップ）' : s;
      p.textContent = texts[f.id];
    }).catch(function () { p.textContent = '（読み込めませんでした）'; });
    return p;
  }
  // an image (small ones), fetched once
  function imageEl(f) {
    var p = el('div', 'vault-pic');
    p.dataset.vact = 'pic';
    if (pics[f.id]) { p.style.backgroundImage = 'url("' + pics[f.id] + '")'; return p; }
    fetchFile(f, null).then(function (blob) {
      pics[f.id] = URL.createObjectURL(new Blob([blob], { type: f.type || 'image/png' }));
      p.style.backgroundImage = 'url("' + pics[f.id] + '")';
    }).catch(function () {});
    return p;
  }

  /* comments on a file: the operators', the developer's and an AI's (from
     its link), each for a day, 3, 7, 30 or with no end */
  var commentsFor = null;
  function openComments(f) {
    vaultWorkspace().open('comments:' + f.id, 'コメント：' + f.name, {
      show: function (pane) {
        var changing = commentsFor !== f.id, draft = commentDrafts[f.id] || { text: '', days: '0' };
        commentsFor = f.id; var box = $('#vcomments'); if (box.parentNode !== pane) pane.appendChild(box); box.hidden = false;
        box.querySelector('.viewer').setAttribute('role', 'region');
        if (changing) { $('#vcomments-text').value = draft.text; $('#vcomments-days').value = draft.days; }
        renderComments();
        if (!fullOf(f)) loadFull(f).then(function () { if (commentsFor === f.id) renderComments(); }, fail);
      },
      hide: function () {
        if (commentsFor !== f.id) return;
        commentDrafts[f.id] = { text: $('#vcomments-text').value, days: $('#vcomments-days').value };
        commentsFor = null; var box = $('#vcomments'); box.hidden = true; $('#app').appendChild(box);
      }, close: function () { delete commentDrafts[f.id]; }
    });
  }
  function closeComments() {
    if (vaultWork && commentsFor) { vaultWork.close('comments:' + commentsFor); return; }
    commentsFor = null; $('#vcomments').hidden = true;
  }
  function renderComments() {
    var f = fileOf(commentsFor);
    if (!f) { closeComments(); return; }
    var full = fullOf(f);
    if (!full && f.noteCount && commentsFor) loadFull(f).then(function () { if (commentsFor === f.id) renderComments(); }, function () {});
    f = full || f;
    $('#vcomments-name').textContent = f.name;
    $('#vcomments-note').textContent = !f.space ? 'URLを知っている人にも、期限まで表示されます' : f.space === 'backup' ? '' : 'この保管庫を使う人と開発者に見えます';
    $('#vcomments-form').hidden = !canWrite() || state.vaultSpace === 'backup';
    var list = $('#vcomments-list');
    list.textContent = '';
    if (!full && f.noteCount) list.appendChild(el('p', 'muted vcomments-empty', '読み込み中…'));
    else if (!(f.notes || []).length) list.appendChild(el('p', 'muted vcomments-empty', 'コメントはまだありません'));
    (f.notes || []).forEach(function (n) {
      var over = n.until && n.until <= Date.now(), ai = n.by && n.by.ai;
      var row = el('div', 'vcomment' + (over ? ' over' : '') + (ai ? ' ai' : ''));
      var head = el('div', 'vcomment-head');
      if (ai) head.appendChild(el('span', 'tag vai', 'AI'));
      else head.appendChild(el('b', '', n.by ? n.by.name : '?'));
      head.appendChild(el('small', '', date(n.at, true) + (n.until ? (over ? '・期限切れ' + (f.space ? '' : '（AIには見えません）') : '・' + date(n.until, true) + 'まで') : '')));
      if (canWrite() && state.vaultSpace !== 'backup') {
        var x = el('button', 'vnote-del', '×');
        x.type = 'button';
        x.title = 'このコメントを削除';
        x.dataset.note = n.id;
        head.appendChild(x);
      }
      row.appendChild(head);
      row.appendChild(el('p', 'vcomment-text', n.text));
      list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
  }
  function sendComment(e) {
    e.preventDefault();
    var f = fileOf(commentsFor), t = $('#vcomments-text'), text = t.value.trim();
    if (!f || !text) return;
    vreq('POST', '/api/vault/notes', { id: f.id, text: text, days: Number($('#vcomments-days').value) }).then(function () {
      if (commentsFor === f.id && t.value.trim() === text) t.value = '';
      else if (commentDrafts[f.id] && commentDrafts[f.id].text.trim() === text) commentDrafts[f.id].text = '';
      return loadVault();
    }).catch(fail);
  }
  function onComments(e) {
    var x = e.target.closest('[data-note]');
    if (!x) return;
    ask({ title: '本当に削除しますか？', text: 'このコメントを削除します：\n' + x.closest('.vcomment').querySelector('.vcomment-text').textContent, ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/notes/delete', { note: Number(x.dataset.note) }).then(function () { toast('削除しました'); return loadVault(); });
    }).catch(fail);
  }

  /* making things here (the ＋): a folder, a file of any kind written here,
     files with a memo on them */
  var TEXT_TYPES = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', xml: 'application/xml', py: 'text/x-python', sh: 'application/x-sh' };
  function newFile() {
    ask({
      title: 'ファイルを作る', text: (state.vaultIn ? 'ファイル「' + (fileOf(state.vaultIn) || { name: '' }).name + '」の中' : '「' + pathName(state.vaultFolder) + '」') + 'に保存します。名前に拡張子を付けると、その種類のファイルになります（例：memo.txt・main.py・index.html）。', ok: '保存する',
      input: { label: '名前（拡張子つき）', type: 'text' }, area: { label: '中身' },
      check: function (v) { return v.trim() ? '' : '名前を入れてください'; }
    }).then(function (v) {
      if (v === null) return null;
      if (!v.text.length) { toast('中身を書いてください'); return null; }
      var name = v.value.trim();
      if (!/\.[A-Za-z0-9]{1,10}$/.test(name)) name += '.txt';
      var ext = name.split('.').pop().toLowerCase();
      return queueFile(new File([v.text], name, { type: TEXT_TYPES[ext] || 'text/plain' }), { note: '', folder: state.vaultFolder, inside: state.vaultIn, space: state.vaultSpace });
    }).catch(fail);
  }
  // a memo on the next files picked
  function memoUpload() {
    ask({ title: 'メモを付けてアップロード', text: '次に選ぶファイルに、このメモが付きます（詳細に表示されます）。', ok: 'ファイルを選ぶ', input: { label: 'メモ（500文字まで）', type: 'text', value: state.vaultMemo || '' } }).then(function (v) {
      if (v === null) return;
      state.vaultMemo = Array.from(v.trim()).slice(0, 500).join('');
      renderMemo();
      $('#vault-file').click();
    });
  }
  function renderMemo() {
    var m = $('#vault-memo');
    m.hidden = !state.vaultMemo;
    m.textContent = state.vaultMemo ? 'メモ「' + state.vaultMemo + '」を次のアップロードに付けます（タップで取り消し）' : '';
  }
  function plusMenu() {
    var info = state.vaultInfo, items = state.vaultIn ? [] : [['フォルダを作る', 'folder']];
    if (info && info.add) items.push(['ファイルを作る（テキスト・プログラム）', 'file'], ['メモを付けてアップロード', 'memo']);
    menuAt($('#vault-plus'), items, function (a) {
      if (a === 'folder') newFolder();
      else if (a === 'file') newFile();
      else if (a === 'memo') memoUpload();
    });
  }
  // How an address is shown to be shared: the page for people (the secret after the #, which no browser sends anywhere) and the one
  // for an AI or a program (JSON; the same secret). Each is a way to reach the same link, which can look, take and comment, nothing else.
  function linkURLs(path) {
    var t = (/[?&]t=([\w-]+)/.exec(path) || [])[1] || '';
    return { page: location.origin + '/link/#' + t, api: location.origin + path };
  }
  // an address just issued, or one issued before: the page's, or the AI's, to copy
  function showIssuedVaultLink(link, title) {
    var u = linkURLs(link.path);
    ask({
      title: title || (link.file === '*' ? '保管庫全体' : link.folder ? 'フォルダ：' + link.name : 'ファイル：' + link.name) + 'のURL',
      text: '有効期限：' + stamp(link.until) + '。このURLを知っている人は、人でも AI でも、見る・ダウンロードする・コメントを書く（150文字まで）ことだけができます。用が済んだらURL確認から停止してください。AI には「このURLを開いて how の説明どおりに使い、作業したらコメントで知らせて」と伝えてください（AI が使うのは下の「AI・プログラム用」です）。',
      input: { label: '共有URL（ここだけコピーできます）', value: u.page }, shareURL: true,
      select: { label: 'どちらを共有しますか', options: [{ value: 'page', label: '人が開くページ' }, { value: 'api', label: 'AI・プログラム用（JSON）' }], value: 'page', change: function (v, input) { input.value = v === 'api' ? u.api : u.page; } },
      ok: '閉じる'
    });
  }
  // The URL tab: every address that works (and what ended in the last days), with what each has done, to look at, copy and stop
  // one by one or all together.
  function openVaultLinks() {
    if (!canWrite()) { toast('URLを見るには「編集する」から開発者コードを入力してください'); return; }
    vaultWorkspace().open('links', 'URL確認', { show: drawLinks });
  }
  function leftText(ms) {
    var m = Math.max(0, Math.floor(ms / 60000));
    return m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60 ? (m % 60) + '分' : '') : m + '分';
  }
  function drawLinks(pane) {
    pane.replaceChildren(el('p', 'muted', 'URLを読み込み中…'));
    vreq('GET', '/api/vault/links').then(function (r) {
      if (!pane.isConnected || !state.developer) return;
      var now = r.now || Date.now(), live = r.links.filter(function (l) { return l.state === 'live'; }), ended = r.links.filter(function (l) { return l.state !== 'live'; });
      pane.replaceChildren();
      pane.appendChild(el('h3', '', 'URL確認（有効 ' + live.length + ' 本）'));
      pane.appendChild(el('p', 'hint muted', '発行したURLを知っている人は、人でも AI でも、見る・ダウンロードする・コメントを書くことだけができます（ファイルは変えられません）。有効時間は 1〜48 時間。あまりに多くの場所から使われたURLは自動で止まります。'));
      var bar = el('div', 'vault-tab-actions');
      function btn(text, cls, fn) { var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b); return b; }
      btn('保管庫全体のURLを発行', 'primary', function () { makeLink(null); });
      btn('更新', '', function () { drawLinks(pane); });
      var showSel = btn('選んだURLを表示・コピー', '', function () { shareMany(chosen()); });
      var stopSel = btn('選んだURLを停止', 'danger', function () { stopLinks(chosen(), pane); });
      btn('有効なURLをすべて停止', 'danger', function () { stopLinks(live, pane); });
      pane.appendChild(bar);
      var rows = [];
      function chosen() { return rows.filter(function (x) { return x.pick.checked; }).map(function (x) { return x.link; }); }
      function sync() { var n = chosen().length; showSel.disabled = stopSel.disabled = !n; all.checked = !!n && n === rows.length; all.indeterminate = n > 0 && n < rows.length; }
      var allLabel = el('label', 'links-all'), all = el('input');
      all.type = 'checkbox'; allLabel.appendChild(all); allLabel.appendChild(el('span', '', 'すべて選ぶ'));
      all.addEventListener('change', function () { rows.forEach(function (x) { x.pick.checked = all.checked; }); sync(); });
      if (live.length) pane.appendChild(allLabel); else pane.appendChild(el('p', 'muted', '有効なURLはありません（ファイルの「⋯」→「URLを発行」で作れます）'));
      live.forEach(function (l) {
        var row = el('article', 'card vault-issued-link'), head = el('label', 'links-title'), pick = el('input');
        pick.type = 'checkbox'; pick.addEventListener('change', sync);
        head.appendChild(pick); head.appendChild(el('b', '', l.file === '*' ? '保管庫全体' : l.folder ? 'フォルダ：' + l.name : l.name));
        head.appendChild(el('small', 'muted', l.file === '*' ? 'すべてのファイル' : 'このファイルだけ'));
        row.appendChild(head);
        var total = Math.max(1, l.until - l.createdAt), life = el('div', 'links-life'), fill = el('i');
        fill.style.width = Math.max(2, Math.min(100, (l.until - now) / total * 100)).toFixed(1) + '%';
        life.appendChild(fill); row.appendChild(life);
        row.appendChild(el('small', 'muted', 'あと ' + leftText(l.until - now) + '（' + stamp(l.until).slice(5, 16) + ' まで）・取得 ' + fmt(l.uses) + '回・取り出し ' + mb(l.bytesUsed || 0) + ' / ' + mb(l.maxBytes || 0)
          + '・使われた場所 ' + l.places + ' / ' + (l.placesMax + 1) + '・' + (l.lastAt ? '最後に使われたのは ' + ago(l.lastAt) : 'まだ使われていません')));
        var acts = el('div', 'vault-tab-actions');
        var view = el('button', 'btn small primary', l.path ? 'URLを表示・コピー' : 'URLを作り直す'); view.type = 'button';
        view.addEventListener('click', function () {
          if (l.path) { showIssuedVaultLink(l); return; }
          var file = l.file === '*' ? null : fileOf(l.file);
          if (l.file !== '*' && !file) { toast('ファイルが見つかりません。一覧を更新してください'); return; }
          makeLink(file);
        });
        var stop = el('button', 'btn small danger', '停止'); stop.type = 'button';
        stop.addEventListener('click', function () { stopLinks([l], pane); });
        acts.appendChild(view); acts.appendChild(stop); row.appendChild(acts);
        if (!l.path) row.appendChild(el('p', 'muted', '以前の方式で発行したURLは復元できません。作り直すと、この一覧から再コピーできます。'));
        rows.push({ link: l, pick: pick });
        pane.appendChild(row);
      });
      sync();
      if (ended.length) {
        var d = el('details', 'links-ended');
        d.appendChild(el('summary', '', '最近終わったURL（' + ended.length + ' 本・3日分）'));
        ended.forEach(function (l) {
          d.appendChild(el('p', 'muted', (l.file === '*' ? '保管庫全体' : l.name) + '・' + (l.state === 'stopped' ? '停止（または使われすぎて自動停止）' : '期限切れ') + '・' + stamp(l.until).slice(5, 16) + '・取得 ' + fmt(l.uses) + '回・場所 ' + l.places));
        });
        pane.appendChild(d);
      }
    }).catch(function (err) { if (pane.isConnected) pane.replaceChildren(el('p', 'error', (err && err.message) || 'URLを読み込めませんでした')); });
  }
  // several addresses at once, to copy (the page's and the AI's of each)
  function shareMany(list) {
    if (!list.length) return;
    var lines = [];
    list.forEach(function (l) {
      if (!l.path) return;
      var u = linkURLs(l.path);
      lines.push('【' + (l.file === '*' ? '保管庫全体' : l.name) + '】' + stamp(l.until).slice(5, 16) + ' まで', '人が開くページ: ' + u.page, 'AI・プログラム用: ' + u.api, '');
    });
    ask({ title: list.length + '本のURL', text: '選んだURLです。このURLを知っている人は、見る・ダウンロードする・コメントを書くことだけができます。', area: { label: '共有URL（ここだけコピーできます）', value: lines.join('\n').trim() }, shareArea: true, ok: '閉じる' });
  }
  function stopLinks(list, pane) {
    if (!list.length) { toast('停止するURLがありません'); return; }
    ask({ title: list.length + '本のURLを停止しますか？', text: '停止したURLは、すぐに使えなくなります（元に戻せません。必要なら新しく発行してください）。', ok: '停止する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/link/stop', { links: list.map(function (l) { return l.id; }) }).then(function (r) { toast('URLを停止しました（' + r.stopped + '本）'); loadVault(); drawLinks(pane); });
    }).catch(fail);
  }

  // what an AI did with a file, newest first
  var LABEL_KINDS = { download: ['AIが取得', 'k-get'], ai: ['AIのラベル', 'k-ai'], implemented: ['実装済み', 'k-done'], restore: ['戻した', 'k-back'] };
  function labelsEl(f) {
    var box = el('div', 'vault-labels');
    (f.labels || []).slice().reverse().forEach(function (l) {
      var k = LABEL_KINDS[l.kind] || [l.kind, ''];
      var c = el('span', 'vlabel ' + k[1]);
      c.title = l.text;
      c.appendChild(el('i', '', k[0]));
      c.appendChild(el('span', '', l.text));
      c.appendChild(el('small', '', date(l.at, true)));
      box.appendChild(c);
    });
    return box;
  }
  // where a file of the backups is
  function whereOf(f) {
    return f.backup && f.backup.removed ? '削除済み（元：' + f.backup.removed.where + '）' : f.where || '保管庫';
  }
  // a file's 💬: how many comments
  function commentBtn(f) {
    var n = f.noteCount !== undefined ? f.noteCount : (f.notes || []).length;
    var b = el('button', 'vbtn vcomment-btn' + (n ? ' has' : ''));
    b.type = 'button';
    b.dataset.vact = 'comments';
    b.title = 'コメント';
    b.setAttribute('aria-label', 'コメント' + (n ? '（' + n + '件）' : ''));
    b.appendChild(el('span', 'vcomment-ic', '💬'));
    if (n) b.appendChild(el('b', '', String(n)));
    return b;
  }
  function vaultCard(f) {
    var kind = fileKind(f), inBackups = state.vaultSpace === 'backup';
    var row = el('article', 'vitem vault-card' + (f.done ? '' : ' undone') + (f.implementedAt ? ' used' : '') + (state.vaultPicked[f.id] ? ' picked' : '') + (shown[f.id] ? ' open' : ''));
    row.dataset.file = f.id;
    row.appendChild(checkEl(f.id, f.name));
    row.appendChild(fileIcon(f, kind));
    var main = el('div', 'vitem-main');
    main.appendChild(el('b', 'vault-name', f.name));
    var who = f.by && (inBackups || (state.vaultInfo && state.vaultInfo.kind === 'pair')) ? '・' + f.by.name : '';
    var summary = el('small', 'vitem-sub', kind[0] + '・' + mb(f.size) + who);
    summary.title = '送信日時：' + stamp(f.createdAt); main.appendChild(summary);
    var tags = el('div', 'vitem-tags');
    if (!f.done) tags.appendChild(el('span', 'kind bug', 'アップロード途中 ' + f.received + '/' + f.chunks));
    if (f.implementedAt) tags.appendChild(el('span', 'kind used', '実装済み'));
    if (f.backup) {
      var b = el('span', 'kind vbackup', f.backup.removed ? 'バックアップのみ' : 'バックアップ');
      b.title = '開発者がバックアップ（' + date(f.backup.at, true) + '）';
      tags.appendChild(b);
    }
    if (inBackups) tags.appendChild(el('span', 'kind vwhere', whereOf(f)));
    var held = inBackups ? 0 : inFile(f.id).length;
    if (held) {
      var hb = el('button', 'kind vinside', '中のファイル ' + fmt(held) + '件');
      hb.type = 'button';
      hb.dataset.vact = 'inside';
      hb.title = '「' + f.name + '」の中を開く';
      tags.appendChild(hb);
    }
    if (!f.space && f.links && f.links.live) tags.appendChild(el('span', 'kind vlink', 'リンク有効'));
    if (tags.childNodes.length) main.appendChild(tags);
    row.appendChild(main);
    var acts = el('div', 'vitem-acts');
    acts.appendChild(commentBtn(f));
    var d = el('button', 'vbtn vdetail' + (shown[f.id] ? ' on' : ''), '詳細');
    d.type = 'button';
    d.dataset.vact = 'details';
    d.setAttribute('aria-expanded', shown[f.id] ? 'true' : 'false');
    acts.appendChild(d);
    acts.appendChild(moreBtn(f.name));
    row.appendChild(acts);

    return row;
  }
  // A file's 詳細: everything about it, asked for when it opens (the list is
  // light), and kept while the list is the same.
  var fulls = {};
  function fullOf(f) {
    var c = fulls[f.id];
    return c && c.rev === state.vaultRev.files ? c.file : null;
  }
  function loadFull(f) {
    var rev = state.vaultRev.files;
    return vreq('GET', '/api/vault/file?id=' + f.id).then(function (r) {
      fulls[f.id] = { rev: rev, file: r.file };
      return r.file;
    });
  }
  // one card drawn again (its 詳細 in)
  function redrawCard(id) {
    var row = document.querySelector('#vault-list [data-file="' + id + '"]'), f = fileOf(id);
    if (row && f) { stopThumbnails(); row.replaceWith(vaultCard(f)); watchThumbnails(); }
    if (vaultWork) vaultWork.render('details:' + id);
  }
  function detailsEl(f, kind) {
    var full = fullOf(f);
    if (!full) {
      var wait = el('div', 'vitem-detail loading', '詳細を読み込み中…');
      loadFull(f).then(function () { redrawCard(f.id); }, function (err) { wait.textContent = '詳細を読み込めませんでした：' + ((err && err.message) || ''); });
      return wait;
    }
    f = full;
    var box = el('div', 'vitem-detail'), light = lightOf(f);
    var body = el('div', 'vault-body');
    if (f.preview) body.appendChild(picEl(f));
    else if (f.done && kind[1] === 'kimg' && f.size <= 256 * 1024) body.appendChild(imageEl(f));
    else if (f.done) body.appendChild(cardEl(f));
    var facts = el('div', 'facts');
    fact(facts, '送信日時', stamp(f.createdAt));
    fact(facts, '保存完了', f.done ? stamp(f.doneAt) : '送信中');
    if (f.by) fact(facts, '送った人', f.by.name);
    if (state.vaultSpace === 'backup') fact(facts, '場所', whereOf(f));
    if (f.implementedAt) fact(facts, '実装済みになった日時', stamp(f.implementedAt));
    if (f.info) modelFacts(facts, f.info, light);
    fact(facts, '大きさ', mb(f.size) + '（' + fmt(f.size) + 'バイト）');
    fact(facts, '種類', kind[0] + (f.type ? '（' + f.type + '）' : ''));
    fact(facts, 'SHA-256（部分ごとのハッシュの並び）', f.sha256 || '-');
    if (!f.space) {
      fact(facts, 'リンク', f.links.live ? f.links.live + '本 有効（' + stamp(f.links.until) + 'まで）' : 'なし');
      fact(facts, 'リンクからの取得', fmt(f.links.uses) + '回');
    }
    if (f.note) fact(facts, 'メモ', f.note);
    if (f.backup) {
      fact(facts, 'バックアップ', date(f.backup.at, true) + '（' + f.backup.by.name + '）');
      if (f.backup.removed) fact(facts, '保管庫から削除', date(f.backup.removed.at, true) + '（' + f.backup.removed.by.name + '・元：' + f.backup.removed.where + '）');
    }
    body.appendChild(facts);
    box.appendChild(body);
    if (f.done && isTextual(kind[1])) box.appendChild(textEl(f));
    box.appendChild(labelsEl(f));
    return box;
  }
  // progress of one upload or download
  function job(name) {
    var card = el('article', 'card job');
    card.appendChild(el('b', '', name));
    var bar = el('div', 'bar'), fill = el('i');
    bar.appendChild(fill);
    card.appendChild(bar);
    var note = el('span', 'muted', '準備中…');
    card.appendChild(note);
    $('#vault-jobs').insertBefore(card, $('#vault-jobs').firstChild);
    moving++;
    var over = false;
    function end() { if (!over) { over = true; moving--; } }
    return {
      set: function (d, t) {
        var p = t ? d / t * 100 : 0;
        fill.style.width = p.toFixed(1) + '%';
        note.textContent = d + ' / ' + t + '（' + Math.round(p) + '%）';
      },
      finish: function (msg) { end(); fill.style.width = '100%'; card.classList.add('ok'); note.textContent = msg; setTimeout(function () { card.remove(); }, 20000); },
      fail: function (msg) { end(); card.classList.add('bad'); note.textContent = msg; },
      pause: function (msg) { end(); card.classList.add('paused'); note.textContent = msg; setTimeout(function () { card.remove(); }, 15000); }
    };
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function sha(buf) { return crypto.subtle.digest('SHA-256', buf); }
  function base64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function later(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // four pieces at a time; a piece that fails is tried again (3 times)
  function pieces(todo, one) {
    var queue = todo.slice(), failed = null;
    function run(n, tries) {
      return one(n).catch(function (err) {
        if (tries < 3 && err.code !== 'vault_locked' && err.status !== 413 && err.status !== 404) return later(1500 * (tries + 1)).then(function () { return run(n, tries + 1); });
        throw err;
      });
    }
    function worker() {
      if (failed || !queue.length) return Promise.resolve();
      return run(queue.shift(), 0).then(worker, function (err) { failed = err; });
    }
    return Promise.all([worker(), worker(), worker(), worker()]).then(function () { if (failed) throw failed; });
  }
  /* ------------------------------------------------------------ uploads --- */
  /* The files go up on their own (ops/vault-upload.js): in the site's
     background worker (ops/ops-sw.js) where there is one, so they go on with
     the vault closed and with this page closed; else here. Each one waits in
     this browser with its upload's own pass, and is shown here while it goes:
     a stopped one (the connection, the server busy, the room) goes on by
     itself, and 「再開」 sends every stopped one again at once. */
  var up = { mode: '', reg: null, engine: null, jobs: {}, cards: {}, mem: {}, checking: {}, ready: null };
  var UP_WHY = {
    net: '通信が切れたか、サーバーが混み合っています。自動で何度でも続きから送ります',
    locked: 'アップロードの許可（1週間）が切れました。「編集する」で開発者コードを入れると、自動で続きを送ります',
    login: 'ログインが切れました。ログインし直すと、自動で続きを送ります',
    full: '保管庫がいっぱいです。空きができしだい送ります',
    room: 'あなたの容量の上限です。開発者の承認か空きができしだい送ります（「容量を申請」から申請できます）',
    gone: 'このファイルは保管庫から削除されました',
    restart: '',
    gave_up: '最初から5回、10秒おきに自動でやり直しましたが送れませんでした。通信などを確かめて「再開」を押してください（通信が戻ると自動でもう一度やり直します）',
    blocked: '',
    error: ''
  };
  // the stopped ones that go again by themselves (ops/vault-upload.js)
  var AGAIN_WHY = { net: 1, error: 1, login: 1, locked: 1, restart: 1 };
  function upInit() {
    var page = function () {
      up.mode = 'page';
      up.engine = VaultUploads.engine({ tell: onJob, mine: function () { return true; }, file: function (key) { return up.mem[key] || null; } });
      return 'page';
    };
    if ('serviceWorker' in navigator && window.isSecureContext && window.indexedDB) {
      navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'vault-upload') onJob(e.data.job); });
      up.ready = navigator.serviceWorker.register('/ops/ops-sw.js', { scope: '/ops/' }).then(function (reg) {
        up.reg = reg;
        return activeOf(reg);
      }).then(function () {
        up.mode = 'sw';
        // (a file only this page holds: sent from here)
        up.engine = VaultUploads.engine({ tell: onJob, mine: function (j) { return !!j.mem; }, file: function (key) { return up.mem[key] || null; } });
        return 'sw';
      }, page);
    } else up.ready = Promise.resolve(window.indexedDB ? page() : 'none');
    up.ready.then(function () { refreshJobs().then(adoptJobs); kick(); });
  }
  // This account's files waiting here with no pass (logging out took it, or it
  // ran out, or the file never got its place) get one now that they are in
  // again; the ones stopped for the login go at once. A file sends only its own
  // pass (ops/vault-upload.js): no login is kept with it.
  function adoptJobs() {
    if (!window.indexedDB || !ctx.token()) return Promise.resolve();
    var me = state.name;
    return VaultUploads.all().then(function (list) {
      return Promise.all(list.filter(function (j) { return j.who === me && j.state !== 'done' && !j.mem && (!j.pass || (j.state === 'stop' && j.why === 'login')); }).map(function (j) {
        j.tries = 0;
        j.next = 0;
        return j.id ? passFor(j) : place(j);
      }));
    }).then(wakeJobs, wakeJobs);
  }
  // logging out: the pass kept with this account's files here goes too (they wait for the next login)
  function dropLogin(me) {
    if (!window.indexedDB) return Promise.resolve();
    return VaultUploads.all().then(function (list) {
      return Promise.all(list.filter(function (j) { return j.who === me && j.pass; }).map(function (j) { j.pass = ''; return VaultUploads.save(j); }));
    }).catch(function () {});
  }
  // now, not later: every stopped file that goes again by itself
  function wakeJobs() {
    if (!up.ready) return;
    up.ready.then(function (mode) {
      if (mode === 'sw' && up.reg && up.reg.active) up.reg.active.postMessage({ type: 'wake' });
      if (up.engine && (mode === 'page' || Object.keys(up.mem).length)) up.engine.wake();
    });
  }
  // the developer code in again: the files whose pass ran out get a new one and go on
  function renewPasses() {
    Object.keys(up.jobs).forEach(function (k) {
      var j = up.jobs[k];
      if (j.id && j.state === 'stop' && j.why === 'locked') passFor(j).then(kick);
    });
  }
  function activeOf(reg) {
    return new Promise(function (ok, no) {
      var w = reg.active || reg.waiting || reg.installing;
      if (!w) { no(new Error('no worker')); return; }
      if (w.state === 'activated') { ok(w); return; }
      w.addEventListener('statechange', function () { if (w.state === 'activated') ok(w); else if (w.state === 'redundant') no(new Error('redundant')); });
    });
  }
  // the files go (whichever runs them)
  function kick() {
    if (!up.ready) return;
    up.ready.then(function (mode) {
      if (mode === 'sw' && up.reg && up.reg.active) up.reg.active.postMessage({ type: 'kick' });
      if (up.engine && (mode === 'page' || Object.keys(up.mem).length)) up.engine.run();
    });
  }
  // what waits in this browser, shown (this account's only; finished ones go after a while)
  function refreshJobs() {
    if (!window.indexedDB) return Promise.resolve();
    return VaultUploads.all().then(function (list) {
      list.forEach(function (j) { if (j.who === state.name) onJob(j); });
    }, function () {});
  }
  function upMine(j) { return j && j.who === state.name; }
  function onJob(j) {
    if (!upMine(j)) return;
    var was = up.jobs[j.key];
    up.jobs[j.key] = j;
    renderJob(j);
    if (j.state === 'done' && (!was || was.state !== 'done')) jobDone(j);
    renderResume();
  }
  function jobText(j) {
    var p = j.chunks ? Math.round(j.sent / j.chunks * 100) : 0;
    if (j.state === 'done') return '保存しました' + (j.sha256 ? '（SHA-256 ' + String(j.sha256).slice(0, 16) + '…）' : '');
    if (j.state === 'run' && j.retry) return '通信が途切れたので、すぐに送り直しています…（' + p + '% 送信済み・' + j.retry + '回目）';
    if (j.state === 'run') return '送信中… ' + mb(Math.min(j.size, j.sent * (j.piece || 0))) + ' / ' + mb(j.size) + '（' + p + '%）' + (j.rate ? '・' + mb(j.rate) + '/秒' : '');
    // (held for the checks a deployment puts in front of the sending: ops/ext.js)
    if (j.state === 'wait' && j.hold) return '準備中…' + (j.prep ? ' ' + j.prep + '%' : '') + '（' + mb(j.size) + '）';
    if (j.state === 'wait') return '順番待ち（' + mb(j.size) + '）';
    var why = UP_WHY[j.why] || '';
    if (j.state === 'fail') return 'できませんでした：' + (j.message || why || 'もう一度ファイルを選んでください');
    // (sent again from its very beginning by itself: which time it is, and when)
    if (j.why === 'restart') {
      var left = j.next ? Math.max(0, Math.ceil((j.next - Date.now()) / 1000)) : 0;
      return '止まりました：' + (j.message ? j.message + '・' : '') + '最初から自動でやり直します（' + (j.restarts || 1) + ' / 5 回目・' + (left ? left + '秒後' : 'まもなく') + '）';
    }
    // (when it goes again by itself)
    var wait = j.next ? Math.max(0, Math.ceil((j.next - Date.now()) / 1000)) : 0;
    var again = AGAIN_WHY[j.why] ? (wait ? '・' + (wait >= 60 ? Math.ceil(wait / 60) + '分' : wait + '秒') + '後に自動で再開' : '・自動で再開中') : '';
    return '止まりました：' + (j.why === 'error' || !why ? (j.message || 'もう一度「再開」を押してください') : why) + (j.chunks ? '（' + p + '% 送信済み' + again + '）' : again ? '（' + again.slice(1) + '）' : '');
  }
  function renderJob(j) {
    var c = up.cards[j.key];
    if (!c) {
      var card = el('article', 'card job up-job');
      var head = el('div', 'up-job-head');
      head.appendChild(el('b', '', j.name + (j.parent ? '（軽量版）' : '')));
      var x = el('button', 'btn small ghost', 'やめる');
      x.type = 'button';
      x.dataset.upCancel = j.key;
      head.appendChild(x);
      card.appendChild(head);
      var bar = el('div', 'bar'), fill = el('i');
      bar.appendChild(fill);
      card.appendChild(bar);
      var note = el('span', 'muted');
      card.appendChild(note);
      $('#vault-jobs').insertBefore(card, $('#vault-jobs').firstChild);
      c = up.cards[j.key] = { card: card, fill: fill, note: note, x: x };
    }
    var p = j.state === 'done' ? 100 : j.chunks ? j.sent / j.chunks * 100 : 0;
    c.fill.style.width = p.toFixed(1) + '%';
    c.note.textContent = jobText(j);
    c.card.classList.toggle('ok', j.state === 'done');
    c.card.classList.toggle('paused', j.state === 'stop');
    c.card.classList.toggle('bad', j.state === 'fail');
    c.x.hidden = j.state === 'done';
  }
  // a file in: the list again; a model's picture made here (its file kept for it till then). The other files' small
  // pictures were made while each was in hand and went up with its end (ops/vault-upload.js); here, only when they
  // were not ready then.
  function jobDone(j) {
    if (state.vault) loadVault();
    var go = Promise.resolve();
    if (j.model && !j.parent) {
      go = Promise.resolve(j.mem ? up.mem[j.key] : VaultUploads.fileOf(j.key)).then(function (blob) {
        if (blob) return preview({ id: j.id, name: j.name }, blob, j);
        return null;
      });
    } else if (!j.parent && !j.pictured && picWait[j.key]) {
      go = picWait[j.key].then(function (pics) {
        if (!pics) return null;
        var h = j.pass ? { 'X-Vault-Upload': j.pass } : {};
        return VaultThumbnails.attempt(function () { return request('POST', '/api/vault/meta', { id: j.id, thumbnail: pics.thumbnail, preview: pics.preview }, h); }, 5, 1500);
      }).catch(function () {});
    }
    go.then(function () {
      setTimeout(function () { dropJob(j.key, true); }, 20000);
    });
  }
  // The small pictures of a file, made from it while it is in hand (before it goes up), one file at a time: an image shrunk,
  // a video's frame, a sound's wave, a text's first lines, a document's or an APK's own picture, or at least a card. They are
  // kept with the job, and whoever finishes the upload saves them with it. Nothing is downloaded.
  var picQueue = Promise.resolve(), picWait = {};
  function startPictures(j, file) {
    if (j.parent || j.model || !window.VaultThumbnails) return;
    var kind = fileKind({ name: j.name, type: j.type })[1];
    picWait[j.key] = picQueue = picQueue.then(function () { return VaultThumbnails.fromFile(file, kind); }).then(function (p) {
      if (!p.thumbnail) return null;
      var pics = { thumbnail: p.thumbnail, preview: p.preview };
      return VaultUploads.patch(j.key, { pics: pics }).then(function () { return pics; });
    }).catch(function () { return null; });
  }
  function dropJob(key, quiet) {
    var c = up.cards[key];
    if (c) c.card.remove();
    delete up.cards[key];
    delete up.jobs[key];
    delete up.mem[key];
    delete picWait[key];
    renderResume();
    return VaultUploads.forget(key).catch(function () {}).then(function () { if (!quiet) kick(); });
  }
  function cancelJob(key) {
    var j = up.jobs[key];
    if (!j) return;
    if (up.reg && up.reg.active) up.reg.active.postMessage({ type: 'cancel', key: key });
    if (up.engine) up.engine.cancel(key);
    dropJob(key);
    toast('「' + j.name + '」のアップロードをやめました' + (j.id ? '（届いた部分は保管庫に「アップロード途中」で残ります。削除もできます）' : ''));
  }
  var upSeq = 0;
  // Files into the vault open now: each gets its place on the server (its
  // upload's own pass with it) and waits in this browser to go. `o`: { note,
  // space, folder, parent (a model's light copy: its pass), id (an unfinished
  // one to go on with) }
  function queueFile(file, o) {
    o = o || {};
    var j = {
      key: Date.now().toString(36) + '-' + (++upSeq) + '-' + Math.random().toString(36).slice(2, 8),
      who: state.name, id: o.id || '', name: file.name, size: file.size, type: file.type || '',
      note: o.note || '', space: o.parent ? '' : o.space || '', folder: o.folder || '', inside: o.parent ? '' : o.inside || '', parent: o.parent || '',
      model: !o.parent && is3d(file.name) && file.size > 0, pass: o.pass || '', piece: 0, chunks: 0, sent: 0,
      // (held for the checks a deployment puts in front of the sending: ops/ext.js)
      hold: OpsExt.has('beforeSend') || OpsExt.expected(),
      state: 'wait', why: '', message: '', tries: 0, next: 0, at: Date.now(), mem: false
    };
    if (!file.size) { toast('「' + file.name + '」は中身が空（0バイト）か、端末から読み込めませんでした。中身のあるファイルを選んでください'); return Promise.resolve(null); }
    if (state.vault && file.size > state.vault.fileBytes) { toast('「' + file.name + '」は大きすぎます（1ファイル ' + mb(state.vault.fileBytes) + 'まで）'); return Promise.resolve(null); }
    // kept in this browser (too big for its storage: in this page only, and sent from here)
    return VaultUploads.add(j, file).catch(function () {
      j.mem = true;
      up.mem[j.key] = file;
      return VaultUploads.add(j, null);
    }).then(function () {
      if (j.mem) up.mem[j.key] = file;
      startPictures(j, file);
      onJob(j);
      return j.id ? passFor(j) : place(j);
    }).then(function () { kick(); return j; });
  }
  // A file waits for the checks the deployment has put in front of its sending (ops/ext.js), if it
  // has any: it is stored held (the sending engine passes it by) and goes on when the check answers.
  // Refused: it ends there, for good, with the words the check gave. Not waited for by the callers:
  // the next file is placed meanwhile, and the check decides how many run at once.
  function check(j) {
    if (!j.hold || !j.id || j.state === 'fail' || up.checking[j.key]) return Promise.resolve();
    if (!OpsExt.has('beforeSend')) return endJob(j, '追加部品を読み込めませんでした。ページを読み込み直して、もう一度ファイルを選んでください');
    up.checking[j.key] = true;
    return (up.mem[j.key] ? Promise.resolve(up.mem[j.key]) : VaultUploads.fileOf(j.key)).then(function (file) {
      if (!file) return null;
      return OpsExt.run('beforeSend', null, j, file, OpsExt.io());
    }).then(function () {
      delete up.checking[j.key];
      j.hold = false;
      return VaultUploads.save(j).then(function () { onJob(j); kick(); });
    }, function (err) {
      delete up.checking[j.key];
      return endJob(j, (err && err.message) || 'できませんでした');
    }).catch(function () { /* the browser's storage failed: the file shows as it was */ });
  }
  function endJob(j, message) {
    j.hold = false;
    j.state = 'fail';
    j.why = 'gone';
    j.message = message;
    j.next = 0;
    return VaultUploads.save(j).then(function () { onJob(j); return j; });
  }
  // after a reload: the files that were held for their check are checked again
  function resumeHeld() {
    if (!window.indexedDB || !ctx.token()) return Promise.resolve();
    var me = state.name;
    return VaultUploads.all().then(function (list) {
      list.filter(function (j) { return j.who === me && j.hold && j.state !== 'done'; }).forEach(function (j) { check(j); });
    }, function () {});
  }
  // its place on the server (and its pass); the room not there: it waits
  function place(j) {
    var extra = j.parent && j.pass ? { 'X-Vault-Upload': j.pass } : null;
    var body = { name: j.name, size: j.size, type: j.type, note: j.parent ? '' : j.note, parent: j.parent || undefined, space: j.parent ? undefined : j.space, folder: j.parent ? undefined : j.folder, inside: j.inside || undefined };
    var call = extra ? request('POST', '/api/vault/files', body, Object.assign({}, state.vault && state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : {}, extra)) : vreq('POST', '/api/vault/files', body);
    return call.then(function (r) {
      j.id = r.file.id;
      j.pass = r.upload;
      j.piece = r.file.piece;
      j.chunks = r.file.chunks;
      j.state = 'wait';
      j.why = '';
      j.message = '';
      return VaultUploads.save(j).then(function () { onJob(j); check(j); });
    }, function (err) { return stopJob(j, err); });
  }
  // an unfinished one on the server, gone on with: a new pass for it
  function passFor(j) {
    return vreq('GET', '/api/vault/missing?id=' + j.id).then(function (r) {
      if (r.file.size !== j.size) {
        // (not the same file after all: a new one)
        j.id = '';
        return place(j);
      }
      j.pass = r.upload;
      j.state = 'wait';
      j.why = '';
      return VaultUploads.save(j).then(function () { onJob(j); check(j); });
    }, function (err) { return stopJob(j, err); });
  }
  function stopJob(j, err) {
    var code = err && err.code;
    j.state = code === 'no_file' ? 'fail' : 'stop';
    j.why = code === 'vault_full' ? 'full' : code === 'need_approval' || code === 'over_limit' ? 'room' : code === 'vault_locked' ? 'locked'
      : err && (err.status === 0 || err.status === 429 || err.status >= 500) ? 'net' : code === 'no_file' ? 'gone' : 'error';
    j.message = (err && err.message) || '';
    j.next = Date.now() + 15000;
    return VaultUploads.save(j).then(function () { onJob(j); });
  }
  // 「再開」: every stopped file again at once (its place or its pass first
  // where it needs one); unfinished files with nothing here: picked again
  function resumeAll() {
    var list = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; }).filter(function (j) { return j.state !== 'done'; });
    var tasks = list.map(function (j) {
      j.tries = 0;
      j.restarts = 0;
      j.next = 0;
      if (!j.id) return place(j);
      if (j.why === 'locked' || j.state === 'fail' && j.why !== 'gone') return passFor(j);
      if (j.why === 'gone') return dropJob(j.key, true);
      j.state = 'wait';
      j.why = '';
      j.message = '';
      return VaultUploads.save(j).then(function () { onJob(j); });
    });
    return Promise.all(tasks).then(function () {
      kick();
      var known = {};
      list.forEach(function (j) { if (j.id) known[j.id] = true; });
      var left = (state.vaultFiles || []).filter(function (f) { return !f.done && !known[f.id]; });
      if (left.length && canWrite()) {
        toast('続きを送るファイルを選んでください（' + left.length + '件：' + left.slice(0, 3).map(function (f) { return f.name; }).join('、') + (left.length > 3 ? ' ほか' : '') + '）');
        $('#vault-file').click();
      } else if (list.length) toast('止まっていたアップロードを再開しました（' + list.length + '件）');
      else if (!left.length) toast('止まっているアップロードはありません');
      else toast('「編集する」で開発者コードを入れると、途中のファイルの続きを送れます');
    });
  }
  // an unfinished file tapped: its upload waiting here goes on at once;
  // without one here, the same file is picked again (its pieces go on)
  function goOn(f) {
    var j = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; }).filter(function (x) { return x.id === f.id && x.state !== 'done'; })[0];
    if (j) {
      j.state = 'wait';
      j.next = 0;
      j.tries = 0;
      VaultUploads.save(j).then(function () { onJob(j); kick(); toast('「' + f.name + '」の続きを送ります'); });
      return;
    }
    if (!canWrite()) { toast('アップロードの途中です（「編集する」で開発者コードを入れると、続きを送れます）'); return; }
    state.resumeId = f.id;
    toast('「' + f.name + '」（' + mb(f.size) + '）と同じファイルを選んでください。届いた部分の続きから送ります');
    $('#vault-file').click();
  }
  // the room for a new file in a vault: all the vaults' room, and in a
  // shared one an operator's own (the developer has no limit)
  function roomIn(space) {
    var v = state.vault, free = v.maxBytes - v.used;
    if (space && !state.developer && v.me && v.me.limit) free = Math.min(free, v.me.limit - v.me.used);
    return free;
  }
  // a new file may get its place from here now (the developer: with the code)
  function canWriteIn() { return !state.developer || !!(state.vault && state.vault.ticket); }
  // room again (a file deleted, a limit raised): the files waiting for it get their place
  function roomCame() {
    if (!state.vault) return;
    Object.keys(up.jobs).forEach(function (k) {
      var j = up.jobs[k];
      if (j.id || j.state !== 'stop' || (j.why !== 'full' && j.why !== 'room') || j.next > Date.now()) return;
      if (j.size <= roomIn(j.space) && canWriteIn(j.space)) { j.next = Date.now() + 15000; place(j).then(kick); }
    });
  }
  // the 再開 button: whenever something is stopped or unfinished
  function renderResume() {
    var b = $('#vault-resume');
    if (!b) return;
    var mine = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; });
    var stopped = mine.filter(function (j) { return j.state === 'stop' || j.state === 'fail' && j.why !== 'gone'; }).length;
    var known = {};
    mine.forEach(function (j) { if (j.id) known[j.id] = true; });
    var half = (state.vaultFiles || []).filter(function (f) { return !f.done && !known[f.id]; }).length;
    b.hidden = !(stopped + half);
    b.textContent = '再開（' + (stopped + half) + '件）';
  }
  // A model: its picture, what is in it, and its light copy (uploaded as a
  // file of its own); `up`: its upload (its pass: the vault may be closed by now)
  function preview(f, file, upj) {
    var j = job(f.name + '（3Dプレビュー）');
    j.set(0, 3);
    var pass = upj && upj.pass ? { 'X-Vault-Upload': upj.pass } : null;
    return vault3d().then(function (V) {
      return V.analyze(file, f.name);
    }).then(function (r) {
      j.set(1, 3);
      // (the 3D engine's picture is large: what is kept is a medium one and a tiny one, a few tens of KB in all)
      return Promise.all([VaultThumbnails.make(r.preview), VaultThumbnails.medium(r.preview)]).then(function (two) { var thumbnail = two[0], medium = two[1]; return (pass ? Promise.resolve(pass) : passOf(f.id)).then(function (h) {
        return request('POST', '/api/vault/meta', { id: f.id, preview: medium, info: r.info, thumbnail: thumbnail }, Object.assign({}, state.vault && state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : {}, h)).then(function () {
          pics[f.id] = medium;
          j.set(2, 3);
          if (!r.light) return null;
          var base = f.name.replace(/\.[^.]+$/, '');
          return queueFile(new File([r.light], base + '.light.glb', { type: 'model/gltf-binary' }), { parent: f.id, pass: h['X-Vault-Upload'] || '' });
        });
      }); });
    }).then(function () { j.finish('プレビューを作りました'); if (state.vault) return loadVault(); return null; }, function (err) {
      j.fail('プレビューを作れませんでした：' + ((err && err.message) || ''));
      // (the 3D engine could not: the item still gets a card, so it is not left without a picture)
      return VaultThumbnails.fromFile(file, 'k3d').then(function (p) {
        if (!p.thumbnail) return null;
        return (pass ? Promise.resolve(pass) : passOf(f.id)).then(function (h) { return request('POST', '/api/vault/meta', { id: f.id, thumbnail: p.thumbnail, preview: p.preview }, Object.assign({}, state.vault && state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : {}, h)); });
      }).catch(function () {});
    });
  }
  // a file's upload pass, from the server (the vault open, or no code needed)
  function passOf(id) {
    return vreq('GET', '/api/vault/missing?id=' + id).then(function (r) { return { 'X-Vault-Upload': r.upload }; }, function () { return {}; });
  }
  // a whole file from the vault, its hashes checked: a Blob
  function fetchFile(f, j) {
    var parts = [], digests = [], done = 0, todo = [];
    for (var n = 0; n < f.chunks; n++) todo.push(n);
    return pieces(todo, function (n) {
      // (the bytes themselves: a third less to fetch, and nothing to decode here)
      return vreq('GET', '/api/vault/chunk?id=' + f.id + '&n=' + n + '&raw=1', undefined, 'bytes').then(function (r) {
        var bytes = new Uint8Array(r.bytes);
        return sha(bytes).then(function (h) {
          if (hex(h) !== r.headers.get('X-Piece-Sha256')) throw { message: '部分 ' + n + ' が壊れています（ハッシュが一致しません）' };
          parts[n] = bytes;
          digests[n] = new Uint8Array(h);
          done++;
          if (j) j.set(done, f.chunks);
        });
      });
    }).then(function () {
      var all = new Uint8Array(32 * f.chunks);
      digests.forEach(function (d, i) { all.set(d, i * 32); });
      return sha(all).then(function (h) {
        if (f.sha256 && hex(h) !== f.sha256) throw { message: 'ファイル全体のハッシュが一致しません' };
        return new Blob(parts, { type: 'application/octet-stream' });
      });
    });
  }
  // the light copy (or the model itself when it is small) turning in 3D
  function view3d(f) {
    var light = lightOf(f), src = light || f;
    var box = $('#viewer-box');
    closeViewer();
    $('#viewer-name').textContent = f.name;
    $('#viewer-note').textContent = '読み込み中…';
    $('#viewer').hidden = false;
    Promise.all([vault3d(), fetchFile(src, { set: function (d, t) { $('#viewer-note').textContent = '読み込み中… ' + Math.round(d / t * 100) + '%'; } })]).then(function (r) {
      return r[1].arrayBuffer().then(function (buf) { return r[0].view(box, buf, src.name); });
    }).then(function (v) {
      if ($('#viewer').hidden) { v.stop(); return; }
      viewing = v;
      $('#viewer-note').textContent = (light ? '軽量版 ' + mb(light.size) : mb(f.size)) + '・ドラッグで回転・ホイール / 2本指でズーム';
    }).catch(function (err) { $('#viewer-note').textContent = (err && err.message) || '表示できませんでした'; });
  }
  function closeViewer() {
    if (viewing) { viewing.stop(); viewing = null; }
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ''; }
    var box = $('#viewer-box');
    box.textContent = '';
    box.classList.remove('big', 'fit');
    box.style.backgroundImage = '';
    $('#viewer').hidden = true;
  }
  // a whole file shown here (`make` puts it in the box)
  function showBlob(f, make) {
    closeViewer();
    $('#viewer-name').textContent = f.name;
    $('#viewer-note').textContent = '読み込み中…';
    $('#viewer').hidden = false;
    fetchFile(f, { set: function (d, t) { $('#viewer-note').textContent = '読み込み中… ' + Math.round(d / t * 100) + '%'; } }).then(function (blob) {
      if ($('#viewer').hidden) return null;
      var box = $('#viewer-box');
      box.textContent = '';
      box.classList.add('fit');
      return Promise.resolve(make(box, blob)).then(function () { $('#viewer-note').textContent = mb(f.size); });
    }).catch(function (err) { $('#viewer-note').textContent = (err && err.message) || '表示できませんでした'; });
  }
  function urlOf(blob, type) {
    if (viewUrl) URL.revokeObjectURL(viewUrl);
    viewUrl = URL.createObjectURL(new Blob([blob], { type: type }));
    return viewUrl;
  }
  function showImage(f) {
    showBlob(f, function (box, blob) {
      var img = el('img', 'viewer-img');
      img.src = urlOf(blob, f.type || 'image/png');
      img.alt = f.name;
      box.appendChild(img);
    });
  }
  function showText(f) {
    showBlob(f, function (box, blob) {
      return blob.text().then(function (text) { box.appendChild(el('pre', 'viewer-text', text)); });
    });
  }
  function showMedia(f, video) {
    showBlob(f, function (box, blob) {
      var m = el(video ? 'video' : 'audio', 'viewer-media');
      m.controls = true;
      m.src = urlOf(blob, f.type || (video ? 'video/mp4' : 'audio/mpeg'));
      box.appendChild(m);
    });
  }
  // A tap on a file's icon: a model turns in 3D, a picture, a text or a
  // program, a video or a sound shows here; anything else (an APK, a zip) is
  // saved. One still going up goes on (the same file picked again).
  var SHOW_TEXT = 2 * 1048576, SHOW_PIC = 40 * 1048576, SHOW_MEDIA = 300 * 1048576;
  function openFile(f) {
    if (!f.done) {
      goOn(f);
      return;
    }
    if (fileKind(f)[1] === 'k3d') view3d(f);
    else showLook(f);
  }
  // A file's enlarged view is its medium picture (tens of KB at most), not the file: the original comes only
  // when it is asked for (the buttons under the picture), and what cannot be shown here is saved.
  function showLook(f) {
    var k = fileKind(f)[1];
    closeViewer();
    $('#viewer-name').textContent = f.name;
    $('#viewer-note').textContent = '読み込み中…';
    $('#viewer').hidden = false;
    var box = $('#viewer-box'), wrap = el('div', 'viewer-look'), img = el('img', 'viewer-img'), acts = el('div', 'viewer-acts');
    box.classList.add('fit');
    img.alt = f.name;
    function button(text, fn, cls) { var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); }
    if (k === 'kimg' && f.size <= SHOW_PIC) button('元の画像を表示（' + mb(f.size) + '）', function () { showImage(f); });
    if (isTextual(k) && f.size <= SHOW_TEXT) button('全文を読み込む（' + mb(f.size) + '）', function () { showText(f); });
    if ((k === 'kvid' || k === 'kaud') && f.size <= SHOW_MEDIA) button('再生する（' + mb(f.size) + ' を読み込みます）', function () { showMedia(f, k === 'kvid'); });
    button('ダウンロード（' + mb(f.size) + '）', function () { download(f); }, 'primary');
    wrap.appendChild(img); wrap.appendChild(acts); box.appendChild(wrap);
    function show(src, real) {
      if ($('#viewer').hidden || !wrap.isConnected) return;
      img.src = src;
      $('#viewer-note').textContent = real ? 'プレビュー（低解像度）・元のファイルは ' + mb(f.size) : '種類を表す絵です（元のファイルは ' + mb(f.size) + '）';
    }
    if (pics[f.id] && f.preview) { show(pics[f.id], true); return; }
    if (!f.preview) { show(cardFor(f, true), false); return; }
    VaultThumbnails.attempt(function () { return vreq('GET', '/api/vault/preview?id=' + f.id); }, 5, 1000).then(function (r) {
      if (r.preview) { pics[f.id] = r.preview; show(r.preview, true); } else show(cardFor(f, true), false);
    }).catch(function () { show(cardFor(f, true), false); });
  }
  // the picture, big
  function showPic(f) {
    if (!pics[f.id]) return;
    closeViewer();
    $('#viewer-name').textContent = f.name;
    $('#viewer-note').textContent = '前（+Z）・右（+X）・上（+Y）・斜め';
    var box = $('#viewer-box');
    box.classList.add('big');
    box.style.backgroundImage = 'url("' + pics[f.id] + '")';
    $('#viewer').hidden = false;
  }
  function makePreview(f) {
    var j = job(f.name + '（ダウンロード）');
    fetchFile(f, j).then(function (blob) {
      j.finish('ダウンロードしました');
      return preview(f, new File([blob], f.name));
    }).catch(function (err) { j.fail((err && err.message) || 'ダウンロードできませんでした'); });
  }
  function download(f) {
    var j = job(f.name + '（ダウンロード）');
    return fetchFile(f, j).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      j.finish('ダウンロードしました（ハッシュ一致を確認済み）');
    }).catch(function (err) { j.fail((err && err.message) || 'ダウンロードできませんでした'); });
  }
  // `f`: a file, or null for the whole vault (or `d`, a folder: it and every folder below it, as they are when the URL is used).
  // Every address is the same: whoever has it (a person or an AI) may look, take and comment; the developer only says for how
  // many hours (1 to 48, on a slider).
  function makeLink(f, d) {
    var range = (state.vault && state.vault.linkHours) || { min: 1, max: 48 };
    ask({
      title: d ? 'フォルダ「' + d.name + '」のURLを発行' : f ? '「' + f.name + '」のURLを発行' : '保管庫全体のURLを発行',
      text: (d ? 'フォルダ「' + pathName(d.id) + '」とその中のフォルダのすべてのファイル（画像・情報・軽量版つき・実装済みは除く。あとから入れたファイルも含み、外へ移したファイルは含みません）'
        : f ? '「' + f.name + '」（画像・情報・軽量版つき）' : '保管庫のすべてのファイル（画像・情報・軽量版つき・実装済みは除く）') + 'を、このURLを知っている人なら誰でも（人でも AI でも）、ログインなしで、見る・ダウンロードする・コメントを書く（150文字まで）ことだけができるURLです。ファイルは変えられません。取り出せる量は5GBまで、あまりに多くの場所から使われると自動で止まります。「URL」の確認画面でいつでも停止・再コピーできます。',
      ok: '発行する',
      input: { label: '有効時間', range: [range.min, range.max], unit: ' 時間', value: '24' },
      check: function (v) { var n = Number(v); return Number.isInteger(n) && n >= range.min && n <= range.max ? '' : range.min + '〜' + range.max + ' 時間で決めてください'; }
    }).then(function (v) {
      if (v === null) return null;
      return vreq('POST', '/api/vault/link', d ? { folder: d.id, hours: Number(v) } : { id: f ? f.id : '*', hours: Number(v) }).then(function (r) {
        loadVault(); if (vaultWork) vaultWork.render('links');
        showIssuedVaultLink({ file: d ? 'folder:' + d.id : f ? f.id : '*', folder: d ? d.id : '', name: d ? pathName(d.id) : f ? f.name : '', until: r.until, path: r.path }, 'URLを発行しました（' + v + '時間有効）');
      });
    }).catch(fail);
  }
  function copyVaultURL(url) {
    var input = [$('#dialog-input'), $('#dialog-area')].filter(function (x) { return x.readOnly && x.dataset.vaultShareUrl === '1' && x.value === url; })[0];
    if ($('#dialog').hidden || !input) return;
    function fallback() { input.focus(); input.select(); try { if (!document.execCommand('copy')) throw new Error(); toast('共有URLをコピーしました'); } catch (e) { toast('URLを選択してコピーしてください'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('共有URLをコピーしました'); }, fallback);
    else fallback();
  }
  /* the menu of an item: its ⋯ (under it), a right click or a long press (where it was) */
  var menuDo = null, menuAt0 = 0, menuWidth = 0;
  function openMenu(items, at, then) {
    var m = $('#vmenu');
    m.textContent = '';
    items.forEach(function (x) {
      var b = el('button', 'vmenu-item' + (x[2] ? ' ' + x[2] : ''), x[0]);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.dataset.mact = x[1];
      m.appendChild(b);
    });
    menuDo = then;
    menuAt0 = Date.now();
    menuWidth = window.innerWidth;
    m.hidden = false;
    // in sight: moved in where it would go out
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(at.x, window.innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, at.y + h + 8 > window.innerHeight ? at.y - h - (at.below || 0) : at.y) + 'px';
    var first = m.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function menuAt(b, items, then) {
    var r = b.getBoundingClientRect();
    openMenu(items, { x: r.left, y: r.bottom + 4, below: r.height + 8 }, then);
  }
  function closeMenu() { $('#vmenu').hidden = true; menuDo = null; }
  // (the page scrolled or turned: the menu goes; not for what opening it moved,
  // nor a phone's address bar coming and going)
  function menuMoved(e) {
    if ($('#vmenu').hidden || Date.now() - menuAt0 < 400) return;
    if (e.type === 'resize' && window.innerWidth === menuWidth) return;
    if (e.type === 'scroll' && e.target && e.target.closest && e.target.closest('#vmenu')) return;
    closeMenu();
  }
  function onMenu(e) {
    var b = e.target.closest('[data-mact]');
    if (!b || !menuDo) return;
    var then = menuDo;
    closeMenu();
    then(b.dataset.mact);
  }

  // what can be done with a file (its ⋯, a right click)
  function fileMenu(f) {
    var write = canWrite(), own = !f.space, kind = fileKind(f), inBackups = state.vaultSpace === 'backup';
    var dev = state.developer && state.vault && state.vault.ticket, items = [];
    if (f.done) {
      items.push(['開く', 'open'], ['ダウンロード', 'get']);
      if (f.done && !f.thumbnail && write && f.size <= 100 * 1048576 && kind[1] !== 'k3d') items.push(['プレビューを作る（ダウンロードして作成）', 'thumbnail']);
      if (lightOf(f)) items.push(['軽量版をダウンロード', 'getlight']);
      if (!f.info && kind[1] === 'k3d' && write && !inBackups && (own || state.vaultInfo.add)) items.push(['3Dプレビューを作る', 'make']);
    } else if (write) items.push(['続きから送る（同じファイルを選ぶ）', 'resume']);
    if (!inBackups) {
      var held = inFile(f.id).length;
      if (held || (write && fileTrail(f.id).length < 8)) items.push([held ? '中のファイルを開く（' + fmt(held) + '件）' : '中を開く（このファイルの中にファイルを入れる）', 'inside']);
    }
    items.push(['詳細を開く', 'details'], ['コメント', 'comments']);
    if (write && !inBackups) items.push(['名前を変更', 'rename'], ['移動', 'move']);
    if (own && f.done && write) {
      if (f.implementedAt) items.push(['実装済みから戻す', 'restore']);
      else items.push(['実装済みにする', 'implement'], ['URLを発行', 'link']);
      if (f.links.live) items.push(['このファイルのURLをすべて停止', 'stop']);
    }
    if (dev && f.done) {
      if (f.backup && f.backup.removed) items.push(['元の場所に戻す', 'unremove']);
      else items.push(f.backup ? ['バックアップから外す', 'unbackup'] : ['バックアップする', 'backup']);
    }
    if (write && (!inBackups || f.space === 'backup')) items.push([inBackups ? '完全に削除' : '削除', 'delete', 'danger']);
    return items;
  }
  function fileAct(f, act) {
    if (act === 'open') openFile(f);
    else if (act === 'inside') goInside(f);
    else if (act === 'details') openVaultDetails(f);
    else if (act === 'comments') openComments(f);
    else if (act === 'get') download(f);
    else if (act === 'getlight') { if (lightOf(f)) download(lightOf(f)); }
    else if (act === 'pic') showPic(f);
    else if (act === 'make') makePreview(f);
    else if (act === 'thumbnail') {
      var task = job(f.name + '（プレビュー）');
      fetchFile(f, task).then(function (blob) { return VaultThumbnails.fromFile(new File([blob], f.name, { type: f.type || '' }), fileKind(f)[1]); }).then(function (p) {
        delete thumbnails[f.id]; delete pics[f.id]; delete cards['s' + f.id]; delete cards['b' + f.id];
        return vreq('POST', '/api/vault/meta', { id: f.id, thumbnail: p.thumbnail, preview: p.preview });
      }).then(function () { task.finish('プレビューを保存しました'); return loadVault(); }).catch(function (err) { task.fail(err.message || 'プレビューを作れませんでした'); });
    }
    else if (act === 'link') makeLink(f);
    else if (act === 'rename') renameFile(f);
    else if (act === 'move') moveItems([f], []);
    else if (act === 'backup' || act === 'unbackup') backupItems([f], [], act === 'backup');
    else if (act === 'unremove') restoreBackup(f);
    else if (act === 'resume') goOn(f);
    else if (act === 'implement') {
      ask({ title: '実装済みにしますか？', text: '「' + f.name + '」がゲームに入ったとき押します。すべてのリンクから外れます（保管庫には残り、あとで戻せます）。', ok: '実装済みにする', input: { label: 'どこに入れたか（例：js/game/cars.js の新車）' }, check: function (v) { return v.trim() ? '' : 'どこに入れたかを書いてください'; } }).then(function (where) {
        if (where === null) return null;
        return vreq('POST', '/api/vault/implemented', { id: f.id, text: where.trim() }).then(function () { toast('実装済みにしました'); return loadVault(); });
      }).catch(fail);
    } else if (act === 'restore') {
      ask({ title: '実装済みから戻しますか？', text: '「' + f.name + '」がまたリンクから取り出せるようになります。', ok: '戻す' }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/restore', { id: f.id }).then(function () { toast('戻しました'); return loadVault(); });
      }).catch(fail);
    } else if (act === 'stop') {
      ask({ title: 'リンクを停止しますか？', text: '「' + f.name + '」のリンクがすべて、すぐに使えなくなります。', ok: '停止する', danger: true }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/link/stop', { id: f.id }).then(function (r) { toast('リンクを停止しました（' + r.stopped + '本）'); return loadVault(); });
      }).catch(fail);
    } else if (act === 'delete') deleteFile(f);
  }
  function renameFile(f) {
    ask({ title: '名前を変更', ok: '変更する', input: { label: 'ファイルの名前', value: f.name }, check: named }).then(function (name) {
      if (name === null || name.trim() === f.name) return null;
      return vreq('POST', '/api/vault/rename', { id: f.id, name: name.trim() }).then(function () { toast('名前を変更しました'); return loadVault(); });
    }).catch(fail);
  }
  function deleteFile(f) {
    var text = f.space === 'backup' ? 'バックアップから完全に削除します（元に戻せません）。'
      : f.backup ? '保管庫から削除します。開発者のバックアップには残ります。'
        : '保管庫から完全に削除します（元に戻せません）。' + (f.space ? '' : 'リンクも使えなくなります。');
    if (f.space !== 'backup' && inFile(f.id).length) text += '中に入っているファイル（' + fmt(inFile(f.id).length) + '件）は消えずに、ひとつ上へ移ります。';
    ask({ title: '本当に削除しますか？', text: '「' + f.name + '」を' + text, ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/delete', { id: f.id }).then(function (r) { toast(r.kept ? '削除しました（バックアップに残っています）' : '削除しました'); return loadVault(); });
    }).catch(fail);
  }
  // a tap in the lists: a checkmark checks, an icon opens, a button does its part
  function onItems(e) {
    if (onPick(e)) return;
    var row = e.target.closest('.vitem');
    if (!row) return;
    var f = row.dataset.file ? fileOf(row.dataset.file) : null, d = row.dataset.folder ? folderOf(row.dataset.folder) : null;
    var b = e.target.closest('[data-vact], [data-vopen]');
    if (d) {
      if (b && b.dataset.vact === 'menu') menuAt(b, folderMenu(d), function (a) { folderAct(d, a); });
      else if (b && b.dataset.vact === 'details') folderDetails(d);
      else if (b || e.target.closest('.vault-name')) goFolder(d.id);
      return;
    }
    if (!f || !b) return;
    if (b.dataset.vopen) openFile(f);
    else if (b.dataset.vact === 'menu') menuAt(b, fileMenu(f), function (a) { fileAct(f, a); });
    else fileAct(f, b.dataset.vact);
  }
  // a right click (or a long press): the item's menu where it was
  function onItemsMenu(e) {
    var row = e.target.closest('.vitem');
    if (!row) return;
    var f = row.dataset.file ? fileOf(row.dataset.file) : null, d = row.dataset.folder ? folderOf(row.dataset.folder) : null;
    if (!f && !d) return;
    e.preventDefault();
    openMenu(f ? fileMenu(f) : folderMenu(d), { x: e.clientX, y: e.clientY }, function (a) { if (f) fileAct(f, a); else folderAct(d, a); });
  }
  // files picked: into the vault and folder open now, with the note (an
  // unfinished one of the same size goes on where it stopped: the one tapped,
  // or one with the same name)
  function onFiles() {
    var input = $('#vault-file'), files = Array.prototype.slice.call(input.files || []), resume = state.resumeId;
    input.value = '';
    state.resumeId = null;
    sendFiles(files, resume, state.vaultFolder, state.vaultIn);
  }
  // `folder`: where they go in the vault open now ('' : its top); `inside`: into that file
  function sendFiles(files, resume, folder, inside) {
    if (!state.vault) return;
    var note = state.vaultMemo || '', space = state.vaultSpace, taken = {};
    if (files.length) { state.vaultMemo = ''; renderMemo(); }
    // (each unfinished one is gone on with once, by the file it was: same size, and the one tapped or the same name)
    Object.keys(up.jobs).forEach(function (k) { if (up.jobs[k].id) taken[up.jobs[k].id] = true; });
    var half = function (file) {
      var same = state.vaultFiles.filter(function (x) { return !x.done && !taken[x.id] && x.size === file.size; });
      var f = same.filter(function (x) { return resume && x.id === resume; })[0] || same.filter(function (x) { return x.name === file.name; })[0];
      if (f) taken[f.id] = true;
      return f;
    };
    files.reduce(function (p, file) {
      return p.then(function () {
        // (the same file again while it still waits here: that one goes on)
        var dup = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; }).filter(function (j) { return j.state !== 'done' && j.name === file.name && j.size === file.size && j.space === space; })[0];
        if (dup) { dup.state = 'wait'; dup.next = 0; return VaultUploads.save(dup).then(function () { onJob(dup); kick(); }); }
        var f = half(file);
        return queueFile(file, { id: f ? f.id : '', note: note, space: space, folder: folder, inside: inside || '' });
      });
    }, Promise.resolve());
  }

  // files dragged in from the computer: dropped on the vault, into the folder
  // open now; dropped on a folder, into that folder (only while it may be
  // changed; never opened by the browser itself)
  var dragDepth = 0;
  function dragFiles(e) { return !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  // the folder dropped on, or the file (into it)
  function dropFolder(e) {
    var row = e.target.closest && e.target.closest('.vitem[data-folder], .vitem[data-file]');
    if (!row) return null;
    if (row.dataset.folder) return $('#vault-folders').contains(row) ? row : null;
    return $('#vault-list').contains(row) && state.vaultSpace !== 'backup' && fileTrail(row.dataset.file).length < 8 ? row : null;
  }
  function markDrop(row) {
    Array.prototype.forEach.call(document.querySelectorAll('.vitem.drop-in'), function (r) { if (r !== row) r.classList.remove('drop-in'); });
    if (row) row.classList.add('drop-in');
  }
  function endDrag() {
    dragDepth = 0;
    $('#vault-main').classList.remove('vault-drag');
    markDrop(null);
  }
  function onDragEnter(e) {
    if (!dragFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (canWrite()) $('#vault-main').classList.add('vault-drag');
  }
  function onDragOver(e) {
    if (!dragFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canWrite() ? 'copy' : 'none';
    if (canWrite()) markDrop(dropFolder(e));
  }
  function onDragLeave(e) {
    if (!dragFiles(e)) return;
    if (--dragDepth <= 0) endDrag();
  }
  function onDrop(e) {
    if (!dragFiles(e)) return;
    e.preventDefault();
    var row = dropFolder(e);
    endDrag();
    if (!canWrite()) {
      toast(!$('#vault-unlock').hidden ? '「編集する」を押してから入れてください' : 'この保管庫には入れられません');
      return;
    }
    // (a folder from the computer is not taken: the files in it are)
    var items = Array.prototype.slice.call(e.dataTransfer.items || []), dirs = 0;
    items.forEach(function (it) { var en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en && en.isDirectory) dirs++; });
    var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f, i) {
      var en = items[i] && items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      return !(en && en.isDirectory);
    });
    if (dirs) toast('フォルダはそのまま入れられません（中のファイルを選んで入れてください）');
    if (!files.length) return;
    if (row && row.dataset.file) {
      var into = fileOf(row.dataset.file);
      toast('「' + into.name + '」の中に ' + files.length + '個 入れます');
      sendFiles(files, null, into.folder || '', into.id);
      return;
    }
    var folder = row ? row.dataset.folder : state.vaultFolder;
    if (row) toast('「' + folderOf(folder).name + '」に ' + files.length + '個 入れます');
    sendFiles(files, null, folder, row ? '' : state.vaultIn);
  }


  function init(){
    $('#vault-unlock').addEventListener('click', unlockVault);
    $('#vault-lock').addEventListener('click', function () { relock('閉じました（閲覧のみ）'); });
    // (a checkmark first: it only checks; an icon opens; the ⋯, 詳細 and 💬)
    ['#vault-list', '#vault-folders'].forEach(function (id) {
      $(id).addEventListener('click', onItems);
      $(id).addEventListener('contextmenu', onItemsMenu);
      // (a double click opens it too)
      $(id).addEventListener('dblclick', function (e) {
        if (e.target.closest('button, .vault-check, .vitem-detail')) return;
        var row = e.target.closest('.vitem');
        if (row && row.dataset.folder) goFolder(row.dataset.folder);
        else if (row && fileOf(row.dataset.file)) openFile(fileOf(row.dataset.file));
      });
    });
    $('#vault-plus').addEventListener('click', plusMenu);
    $('#vault-link').addEventListener('click', openVaultLinks);
    $('#vault-work-panes').addEventListener('click', function (e) {
      var action = e.target.closest('[data-vact]'), pane = e.target.closest('[data-vault-file]');
      if (action && pane) { var f = fileOf(pane.dataset.vaultFile); if (f) fileAct(f, action.dataset.vact); }
    });

    $('#vault-memo').addEventListener('click', function () { state.vaultMemo = ''; renderMemo(); });
    $('#vmenu').addEventListener('click', onMenu);
    document.addEventListener('mousedown', function (e) { if (!$('#vmenu').hidden && !e.target.closest('#vmenu')) closeMenu(); }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#vmenu').hidden) closeMenu();
      else if (!$('#vcomments').hidden) closeComments();
    });
    window.addEventListener('scroll', menuMoved, true);
    window.addEventListener('resize', menuMoved);
    $('#vcomments-close').addEventListener('click', closeComments);
    $('#vcomments').addEventListener('click', function (e) { if (e.target.id === 'vcomments') closeComments(); });
    $('#vcomments-form').addEventListener('submit', sendComment);
    $('#vcomments-list').addEventListener('click', onComments);
    $('#vcomments-text').addEventListener('keydown', function (e) {
      // (Ctrl / ⌘ + Enter sends)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(e);
    });
    $('#vault-filter').addEventListener('click', function (e) {
      var c = e.target.closest('[data-vf]');
      if (!c) return;
      setShow(c.dataset.vf);
      state.vaultPage = 0;
      clearPicks();
      renderVault();
    });
    $('#vault-spaces').addEventListener('click', function (e) {
      var b = e.target.closest('[data-space]');
      if (b) goSpace(b.dataset.space);
    });
    // the vault's icon or its name: back to its top
    $('#vault-head').addEventListener('click', function (e) { if (e.target.closest('[data-vtop]')) goTop(); });
    $('#vault-title').addEventListener('click', goTop);
    $('#vault-room').addEventListener('click', onRoom);
    $('#vault-pick-all').addEventListener('change', pickAll);
    $('#vault-pager').addEventListener('click', function (e) {
      var b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      state.vaultPage = Number(b.dataset.page);
      renderVault();
      $('#vault-path').scrollIntoView({ block: 'start' });
    });
    // uploads: やめる, 再開; the connection back: at once; and a look every 15 s
    upInit();
    $('#vault-jobs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-up-cancel]');
      if (b) cancelJob(b.dataset.upCancel);
    });
    $('#vault-resume').addEventListener('click', function () { resumeAll().catch(fail); });
    // the connection back: the stopped files at once
    window.addEventListener('online', wakeJobs);
    setInterval(function () {
      if (!ctx.token() || $('#app').hidden || !Object.keys(up.jobs).some(function (k) { return up.jobs[k].state !== 'done'; })) return;
      kick();
      if (state.vault && !document.hidden) loadVault(true);
      // the server answering again: the files stopped for the connection go at once, not at their next try
      if (Object.keys(up.jobs).some(function (k) { return up.jobs[k].state === 'stop' && up.jobs[k].why === 'net'; })) {
        fetch('/api/health', { cache: 'no-store' }).then(function (r) { if (r.ok) wakeJobs(); }, function () {});
      }
    }, 15000);
    // (the countdown to each stopped file going again)
    setInterval(function () {
      Object.keys(up.jobs).forEach(function (k) { var j = up.jobs[k]; if (j.state === 'stop' && up.cards[k]) up.cards[k].note.textContent = jobText(j); });
    }, 1000);
    $('#vault-speed').addEventListener('change', function () { setVaultSpeed($('#vault-speed').value); });
    $('#vault-path').addEventListener('click', onFolder);
    $('#vault-picked-move').addEventListener('click', function () { moveItems(pickedFiles(), pickedFolders()); });
    $('#vault-picked-get').addEventListener('click', function () { downloadItems(pickedFiles(), pickedFolders()); });
    $('#vault-picked-delete').addEventListener('click', function () { deleteItems(pickedFiles(), pickedFolders()); });
    $('#vault-picked-clear').addEventListener('click', function () { clearPicks(); renderPicks(); });
    $('#vault-picked-backup').addEventListener('click', function () { backupItems(pickedFiles(), pickedFolders(), true); });
    $('#viewer-close').addEventListener('click', closeViewer);
    $('#viewer').addEventListener('click', function (e) { if (e.target.id === 'viewer') closeViewer(); });
    $('#vault-file').addEventListener('change', onFiles);
    var vm = $('#vault-main');
    vm.addEventListener('dragenter', onDragEnter);
    vm.addEventListener('dragover', onDragOver);
    vm.addEventListener('dragleave', onDragLeave);
    vm.addEventListener('drop', onDrop);
    // (a file dropped anywhere else on the site is not opened in its place)
    window.addEventListener('dragover', function (e) { if (dragFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) { if (dragFiles(e)) e.preventDefault(); });
    // leaving in the middle of an upload or a download
    // (uploads in the background worker go on: no question for them)
    window.addEventListener('beforeunload', function (e) {
      var here = Object.keys(up.jobs).some(function (k) { var j = up.jobs[k]; return j.state !== 'done' && (up.mode !== 'sw' || j.mem); });
      if (moving > 0 || here) { e.preventDefault(); e.returnValue = ''; }
    });

  }

  return { init, vreq, mb, resetVault, openLook, loadVault, vaultAsk, vaultGot, vaultFailed, goSpace, folderOf, goTop, goFolder, renderVault, stopThumbnails, base64, up, adoptJobs, dropLogin, kick, refreshJobs, onJob, resumeHeld, copyVaultURL };
};
