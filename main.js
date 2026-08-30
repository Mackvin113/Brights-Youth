/* =========================================================================
   FIREBASE SETUP — paste your project's config here.
   Get this from: Firebase console → Project settings → General →
   "Your apps" → the web app (</>) → SDK setup and configuration.
   ========================================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyC3KcwTU5R7UtkAtLOHJm6koLvB24QW_z0",
  authDomain: "brights-youth.firebaseapp.com",
  projectId: "brights-youth",
  storageBucket: "brights-youth.firebasestorage.app",
  messagingSenderId: "1094756680154",
  appId: "1:1094756680154:web:c63d94fd9475f2012e80e3"
};

const FIREBASE_NOT_CONFIGURED = firebaseConfig.apiKey === "PASTE_YOUR_API_KEY_HERE";
if(FIREBASE_NOT_CONFIGURED){ document.getElementById('configBanner').classList.add('show'); }
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const COLLECTION = 'brights';

/* ---------- storage helpers (Firestore = shared, visible to everyone who opens this dashboard) ---------- */
async function storeGet(key, fallback){
  if(FIREBASE_NOT_CONFIGURED) return fallback;
  try{
    const doc = await db.collection(COLLECTION).doc(key).get();
    return doc.exists ? JSON.parse(doc.data().value) : fallback;
  }catch(e){ console.error('storage get failed', key, e); return fallback; }
}
async function storeSet(key, value){
  if(FIREBASE_NOT_CONFIGURED) return false;
  try{ await db.collection(COLLECTION).doc(key).set({ value: JSON.stringify(value) }); return true; }
  catch(e){ console.error('storage set failed', key, e); return false; }
}
async function storeListPrefix(prefix){
  if(FIREBASE_NOT_CONFIGURED) return [];
  try{
    const snap = await db.collection(COLLECTION).get();
    return snap.docs.map(d=>d.id).filter(id=>id.startsWith(prefix));
  }catch(e){ return []; }
}
async function storeDelete(key){
  if(FIREBASE_NOT_CONFIGURED) return;
  try{ await db.collection(COLLECTION).doc(key).delete(); }
  catch(e){ console.error('storage delete failed', key, e); }
}


/* ---------- app state ---------- */
const PALETTE = ['#E8174C','#F0642A','#F5C400','#2FA84C','#2F7FE0','#7B2C8E'];
let members = [];
let settings = { monthlyFee: 200, openingBalance: 0 };
let transactions = [];
let monthCache = {};
let currentMonth = new Date().toISOString().slice(0,7);
let newPhotoData = '';
let isAdmin = false;
let birthdayMessage = '';
let galleryPhotos = [];
let newGalleryImages = [];
let likedPhotoIds = new Set();
let commenterMember = null; // {id, name} — picked from the member list, not free-typed
let sliderIndex = new Map(); // photoId -> current slide index
let editingMemberId = null;

function fmtMoney(n){ n = Math.round(n||0); return '₹' + n.toLocaleString('en-IN'); }
function initials(name){ return (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join(''); }
function colorFor(idx){ return PALETTE[idx % PALETTE.length]; }

/* ---------- member sort order ----------
   1. Top leadership positions, in this exact order
   2. Any custom/typed-in position ("Other") not covered below
   3. Standard committee positions from the dropdown
   4. Plain "Member" (no position) — always last
*/
const TOP_POSITIONS = ['Founder/Treasurer','Founder/Adviser','Founder','President','Vice President','Event Head'];
const STANDARD_POSITIONS = ['Secretary','Joint Secretary','Treasurer','Coordinator','Volunteer'];
function positionRank(pos){
  const p = (pos||'').trim();
  if(p === '') return 1000; // Member (no position) — always last
  const topIdx = TOP_POSITIONS.indexOf(p);
  if(topIdx !== -1) return topIdx; // 0–4
  const stdIdx = STANDARD_POSITIONS.indexOf(p);
  if(stdIdx !== -1) return 100 + stdIdx; // 100–104
  return 50; // any custom/typed-in position — falls right after the top 5
}
function getSortedMembers(){
  return [...members].sort((a,b)=>{
    const ra = positionRank(a.position), rb = positionRank(b.position);
    if(ra !== rb) return ra - rb;
    return (a.name||'').localeCompare(b.name||'');
  });
}
function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
/* ---------- comment moderation ---------- */
const BLOCKED_WORDS = ['fuck','shit','bitch','asshole','bastard','dick','pussy','cunt','slut','whore','fucker','motherfucker','nigger','faggot','retard','rape'];
function containsProfanity(text){
  const clean = (text||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ');
  return BLOCKED_WORDS.some(word=> new RegExp('\\b'+word+'\\b').test(clean));
}

function formatDob(dob){
  const parts = dob.split('-');
  if(parts.length !== 3) return dob;
  const [y,mo,d] = parts;
  return new Date(y, mo-1, d).toLocaleDateString('default', {day:'numeric', month:'long', year:'numeric'});
}
function calcAge(dob){
  if(!dob) return null;
  const parts = dob.split('-');
  if(parts.length !== 3) return null;
  const [y,mo,d] = parts.map(Number);
  const birth = new Date(y, mo-1, d);
  if(isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear = (today.getMonth() > birth.getMonth()) ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if(!hasHadBirthdayThisYear) age--;
  return age >= 0 ? age : null;
}

/* ---------- custom dialogs (native prompt/alert/confirm are blocked in this preview) ---------- */
function openModal(html, extraClass){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box ${extraClass||''}">${html}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}
function askText(title, placeholder, isPassword){
  return new Promise(resolve=>{
    const overlay = openModal(`
      <h3>${title}</h3>
      <input type="${isPassword?'password':'text'}" id="modalInput" placeholder="${placeholder||''}">
      <div class="modal-actions">
        <button class="btn btn-sm" id="modalCancel">Cancel</button>
        <button class="btn btn-sm btn-primary" id="modalOk">OK</button>
      </div>`);
    const input = overlay.querySelector('#modalInput');
    setTimeout(()=>input.focus(), 30);
    const cleanup = (val)=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#modalOk').addEventListener('click', ()=>cleanup(input.value));
    overlay.querySelector('#modalCancel').addEventListener('click', ()=>cleanup(null));
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) cleanup(null); });
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') cleanup(input.value); if(e.key==='Escape') cleanup(null); });
  });
}
function askConfirm(title, confirmLabel){
  return new Promise(resolve=>{
    const overlay = openModal(`
      <h3>${title}</h3>
      <div class="modal-actions">
        <button class="btn btn-sm" id="modalCancel">Cancel</button>
        <button class="btn btn-sm btn-danger" id="modalOk">${confirmLabel||'Confirm'}</button>
      </div>`);
    const cleanup = (val)=>{ overlay.remove(); resolve(val); };
    overlay.querySelector('#modalOk').addEventListener('click', ()=>cleanup(true));
    overlay.querySelector('#modalCancel').addEventListener('click', ()=>cleanup(false));
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) cleanup(false); });
  });
}
function showMessage(title){
  const overlay = openModal(`<h3>${title}</h3><div class="modal-actions"><button class="btn btn-sm btn-primary" id="modalOk">OK</button></div>`);
  overlay.querySelector('#modalOk').addEventListener('click', ()=>overlay.remove());
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.remove(); });
}

