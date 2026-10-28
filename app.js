'use strict';

// ---------- 设备预设 ----------
const DEVICES = [
  { id: 'ip16pm', name: 'iPhone 16 Pro Max', w: 1320, h: 2868, type: 'phone' },
  { id: 'ip16p', name: 'iPhone 16 Pro', w: 1206, h: 2622, type: 'phone' },
  { id: 'ip16', name: 'iPhone 16 / 15', w: 1179, h: 2556, type: 'phone' },
  { id: 'andr', name: 'Android 1080×2400', w: 1080, h: 2400, type: 'phone' },
  { id: 'ipadpro', name: 'iPad Pro 13″', w: 2064, h: 2752, type: 'tablet' },
  { id: 'ipadair', name: 'iPad Air 11″', w: 1640, h: 2360, type: 'tablet' },
  { id: 'mba13', name: 'MacBook Air 13″', w: 2560, h: 1664, type: 'laptop' },
  { id: 'mbp14', name: 'MacBook Pro 14″', w: 3024, h: 1964, type: 'laptop' },
  { id: 'mbp16', name: 'MacBook Pro 16″', w: 3456, h: 2234, type: 'laptop' },
  { id: 'fhd', name: '显示器 1920×1080', w: 1920, h: 1080, type: 'desktop' },
  { id: 'qhd', name: '显示器 2560×1440', w: 2560, h: 1440, type: 'desktop' },
  { id: 'uhd', name: '显示器 4K', w: 3840, h: 2160, type: 'desktop' },
  { id: '5k', name: 'Studio Display 5K', w: 5120, h: 2880, type: 'desktop' },
  { id: 'custom', name: '自定义', w: 0, h: 0, type: 'auto' },
];

const DEFAULTS = {
  device: 'ip16p', w: 1206, h: 2622, cols: 3, gap: 0, pad: 0, radius: 0, offset: 0,
  bg: '#111111', repeat: true, overlay: true,
};

const $ = (s) => document.querySelector(s);
const STORE_KEY = 'sleeve.v1';

let state = load();
let undoStack = [];
let lastResults = [];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.items)) return { items: s.items, settings: { ...DEFAULTS, ...s.settings } };
  } catch {}
  return { items: [], settings: { ...DEFAULTS } };
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { toast('本地存储已满，上传的图片可能无法保存'); }
  }, 200);
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- 封面地址 ----------
// iTunes 的封面地址形如 .../xxx.jpg/100x100bb.jpg，把尺寸换掉即可；请求超过原始尺寸时返回原图最大尺寸
const artBase = (u) => u.replace(/\/\d+x\d+[a-z]*\.(jpg|png|webp)$/i, '');
function artUrl(item, size) {
  if (item.local) return item.art;
  return `${item.art}/${size === 'max' ? '9999x9999' : `${size}x${size}`}bb.jpg`;
}

// ---------- 搜索 ----------
const searchCache = new Map();

