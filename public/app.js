let NOTES = [], SEL = null, SEQ = 'now', FULL = {}, MEDIA = {};
const $ = s => document.querySelector(s);

async function j(u) { const r = await fetch(u); return r.json(); }

// Ubah sintaks Obsidian jadi markdown standar + path /vault agar gambar/lampiran tampil.
function obsidianToMd(text, noteRel) {
  const dir = (noteRel || '').includes('/') ? (noteRel || '').split('/').slice(0, -1).join('/') : '';
  const resolveMedia = (name) => {
    name = decodeURIComponent(name.trim());
    if (/^(https?:|data:)/i.test(name)) return name;
    const base = name.split('/').pop().toLowerCase();
    if (MEDIA[base]) return '/vault/' + MEDIA[base].split('/').map(encodeURIComponent).join('/');
    const cand = [dir ? dir + '/' + name : name, name].filter(Boolean);
    return '/vault/' + cand[0].split('/').map(encodeURIComponent).join('/');
  };
  // Embed gambar: ![[foto.png]] / ![[foto.png|300]]
  text = text.replace(/!\[\[([^\]]+)\]\]/g, (m, inner) => {
    const name = inner.split('|')[0].split('#')[0].trim();
    if (/\.(png|jpe?g|gif|svg|webp|bmp|mp4|webm|pdf)$/i.test(name)) return `![](${resolveMedia(name)})`;
    return m; // embed note non-gambar: biarkan, ditangani sebagai link
  });
  // Wikilink: [[Note]] / [[Note#H|Alias]] -> [Alias](#note:Note)
  text = text.replace(/(^|[^!])\[\[([^\]]+)\]\]/g, (m, pre, inner) => {
    const target = inner.split('#')[0].split('|')[0].trim();
    const alias = inner.includes('|') ? inner.split('|').slice(1).join('|').trim() : target;
    return `${pre}[${alias}](#note:${encodeURIComponent(target)})`;
  });
  return text;
}

async function health() {
  try {
    const h = await j('/api/health');
    $('#health').textContent = h.ok ? `● LIVE · ${h.db.docs} docs · seq ${String(h.db.update_seq).slice(0,12)}` : '○ CouchDB error';
    $('#health').style.color = h.ok ? '#9fd68f' : '#e08a8a';
  } catch { $('#health').textContent = '○ server belum jalan'; }
}

async function loadDocs() {
  const d = await j('/api/local-docs');
  if (!d.ok) { $('#health').textContent = '○ ' + String(d.error).slice(0,140); return; }
  NOTES = d.notes;
  MEDIA = {};
  for (const m of (d.media || [])) MEDIA[m.split('/').pop().toLowerCase()] = m;
  renderList($('#q').value);
  if (!SEL && NOTES.length) select(NOTES[0].id);
  if (SEL) drawGraph();
}