/* ---------- admin gate ---------- */
function setAdminUi(){
  document.body.classList.toggle('is-admin', isAdmin);
  document.getElementById('adminPill').textContent = isAdmin ? 'Admin mode' : 'Viewing only';
  document.getElementById('adminPill').className = 'admin-pill ' + (isAdmin ? 'on' : 'off');
  document.getElementById('adminLoginBtn').style.display = isAdmin ? 'none' : 'inline-flex';
  document.getElementById('adminBar').classList.toggle('show', isAdmin);
  if(!isAdmin && document.querySelector('.tab-btn[data-tab="settings"]').classList.contains('active')){
    document.querySelector('.tab-btn[data-tab="overview"]').click();
  }
}
document.getElementById('adminLoginBtn').addEventListener('click', async ()=>{
  let pin = await storeGet('admin-pin', null);
  if(!pin){
    const setPin = await askText('Set your admin PIN', 'Choose a PIN (4+ characters)');
    if(!setPin) return;
    await storeSet('admin-pin', setPin);
    isAdmin = true; setAdminUi(); render();
    return;
  }
  const entered = await askText('Enter admin PIN', 'PIN', true);
  if(entered === null) return;
  if(entered === pin){ isAdmin = true; setAdminUi(); render(); }
  else showMessage('Incorrect PIN.');
});
document.getElementById('adminLogoutBtn').addEventListener('click', ()=>{
  isAdmin = false; setAdminUi(); render();
});

/* ---------- data load ---------- */
async function loadAll(){
  members = await loadMembers();
  settings = await storeGet('settings', { monthlyFee: 200, openingBalance: 0 });
  transactions = await storeGet('transactions', []);
  birthdayMessage = await storeGet('birthday-message', '');
  document.getElementById('monthlyFeeInput').value = settings.monthlyFee;
  document.getElementById('openingBalanceInput').value = settings.openingBalance;
  document.getElementById('monthPicker').value = currentMonth;
  await ensureMonthLoaded(currentMonth);
  await ensureAllMonthsLoaded();
  await loadGallery();
  render();
  maybeShowUpcomingBirthdaysPopup();
}
async function loadMembers(){
  // Each member is stored as its own document (member:<id>) so the member
  // list can never hit Firestore's 1MB-per-document limit as the community
  // grows or people add profile photos — previously ALL members shared one
  // document, so adding one member with a photo could push that single
  // document over the limit and silently fail to save, which is what broke
  // the member list.
  const keys = await storeListPrefix('member:');
  if(keys.length > 0){
    const loaded = [];
    for(const key of keys){
      const m = await storeGet(key, null);
      if(m) loaded.push(m);
    }
    return loaded;
  }
  // Nothing in the new format yet — check for data saved in the old bundled
  // 'members' document and migrate it automatically, one document per member.
  const legacy = await storeGet('members', []);
  if(legacy.length > 0){
    for(const m of legacy){ await storeSet('member:' + m.id, m); }
  }
  return legacy;
}
async function loadGallery(){
  const keys = await storeListPrefix('gallery:');
  const photos = [];
  for(const key of keys){
    const p = await storeGet(key, null);
    if(!p) continue;
    p.images = await loadPhotoImages(p.id, p);
    photos.push(p);
  }
  photos.sort((a,b)=> new Date(b.uploadedAt) - new Date(a.uploadedAt));
  galleryPhotos = photos;
  renderGallery();
}
async function loadPhotoImages(photoId, legacyPhoto){
  // Each image is stored as its own document (gallery-img:<photoId>:<index>)
  // so a post with several photos never hits Firestore's 1MB-per-document limit.
  const imgKeys = await storeListPrefix('gallery-img:' + photoId + ':');
  if(imgKeys.length === 0){
    // Falls back to the old bundled format for posts uploaded before this fix.
    return (legacyPhoto && legacyPhoto.images && legacyPhoto.images.length) ? legacyPhoto.images
      : (legacyPhoto && legacyPhoto.image ? [legacyPhoto.image] : []);
  }
  imgKeys.sort((a,b)=> Number(a.split(':').pop()) - Number(b.split(':').pop()));
  const images = [];
  for(const key of imgKeys){
    const img = await storeGet(key, null);
    if(img) images.push(img);
  }
  return images;
}
async function savePhotoImages(photoId, images){
  // Wipes any existing per-image documents for this post, then writes the
  // current set fresh — keeps things in sync after edits (add/remove photos).
  const oldKeys = await storeListPrefix('gallery-img:' + photoId + ':');
  for(const key of oldKeys){ await storeDelete(key); }
  let ok = true;
  for(let i=0; i<images.length; i++){
    const success = await storeSet('gallery-img:' + photoId + ':' + i, images[i]);
    if(!success) ok = false;
  }
  return ok;
}
async function ensureMonthLoaded(month){
  if(monthCache[month]) return monthCache[month];
  const data = await storeGet('payments:' + month, {});
  monthCache[month] = data;
  return data;
}
async function ensureAllMonthsLoaded(){
  // Loads every payments:YYYY-MM record that exists, not just recent ones —
  // needed so "Overall collected" and the balance reflect the true all-time total.
  const monthKeys = await storeListPrefix('payments:');
  for(const key of monthKeys){
    const month = key.replace('payments:', '');
    await ensureMonthLoaded(month);
  }
}
async function saveMonth(month){ await storeSet('payments:' + month, monthCache[month]); }

/* ---------- render orchestration ---------- */
async function render(){
  renderStats();
  renderMembersTable();
  await renderChart();
  renderDonut();
  await renderMonthSlicer();
  renderSplitTables();
  renderBirthdays();
}

function renderBirthdays(){
  const panel = document.getElementById('birthdayPanel');
  const strip = document.getElementById('birthdayStrip');
  const today = new Date();
  const todayKey = String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

  const celebrants = members.filter(m=>{
    if(!m.dob) return false;
    const parts = m.dob.split('-'); // YYYY-MM-DD
    if(parts.length !== 3) return false;
    const key = parts[1] + '-' + parts[2];
    return key === todayKey;
  });

  if(celebrants.length === 0){
    panel.classList.remove('show');
    strip.innerHTML = '';
    return;
  }
  panel.classList.add('show');
  strip.innerHTML = celebrants.map((m, i)=>{
    const idx = members.indexOf(m);
    const avatar = m.photo
      ? `<img class="birthday-avatar" src="${m.photo}" alt="${escapeHtml(m.name)}">`
      : `<div class="birthday-avatar-fallback" style="background:${colorFor(idx)}">${initials(m.name)}</div>`;
    return `<div class="birthday-card">
      <div class="birthday-avatar-wrap" style="background:${colorFor(idx)}22;">${avatar}</div>
      <div class="birthday-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
      <div class="birthday-wish">🎂 Happy Birthday!</div>
    </div>`;
  }).join('');
  document.getElementById('birthdayMessageDisplay').textContent = birthdayMessage || 'Wishing you a wonderful year ahead! 🎉';
  document.getElementById('birthdayMessageInput').value = birthdayMessage;
}

