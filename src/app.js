const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = s => document.querySelector(s);
const store = (k, d) => { try { return JSON.parse(localStorage[k]) } catch { return d } };
let tabs = [], cur = null, n = 0;
let bms = store('bm', []), hist = store('hist', []);

// Interne Seiten (Startseite) zeigen wir als leere Adressleiste
const isInt = u => !u || /^(https?:\/\/tauri\.localhost|tauri:\/\/)/.test(u);
const byId = id => tabs.find(t => t.id === id);

const norm = t => {
  t = t.trim(); if (!t) return null;
  if (/^(https?):\/\//.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) || /^localhost(:\d+)?/.test(t)) return 'https://' + t;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(t);
};

// Bereich für die Seiten melden (Tabs liegen als eigene Webviews über #views)
async function layoutSend() {
  const r = $('#views').getBoundingClientRect();
  await invoke('layout', { x: r.left, y: r.top, w: r.width, h: r.height });
}
new ResizeObserver(() => layoutSend()).observe($('#views'));

const act = (action, arg) => cur && invoke('tab_action', { id: cur.id, action, arg: arg == null ? null : String(arg) }).catch(console.error);
const go = url => cur && invoke('tab_navigate', { id: cur.id, url }).catch(console.error);

async function addTab(url = 'app:start') {
  const id = ++n, t = { id, title: 'Neuer Tab', url: '', zoom: 0 };
  tabs.push(t);
  await layoutSend();
  await invoke('tab_new', { id, url });
  select(t); return t;
}
async function select(t) {
  cur = t; draw(); $('#url').value = t.url;
  await invoke('tab_show', { id: t.id });
}
function close(t) {
  const i = tabs.indexOf(t);
  invoke('tab_close', { id: t.id }); tabs.splice(i, 1);
  if (!tabs.length) addTab(); else if (cur === t) select(tabs[Math.max(0, i - 1)]); else draw();
}
function draw() {
  $('#tabs').innerHTML = ''; tabs.forEach(t => { const d = document.createElement('div');
    d.className = 'tab' + (t === cur ? ' on' : ''); d.innerHTML = '<span></span><b title="Schließen">×</b>';
    d.firstChild.textContent = t.title; d.onclick = () => select(t);
    d.lastChild.onclick = e => { e.stopPropagation(); close(t) }; $('#tabs').append(d) });
  const p = document.createElement('button'); p.textContent = '+'; p.title = 'Neuer Tab';
  p.style.cssText = 'background:none;border:0;color:var(--mut);font-size:18px;cursor:pointer'; p.onclick = () => addTab(); $('#tabs').append(p);
}
function addHist(title, url) {
  if (!url || (hist[0] && hist[0].url === url)) return;
  hist.unshift({ title, url, t: Date.now() }); hist = hist.slice(0, 500); localStorage.hist = JSON.stringify(hist);
}

// Ereignisse aus den Tabs (kommen aus main.rs)
listen('tab-title', e => { const t = byId(e.payload.id); if (t) { t.title = e.payload.value || t.title; draw() } });
listen('tab-url', e => {
  const t = byId(e.payload.id); if (!t) return;
  t.url = isInt(e.payload.value) ? '' : e.payload.value;
  if (cur === t) $('#url').value = t.url;
  addHist(t.title, t.url);
});
listen('tab-open', e => addTab(e.payload));

$('#url').onkeydown = e => { if (e.key === 'Enter') { const u = norm(e.target.value); if (u) go(u) } };
$('#back').onclick = () => act('back');
$('#fwd').onclick = () => act('forward');
$('#reload').onclick = () => act('reload');
$('#devt').onclick = () => act('devtools');
const setZ = d => { if (!cur) return; cur.zoom = Math.max(-3, Math.min(5, cur.zoom + d)); act('zoom', Math.pow(1.2, cur.zoom)) };
$('#zoomi').onclick = () => setZ(.5); $('#zoomo').onclick = () => setZ(-.5);
$('#star').onclick = () => { if (!cur || !cur.url) return; if (!bms.some(b => b.url === cur.url)) bms.push({ title: cur.title, url: cur.url });
  localStorage.bm = JSON.stringify(bms); if (open === 'bm') { open = null; panel('bm') } };
$('#fq').oninput = e => e.target.value ? act('find', e.target.value) : act('clearfind');
$('#fnext').onclick = () => { const q = $('#fq').value; if (q) act('findnext', q) };

let open = null;
function link(x) { const a = document.createElement('a'); a.textContent = x.title || x.url; a.title = x.url; a.onclick = () => go(x.url); return a }
function panel(k) {
  const p = $('#panel'); document.querySelectorAll('#side button').forEach(b => b.classList.toggle('on', b.dataset.p === k && open !== k));
  if (open === k) { open = null; p.style.display = 'none'; return }
  open = k; p.style.display = 'block'; p.innerHTML = '';
  if (k === 'bm') { p.innerHTML = '<h3>Lesezeichen</h3>'; if (!bms.length) p.append('Noch leer. Klicke ☆ in der Adressleiste.'); bms.forEach(b => p.append(link(b))) }
  if (k === 'hist') { p.innerHTML = '<h3>Verlauf</h3><button id="clr">Verlauf löschen</button>'; hist.slice(0, 100).forEach(h => p.append(link(h)));
    p.querySelector('#clr').onclick = () => { hist = []; localStorage.hist = '[]'; open = null; panel('hist') } }
  if (k === 'notes') { p.innerHTML = '<h3>Notizen</h3><textarea placeholder="Hier schreiben, wird automatisch gespeichert"></textarea>';
    const ta = p.querySelector('textarea'); ta.value = localStorage.notes || ''; ta.oninput = () => localStorage.notes = ta.value }
  if (k === 'set') { p.innerHTML = '<h3>Einstellungen</h3><button id="th">Hell/Dunkel wechseln</button><br><button id="ck">Cookies &amp; Cache löschen</button>';
    p.querySelector('#th').onclick = () => { document.body.classList.toggle('light'); localStorage.light = document.body.classList.contains('light') ? 1 : '' };
    p.querySelector('#ck').onclick = async () => {
      // Löschen betrifft alle Webviews der App, also auch unsere eigenen Daten -> vorher sichern, danach zurückschreiben
      const keep = {}; ['bm', 'hist', 'notes', 'light'].forEach(k => { if (localStorage[k] != null) keep[k] = localStorage[k] });
      await invoke('clear_data').catch(console.error);
      Object.entries(keep).forEach(([k, v]) => localStorage[k] = v);
      p.querySelector('#ck').textContent = 'Gelöscht ✓';
    } }
}
document.querySelectorAll('#side button').forEach(b => b.onclick = () => panel(b.dataset.p));
onkeydown = e => { if (!e.ctrlKey) return; const k = e.key.toLowerCase();
  if (k === 't') { e.preventDefault(); addTab() } if (k === 'w') { e.preventDefault(); cur && close(cur) }
  if (k === 'l') { e.preventDefault(); $('#url').select() } if (k === 'r') { e.preventDefault(); act('reload') }
  if (k === 'f') { e.preventDefault(); $('#find').style.display = 'block'; $('#fq').focus() }
  if (k === 'tab') { e.preventDefault(); select(tabs[(tabs.indexOf(cur) + 1) % tabs.length]) } };
if (localStorage.light) document.body.classList.add('light');
addTab();