async function fetchStore(term, attr, country) {
  const p = new URLSearchParams({ term, entity: 'album', media: 'music', limit: '200', country });
  if (attr) p.set('attribute', attr);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`https://itunes.apple.com/search?${p}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? '请求太频繁' : `HTTP ${res.status}`);
    return (await res.json()).results || [];
  } finally {
    clearTimeout(timer);
  }
}

async function search(term, attr, stores) {
  const key = [term.toLowerCase(), attr, stores].join('|');
  if (searchCache.has(key)) return searchCache.get(key);

  const settled = await Promise.allSettled(stores.split(',').map((c) => fetchStore(term, attr, c)));
  const lists = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (!lists.length) throw settled[0].reason;

  // 各地区结果交替合并，保持相关度顺序；按封面图去重（同一专辑不同地区版本封面相同）
  const seen = new Set();
  const out = [];
  const max = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      const r = list[i];
      if (!r || !r.artworkUrl100) continue;
      const art = artBase(r.artworkUrl100);
      const k = art.split('/').slice(-1)[0] + '|' + r.collectionName;
      if (seen.has(art) || seen.has(k)) continue;
      seen.add(art); seen.add(k);
      out.push({
        id: String(r.collectionId),
        title: r.collectionName,
        artist: r.artistName,
        year: (r.releaseDate || '').slice(0, 4),
        art,
      });
    }
  }
  const partial = lists.length < settled.length;
  const result = { items: out, partial };
  searchCache.set(key, result);
  return result;
}

async function runSearch() {
  const term = $('#q').value.trim();
  if (!term) return;
  const status = $('#status');
  status.textContent = '搜索中…';
  try {
    const { items, partial } = await search(term, $('#attr').value, $('#store').value);
    lastResults = items;
    renderResults();
    status.textContent = items.length
      ? `找到 ${items.length} 张专辑${partial ? '（部分地区曲库未响应）' : ''}`
      : '没有找到。试试换个写法，或切换曲库地区。';
  } catch (e) {
    const msg = e.name === 'AbortError' ? '请求超时' : e.message || '网络错误';
    status.innerHTML = `搜索失败：${escapeHtml(msg)}<button class="ghost" id="retryBtn">重试</button>`;
    $('#retryBtn').onclick = runSearch;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderResults() {
  const added = new Set(state.items.map((i) => i.art));
  $('#results').innerHTML = lastResults.map((r, i) => `
    <div class="card${added.has(r.art) ? ' added' : ''}" data-i="${i}" title="${escapeHtml(r.title)} — ${escapeHtml(r.artist)}">
      <div class="art"><img loading="lazy" src="${artUrl(r, 300)}" alt=""></div>
      <button class="dl" data-dl="${i}" title="下载原图">原图 ↓</button>
      <div class="t">${escapeHtml(r.title)}</div>
      <div class="a">${escapeHtml(r.artist)}${r.year ? ' · ' + r.year : ''}</div>
    </div>`).join('');
}

$('#results').addEventListener('click', (e) => {
  const dl = e.target.closest('[data-dl]');
  if (dl) { e.stopPropagation(); downloadOriginal(lastResults[dl.dataset.dl], dl); return; }
  const card = e.target.closest('.card');
  if (!card) return;
  const r = lastResults[card.dataset.i];
  const idx = state.items.findIndex((i) => i.art === r.art);
  pushUndo();
  if (idx >= 0) { state.items.splice(idx, 1); toast('已移出'); }
  else { state.items.push({ ...r, uid: uid() }); toast(`已加入第 ${state.items.length} 格`); }
  changed();
});

async function downloadOriginal(item, btn) {
  const old = btn.textContent;
  btn.textContent = '下载中…';
  try {
    const res = await fetch(artUrl(item, 'max'));
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    const size = await imageSize(blob);
    saveBlob(blob, safeName(`${item.artist} - ${item.title}`) + '.jpg');
    toast(`已下载 ${size}`);
  } catch {
    window.open(artUrl(item, 'max'), '_blank');
  } finally {
    btn.textContent = old;
  }
}

async function imageSize(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    return `${bmp.width}×${bmp.height}`;
  } catch { return ''; }
}

const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const uid = () => Math.random().toString(36).slice(2, 10);

// 上传本地图片：压到 1600px 以内存进草稿
$('#upload').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  pushUndo();
  for (const f of files) {
    try {
      const bmp = await createImageBitmap(f);
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      state.items.push({ uid: uid(), local: true, title: f.name.replace(/\.[^.]+$/, ''), artist: '本地', art: c.toDataURL('image/jpeg', 0.9) });
    } catch { toast(`无法读取 ${f.name}`); }
  }
  changed();
  toast(`已加入 ${files.length} 张`);
});

// ---------- 排列板 ----------
function pushUndo() {
  undoStack.push(JSON.stringify(state.items));
  if (undoStack.length > 60) undoStack.shift();
}
function undo() {
  if (!undoStack.length) return toast('没有可撤销的操作');
  state.items = JSON.parse(undoStack.pop());
  changed();
}

function renderBoard() {
  const board = $('#board');
  board.style.gridTemplateColumns = `repeat(${state.settings.cols}, 1fr)`;
  board.innerHTML = state.items.map((it, i) => `
    <div class="tile" data-uid="${it.uid}" title="${escapeHtml(it.title)} — ${escapeHtml(it.artist)}">
      <img src="${artUrl(it, 200)}" alt="">
      <span class="n">${i + 1}</span>
      <button class="x" data-rm="${it.uid}" title="移除">✕</button>
    </div>`).join('');
  $('#count').textContent = state.items.length ? `${state.items.length} 张` : '';
}

$('#board').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (!rm) return;
  pushUndo();
  state.items = state.items.filter((i) => i.uid !== rm.dataset.rm);
  changed();
});

Sortable.create($('#board'), {
  animation: 160,
  delay: 120,
  delayOnTouchOnly: true,
  ghostClass: 'ghosting',
  chosenClass: 'chosen',
  filter: '.x',
  preventOnFilter: false,
  onEnd(ev) {
    if (ev.oldIndex === ev.newIndex) return;
    pushUndo();
    const [m] = state.items.splice(ev.oldIndex, 1);
    state.items.splice(ev.newIndex, 0, m);
    changed();
  },
});

$('#shuffleBtn').onclick = () => {
  pushUndo();
  const a = state.items;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  changed();
};
$('#reverseBtn').onclick = () => { pushUndo(); state.items.reverse(); changed(); };
$('#clearBtn').onclick = () => {
  if (!state.items.length) return;
  pushUndo(); state.items = []; changed(); toast('已清空，可撤销');
};
$('#undoBtn').onclick = undo;
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault(); undo();
  }
});

function changed() {
  save();
  renderBoard();
  markAdded();
  schedulePreview();
}

function markAdded() {
  const added = new Set(state.items.map((i) => i.art));
  document.querySelectorAll('#results .card').forEach((c) => {
    c.classList.toggle('added', added.has(lastResults[c.dataset.i].art));
  });
}

// ---------- 版式计算与绘制（预览与导出共用） ----------
function layout(s, n) {
  const { w: W, h: H, cols, gap, pad } = s;
  const cell = (W - 2 * pad - (cols - 1) * gap) / cols;
  const fillRows = Math.max(1, Math.ceil((H - 2 * pad + gap) / (cell + gap)));
  const rows = s.repeat ? fillRows : Math.max(1, Math.ceil(n / cols));
  const contentH = rows * cell + (rows - 1) * gap;
  let y0 = (H - contentH) / 2;
  y0 += (s.offset / 100) * H;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const item = !n ? null : s.repeat ? i % n : i < n ? i : null;
      cells.push({ x: pad + c * (cell + gap), y: y0 + r * (cell + gap), size: cell, item });
    }
  }
  return { cell, cells };
}

const imgCache = new Map();
function loadImg(url) {
  if (!imgCache.has(url)) {
    imgCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => { imgCache.delete(url); resolve(null); };
      img.src = url;
    }));
  }
  return imgCache.get(url);
}

const pickSize = (px) => (px <= 300 ? 300 : px <= 600 ? 600 : px <= 1200 ? 1200 : 'max');

async function draw(ctx, s, scale, items) {
  const { cell, cells } = layout(s, items.length);
  const size = pickSize(cell * scale);
  const imgs = await Promise.all(items.map((it) => loadImg(artUrl(it, size))));
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, s.w, s.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const r = (s.radius / 100) * cell;
  for (const c of cells) {
    if (c.item == null || c.y > s.h || c.y + c.size < 0) continue;
    const img = imgs[c.item];
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.size, c.size, r);
    ctx.clip();
    if (img) {
      // 非方形图居中裁切
      const k = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, c.x, c.y, c.size, c.size);
    } else {
      ctx.fillStyle = '#2a2724';
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------- 预览 ----------
let previewToken = 0;
let previewRaf;
function schedulePreview() {
  cancelAnimationFrame(previewRaf);
  previewRaf = requestAnimationFrame(renderPreview);
}

function deviceType() {
  const s = state.settings;
  const d = DEVICES.find((x) => x.id === s.device);
  if (d && d.type !== 'auto') return d.type;
  const ratio = s.h / s.w;
  return ratio > 1.7 ? 'phone' : ratio > 1 ? 'tablet' : 'desktop';
}

function buildFrame(type) {
  const frame = $('#frame');
  if (frame.dataset.type === type) return;
  const screen = frame.querySelector('.screen');
  frame.className = `frame ${type}`;
  frame.dataset.type = type;
  frame.innerHTML = '';
  if (type === 'laptop' || type === 'desktop') {
    const lid = document.createElement('div');
    lid.className = 'lid';
    lid.appendChild(screen);
    frame.appendChild(lid);
    if (type === 'laptop') frame.insertAdjacentHTML('beforeend', '<div class="base"></div>');
    else frame.insertAdjacentHTML('beforeend', '<div class="stand"></div><div class="foot"></div>');
  } else {
    frame.appendChild(screen);
  }
}

function sizeFrame() {
  const s = state.settings;
  const type = deviceType();
  buildFrame(type);
  const stage = $('.stage');
  const availW = stage.clientWidth - 20;
  const availH = stage.clientHeight - 20;
  if (availW <= 0 || availH <= 0) return null;
  const aspect = s.h / s.w;
  const frame = $('#frame');
  let screenW;
  if (type === 'phone' || type === 'tablet') {
    const bzK = type === 'phone' ? 0.045 : 0.035; // 边框占屏宽比例
    // 总宽 = sw*(1+2bz)，总高 = sw*(aspect+2bz)
    screenW = Math.min(availW / (1 + 2 * bzK), availH / (aspect + 2 * bzK));
    const bz = screenW * bzK;
    const inner = screenW * (type === 'phone' ? 0.14 : 0.04);
    frame.style.setProperty('--bz', `${bz}px`);
    frame.style.setProperty('--inner', `${inner}px`);
    frame.style.setProperty('--outer', `${inner + bz}px`);
  } else {
    // 外框：屏幕 + 边框约 5%，底座额外高度
    const extraH = type === 'laptop' ? 14 : 60;
    screenW = Math.min(availW / (type === 'laptop' ? 1.2 : 1.03), (availH - extraH) / (aspect * 1.05 + 0.03));
  }
  screenW = Math.floor(screenW);
  const screen = frame.querySelector('.screen');
  screen.style.width = `${screenW}px`;
  screen.style.height = `${Math.round(screenW * aspect)}px`;
  frame.style.width = type === 'phone' || type === 'tablet' ? 'auto' : `${Math.round(screenW * 1.045)}px`;
  screen.style.setProperty('--sw', `${screenW}px`);
  renderSysUI(type, screenW);
  return screenW;
}

function renderSysUI(type, sw) {
  const ui = $('#sysui');
  if (!state.settings.overlay) { ui.innerHTML = ''; return; }
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  if (type === 'phone') {
    ui.innerHTML = `<div class="lock-date">${date}</div><div class="lock-time">${time}</div>
      <div class="flash" style="left:9%"></div><div class="flash" style="right:9%"></div><div class="homebar"></div>`;
  } else if (type === 'tablet') {
    ui.innerHTML = `<div class="lock-date" style="font-size:${sw * 0.03}px;top:9%">${date}</div>
      <div class="lock-time" style="font-size:${sw * 0.16}px;top:11%">${time}</div><div class="homebar" style="width:22%"></div>`;
  } else {
    ui.innerHTML = '<div class="menubar"></div><div class="dock"></div>';
  }
}

async function renderPreview() {
  const token = ++previewToken;
  const s = state.settings;
  const sw = sizeFrame();
  if (!sw) return;
  const canvas = $('#preview');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = (sw * dpr) / s.w;
  const off = document.createElement('canvas');
  off.width = Math.round(s.w * scale);
  off.height = Math.round(s.h * scale);
  await draw(off.getContext('2d'), s, scale, state.items);
  if (token !== previewToken) return; // 期间已有新的渲染
  canvas.width = off.width;
  canvas.height = off.height;
  canvas.getContext('2d').drawImage(off, 0, 0);
  const { cells } = layout(s, state.items.length);
  const d = DEVICES.find((x) => x.id === s.device);
  $('#previewMeta').textContent = `${d && d.id !== 'custom' ? d.name + ' · ' : ''}${s.w}×${s.h} · ${cells.length} 格`;
}

new ResizeObserver(schedulePreview).observe($('.stage'));

// ---------- 导出 ----------
$('#exportBtn').onclick = async () => {
  const s = state.settings;
  if (!state.items.length) return toast('先加入一些封面');
  const btn = $('#exportBtn');
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    const c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    await draw(c.getContext('2d'), s, 1, state.items);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    saveBlob(blob, `sleeve-${s.w}x${s.h}.png`);
    toast('壁纸已导出');
  } catch (e) {
    console.error(e);
    toast('导出失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出壁纸';
  }
};

// ---------- 设置面板 ----------
const deviceSel = $('#device');
deviceSel.innerHTML = DEVICES.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');

const RATIOS = [
  [9, 19.5, '9:19.5 新款 iPhone'], [9, 20, '9:20 安卓全面屏'], [9, 16, '9:16'], [3, 4, '3:4 iPad'],
  [1, 1, '1:1'], [4, 3, '4:3'], [3, 2, '3:2'], [16, 10, '16:10 MacBook'], [16, 9, '16:9'],
  [21, 9, '21:9 带鱼屏'], [32, 9, '32:9'],
];
const ratioSel = $('#ratio');
ratioSel.innerHTML = '<option value="">自定义</option>' +
  RATIOS.map(([a, b, name], i) => `<option value="${i}">${name}</option>`).join('');

// 当前尺寸与哪个预设比例吻合（允许 1.5% 误差，设备分辨率不一定是整比例）
function matchRatio(w, h) {
  const i = RATIOS.findIndex(([a, b]) => Math.abs((w / h) / (a / b) - 1) < 0.015);
  return i < 0 ? '' : String(i);
}

const ranges = { cols: '', gap: 'px', pad: 'px', radius: '%', offset: '%' };
function syncControls() {
  const s = state.settings;
  deviceSel.value = s.device;
  ratioSel.value = matchRatio(s.w, s.h);
  $('#w').value = s.w; $('#h').value = s.h;
  for (const [k, unit] of Object.entries(ranges)) {
    $('#' + k).value = s[k];
    $(`#${k}Out`).textContent = s[k] + unit;
  }
  $('#bg').value = s.bg;
  $('#repeat').checked = s.repeat;
  $('#overlay').checked = s.overlay;
}