/* ---------- upcoming birthdays popup (shows once per page load, 10 days out) ---------- */
function computeUpcomingBirthdays(withinDays){
  const today = new Date();
  today.setHours(0,0,0,0);
  const upcoming = [];
  members.forEach(m=>{
    if(!m.dob) return;
    const parts = m.dob.split('-');
    if(parts.length !== 3) return;
    const mo = Number(parts[1]) - 1, d = Number(parts[2]);
    let next = new Date(today.getFullYear(), mo, d);
    if(next < today) next = new Date(today.getFullYear()+1, mo, d);
    const daysAway = Math.round((next - today) / 86400000);
    if(daysAway > 0 && daysAway <= withinDays){
      upcoming.push({ m, daysAway, next });
    }
  });
  upcoming.sort((a,b)=>a.daysAway - b.daysAway);
  return upcoming;
}
function maybeShowUpcomingBirthdaysPopup(){
  const upcoming = computeUpcomingBirthdays(10);
  if(upcoming.length === 0) return;
  const rows = upcoming.map(({m, daysAway, next})=>{
    const idx = members.indexOf(m);
    const avatar = m.photo
      ? `<img class="member-card-avatar" style="width:40px;height:40px;" src="${m.photo}" alt="${escapeHtml(m.name)}">`
      : `<div class="member-card-avatar-fallback" style="width:40px;height:40px;font-size:14px;background:${colorFor(idx)}">${initials(m.name)}</div>`;
    const dateLabel = next.toLocaleDateString('default', {day:'numeric', month:'long'});
    const dayWord = daysAway === 1 ? 'day' : 'days';
    return `<div class="upcoming-bday-row">
      ${avatar}
      <div>
        <div class="member-name">${escapeHtml(m.name)}</div>
        <div class="member-sub">${dateLabel} · in ${daysAway} ${dayWord}</div>
      </div>
    </div>`;
  }).join('');
  const overlay = openModal(`
    <h3>🎂 Upcoming birthdays</h3>
    <div class="upcoming-bday-list">${rows}</div>
    <div class="modal-actions"><button class="btn btn-sm btn-primary" id="modalOk">Got it</button></div>
  `, 'wide');
  overlay.querySelector('#modalOk').addEventListener('click', ()=>overlay.remove());
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.remove(); });
}

document.getElementById('saveBirthdayMsgBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  birthdayMessage = document.getElementById('birthdayMessageInput').value.trim();
  await storeSet('birthday-message', birthdayMessage);
  document.getElementById('birthdayMessageDisplay').textContent = birthdayMessage || 'Wishing you a wonderful year ahead! 🎉';
});

/* ---------- member search ---------- */
document.getElementById('memberSearchInput').addEventListener('input', (e)=>{
  renderSearchResults(e.target.value.trim().toLowerCase());
});
function renderSearchResults(query){
  const wrap = document.getElementById('memberSearchResults');
  if(!query){ wrap.innerHTML = ''; return; }
  const matches = getSortedMembers().filter(m=>
    (m.name||'').toLowerCase().includes(query) ||
    (m.phone||'').toLowerCase().includes(query) ||
    (m.position||'').toLowerCase().includes(query)
  );
  if(matches.length === 0){ wrap.innerHTML = `<div class="split-empty">No members found.</div>`; return; }
  wrap.innerHTML = matches.map(m=>{
    const idx = members.indexOf(m);
    const avatar = m.photo
      ? `<img class="avatar" src="${m.photo}" style="border-color:${colorFor(idx)}" alt="${escapeHtml(m.name)}">`
      : `<div class="avatar-fallback" style="background:${colorFor(idx)}">${initials(m.name)}</div>`;
    return `<div class="search-result-row" data-search-member="${m.id}">${avatar}<div><div class="member-name">${escapeHtml(m.name)}</div>${m.position?`<div class="member-position">${escapeHtml(m.position)}</div>`:''}</div></div>`;
  }).join('');
  wrap.querySelectorAll('[data-search-member]').forEach(row=>{
    row.addEventListener('click', ()=>{
      const m = members.find(x=>x.id===row.getAttribute('data-search-member'));
      if(m) showMemberCard(m);
    });
  });
}
function showMemberCard(m){
  const idx = members.indexOf(m);
  const avatar = m.photo
    ? `<img class="member-card-avatar" src="${m.photo}" alt="${escapeHtml(m.name)}">`
    : `<div class="member-card-avatar-fallback" style="background:${colorFor(idx)}">${initials(m.name)}</div>`;
  const rows = [
    ['Phone', m.phone || '—'],
    ['Address', m.address || '—'],
    ['Parent / guardian', m.parentName || '—'],
    ['Parent phone', m.parentPhone || '—'],
    ['Education', m.education || '—'],
    ['Status', m.status || '—'],
    [m.status === 'Working' ? 'Workplace' : 'Institution', m.institution || '—'],
    ['Date of birth', m.dob ? `${formatDob(m.dob)} (${calcAge(m.dob)} yrs)` : '—'],
    ['Joined', m.joined || '—']
  ];
  const rowsHtml = rows.map(([k,v])=>`<tr><td class="mc-key">${k}</td><td class="mc-val">${escapeHtml(String(v))}</td></tr>`).join('');
  const overlay = openModal(`
    <div class="member-card-head">${avatar}<div><h3 style="margin-bottom:4px;">${escapeHtml(m.name)}</h3><div class="member-position">${escapeHtml(m.position || 'Member')}</div></div></div>
    <table class="member-card-table">${rowsHtml}</table>
    <div class="modal-actions" style="margin-top:16px;"><button class="btn btn-sm btn-primary" id="modalOk">Close</button></div>
  `, 'wide');
  overlay.querySelector('#modalOk').addEventListener('click', ()=>overlay.remove());
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.remove(); });
}

function renderStats(){
  document.getElementById('statMembers').textContent = members.length;
  const paidData = monthCache[currentMonth] || {};
  let paidCount = 0, collected = 0;
  members.forEach(m=>{ const p = paidData[m.id]; if(p && p.paid){ paidCount++; collected += Number(p.amount||0); } });
  document.getElementById('statCollected').textContent = fmtMoney(collected);
  const [y,mo] = currentMonth.split('-');
  const monthName = new Date(y, mo-1, 1).toLocaleString('default',{month:'long', year:'numeric'});
  document.getElementById('statCollectedLabel').textContent = 'Collected · ' + monthName;

  const totalSpent = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);
  document.getElementById('statSpent').textContent = fmtMoney(totalSpent);
  document.getElementById('statOverall').textContent = fmtMoney(computeAllTimeCollected());
  document.getElementById('statBalance').textContent = fmtMoney(computeBalance());
  document.getElementById('monthLabelMembers').textContent = monthName;
  document.getElementById('monthSplitSub').textContent = monthName + ' payment status';
  document.getElementById('paidCountText').textContent = paidCount + ' paid';
  document.getElementById('unpaidCountText').textContent = (members.length - paidCount) + ' not paid';
}

function computeAllTimeCollected(){
  let totalCollectedAllTime = 0;
  Object.keys(monthCache).forEach(month=>{
    const data = monthCache[month];
    Object.values(data).forEach(p=>{ if(p && p.paid) totalCollectedAllTime += Number(p.amount||0); });
  });
  const otherIncome = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0);
  return totalCollectedAllTime + otherIncome;
}