function folderOf(n) {
  const parts = (n.rel || n.id).split('/');
  return parts.length > 1 ? parts[0] : 'Root';
}
function renderList(f='') {
  f = f.toLowerCase();
  const box = $('#list'); box.innerHTML = '';
  const items = NOTES.filter(n => (n.name + ' ' + (n.rel||n.id)).toLowerCase().includes(f)).slice(0, 800);
  $('#count').textContent = items.length + '/' + NOTES.length;
  const groups = {};
  const rootItems = [];
  for (const n of items) {
    const parts = (n.rel || n.id).split('/');
    if (parts.length > 1) { const g = parts[0]; (groups[g] = groups[g] || []).push(n); }
    else rootItems.push(n);
  }
  const fileRow = (n) => {
    const li = document.createElement('li');
    li.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 1.5h5.6L12.5 5v9.5h-9v-13zM9 1.5V5h3.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
    const sp = document.createElement('span');
    sp.className = 'fname'; sp.textContent = n.name.replace(/\.md$/i, '');
    li.appendChild(sp); li.title = n.rel || n.id;
    if (n.id === SEL) li.classList.add('sel');
    li.onclick = () => select(n.id);
    return li;
  };
  const names = Object.keys(groups).sort((a,b) => a.localeCompare(b));
  for (const g of names) {
    const det = document.createElement('details');
    det.className = 'grp'; det.open = true;
    const sum = document.createElement('summary');
    sum.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 4.5c0-.8.7-1.5 1.5-1.5h3l1.2 1.5H13c.8 0 1.5.7 1.5 1.5v4c0 .8-.7 1.5-1.5 1.5H3c-.8 0-1.5-.7-1.5-1.5v-5.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="gname">${g}</span><span class="gcount">${groups[g].length}</span>`;
    det.appendChild(sum);
    const ul = document.createElement('ul');
    ul.className = 'flist';
    for (const n of groups[g]) ul.appendChild(fileRow(n));
    det.appendChild(ul);
    box.appendChild(det);
  }
  if (rootItems.length) {
    const div = document.createElement('div');
    div.className = 'rootsep'; div.textContent = 'Root files';
    box.appendChild(div);
    const ul = document.createElement('ul');
    ul.className = 'flist rootlist';
    for (const n of rootItems) ul.appendChild(fileRow(n));
    box.appendChild(ul);
  }
}

async function select(id) {
  SEL = id;
  document.querySelectorAll('#list li').forEach(li => li.classList.toggle('sel', li.title === id));
  const d = await j('/api/local-doc?rel=' + encodeURIComponent(id));
  FULL = d;
  const cur = NOTES.find(n=>n.id===id) || {};
  $('#title').textContent = cur.name || id;
  $('#meta').textContent = cur.rel ? `${cur.rel} · ${(cur.size/1024).toFixed(1)} KB · ${new Date(cur.mtime).toLocaleString('id-ID')}` : '';
  $('#raw').textContent = (d.text || '').slice(0, 20000) || '(kosong)';
  const std = obsidianToMd(d.text || '', id);
  $('#md').innerHTML = window.marked ? marked.parse(std) : '<pre>' + std.replace(/</g,'&lt;') + '</pre>';
  // Betulkan <img> relatif -> /vault/... ; link #note:X -> buka note bila cocok
  const noteDir = id.includes('/') ? id.split('/').slice(0,-1).join('/') : '';
  $('#md').querySelectorAll('img').forEach(img => {
    let s = img.getAttribute('src') || '';
    const base0 = decodeURIComponent(s.split('/').pop().split('?')[0]).toLowerCase();
    if (MEDIA[base0] && !/^(https?:|data:|blob:)/i.test(s)) {
      // Nama file dikenal se-vault (mis. lampiran/...) -> langsung ke lokasi benar, tanpa 404 dulu
      img.setAttribute('src', '/vault/' + MEDIA[base0].split('/').map(encodeURIComponent).join('/'));
      s = img.getAttribute('src');
    }
    else if (/^\.\.\/_gambar\//i.test(s)) {
      img.setAttribute('src', '/gambar/' + s.replace(/^\.\.\/_gambar\//i, '').split('/').map(encodeURIComponent).join('/'));
      s = img.getAttribute('src');
    }
    if (!/^(https?:|data:|blob:|\/vault\/)/i.test(s)) {
      s = s.replace(/^\.\//, '');
      const rel = (noteDir ? noteDir + '/' + s : s).split('/').map(encodeURIComponent).join('/');
      img.setAttribute('src', '/vault/' + rel);
    }
    img.loading = 'lazy';
    img.title = img.getAttribute('src') || '';
    img.onerror = () => {
      if (img.dataset.fb) {
        // Gagal total: tandai + tampilkan path aslinya biar gampang lapor
        img.style.border = '1px dashed #a66'; img.alt = 'gambar tidak ketemu: ' + (img.getAttribute('src') || '');
        return;
      }
      img.dataset.fb = '1';
      const raw = (img.getAttribute('src') || '').split('/').pop().toLowerCase();
      const name = decodeURIComponent(raw);
      if (MEDIA[name]) img.src = '/vault/' + MEDIA[name].split('/').map(encodeURIComponent).join('/');
    };
  });
  const byBase = {};
  NOTES.forEach(n => { byBase[n.base.toLowerCase()] = n.id; byBase[n.name.toLowerCase()] = n.id; });
  $('#md').querySelectorAll('a[href^="#note:"]').forEach(a => {
    const target = decodeURIComponent(a.getAttribute('href').replace('#note:', '')).toLowerCase();
    const hit = byBase[target] || byBase[target + '.md'];
    if (hit) { a.onclick = e => { e.preventDefault(); select(hit); }; }
    else { a.removeAttribute('href'); a.style.borderBottom = '1px dotted #666'; }
  });
  // backlinks: siapa yang link ke note ini?
  const me = ($('#title').textContent || '').toLowerCase().replace(/\.md$/,'');
  const bl = NOTES.filter(n => (n.links||[]).some(l => l.toLowerCase() === me || (n.preview||'').toLowerCase().includes(me)));
  $('#backlinks').innerHTML = bl.length ? '<b>Backlinks ('+bl.length+'):</b> ' + bl.map(n=>`<a href="#" data-id="${n.id}">${n.name}</a>`).join(' · ') : 'Tidak ada backlinks terdeteksi.';
  $('#backlinks').querySelectorAll('a').forEach(a => a.onclick = e => { e.preventDefault(); select(a.dataset.id); });
  drawGraph();
}

// ---- graph: fisika stabil + motion halus ----
let nodes=[], edges=[], cam={x:0,y:0,z:1}, gRAF=null;
let gHover=null, gDrag=null, gBorn=0;
const GPOS = {}; // posisi stabil antar-render, key = note id
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
function buildGraph() {
  const idx = {};
  const list = NOTES.slice(0, 300);
  nodes = list.map((n,i)=>{
    idx[n.id]=i;
    const p = GPOS[n.id] || { x: (Math.random()-0.5)*600, y: (Math.random()-0.5)*600 };
    return { id:n.id, label:n.name, x:p.x, y:p.y, vx:0, vy:0, deg:0, born: gBorn + i*28 };
  });
  edges = [];
  const name2id = {};
  NOTES.forEach(n=>{
    name2id[n.name.toLowerCase().replace(/\.md$/,'')] = n.id;
    name2id[(n.base||'').toLowerCase()] = n.id;
  });
  list.forEach(n=>{
    (n.links||[]).forEach(l=>{
      const t = name2id[String(l).toLowerCase().replace(/\.md$/,'')];
      if (t && idx[t]!==undefined && t!==n.id) { edges.push([idx[n.id], idx[t]]); nodes[idx[n.id]].deg++; nodes[idx[t]].deg++; }
    });
  });
}
function drawGraph() {
  if (!NOTES.length) return;
  buildGraph();
  gBorn = performance.now();
  nodes.forEach((n,i)=>{ n.born = gBorn + i*28; });
  const cv = $('#cv'); if(!cv) return;
  const ctx = cv.getContext('2d');
  const rs = ()=>{ const r = cv.getBoundingClientRect(); cv.width = Math.max(50, r.width); cv.height = Math.max(50, r.height); };
  rs();
  if (gRAF) cancelAnimationFrame(gRAF);
  let temp = 1; // pendinginan simulasi biar cepat stabil
  const LINK_DIST = 130, REPEL = 9000, GRAV = 0.012;
  (function tick(now){
    gRAF = null;
    const t = now || performance.now();
    // --- fisika: tolak + pegas panjang-ideal + gravitasi tengah + redam ---
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i],b=nodes[j];
      let dx=a.x-b.x, dy=a.y-b.y, d=Math.hypot(dx,dy);
      if(d<1){dx=(Math.random()-0.5);dy=(Math.random()-0.5);d=1;}
      if(d<220){ const f=Math.min(REPEL/(d*d),3)*temp; a.vx+=dx/d*f; a.vy+=dy/d*f; b.vx-=dx/d*f; b.vy-=dy/d*f; }
    }
    for(const [i,j] of edges){
      const a=nodes[i],b=nodes[j];
      const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1;
      const f=(d-LINK_DIST)*0.015*temp;
      a.vx+=dx/d*f; a.vy+=dy/d*f; b.vx-=dx/d*f; b.vy-=dy/d*f;
    }
    for(const n of nodes){
      if(n===gDrag) continue;
      n.vx+=-n.x*GRAV*temp; n.vy+=-n.y*GRAV*temp;
      n.vx*=0.82; n.vy*=0.82;
      const step=Math.min(Math.hypot(n.vx,n.vy),24), a=Math.atan2(n.vy,n.vx);
      n.x+=Math.cos(a)*step; n.y+=Math.sin(a)*step;
    }
    temp = Math.max(0.15, temp*0.995);
    // --- gambar ---
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.save(); ctx.translate(cv.width/2+cam.x, cv.height/2+cam.y); ctx.scale(cam.z,cam.z);
    const hovSet = new Set();
    if(gHover){ hovSet.add(gHover.id); for(const [i,j] of edges){ if(nodes[i].id===gHover.id)hovSet.add(nodes[j].id); if(nodes[j].id===gHover.id)hovSet.add(nodes[i].id); } }
    for(const [i,j] of edges){
      const hot = hovSet.has(nodes[i].id) && hovSet.has(nodes[j].id);
      ctx.strokeStyle = hot ? 'rgba(180,160,255,.85)' : 'rgba(90,90,110,.4)';
      ctx.lineWidth = hot ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(nodes[i].x,nodes[i].y); ctx.lineTo(nodes[j].x,nodes[j].y); ctx.stroke();
    }
    for(const n of nodes){
      const sel = n.id===SEL, hov = gHover && gHover.id===n.id;
      const age = REDUCED ? 1 : Math.min(1, Math.max(0, (t - n.born)/450));
      const ease = 1 - Math.pow(1-age, 3);
      const r = (5 + Math.min(n.deg,8)*1.1 + (sel?3:0) + (hov?2:0)) * (0.4 + 0.6*ease);
      if(sel){ const pulse = 3 + Math.sin(t/350)*1.6; ctx.strokeStyle='rgba(124,92,255,.55)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(n.x,n.y,r+pulse,0,7); ctx.stroke(); }
      if(hov){ ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(n.x,n.y,r+3,0,7); ctx.stroke(); }
      ctx.globalAlpha = 0.25 + 0.75*ease;
      ctx.fillStyle = sel ? '#7c5cff' : (n.deg ? '#4cc38a' : '#5a6272');
      ctx.beginPath(); ctx.arc(n.x,n.y,Math.max(r,0.1),0,7); ctx.fill();
      ctx.globalAlpha = 1;
      if(sel || hov || cam.z>1.25 || n.deg>=2){
        ctx.fillStyle = sel||hov ? '#fff' : '#a9a9b5';
        ctx.font = (sel||hov?'600 ':'') + '11px sans-serif';
        ctx.fillText(n.label.replace(/\.md$/i,'').slice(0,26), n.x+10, n.y+4);
      }
      n._sx = n.x*cam.z+cv.width/2+cam.x; n._sy = n.y*cam.z+cv.height/2+cam.y;
      GPOS[n.id] = { x:n.x, y:n.y };
    }
    ctx.restore();
    if(!$('#pane-graph').hidden) gRAF = requestAnimationFrame(tick);
  })(performance.now());
}
function gNodeAt(mx,my){ let best=null,bd=1e9; for(const n of nodes){ const d=Math.hypot((n._sx||0)-mx,(n._sy||0)-my); if(d<bd){bd=d;best=n;} } return bd<22?best:null; }
function gPos(e, cv){ const r=cv.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
function bindGraph(){
  const cv = $('#cv'); if(!cv || cv._bound) return; cv._bound = true;
  cv.addEventListener('mousedown', e=>{ const [mx,my]=gPos(e,cv); const n=gNodeAt(mx,my); if(n){ gDrag=n; cv.style.cursor='grabbing'; } });
  window.addEventListener('mousemove', e=>{
    if(!gDrag || $('#pane-graph').hidden) {
      if(!$('#pane-graph').hidden){ const cv2=$('#cv'); const [mx,my]=gPos(e,cv2); const n=gNodeAt(mx,my); if((n&&!gHover)||(!n&&gHover)){ gHover=n; } cv2.style.cursor=n?'pointer':'default'; }
      return;
    }
    const [mx,my]=gPos(e,cv);
    gDrag.x=(mx-cv.width/2-cam.x)/cam.z; gDrag.y=(my-cv.height/2-cam.y)/cam.z;
    gDrag.vx=gDrag.vy=0;
  });
  window.addEventListener('mouseup', ()=>{ gDrag=null; const cv2=$('#cv'); if(cv2)cv2.style.cursor='default'; });
  cv.addEventListener('click', e=>{ const [mx,my]=gPos(e,cv); const n=gNodeAt(mx,my); if(n) select(n.id); });
  cv.addEventListener('wheel', e=>{ e.preventDefault(); cam.z=Math.min(3.2,Math.max(.3,cam.z*(e.deltaY<0?1.12:0.89))); }, {passive:false});
  cv.addEventListener('dblclick', ()=>{ cam={x:0,y:0,z:1}; });
}
bindGraph();
$('#zin').onclick=()=>cam.z=Math.min(3,cam.z*1.2);
$('#zout').onclick=()=>cam.z=Math.max(.3,cam.z/1.2);
$('#zreset').onclick=()=>cam={x:0,y:0,z:1};

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  const t=b.dataset.t;
  $('#pane-preview').hidden = t!=='preview'; $('#pane-graph').hidden = t!=='graph'; $('#pane-raw').hidden = t!=='raw';
  if(t==='graph') drawGraph();
});
$('#q').oninput=e=>renderList(e.target.value);
document.addEventListener('keydown',e=>{
  if(e.key==='/'){e.preventDefault();$('#q').focus();}
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='b'){e.preventDefault();toggleSide();}
});
function toggleSide(force){
  const hide = force !== undefined ? force : !document.body.classList.contains('side-hidden');
  document.body.classList.toggle('side-hidden', hide);
  try{localStorage.setItem('side-hidden', hide ? '1' : '0');}catch{}
  if(!hide) drawGraph();
}
$('#sideToggle').onclick=()=>toggleSide();
try{if(localStorage.getItem('side-hidden')==='1')document.body.classList.add('side-hidden');}catch{}
$('#foldAll').onclick=()=>document.querySelectorAll('#list details.grp').forEach(d=>d.open=false);
$('#unfoldAll').onclick=()=>document.querySelectorAll('#list details.grp').forEach(d=>d.open=true);
$('#reload').onclick=()=>{health();loadDocs();};

let pollDelay = 3000, authDead = false;
async function poll(){
  if (authDead) return;
  try{
    const c = await j('/api/changes?since='+encodeURIComponent(SEQ));
    if(c.ok){ pollDelay = 3000; if(c.results && c.results.length){ await loadDocs(); } SEQ = c.last_seq || SEQ; }
    else if(/AUTH|401|403|locked/i.test(c.error||'')){
      authDead = true;
      $('#health').textContent = '○ STOP — auth gagal/terkunci, betulkan .env dulu';
      $('#health').style.color = '#e08a8a';
      return;
    }
  }catch{}
  setTimeout(poll, pollDelay);
  pollDelay = Math.min(pollDelay * 1.5, 30000);
}
health(); loadDocs(); poll(); setInterval(health, 10000);