function setSetting(patch) {
  Object.assign(state.settings, patch);
  syncControls();
  save();
  renderBoard();
  schedulePreview();
}

deviceSel.onchange = () => {
  const d = DEVICES.find((x) => x.id === deviceSel.value);
  if (d.id === 'custom') return setSetting({ device: 'custom' });
  // 换方向时按屏幕宽高比缩放每行数量，保持格子大小相近
  const s = state.settings;
  const k = Math.sqrt((d.w / d.h) / (s.w / s.h));
  const cols = Math.max(1, Math.min(12, Math.round(s.cols * k)));
  setSetting({ device: d.id, w: d.w, h: d.h, cols });
};
ratioSel.onchange = () => {
  if (ratioSel.value === '') return;
  const [a, b] = RATIOS[+ratioSel.value];
  const s = state.settings;
  // 保留长边像素，短边按比例换算
  const L = Math.max(s.w, s.h);
  const w = a >= b ? L : Math.round((L * a) / b);
  const h = a >= b ? Math.round((L * b) / a) : L;
  const k = Math.sqrt((w / h) / (s.w / s.h));
  const cols = Math.max(1, Math.min(12, Math.round(s.cols * k)));
  setSetting({ w, h, device: 'custom', cols });
};
for (const k of ['w', 'h']) {
  $('#' + k).onchange = (e) => {
    const v = Math.max(200, Math.min(8000, Math.round(+e.target.value) || 0));
    setSetting({ [k]: v, device: 'custom' });
  };
}
$('#rotateBtn').onclick = () => {
  const s = state.settings;
  const cols = Math.max(1, Math.min(12, Math.round(s.cols * (s.h / s.w))));
  setSetting({ w: s.h, h: s.w, device: 'custom', cols });
};
for (const k of Object.keys(ranges)) $('#' + k).oninput = (e) => setSetting({ [k]: +e.target.value });
$('#bg').oninput = (e) => setSetting({ bg: e.target.value });
$('#repeat').onchange = (e) => setSetting({ repeat: e.target.checked });
$('#overlay').onchange = (e) => setSetting({ overlay: e.target.checked });

// ---------- 移动端标签页 ----------
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('.layout').dataset.tab = b.dataset.tab;
    schedulePreview();
  };
});

$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });

syncControls();
renderBoard();
schedulePreview();