function computeBalance(){
  const totalCollectedAllTime = computeAllTimeCollected();
  const totalSpent = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);
  return Number(settings.openingBalance||0) + totalCollectedAllTime - totalSpent;
}

function renderMembersTable(){
  const wrap = document.getElementById('membersTableWrap');
  if(members.length === 0){
    wrap.innerHTML = `<div class="empty"><div class="big">👥</div>${isAdmin ? 'Add your first member above to start tracking contributions.' : 'No members added yet.'}</div>`;
    return;
  }
  const paidData = monthCache[currentMonth] || {};
  let rows = getSortedMembers().map((m)=>{
    const idx = members.indexOf(m);
    const p = paidData[m.id] || { paid:false, amount:0 };
    const avatar = m.photo
      ? `<img class="avatar" src="${m.photo}" style="border-color:${colorFor(idx)}" alt="${m.name}">`
      : `<div class="avatar-fallback" style="background:${colorFor(idx)}">${initials(m.name)}</div>`;
    return `<tr>
      <td><div class="member-cell" data-detail="${m.id}">${avatar}<div><div class="member-name">${escapeHtml(m.name)}</div><div class="member-sub">${escapeHtml(m.phone||'')}</div>${m.position?`<div class="member-position">${escapeHtml(m.position)}</div>`:''}</div></div></td>
      <td>
        <div class="pay-cell">
          <button class="toggle ${p.paid?'on':''}" data-member="${m.id}" ${isAdmin?'':'disabled'} aria-label="Toggle paid status"></button>
          <span class="status-text ${p.paid?'paid':'unpaid'}">${p.paid?'Paid':'Not paid'}</span>
          ${p.paid ? `<input type="number" class="amount-input admin-only-inline" style="display:${isAdmin?'inline-flex':'none'}" data-amount="${m.id}" value="${p.amount}" min="0">` : ''}
          ${p.paid && !isAdmin ? `<span class="mono" style="font-size:13px;">${fmtMoney(p.amount)}</span>` : ''}
        </div>
      </td>
      <td style="text-align:right;">
        <button class="btn btn-sm admin-only" data-edit="${m.id}">Edit</button>
        <button class="btn btn-sm btn-danger admin-only" data-remove="${m.id}">Remove</button>
      </td>
    </tr>
    <tr class="detail-row" id="detail-${m.id}" style="display:none;"><td colspan="3">
      <div class="detail-grid">
        <div><div class="dlabel">Position</div><div class="dvalue">${escapeHtml(m.position)||'Member'}</div></div>
        <div><div class="dlabel">Date of birth</div><div class="dvalue">${m.dob?`${formatDob(m.dob)} (${calcAge(m.dob)} yrs)`:'—'}</div></div>
        <div><div class="dlabel">Address</div><div class="dvalue">${escapeHtml(m.address)||'—'}</div></div>
        <div><div class="dlabel">Parent / guardian</div><div class="dvalue">${escapeHtml(m.parentName)||'—'}</div></div>
        <div><div class="dlabel">Parent phone</div><div class="dvalue">${escapeHtml(m.parentPhone)||'—'}</div></div>
        <div><div class="dlabel">Education</div><div class="dvalue">${escapeHtml(m.education)||'—'}</div></div>
        <div><div class="dlabel">Status</div><div class="dvalue">${escapeHtml(m.status)||'—'}</div></div>
        <div><div class="dlabel">${m.status==='Working'?'Workplace':'Institution'}</div><div class="dvalue">${escapeHtml(m.institution)||'—'}</div></div>
        <div><div class="dlabel">Joined</div><div class="dvalue">${escapeHtml(m.joined)||'—'}</div></div>
      </div>
    </td></tr>`;
  }).join('');
  wrap.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Member</th><th>This month</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;

  wrap.querySelectorAll('[data-detail]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const row = document.getElementById('detail-'+el.getAttribute('data-detail'));
      row.style.display = row.style.display === 'none' ? '' : 'none';
    });
  });
  wrap.querySelectorAll('[data-member]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!isAdmin) return;
      const id = btn.getAttribute('data-member');
      const data = monthCache[currentMonth] || (monthCache[currentMonth]={});
      const current = data[id] || { paid:false, amount: settings.monthlyFee };
      current.paid = !current.paid;
      if(current.paid && !current.amount) current.amount = settings.monthlyFee;
      data[id] = current;
      await saveMonth(currentMonth);
      render();
    });
  });
  wrap.querySelectorAll('[data-amount]').forEach(inp=>{
    inp.addEventListener('change', async ()=>{
      if(!isAdmin) return;
      const id = inp.getAttribute('data-amount');
      const data = monthCache[currentMonth] || (monthCache[currentMonth]={});
      if(!data[id]) data[id] = { paid:true, amount:0 };
      data[id].amount = Number(inp.value)||0;
      await saveMonth(currentMonth);
      renderStats();
      await renderChart();
      renderDonut();
    });
  });
  wrap.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!isAdmin) return;
      const id = btn.getAttribute('data-remove');
      const ok = await askConfirm('Remove this member? Their payment history will stay in past months.', 'Remove');
      if(!ok) return;
      members = members.filter(m=>m.id!==id);
      await storeDelete('member:' + id);
      render();
    });
  });
  wrap.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(!isAdmin) return;
      const id = btn.getAttribute('data-edit');
      const m = members.find(x=>x.id===id);
      if(!m) return;
      startEditMember(m);
    });
  });
}

async function loadRecentMonths(count){
  const monthKeys = await storeListPrefix('payments:');
  let months = monthKeys.map(k=>k.replace('payments:','')).sort();
  if(!months.includes(currentMonth)) months.push(currentMonth);
  months = [...new Set(months)].sort().slice(-(count||8));
  for(const m of months){ await ensureMonthLoaded(m); }
  return months;
}

async function renderChart(){
  const container = document.getElementById('chartBars');
  const months = await loadRecentMonths(6);
  const values = months.map(m=>{
    const data = monthCache[m] || {};
    let sum = 0;
    Object.values(data).forEach(p=>{ if(p && p.paid) sum += Number(p.amount||0); });
    return sum;
  });
  const max = Math.max(...values, 1);
  container.innerHTML = months.map((m,i)=>{
    const [y,mo] = m.split('-');
    const label = new Date(y,mo-1,1).toLocaleString('default',{month:'short'});
    const h = Math.max(6, Math.round((values[i]/max)*150));
    const isCurrent = m === currentMonth;
    return `<div class="bar-col"><div class="amt">${fmtMoney(values[i])}</div><div class="bar" style="height:${h}px; background:${isCurrent?'#2F7FE0':'#B9CFEE'}"></div><div class="mo">${label}</div></div>`;
  }).join('');
}

async function renderMonthSlicer(){
  const el = document.getElementById('monthSlicer');
  const months = await loadRecentMonths(8);
  el.innerHTML = months.map(m=>{
    const [y,mo] = m.split('-');
    const label = new Date(y,mo-1,1).toLocaleString('default',{month:'short', year:'2-digit'});
    return `<button class="slicer-chip ${m===currentMonth?'active':''}" data-slicer-month="${m}">${label}</button>`;
  }).join('');
  el.querySelectorAll('[data-slicer-month]').forEach(chip=>{
    chip.addEventListener('click', async ()=>{
      currentMonth = chip.getAttribute('data-slicer-month');
      document.getElementById('monthPicker').value = currentMonth;
      await ensureMonthLoaded(currentMonth);
      render();
    });
  });
}

