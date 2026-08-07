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
  if(FIREBASE_NOT_CONFIGURED) return;
  try{ await db.collection(COLLECTION).doc(key).set({ value: JSON.stringify(value) }); }
  catch(e){ console.error('storage set failed', key, e); }
}
async function storeListPrefix(prefix){
  if(FIREBASE_NOT_CONFIGURED) return [];
  try{
    const snap = await db.collection(COLLECTION).get();
    return snap.docs.map(d=>d.id).filter(id=>id.startsWith(prefix));
  }catch(e){ return []; }
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
let editingMemberId = null;

function fmtMoney(n){ n = Math.round(n||0); return '₹' + n.toLocaleString('en-IN'); }
function initials(name){ return (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join(''); }
function colorFor(idx){ return PALETTE[idx % PALETTE.length]; }
function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

/* ---------- custom dialogs (native prompt/alert/confirm are blocked in this preview) ---------- */
function openModal(html){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box">${html}</div>`;
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
  members = await storeGet('members', []);
  settings = await storeGet('settings', { monthlyFee: 200, openingBalance: 0 });
  transactions = await storeGet('transactions', []);
  document.getElementById('monthlyFeeInput').value = settings.monthlyFee;
  document.getElementById('openingBalanceInput').value = settings.openingBalance;
  document.getElementById('monthPicker').value = currentMonth;
  await ensureMonthLoaded(currentMonth);
  await ensureAllMonthsLoaded();
  render();
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
  let rows = members.map((m, idx)=>{
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
      await storeSet('members', members);
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
  members.forEach((m, idx)=>{
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
  ['fName','fPhone','fAddress','fParentName','fParentPhone','fEducation','fInstitution','fPositionOther'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fStatus').value = 'Studying';
  document.getElementById('fInstLabel').textContent = 'School / college';
  document.getElementById('fPosition').value = '';
  document.getElementById('fPositionOtherWrap').style.display = 'none';
  document.getElementById('newPhotoPreview').src = '';
  newPhotoData = '';
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
  document.getElementById('fStatus').value = m.status||'Studying';
  document.getElementById('fInstLabel').textContent = m.status === 'Working' ? 'Workplace' : 'School / college';
  document.getElementById('fInstitution').value = m.institution||'';
  const knownPositions = ['President','Vice President','Secretary','Joint Secretary','Treasurer','Coordinator','Volunteer'];
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
    status: document.getElementById('fStatus').value,
    institution: document.getElementById('fInstitution').value.trim(),
    position: positionSelect === '__other' ? document.getElementById('fPositionOther').value.trim() : positionSelect,
    photo: newPhotoData
  };
  if(editingMemberId){
    const idx = members.findIndex(m=>m.id===editingMemberId);
    if(idx>-1) members[idx] = { ...members[idx], ...fields };
  } else {
    members.push({ id:'m_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), joined:new Date().toISOString().slice(0,10), ...fields });
  }
  await storeSet('members', members);
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

/* ---------- init ---------- */
setAdminUi();
loadAll();