function renderSplitTables(){
  const paidData = monthCache[currentMonth] || {};
  const paidMembers = [], unpaidMembers = [];
  getSortedMembers().forEach((m)=>{
    const idx = members.indexOf(m);
    const p = paidData[m.id];
    if(p && p.paid) paidMembers.push({m, idx, amount:p.amount});
    else unpaidMembers.push({m, idx});
  });

  document.getElementById('paidSplitCount').textContent = paidMembers.length;
  document.getElementById('unpaidSplitCount').textContent = unpaidMembers.length;

  const cardHtml = (item, showAmount)=>{
    const { m, idx } = item;
    const avatar = m.photo
      ? `<img class="split-avatar" src="${m.photo}" alt="${escapeHtml(m.name)}">`
      : `<div class="split-avatar-fallback" style="background:${colorFor(idx)}">${initials(m.name)}</div>`;
    return `<div class="split-card">
      ${avatar}
      <div class="split-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
      ${m.position?`<div class="member-position">${escapeHtml(m.position)}</div>`:''}
      ${showAmount?`<div class="split-amt">${fmtMoney(item.amount)}</div>`:''}
    </div>`;
  };

  const paidWrap = document.getElementById('paidSplitTable');
  paidWrap.innerHTML = paidMembers.length
    ? `<div class="split-grid">${paidMembers.map(item=>cardHtml(item, true)).join('')}</div>`
    : `<div class="split-empty">No one has paid for this month yet.</div>`;

  const unpaidWrap = document.getElementById('unpaidSplitTable');
  unpaidWrap.innerHTML = unpaidMembers.length
    ? `<div class="split-grid">${unpaidMembers.map(item=>cardHtml(item, false)).join('')}</div>`
    : `<div class="split-empty">Everyone has paid this month.</div>`;
}



function renderDonut(){
  const svg = document.getElementById('donutSvg');
  const legend = document.getElementById('donutLegend');
  const paidData = monthCache[currentMonth] || {};
  let paid = 0;
  members.forEach(m=>{ if(paidData[m.id] && paidData[m.id].paid) paid++; });
  const unpaid = members.length - paid;
  const total = members.length || 1;
  const r = 60, cx=80, cy=80, circ = 2*Math.PI*r;
  const paidLen = (paid/total) * circ;
  svg.innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F3EDF5" stroke-width="20"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2FA84C" stroke-width="20" stroke-dasharray="${paidLen} ${circ-paidLen}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy-4}" text-anchor="middle" font-family="Baloo 2" font-size="24" font-weight="700" fill="#20222B">${paid}/${total}</text>
    <text x="${cx}" y="${cy+16}" text-anchor="middle" font-family="Inter" font-size="11" fill="#6E7180">paid</text>`;
  legend.innerHTML = `<span><span class="dot" style="background:#2FA84C"></span>Paid · ${paid}</span><span><span class="dot" style="background:#F3EDF5"></span>Not paid · ${unpaid}</span>`;
}

function renderTxnTable(){
  const wrap = document.getElementById('txnTableWrap');
  if(transactions.length===0){
    wrap.innerHTML = `<div class="empty"><div class="big">🧾</div>No transactions yet.</div>`;
    return;
  }
  const sorted = [...transactions].sort((a,b)=> b.date.localeCompare(a.date));
  wrap.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th style="text-align:right;">Amount</th><th></th></tr></thead>
    <tbody>${sorted.map(t=>`<tr>
        <td class="mono">${t.date}</td>
        <td><span class="txn-type-pill ${t.type}">${t.type==='income'?'Income':'Expense'}</span></td>
        <td>${escapeHtml(t.desc)}</td>
        <td style="text-align:right;" class="mono">${fmtMoney(t.amount)}</td>
        <td style="text-align:right;"><button class="btn btn-sm btn-danger admin-only" data-txn-remove="${t.id}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  wrap.querySelectorAll('[data-txn-remove]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!isAdmin) return;
      const id = btn.getAttribute('data-txn-remove');
      transactions = transactions.filter(t=>t.id!==id);
      await storeSet('transactions', transactions);
      renderTxnTable();
      renderStats();
    });
  });
}

/* ---------- tabs ---------- */
document.getElementById('tabs').addEventListener('click', (e)=>{
  const btn = e.target.closest('.tab-btn');
  if(!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('section-'+btn.dataset.tab).classList.add('active');
  if(btn.dataset.tab === 'fund') renderTxnTable();
});

/* ---------- month picker ---------- */
document.getElementById('monthPicker').addEventListener('change', async (e)=>{
  currentMonth = e.target.value;
  await ensureMonthLoaded(currentMonth);
  render();
});

/* ---------- member status/institution label swap ---------- */
document.getElementById('fStatus').addEventListener('change', (e)=>{
  document.getElementById('fInstLabel').textContent = e.target.value === 'Working' ? 'Workplace' : 'School / college';
});
document.getElementById('fPosition').addEventListener('change', (e)=>{
  document.getElementById('fPositionOtherWrap').style.display = e.target.value === '__other' ? 'block' : 'none';
});
function updateDobAgeHint(){
  const val = document.getElementById('fDob').value;
  const hint = document.getElementById('fDobAgeHint');
  const age = calcAge(val);
  hint.textContent = age !== null ? `Age: ${age} years` : '';
}
document.getElementById('fDob').addEventListener('input', updateDobAgeHint);

/* ---------- new member photo ---------- */
document.getElementById('newPhotoInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      const size = 160;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size/img.width, size/img.height);
      const w = img.width*scale, h = img.height*scale;
      ctx.drawImage(img, (size-w)/2, (size-h)/2, w, h);
      newPhotoData = canvas.toDataURL('image/jpeg', 0.82);
      document.getElementById('newPhotoPreview').src = newPhotoData;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

/* ---------- add / edit member ---------- */
function resetMemberForm(){
  editingMemberId = null;
  document.getElementById('memberFormTitle').textContent = 'Add a member';
  document.getElementById('saveMemberBtn').textContent = 'Add member';
  document.getElementById('cancelEditBtn').style.display = 'none';
  ['fName','fPhone','fAddress','fParentName','fParentPhone','fEducation','fDob','fInstitution','fPositionOther'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fStatus').value = 'Studying';
  document.getElementById('fInstLabel').textContent = 'School / college';
  document.getElementById('fPosition').value = '';
  document.getElementById('fPositionOtherWrap').style.display = 'none';
  document.getElementById('newPhotoPreview').src = '';
  newPhotoData = '';
  updateDobAgeHint();
}
function startEditMember(m){
  editingMemberId = m.id;
  document.getElementById('memberFormTitle').textContent = 'Edit member';
  document.getElementById('saveMemberBtn').textContent = 'Update member';
  document.getElementById('cancelEditBtn').style.display = 'inline-flex';
  document.getElementById('fName').value = m.name||'';
  document.getElementById('fPhone').value = m.phone||'';
  document.getElementById('fAddress').value = m.address||'';
  document.getElementById('fParentName').value = m.parentName||'';
  document.getElementById('fParentPhone').value = m.parentPhone||'';
  document.getElementById('fEducation').value = m.education||'';
  document.getElementById('fDob').value = m.dob||'';
  updateDobAgeHint();
  document.getElementById('fStatus').value = m.status||'Studying';
  document.getElementById('fInstLabel').textContent = m.status === 'Working' ? 'Workplace' : 'School / college';
  document.getElementById('fInstitution').value = m.institution||'';
  const knownPositions = ['President','Vice President','Secretary','Joint Secretary','Treasurer','Coordinator','Volunteer','Event Head'];
  if(m.position && !knownPositions.includes(m.position)){
    document.getElementById('fPosition').value = '__other';
    document.getElementById('fPositionOther').value = m.position;
    document.getElementById('fPositionOtherWrap').style.display = 'block';
  } else {
    document.getElementById('fPosition').value = m.position || '';
    document.getElementById('fPositionOther').value = '';
    document.getElementById('fPositionOtherWrap').style.display = 'none';
  }
  newPhotoData = m.photo||'';
  document.getElementById('newPhotoPreview').src = m.photo||'';
  document.getElementById('memberFormPanel').scrollIntoView({behavior:'smooth', block:'start'});
}
document.getElementById('cancelEditBtn').addEventListener('click', resetMemberForm);
document.getElementById('saveMemberBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const name = document.getElementById('fName').value.trim();
  if(!name){ showMessage('Enter a name for the member.'); return; }
  const positionSelect = document.getElementById('fPosition').value;
  const fields = {
    name,
    phone: document.getElementById('fPhone').value.trim(),
    address: document.getElementById('fAddress').value.trim(),
    parentName: document.getElementById('fParentName').value.trim(),
    parentPhone: document.getElementById('fParentPhone').value.trim(),
    education: document.getElementById('fEducation').value.trim(),
    dob: document.getElementById('fDob').value,
    status: document.getElementById('fStatus').value,
    institution: document.getElementById('fInstitution').value.trim(),
    position: positionSelect === '__other' ? document.getElementById('fPositionOther').value.trim() : positionSelect,
    photo: newPhotoData
  };
  let savedMember;
  if(editingMemberId){
    const idx = members.findIndex(m=>m.id===editingMemberId);
    if(idx>-1) members[idx] = { ...members[idx], ...fields };
    savedMember = members[idx];
  } else {
    savedMember = { id:'m_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), joined:new Date().toISOString().slice(0,10), ...fields };
    members.push(savedMember);
  }
  const btn = document.getElementById('saveMemberBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving...';
  const ok = await storeSet('member:' + savedMember.id, savedMember);
  btn.disabled = false; btn.textContent = originalLabel;
  if(!ok){
    showMessage('Couldn\'t save this member — check your internet connection and try again.');
    return;
  }
  resetMemberForm();
  render();
});

/* ---------- mark all paid / unpaid ---------- */
document.getElementById('markAllPaidBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const data = monthCache[currentMonth] || (monthCache[currentMonth]={});
  members.forEach(m=>{ const existing = data[m.id]; data[m.id] = { paid:true, amount: existing && existing.amount ? existing.amount : settings.monthlyFee }; });
  await saveMonth(currentMonth);
  render();
});
document.getElementById('markAllUnpaidBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const data = monthCache[currentMonth] || (monthCache[currentMonth]={});
  members.forEach(m=>{ const existing = data[m.id]||{}; data[m.id] = { paid:false, amount: existing.amount||0 }; });
  await saveMonth(currentMonth);
  render();
});

/* ---------- fund transactions ---------- */
document.getElementById('txnDate').value = new Date().toISOString().slice(0,10);
document.getElementById('addTxnBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const date = document.getElementById('txnDate').value;
  const type = document.getElementById('txnType').value;
  const desc = document.getElementById('txnDesc').value.trim();
  const amount = Number(document.getElementById('txnAmount').value);
  if(!date || !desc || !amount){ showMessage('Fill in date, description and amount.'); return; }
  transactions.push({ id:'t_'+Date.now(), date, type, desc, amount });
  await storeSet('transactions', transactions);
  document.getElementById('txnDesc').value='';
  document.getElementById('txnAmount').value='';
  renderTxnTable();
  renderStats();
});

/* ---------- settings ---------- */
document.getElementById('saveSettingsBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  settings.monthlyFee = Number(document.getElementById('monthlyFeeInput').value)||0;
  settings.openingBalance = Number(document.getElementById('openingBalanceInput').value)||0;
  await storeSet('settings', settings);
  const msg = document.getElementById('settingsSaveMsg');
  msg.classList.add('show');
  setTimeout(()=>msg.classList.remove('show'), 1800);
  render();
});
document.getElementById('changePinBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  const val = document.getElementById('newPinInput').value.trim();
  if(!val || val.length < 4){ showMessage('Choose a PIN with at least 4 characters.'); return; }
  await storeSet('admin-pin', val);
  document.getElementById('newPinInput').value = '';
  showMessage('Admin PIN updated.');
});

/* ---------- gallery ---------- */
function compressImageFile(file, maxDim, quality){
  maxDim = maxDim || 1100;
  quality = quality || 0.82;
  // Caps the longer side and re-encodes as JPEG — keeps photos sharp on
  // screen while staying well under storage limits.
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (ev)=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w >= h){ h = Math.round(h * (maxDim / w)); w = maxDim; }
          else { w = Math.round(w * (maxDim / h)); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('galleryPhotoInput').addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  if(files.length === 0) return;
  for(const file of files){
    try{
      const dataUrl = await compressImageFile(file);
      newGalleryImages.push(dataUrl);
      renderGalleryUploadPreview();
    }catch(err){ console.error('image compression failed', err); }
  }
  e.target.value = ''; // lets them pick more photos afterwards, including the same files again
});

function renderGalleryUploadPreview(){
  const wrap = document.getElementById('galleryUploadPreview');
  if(!wrap) return;
  if(newGalleryImages.length === 0){ wrap.innerHTML = ''; return; }
  wrap.innerHTML = newGalleryImages.map((src,i)=>`
    <div class="upload-thumb">
      <img src="${src}" alt="Selected photo ${i+1}">
      <button type="button" class="upload-thumb-remove" data-remove-thumb="${i}">×</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-remove-thumb]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      newGalleryImages.splice(Number(btn.getAttribute('data-remove-thumb')), 1);
      renderGalleryUploadPreview();
    });
  });
}

document.getElementById('uploadGalleryBtn').addEventListener('click', async ()=>{
  if(!isAdmin) return;
  if(newGalleryImages.length === 0){ showMessage('Choose at least one photo first.'); return; }
  const btn = document.getElementById('uploadGalleryBtn');
  btn.disabled = true; btn.textContent = 'Uploading...';
  const caption = document.getElementById('galleryCaptionInput').value.trim();
  const takenAt = document.getElementById('galleryDateInput').value || null;
  const id = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const imagesOk = await savePhotoImages(id, newGalleryImages);
  const photo = { id, caption, takenAt, uploadedAt: new Date().toISOString(), likes: 0, comments: [] };
  const metaOk = await storeSet('gallery:' + id, photo);
  btn.disabled = false; btn.textContent = 'Upload';
  if(!imagesOk || !metaOk){
    showMessage('Upload failed — check your internet connection and try again with fewer photos.');
    return;
  }
  photo.images = [...newGalleryImages];
  galleryPhotos.unshift(photo);
  document.getElementById('galleryCaptionInput').value = '';
  document.getElementById('galleryDateInput').value = '';
  newGalleryImages = [];
  renderGalleryUploadPreview();
  renderGallery();
});

function photoImages(p){
  return p.images && p.images.length ? p.images : (p.image ? [p.image] : []);
}

function renderGallery(){
  const grid = document.getElementById('galleryGrid');
  if(!grid) return;
  if(galleryPhotos.length === 0){
    grid.innerHTML = `<div class="empty"><div class="big">📷</div>${isAdmin ? 'Upload your first photo above.' : 'No photos yet.'}</div>`;
    return;
  }
  grid.innerHTML = `<div class="gallery-grid">${galleryPhotos.map(p=>{
    const liked = likedPhotoIds.has(p.id);
    const dateLabel = p.takenAt
      ? formatDob(p.takenAt)
      : new Date(p.uploadedAt).toLocaleDateString('default', {day:'numeric', month:'short', year:'numeric'});
    const dateCaption = p.takenAt ? `Taken ${dateLabel}` : `Uploaded ${dateLabel}`;
    const comments = p.comments || [];
    const commentsHtml = comments.length
      ? comments.map(c=>`<div class="gallery-comment"><strong>${escapeHtml(c.author||'Member')}:</strong> ${escapeHtml(c.text)}</div>`).join('')
      : `<div class="gallery-comment-empty">No comments yet.</div>`;
    const images = photoImages(p);
    const curIdx = sliderIndex.get(p.id) || 0;
    const sliderHtml = `<div class="gallery-slider">
      <div class="gallery-slider-track" id="sliderTrack-${p.id}" style="transform:translateX(-${curIdx*100}%);">
        ${images.map(src=>`<img class="gallery-img" src="${src}" alt="${escapeHtml(p.caption||'Gallery photo')}">`).join('')}
      </div>
      ${images.length > 1 ? `
        <button type="button" class="slider-arrow prev" data-slider-prev="${p.id}">‹</button>
        <button type="button" class="slider-arrow next" data-slider-next="${p.id}">›</button>
        <div class="slider-dots">${images.map((_,i)=>`<span class="slider-dot ${i===curIdx?'active':''}" data-dot="${p.id}:${i}"></span>`).join('')}</div>
      ` : ''}
    </div>`;
    const commentingAs = commenterMember
      ? `<div class="commenting-as">Commenting as <strong>${escapeHtml(commenterMember.name)}</strong> · <button type="button" class="link-btn" data-change-commenter>not you?</button></div>`
      : '';
    return `<div class="gallery-card">
      ${sliderHtml}
      <div class="gallery-body">
        ${p.caption ? `<div class="gallery-caption">${escapeHtml(p.caption)}</div>` : ''}
        <div class="gallery-date">${dateCaption}</div>
        <div class="gallery-actions">
          <button class="gallery-action-btn ${liked?'liked':''}" data-like="${p.id}">${liked?'❤️':'🤍'} <span>${p.likes||0}</span></button>
          <button class="gallery-action-btn" data-comment-toggle="${p.id}">💬 <span>${comments.length}</span></button>
          <button class="gallery-action-btn" data-share="${p.id}">↗ Share</button>
          <button class="gallery-action-btn admin-only" data-gallery-edit="${p.id}">✏️ Edit</button>
          <button class="gallery-action-btn danger admin-only" data-gallery-remove="${p.id}">🗑</button>
        </div>
        <div class="gallery-comments" id="comments-${p.id}" style="display:none;">
          <div class="gallery-comment-list">${commentsHtml}</div>
          ${commentingAs}
          <div class="gallery-comment-input-row">
            <input type="text" placeholder="Add a comment..." id="commentInput-${p.id}">
            <button class="btn btn-sm" data-comment-send="${p.id}">Send</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;

  grid.querySelectorAll('[data-like]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-like');
      const photo = galleryPhotos.find(x=>x.id===id);
      if(!photo) return;
      if(likedPhotoIds.has(id)){ likedPhotoIds.delete(id); photo.likes = Math.max(0, (photo.likes||0)-1); }
      else { likedPhotoIds.add(id); photo.likes = (photo.likes||0)+1; }
      await storeSet('gallery:'+id, photo);
      renderGallery();
    });
  });
  grid.querySelectorAll('[data-comment-toggle]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const el = document.getElementById('comments-'+btn.getAttribute('data-comment-toggle'));
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    });
  });
  grid.querySelectorAll('[data-comment-send]').forEach(btn=>{
    btn.addEventListener('click', ()=>submitComment(btn.getAttribute('data-comment-send')));
  });
  grid.querySelectorAll('[id^="commentInput-"]').forEach(input=>{
    input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') submitComment(input.id.replace('commentInput-','')); });
  });
  grid.querySelectorAll('[data-change-commenter]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const picked = await pickCommenterMember();
      if(picked) commenterMember = picked;
      renderGallery();
    });
  });
  grid.querySelectorAll('[data-share]').forEach(btn=>{
    btn.addEventListener('click', ()=>sharePhoto(btn.getAttribute('data-share')));
  });
  grid.querySelectorAll('[data-gallery-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>editGalleryPost(btn.getAttribute('data-gallery-edit')));
  });
  grid.querySelectorAll('[data-gallery-remove]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!isAdmin) return;
      const id = btn.getAttribute('data-gallery-remove');
      const ok = await askConfirm('Remove this photo? This can\'t be undone.', 'Remove');
      if(!ok) return;
      const imgKeys = await storeListPrefix('gallery-img:' + id + ':');
      for(const key of imgKeys){ await storeDelete(key); }
      await storeDelete('gallery:'+id);
      galleryPhotos = galleryPhotos.filter(p=>p.id!==id);
      sliderIndex.delete(id);
      renderGallery();
    });
  });
  grid.querySelectorAll('[data-slider-prev]').forEach(btn=>{
    btn.addEventListener('click', ()=>stepSlider(btn.getAttribute('data-slider-prev'), -1));
  });
  grid.querySelectorAll('[data-slider-next]').forEach(btn=>{
    btn.addEventListener('click', ()=>stepSlider(btn.getAttribute('data-slider-next'), 1));
  });
  grid.querySelectorAll('[data-dot]').forEach(dot=>{
    dot.addEventListener('click', ()=>{
      const [id, i] = dot.getAttribute('data-dot').split(':');
      sliderIndex.set(id, Number(i));
      updateSliderPosition(id);
    });
  });
}

async function editGalleryPost(id){
  if(!isAdmin) return;
  const photo = galleryPhotos.find(x=>x.id===id);
  if(!photo) return;
  let editImages = [...photoImages(photo)];

  const overlay = openModal(`
    <h3>Edit post</h3>
    <div class="gallery-upload-preview" id="editGalleryPreview"></div>
    <button type="button" class="btn btn-sm file-btn" style="margin-top:10px;">Add more photos<input type="file" id="editGalleryFileInput" accept="image/*" multiple></button>
    <div class="field" style="margin-top:14px;"><label>Caption</label><input type="text" id="editGalleryCaption" value="${escapeHtml(photo.caption||'')}"></div>
    <div class="field"><label>Date taken</label><input type="date" id="editGalleryDate" value="${photo.takenAt||''}"></div>
    <div class="modal-actions">
      <button class="btn btn-sm" id="modalCancel">Cancel</button>
      <button class="btn btn-sm btn-primary" id="modalSave">Save changes</button>
    </div>
  `, 'wide');

  function renderEditPreview(){
    const wrap = overlay.querySelector('#editGalleryPreview');
    wrap.innerHTML = editImages.map((src,i)=>`
      <div class="upload-thumb">
        <img src="${src}" alt="Photo ${i+1}">
        <button type="button" class="upload-thumb-remove" data-edit-remove-thumb="${i}">×</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-edit-remove-thumb]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        editImages.splice(Number(btn.getAttribute('data-edit-remove-thumb')), 1);
        renderEditPreview();
      });
    });
  }
  renderEditPreview();

  overlay.querySelector('#editGalleryFileInput').addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    for(const file of files){
      try{ editImages.push(await compressImageFile(file)); }
      catch(err){ console.error('image compression failed', err); }
    }
    renderEditPreview();
    e.target.value = '';
  });

  overlay.querySelector('#modalCancel').addEventListener('click', ()=>overlay.remove());
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.remove(); });
  overlay.querySelector('#modalSave').addEventListener('click', async ()=>{
    if(editImages.length === 0){ showMessage('A post needs at least one photo.'); return; }
    const saveBtn = overlay.querySelector('#modalSave');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
    const imagesOk = await savePhotoImages(id, editImages);
    const metaToSave = {
      id: photo.id,
      caption: overlay.querySelector('#editGalleryCaption').value.trim(),
      takenAt: overlay.querySelector('#editGalleryDate').value || null,
      uploadedAt: photo.uploadedAt,
      likes: photo.likes || 0,
      comments: photo.comments || []
    };
    const metaOk = await storeSet('gallery:' + id, metaToSave);
    saveBtn.disabled = false; saveBtn.textContent = 'Save changes';
    if(!imagesOk || !metaOk){
      showMessage('Save failed — check your internet connection and try again with fewer photos.');
      return;
    }
    Object.assign(photo, metaToSave);
    photo.images = [...editImages];
    sliderIndex.set(id, 0);
    overlay.remove();
    renderGallery();
  });
}

function stepSlider(id, delta){
  const photo = galleryPhotos.find(x=>x.id===id);
  if(!photo) return;
  const images = photoImages(photo);
  let idx = sliderIndex.get(id) || 0;
  idx = (idx + delta + images.length) % images.length;
  sliderIndex.set(id, idx);
  updateSliderPosition(id);
}
function updateSliderPosition(id){
  const track = document.getElementById('sliderTrack-'+id);
  const idx = sliderIndex.get(id) || 0;
  if(track) track.style.transform = `translateX(-${idx*100}%)`;
  document.querySelectorAll(`[data-dot^="${id}:"]`).forEach(d=>{
    const i = Number(d.getAttribute('data-dot').split(':')[1]);
    d.classList.toggle('active', i === idx);
  });
}

/* ---------- comment identity: pick from members, never free-typed ---------- */
function pickCommenterMember(){
  return new Promise(resolve=>{
    const overlay = openModal(`
      <h3>Who are you?</h3>
      <input type="text" id="commenterSearchInput" placeholder="Search your name...">
      <div id="commenterSearchResults" style="max-height:260px; overflow-y:auto; margin:10px 0 4px;"></div>
      <div class="modal-actions"><button class="btn btn-sm" id="modalCancel">Cancel</button></div>
    `, 'wide');
    const input = overlay.querySelector('#commenterSearchInput');
    const resultsWrap = overlay.querySelector('#commenterSearchResults');
    const cleanup = (val)=>{ overlay.remove(); resolve(val); };

    function renderResults(query){
      const q = (query||'').toLowerCase();
      const list = q ? getSortedMembers().filter(m=>(m.name||'').toLowerCase().includes(q)) : getSortedMembers();
      if(list.length === 0){ resultsWrap.innerHTML = `<div class="split-empty">No members found.</div>`; return; }
      resultsWrap.innerHTML = list.map(m=>{
        const idx = members.indexOf(m);
        const avatar = m.photo
          ? `<img class="avatar" src="${m.photo}" style="border-color:${colorFor(idx)}" alt="${escapeHtml(m.name)}">`
          : `<div class="avatar-fallback" style="background:${colorFor(idx)}">${initials(m.name)}</div>`;
        return `<div class="search-result-row" data-pick-member="${m.id}">${avatar}<div><div class="member-name">${escapeHtml(m.name)}</div>${m.position?`<div class="member-position">${escapeHtml(m.position)}</div>`:''}</div></div>`;
      }).join('');
      resultsWrap.querySelectorAll('[data-pick-member]').forEach(row=>{
        row.addEventListener('click', ()=>{
          const m = members.find(x=>x.id===row.getAttribute('data-pick-member'));
          cleanup(m ? {id:m.id, name:m.name} : null);
        });
      });
    }
    renderResults('');
    input.addEventListener('input', ()=>renderResults(input.value.trim()));
    setTimeout(()=>input.focus(), 30);
    overlay.querySelector('#modalCancel').addEventListener('click', ()=>cleanup(null));
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) cleanup(null); });
  });
}

async function submitComment(id){
  const input = document.getElementById('commentInput-'+id);
  const text = input.value.trim();
  if(!text) return;
  if(containsProfanity(text)){
    showMessage('That comment contains language that isn\'t allowed here — please rephrase it.');
    return;
  }
  if(!commenterMember){
    const picked = await pickCommenterMember();
    if(!picked) return;
    commenterMember = picked;
  }
  const photo = galleryPhotos.find(x=>x.id===id);
  if(!photo) return;
  photo.comments = photo.comments || [];
  photo.comments.push({ authorId: commenterMember.id, author: commenterMember.name, text, at: new Date().toISOString() });
  await storeSet('gallery:'+id, photo);
  renderGallery();
  const el = document.getElementById('comments-'+id);
  if(el) el.style.display = 'block';
}

function sharePhoto(id){
  const photo = galleryPhotos.find(x=>x.id===id);
  if(!photo) return;
  const shareText = photo.caption || 'Check out this photo from Brights Youth Community!';
  if(navigator.share){
    navigator.share({ title:'Brights Youth Community', text: shareText, url: window.location.href }).catch(()=>{});
  } else if(navigator.clipboard){
    navigator.clipboard.writeText(shareText + ' — ' + window.location.href)
      .then(()=>showMessage('Link copied! Paste it anywhere to share.'))
      .catch(()=>showMessage('Could not copy the link automatically.'));
  } else {
    showMessage('Sharing is not supported on this browser.');
  }
}

/* ---------- installable app (PWA) ---------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(err=>console.error('SW registration failed', err));
  });
}
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('installAppBtn');
  if(btn) btn.style.display = 'inline-flex';
});
document.getElementById('installAppBtn').addEventListener('click', async ()=>{
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('installAppBtn').style.display = 'none';
});
window.addEventListener('appinstalled', ()=>{
  const btn = document.getElementById('installAppBtn');
  if(btn) btn.style.display = 'none';
});

/* ---------- init ---------- */
setAdminUi();
loadAll();
