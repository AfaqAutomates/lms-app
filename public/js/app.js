const sb = window.supabase.createClient(window.LMS_CONFIG.SUPABASE_URL, window.LMS_CONFIG.SUPABASE_ANON_KEY);

const ACTIVITY_TYPES = ['Top-up','Oil Replacement','Drain and Refill','Greasing','Lubricant Replenishment',
  'Filter Replacement','Sampling','Inspection','Flushing','Corrective lubrication','Emergency lubrication','Other'];

const PAGES = [
  {id:'dashboard', label:'Dashboard', icon:'dashboard'},
  {id:'Equipment', label:'Equipment', icon:'Equipment'},
  {id:'points', label:'Lubrication Points', icon:'points'},
  {id:'workorders', label:'Work Orders', icon:'workorders'},
  {id:'oilanalysis', label:'Oil Analysis', icon:'oil'},
  {id:'inventory', label:'Inventory', icon:'inventory'},
  {id:'alerts', label:'Alerts', icon:'alerts'},
  {id:'reports', label:'Reports', icon:'reports'},
  {id:'audit', label:'Audit History', icon:'audit'},
  {id:'settings', label:'Settings', icon:'settings'},
];

let active = 'dashboard';
let session = null;
let me = {id:null, name:'', isAdmin:false};
let myFeatures = new Set();
let allFeatures = [];
let cache = {equipment:[], components:[], points:[], lubricants:[], activities:[], profiles:{}};
let editing = {};
let workOrderFilter = '';
let inventorySubtab = 'lubricants';
let pointsSubtab = 'points';

// ============================== AUTH ==============================
async function init(){
  document.getElementById('authLogo').innerHTML = icon('logo');
  document.getElementById('brandLogo').innerHTML = icon('logo');
  document.getElementById('bellIcon').innerHTML = icon('bell');
  document.getElementById('hamburger').innerHTML = icon('menu');

  const {data:{session:s}} = await sb.auth.getSession();
  session = s;
  sb.auth.onAuthStateChange((_e, s2)=>{ session = s2; route(); });
  route();

  document.getElementById('btnSignIn').onclick = async ()=>{
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const {error} = await sb.auth.signInWithPassword({email, password});
    if(error) showAuthError(error.message);
  };
  document.getElementById('btnSignOut').onclick = async ()=>{ await sb.auth.signOut(); };
  document.getElementById('btnChangePw').onclick = openChangePasswordModal;
  document.getElementById('hamburger').onclick = ()=>document.body.classList.toggle('drawer-open');
  document.getElementById('backdrop').onclick = ()=>document.body.classList.remove('drawer-open');
}
function openChangePasswordModal(){
  const body = el('div');
  const w1 = el('div'); w1.appendChild(el('label','field-label','New password (min 8 characters)'));
  const p1 = el('input'); p1.type='password'; w1.appendChild(p1); body.appendChild(w1);
  const w2 = el('div'); w2.appendChild(el('label','field-label','Confirm new password'));
  const p2 = el('input'); p2.type='password'; w2.appendChild(p2); body.appendChild(w2);
  openModal('Change password', body, async ()=>{
    if(p1.value.length<8){ alert('Password must be at least 8 characters.'); return false; }
    if(p1.value!==p2.value){ alert('Passwords do not match.'); return false; }
    const {error} = await sb.auth.updateUser({password:p1.value});
    if(error){ alert('Failed: '+error.message); return false; }
    alert('Password changed.');
  }, 'Change password');
}
function showAuthError(msg, ok){
  const el = document.getElementById('authError');
  el.style.display='block'; el.textContent = msg;
  el.style.color = ok ? 'var(--ok)' : 'var(--bad)';
}

async function route(){
  if(!session){
    document.getElementById('authScreen').style.display='flex';
    document.getElementById('appScreen').style.display='none';
    return;
  }
  document.getElementById('authScreen').style.display='none';
  document.getElementById('appScreen').style.display='block';
  me.id = session.user.id;
  const {data:prof} = await sb.from('profiles').select('full_name, is_admin').eq('id', me.id).maybeSingle();
  me.name = (prof && prof.full_name) ? prof.full_name : session.user.email;
  me.isAdmin = !!(prof && prof.is_admin);
  document.getElementById('tbName').textContent = me.name;
  document.getElementById('tbAvatar').textContent = (me.name||'?').trim().slice(0,1).toUpperCase();
  buildSidebar();
  await loadAll();
  document.getElementById('tbRole').textContent = me.isAdmin ? 'Administrator' : (myFeatures.size ? [...myFeatures].join(', ') : 'No access assigned');
  render();
}

// ============================== DATA ==============================
async function loadAll(){
  const [eq, comp, pts, lub, act, feats, myFeats] = await Promise.all([
    sb.from('equipment').select('*').order('created_at',{ascending:false}),
    sb.from('components').select('*').order('created_at',{ascending:false}),
    sb.from('lubrication_points').select('*').order('created_at',{ascending:false}),
    sb.from('lubricants').select('*').order('created_at',{ascending:false}),
    sb.from('activities').select('*').order('activity_date',{ascending:false}),
    sb.from('features').select('*').order('module'),
    sb.from('user_features').select('feature_key').eq('user_id', me.id).eq('enabled', true),
  ]);
  cache.equipment = eq.data || [];
  cache.components = comp.data || [];
  cache.points = pts.data || [];
  cache.lubricants = lub.data || [];
  cache.activities = act.data || [];
  allFeatures = feats.data || [];
  myFeatures = new Set((myFeats.data||[]).map(f=>f.feature_key));

  const ids = new Set();
  [...cache.equipment, ...cache.components, ...cache.points, ...cache.lubricants, ...cache.activities].forEach(r=>{
    if(r.created_by) ids.add(r.created_by); if(r.updated_by) ids.add(r.updated_by);
  });
  if(ids.size){
    const {data:profs} = await sb.from('profiles').select('id, full_name').in('id', [...ids]);
    (profs||[]).forEach(p=>{ cache.profiles[p.id]=p.full_name; });
  }
}
function personName(id){ return cache.profiles[id] || (id ? 'Unknown user' : '—'); }
function hasFeature(key){ return me.isAdmin || myFeatures.has(key); }
function isAdmin(){ return me.isAdmin; }

// ============================== SHELL / ROUTER ==============================
function buildSidebar(){
  const nav = document.getElementById('sbnav');
  nav.innerHTML = '';
  PAGES.forEach(p=>{
    const b = document.createElement('button');
    b.className = 'nav-item' + (p.id===active ? ' active':'');
    b.innerHTML = icon(p.icon) + '<span>'+p.label+'</span>';
    b.onclick = ()=>{ active=p.id; document.body.classList.remove('drawer-open'); render(); };
    nav.appendChild(b);
  });
}
function render(){
  buildSidebar();
  document.getElementById('pageTitle').textContent = PAGES.find(p=>p.id===active).label;
  const page = document.getElementById('page');
  page.innerHTML = '';
  const renderers = {
    dashboard: renderDashboard, Equipment: ()=>renderMasterPage('Equipment'), points: renderPointsPage,
    workorders: renderWorkOrders, oilanalysis: ()=>renderComingSoon('Oil Analysis','Manual lab-result entry, configurable limits and trend charts arrive in Phase 4.'),
    inventory: renderInventory, alerts: ()=>renderComingSoon('Alerts','Automatic alerts (overdue lubrication, abnormal oil analysis, low stock) arrive once Running Hours, Oil Analysis and Inventory levels are built.'),
    reports: ()=>renderComingSoon('Reports','Standardized monthly reports and analytics arrive in Phase 6, once the modules feeding them exist.'),
    audit: renderAudit, settings: renderSettings,
  };
  (renderers[active]||renderDashboard)();
}
function el(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!==undefined) e.innerHTML=html; return e; }
function fmtDate(s){ if(!s) return '—'; return new Date(s).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }
function fmtDateTime(s){ if(!s) return '—'; return new Date(s).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }

function statusBadge(status){
  const s=(status||'Active').toLowerCase();
  const cls = s==='inactive' ? 'bad' : 'ok';
  return '<span class="badge '+cls+'">'+(status||'Active')+'</span>';
}

// ============================== MODAL ==============================
function openModal(title, bodyEl, onSave, saveLabel){
  const bd = el('div','modal-backdrop');
  const m = el('div','modal');
  const head = el('div','modal-head');
  head.appendChild(el('h2',null,title));
  const closeBtn = el('button','modal-close', icon('close'));
  closeBtn.onclick = ()=>bd.remove();
  head.appendChild(closeBtn);
  m.appendChild(head);
  m.appendChild(bodyEl);
  if(onSave){
    const foot = el('div','modal-foot');
    const cancel = el('button','btn sec','Cancel'); cancel.onclick=()=>bd.remove();
    const save = el('button','btn', saveLabel||'Save'); save.onclick=async()=>{ const ok = await onSave(); if(ok!==false) bd.remove(); };
    foot.appendChild(cancel); foot.appendChild(save);
    m.appendChild(foot);
  }
  bd.appendChild(m);
  bd.onclick = (e)=>{ if(e.target===bd) bd.remove(); };
  document.body.appendChild(bd);
}

// ============================== DASHBOARD ==============================
function renderDashboard(){
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Welcome back, '+ (me.name||'').split(' ')[0] +'!</h1><div class="page-sub">Plant — Lubrication Management &amp; Reliability</div>'));
  page.appendChild(head);

  const kpis = el('div','kpi-grid');
  const totalPoints = cache.points.length;
  const activePoints = cache.points.filter(p=>(p.status||'Active').toLowerCase()!=='inactive').length;
  const totalEquipment = cache.equipment.length;
  const recentActs = cache.activities.filter(a=>{
    const d = new Date(a.activity_date); const now = new Date();
    return (now - d) / 86400000 <= 30;
  }).length;

  kpis.appendChild(kpiCard('Equipment','Total Lubrication Points', totalPoints, activePoints+' active', 'var(--accent)','var(--accent-tint)'));
  kpis.appendChild(kpiCard('workorders','Activities (Last 30 Days)', recentActs, 'recorded by your team', 'var(--ok)','var(--ok-tint)'));
  kpis.appendChild(kpiCard('Equipment','Total Equipment', totalEquipment, 'in the equipment master', 'var(--info)','var(--info-tint)'));
  const dueCard = el('div','kpi muted');
  dueCard.innerHTML = '<div class="kpi-top"><div class="kpi-icon" style="background:var(--warn-tint);color:var(--warn)">'+icon('alerts')+'</div><div class="kpi-label">Due Soon / Overdue</div></div><div class="kpi-value">Coming in Phase 3</div><div class="kpi-sub">Activates once Running Hours tracking is built</div>';
  kpis.appendChild(dueCard);
  page.appendChild(kpis);

  const grid = el('div');
  grid.style.cssText='display:grid;grid-template-columns:2fr 1fr;gap:16px;';
  if(window.innerWidth < 900) grid.style.gridTemplateColumns='1fr';

  const left = el('div');
  const recentCard = el('div','card');
  recentCard.appendChild(el('div','card-title','Recent Activities'));
  const recent = cache.activities.slice(0,8);
  if(!recent.length){
    recentCard.appendChild(emptyState('workorders','No activities yet','Recorded lubrication activities will show up here.'));
  } else {
    const t = el('table');
    t.innerHTML = '<tr><th>Date</th><th>Asset</th><th>Type</th><th>Lubricant</th></tr>' + recent.map(a=>
      '<tr><td>'+fmtDate(a.activity_date)+'</td><td>'+(a.equipment_number||'—')+'</td><td>'+(a.activity_type||'—')+'</td><td>'+(a.lubricant_name||'—')+'</td></tr>'
    ).join('');
    const w = el('div','tablewrap'); w.appendChild(t); recentCard.appendChild(w);
  }
  left.appendChild(recentCard);
  grid.appendChild(left);

  const right = el('div');
  const roleCard = el('div','card');
  roleCard.appendChild(el('div','card-title','Your Access'));
  const accessList = me.isAdmin ? '<span class="badge info">Administrator — full access</span>' :
    (myFeatures.size ? [...myFeatures].map(k=>'<span class="badge ok" style="margin:2px">'+k+'</span>').join('') : '<span class="badge gray">No features enabled yet</span>');
  roleCard.appendChild(el('div',null,'<div style="font-size:13px;color:var(--sub)">'+accessList+'</div>'));
  right.appendChild(roleCard);
  if(me.isAdmin){
    const adminCard = el('div','card');
    adminCard.appendChild(el('div','card-title','Administration'));
    adminCard.appendChild(el('div',null,'<div style="font-size:12px;color:var(--sub)">Create users and manage feature access under <b>Settings</b>.</div>'));
    right.appendChild(adminCard);
  }
  grid.appendChild(right);
  page.appendChild(grid);
}
function kpiCard(iconName, label, value, sub, color, tint){
  const c = el('div','kpi');
  c.innerHTML = '<div class="kpi-top"><div class="kpi-icon" style="background:'+tint+';color:'+color+'">'+icon(iconName)+'</div><div class="kpi-label">'+label+'</div></div>'+
    '<div class="kpi-value">'+value+'</div><div class="kpi-sub">'+sub+'</div>';
  return c;
}
function emptyState(iconName, title, sub){
  const e = el('div','empty-state');
  e.innerHTML = icon(iconName)+'<h3>'+title+'</h3><p>'+sub+'</p>';
  return e;
}
function renderComingSoon(title, sub){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>'+title+'</h1>'));
  const card = el('div','card');
  card.appendChild(emptyState('reports', title+' — coming soon', sub));
  page.appendChild(card);
}

// ============================== Equipment (equipment) ==============================
const MASTER_CONFIG = {
  Equipment: {
    table:'equipment', label:'Asset',
    columns: [
      ['sap_equipment_number','Asset ID'], ['description','Asset Name'], ['equipment_type','Type'],
      ['functional_location','Location'], ['_lp_count','Lubrication Points'], ['status','Status'],
    ],
    fields: [
      ['sap_equipment_number','SAP Equipment #',1],['description','Description',1],
      ['functional_location','Functional Location'],['plant','Plant'],['area','Area'],
      ['equipment_type','Equipment Type'],['manufacturer','Manufacturer'],['model','Model'],
      ['serial_number','Serial Number'],['status','Status (Active/Inactive)'],
      ['criticality','Lubrication Criticality'],['notes','Lubrication Notes',0,'textarea'],
    ],
  },
};
function renderMasterPage(kind){
  const cfg = MASTER_CONFIG[kind];
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Equipment</h1><div class="page-sub">Plant equipment, keyed by SAP Equipment Number</div>'));
  if(hasFeature('Equipment.edit')){
    const addBtn = el('button','btn', icon('plus')+' Add Asset');
    addBtn.onclick = ()=>openMasterModal(kind, null);
    head.appendChild(addBtn);
  }
  page.appendChild(head);

  const list = cache.equipment;
  const card = el('div','card');
  if(!list.length){ card.appendChild(emptyState('Equipment','No Equipment yet', hasFeature('Equipment.edit')?'Click "Add Asset" to create your first one.':'Ask your administrator for access.')); page.appendChild(card); return; }

  const wrap = el('div','tablewrap');
  const t = el('table');
  const thead = el('tr');
  cfg.columns.forEach(c=>thead.appendChild(el('th',null,c[1])));
  thead.appendChild(el('th'));
  t.appendChild(thead);
  list.forEach(rec=>{
    const tr = el('tr');
    cfg.columns.forEach(c=>{
      const td = el('td');
      if(c[0]==='status'){ td.innerHTML = statusBadge(rec.status); }
      else if(c[0]==='_lp_count'){ td.textContent = cache.points.filter(p=>p.equipment_number===rec.sap_equipment_number).length; }
      else { td.textContent = rec[c[0]]||'—'; }
      tr.appendChild(td);
    });
    const tdAct = el('td'); tdAct.className='row-actions';
    const hist = el('button','icon-btn', icon('history')); hist.title='History';
    hist.onclick=()=>{ workOrderFilter = rec.sap_equipment_number; active='workorders'; render(); };
    tdAct.appendChild(hist);
    if(hasFeature('Equipment.edit')){
      const ed = el('button','icon-btn', icon('settings')); ed.title='Edit';
      ed.onclick=()=>openMasterModal(kind, rec);
      const del = el('button','icon-btn', icon('close')); del.title='Delete'; del.style.color='var(--bad)';
      del.onclick=async()=>{ if(confirm('Delete this asset?')){ const {error}=await sb.from(cfg.table).delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
      tdAct.appendChild(ed); tdAct.appendChild(del);
    }
    tr.appendChild(tdAct);
    t.appendChild(tr);
  });
  wrap.appendChild(t); card.appendChild(wrap); page.appendChild(card);
}
function openMasterModal(kind, edit){
  const cfg = MASTER_CONFIG[kind];
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  cfg.fields.forEach(([key,label,req,type])=>{
    const w = el('div');
    w.appendChild(el('label','field-label', label+(req?' *':'')));
    const inp = type==='textarea' ? el('textarea') : el('input');
    inp.value = edit ? (edit[key]||'') : '';
    w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });
  body.appendChild(grid);
  openModal(edit?'Edit asset':'Add new asset', body, async ()=>{
    const data={}; let missing=false;
    cfg.fields.forEach(([key,label,req])=>{ const v=inputs[key].value.trim(); if(req&&!v)missing=true; data[key]=v; });
    if(missing){ alert('Please fill required fields (*)'); return false; }
    data.updated_at = new Date().toISOString(); data.updated_by = me.id;
    try{
      if(edit){ const {error}=await sb.from(cfg.table).update(data).eq('id',edit.id); if(error) throw error; }
      else { data.created_by=me.id; const {error}=await sb.from(cfg.table).insert(data); if(error) throw error; }
    }catch(e){ alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit?'Save changes':'Add asset');
}

// ============================== LUBRICATION POINTS (+ Components subtab) ==============================
function renderPointsPage(){
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Lubrication Points</h1><div class="page-sub">Plant &rarr; Area &rarr; Asset &rarr; Component &rarr; Lubrication Point</div>'));
  if(hasFeature('points.edit')){
    const addBtn = el('button','btn', icon('plus')+(pointsSubtab==='points'?' Add Lubrication Point':' Add Component'));
    addBtn.onclick = ()=> pointsSubtab==='points' ? openPointModal(null) : openComponentModal(null);
    head.appendChild(addBtn);
  }
  page.appendChild(head);

  const seg = el('div','segtabs');
  ['points','components'].forEach(s=>{
    const b = el('button', s===pointsSubtab?'active':'', s==='points'?'Lubrication Points':'Components');
    b.onclick = ()=>{ pointsSubtab=s; render(); };
    seg.appendChild(b);
  });
  page.appendChild(seg);

  const card = el('div','card');
  if(pointsSubtab==='points'){
    const list = cache.points;
    if(!list.length){ card.appendChild(emptyState('points','No lubrication points yet', hasFeature('points.edit')?'Click "Add Lubrication Point" to create your first one.':'Ask your administrator for access.')); }
    else {
      const wrap = el('div','tablewrap');
      const t = el('table');
      t.appendChild(el('tr',null,'<th>Point</th><th>Asset</th><th>Component</th><th>Lubricant</th><th>Frequency</th><th>Next Due</th><th>Status</th><th></th>'));
      list.forEach(rec=>{
        const tr = el('tr');
        tr.innerHTML = '<td>LP-'+rec.id.slice(0,5).toUpperCase()+'</td><td>'+(rec.equipment_number||'—')+'</td><td>'+(rec.component_name||'—')+'</td>'+
          '<td>'+(rec.lubricant_name||'—')+'</td><td>'+(rec.frequency||rec.running_hour_interval||rec.calendar_interval||'—')+'</td>'+
          '<td><span class="badge gray">Phase 3</span></td><td>'+statusBadge(rec.status)+'</td>';
        const tdAct = el('td'); tdAct.className='row-actions';
        if(hasFeature('points.edit')){
          const ed = el('button','icon-btn', icon('settings')); ed.onclick=()=>openPointModal(rec);
          const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
          del.onclick=async()=>{ if(confirm('Delete this lubrication point?')){ const {error}=await sb.from('lubrication_points').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
          tdAct.appendChild(ed); tdAct.appendChild(del);
        }
        tr.appendChild(tdAct);
        t.appendChild(tr);
      });
      wrap.appendChild(t); card.appendChild(wrap);
    }
  } else {
    const list = cache.components;
    if(!list.length){ card.appendChild(emptyState('points','No components yet', hasFeature('points.edit')?'Click "Add Component" to create your first one.':'Ask your administrator for access.')); }
    else {
      const wrap = el('div','tablewrap');
      const t = el('table');
      t.appendChild(el('tr',null,'<th>Component</th><th>Asset</th><th>Type</th><th>Criticality</th><th>Status</th><th></th>'));
      list.forEach(rec=>{
        const tr = el('tr');
        tr.innerHTML = '<td>'+rec.name+'</td><td>'+(rec.equipment_number||'—')+'</td><td>'+(rec.type||'—')+'</td><td>'+(rec.criticality||'—')+'</td><td>'+statusBadge(rec.status)+'</td>';
        const tdAct = el('td'); tdAct.className='row-actions';
        if(hasFeature('points.edit')){
          const ed = el('button','icon-btn', icon('settings')); ed.onclick=()=>openComponentModal(rec);
          const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
          del.onclick=async()=>{ if(confirm('Delete this component?')){ const {error}=await sb.from('components').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
          tdAct.appendChild(ed); tdAct.appendChild(del);
        }
        tr.appendChild(tdAct);
        t.appendChild(tr);
      });
      wrap.appendChild(t); card.appendChild(wrap);
    }
  }
  page.appendChild(card);
}
function equipmentSelect(value){
  const sel = el('select');
  sel.appendChild(el('option','', '— select —'));
  cache.equipment.forEach(e=>{ const o=el('option',null,e.sap_equipment_number+' — '+(e.description||'')); o.value=e.sap_equipment_number; sel.appendChild(o); });
  sel.value = value||''; return sel;
}
function openPointModal(edit){
  const fields = [
    ['component_name','Component Name'],['point_name','Point Name',1],['lubrication_type','Lubrication Type'],
    ['lubricant_name','Lubricant'],['required_quantity','Required Qty'],['uom','UOM'],['frequency','Frequency (text)'],
    ['running_hour_interval','Running-Hour Interval'],['calendar_interval','Calendar Interval (months)'],
    ['status','Status (Active/Inactive)'],['special_instructions','Special Instructions',0,'textarea'],
  ];
  const body = el('div');
  const eqWrap = el('div'); eqWrap.appendChild(el('label','field-label','SAP Equipment # *'));
  const eqSel = equipmentSelect(edit?edit.equipment_number:''); eqWrap.appendChild(eqSel); body.appendChild(eqWrap);
  const grid = el('div','grid2'); const inputs = {};
  fields.forEach(([key,label,req,type])=>{
    const w = el('div'); w.appendChild(el('label','field-label', label+(req?' *':'')));
    const inp = type==='textarea' ? el('textarea') : el('input');
    inp.value = edit ? (edit[key]||'') : ''; w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });
  body.appendChild(grid);
  openModal(edit?'Edit lubrication point':'Add lubrication point', body, async ()=>{
    if(!eqSel.value){ alert('Select an asset.'); return false; }
    const data={equipment_number:eqSel.value}; let missing=false;
    fields.forEach(([key,label,req])=>{ const v=inputs[key].value.trim(); if(req&&!v)missing=true; data[key]=v; });
    if(missing){ alert('Please fill required fields (*)'); return false; }
    data.updated_at=new Date().toISOString(); data.updated_by=me.id;
    try{
      if(edit){ const {error}=await sb.from('lubrication_points').update(data).eq('id',edit.id); if(error) throw error; }
      else { data.created_by=me.id; const {error}=await sb.from('lubrication_points').insert(data); if(error) throw error; }
    }catch(e){ alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  });
}
function openComponentModal(edit){
  const fields = [['name','Component Name',1],['type','Component Type'],['description','Description'],
    ['criticality','Criticality'],['status','Status (Active/Inactive)'],['remarks','Remarks',0,'textarea']];
  const body = el('div');
  const eqWrap = el('div'); eqWrap.appendChild(el('label','field-label','SAP Equipment # *'));
  const eqSel = equipmentSelect(edit?edit.equipment_number:''); eqWrap.appendChild(eqSel); body.appendChild(eqWrap);
  const grid = el('div','grid2'); const inputs = {};
  fields.forEach(([key,label,req,type])=>{
    const w = el('div'); w.appendChild(el('label','field-label', label+(req?' *':'')));
    const inp = type==='textarea' ? el('textarea') : el('input');
    inp.value = edit ? (edit[key]||'') : ''; w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });
  body.appendChild(grid);
  openModal(edit?'Edit component':'Add component', body, async ()=>{
    if(!eqSel.value){ alert('Select an asset.'); return false; }
    const data={equipment_number:eqSel.value}; let missing=false;
    fields.forEach(([key,label,req])=>{ const v=inputs[key].value.trim(); if(req&&!v)missing=true; data[key]=v; });
    if(missing){ alert('Please fill required fields (*)'); return false; }
    data.updated_at=new Date().toISOString(); data.updated_by=me.id;
    try{
      if(edit){ const {error}=await sb.from('components').update(data).eq('id',edit.id); if(error) throw error; }
      else { data.created_by=me.id; const {error}=await sb.from('components').insert(data); if(error) throw error; }
    }catch(e){ alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  });
}

// ============================== WORK ORDERS (activities) ==============================
function renderWorkOrders(){
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Work Orders</h1><div class="page-sub">Recorded lubrication activities — every entry here represents completed work. Scheduled/open work orders arrive in a later phase.</div>'));
  const addBtn = el('button','btn', icon('plus')+' Record Activity');
  addBtn.onclick = ()=>openActivityModal(null);
  addBtn.style.display = hasFeature('workorders.record') ? '' : 'none';
  head.appendChild(addBtn);
  page.appendChild(head);

  const filterBar = el('div','filter-bar');
  const sw = el('div','search-wrap'); sw.innerHTML = icon('search');
  const fin = el('input'); fin.type='text'; fin.placeholder='Filter by SAP Equipment #…'; fin.value=workOrderFilter;
  fin.oninput = ()=>{ workOrderFilter = fin.value; renderWorkOrderTable(tableHost); };
  sw.appendChild(fin); filterBar.appendChild(sw);
  if(workOrderFilter){ const c=el('button','btn sec','Clear'); c.onclick=()=>{workOrderFilter=''; render();}; filterBar.appendChild(c); }
  page.appendChild(filterBar);

  const card = el('div','card');
  const tableHost = el('div');
  card.appendChild(tableHost);
  page.appendChild(card);
  renderWorkOrderTable(tableHost);
}
function renderWorkOrderTable(host){
  const list = cache.activities.filter(a=>!workOrderFilter || a.equipment_number===workOrderFilter);
  host.innerHTML='';
  if(!list.length){ host.appendChild(emptyState('workorders','No activities recorded yet','Click "Record Activity" to log the first one.')); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>WO #</th><th>Asset</th><th>Point</th><th>Type</th><th>Qty</th><th>Completed</th><th>Status</th><th></th>'));
  list.forEach(rec=>{
    const tr = el('tr');
    tr.innerHTML = '<td>WO-'+rec.id.slice(0,5).toUpperCase()+'</td><td>'+(rec.equipment_number||'—')+'</td><td>'+(rec.point_name||'—')+'</td>'+
      '<td>'+(rec.activity_type||'—')+'</td><td>'+(rec.quantity?rec.quantity+' '+(rec.uom||''):'—')+'</td><td>'+fmtDate(rec.activity_date)+'</td>'+
      '<td><span class="badge ok">Completed</span></td>';
    const tdAct = el('td'); tdAct.className='row-actions';
    if(hasFeature('workorders.edit')){
      const ed = el('button','icon-btn', icon('settings')); ed.onclick=()=>openActivityModal(rec);
      const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
      del.onclick=async()=>{ if(confirm('Delete this activity record?')){ const {error}=await sb.from('activities').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
      tdAct.appendChild(ed); tdAct.appendChild(del);
    }
    tr.appendChild(tdAct);
    t.appendChild(tr);
  });
  wrap.appendChild(t); host.appendChild(wrap);
}
function openActivityModal(edit){
  const fields = [
    ['component_name','Component'],['point_name','Lubrication Point'],
    ['activity_type','Activity Type',1,'select-type'],['activity_date','Date',1,'date'],['running_hours','Running Hours'],
    ['lubricant_name','Lubricant'],['quantity','Quantity'],['uom','UOM'],['previous_level','Previous Level'],
    ['new_level','New Level'],['condition','Condition'],['reason','Reason'],['sap_notification','SAP Notification #'],
    ['observation','Observation',0,'textarea'],['remarks','Remarks',0,'textarea'],
  ];
  const body = el('div');
  const eqWrap = el('div'); eqWrap.appendChild(el('label','field-label','SAP Equipment # *'));
  const eqSel = equipmentSelect(edit?edit.equipment_number:''); eqWrap.appendChild(eqSel); body.appendChild(eqWrap);
  const grid = el('div','grid2'); const inputs = {};
  fields.forEach(([key,label,req,type])=>{
    const w = el('div'); w.appendChild(el('label','field-label', label+(req?' *':'')));
    let inp;
    if(type==='textarea'){ inp=el('textarea'); }
    else if(type==='select-type'){ inp=el('select'); inp.appendChild(el('option','','— select —')); ACTIVITY_TYPES.forEach(t=>{const o=el('option',null,t); o.value=t; inp.appendChild(o);}); }
    else if(type==='date'){ inp=el('input'); inp.type='date'; }
    else { inp=el('input'); }
    inp.value = edit ? (edit[key]||'') : (type==='date'&&!edit ? new Date().toISOString().slice(0,10) : '');
    w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });
  body.appendChild(grid);
  openModal(edit?'Edit activity':'Record lubrication activity', body, async ()=>{
    if(!eqSel.value){ alert('Select an asset.'); return false; }
    const data={equipment_number:eqSel.value}; let missing=false;
    fields.forEach(([key,label,req])=>{ const v=inputs[key].value.trim(); if(req&&!v)missing=true; data[key]=v; });
    if(missing){ alert('Please fill required fields (*)'); return false; }
    data.updated_at=new Date().toISOString(); data.updated_by=me.id;
    try{
      if(edit){ const {error}=await sb.from('activities').update(data).eq('id',edit.id); if(error) throw error; }
      else { data.created_by=me.id; const {error}=await sb.from('activities').insert(data); if(error) throw error; }
    }catch(e){ alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit?'Save changes':'Record activity');
}

// ============================== INVENTORY (lubricants) ==============================
function renderInventory(){
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Inventory</h1><div class="page-sub">Lubricant master data. Stock quantities, min levels and consumption tracking arrive in Phase 5.</div>'));
  if(hasFeature('inventory.edit') && inventorySubtab==='lubricants'){
    const addBtn = el('button','btn', icon('plus')+' Add Lubricant');
    addBtn.onclick = ()=>openLubricantModal(null);
    head.appendChild(addBtn);
  }
  page.appendChild(head);

  const seg = el('div','segtabs');
  [['lubricants','Lubricants'],['greases','Greases'],['filters','Filters'],['other','Other Supplies']].forEach(([id,label])=>{
    const b = el('button', id===inventorySubtab?'active':'', label);
    b.onclick = ()=>{ inventorySubtab=id; render(); };
    seg.appendChild(b);
  });
  page.appendChild(seg);

  const card = el('div','card');
  if(inventorySubtab!=='lubricants'){
    card.appendChild(emptyState('inventory','Coming soon','Dedicated tracking for this category arrives alongside full inventory/stock management in Phase 5. For now, related items can be recorded in the Lubricants list.'));
    page.appendChild(card); return;
  }
  const list = cache.lubricants;
  if(!list.length){ card.appendChild(emptyState('inventory','No lubricants yet', hasFeature('inventory.edit')?'Click "Add Lubricant" to create your first one.':'Ask your administrator for access.')); page.appendChild(card); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Item Code</th><th>Product Name</th><th>Type</th><th>Manufacturer</th><th>UOM</th><th>Status</th><th></th>'));
  list.forEach(rec=>{
    const tr = el('tr');
    tr.innerHTML = '<td>'+(rec.sap_material_code||'—')+'</td><td>'+rec.brand+' '+rec.product_name+'</td><td>'+(rec.lubricant_type||'—')+'</td>'+
      '<td>'+(rec.manufacturer||'—')+'</td><td>'+(rec.uom||'—')+'</td><td>'+statusBadge(rec.status)+'</td>';
    const tdAct = el('td'); tdAct.className='row-actions';
    if(hasFeature('inventory.edit')){
      const ed = el('button','icon-btn', icon('settings')); ed.onclick=()=>openLubricantModal(rec);
      const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
      del.onclick=async()=>{ if(confirm('Delete this lubricant?')){ const {error}=await sb.from('lubricants').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
      tdAct.appendChild(ed); tdAct.appendChild(del);
    }
    tr.appendChild(tdAct);
    t.appendChild(tr);
  });
  wrap.appendChild(t); card.appendChild(wrap); page.appendChild(card);
}
function openLubricantModal(edit){
  const fields = [
    ['brand','Brand',1],['product_name','Product Name',1],['lubricant_type','Lubricant Type'],['base_oil','Base Oil'],
    ['iso_vg','ISO VG'],['nlgi_grade','NLGI Grade'],['manufacturer','Manufacturer'],['uom','UOM'],
    ['sap_material_code','SAP Material Code'],['status','Status (Active/Inactive)'],['notes','Notes',0,'textarea'],
  ];
  const body = el('div'); const grid = el('div','grid2'); const inputs = {};
  fields.forEach(([key,label,req,type])=>{
    const w = el('div'); w.appendChild(el('label','field-label', label+(req?' *':'')));
    const inp = type==='textarea' ? el('textarea') : el('input');
    inp.value = edit ? (edit[key]||'') : ''; w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });
  body.appendChild(grid);
  openModal(edit?'Edit lubricant':'Add lubricant', body, async ()=>{
    const data={}; let missing=false;
    fields.forEach(([key,label,req])=>{ const v=inputs[key].value.trim(); if(req&&!v)missing=true; data[key]=v; });
    if(missing){ alert('Please fill required fields (*)'); return false; }
    data.updated_at=new Date().toISOString(); data.updated_by=me.id;
    try{
      if(edit){ const {error}=await sb.from('lubricants').update(data).eq('id',edit.id); if(error) throw error; }
      else { data.created_by=me.id; const {error}=await sb.from('lubricants').insert(data); if(error) throw error; }
    }catch(e){ alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  });
}

// ============================== AUDIT HISTORY (real, built from every table) ==============================
function renderAudit(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Audit History</h1><div class="page-sub">Every create/update across the system, most recent first.</div>'));
  const entries = [];
  const push = (rows, moduleName, labelFn) => rows.forEach(r=>{
    entries.push({
      at: r.updated_at || r.created_at, user: r.updated_by || r.created_by,
      module: moduleName, action: (r.created_at===r.updated_at) ? 'Created' : 'Updated',
      record: labelFn(r),
    });
  });
  push(cache.equipment, 'Equipment', r=>r.sap_equipment_number+' — '+(r.description||''));
  push(cache.components, 'Lubrication Points', r=>'Component: '+r.name+' ('+r.equipment_number+')');
  push(cache.points, 'Lubrication Points', r=>'Point: '+r.point_name+' ('+r.equipment_number+')');
  push(cache.lubricants, 'Inventory', r=>r.brand+' '+r.product_name);
  push(cache.activities, 'Work Orders', r=>(r.activity_type||'Activity')+' — '+r.equipment_number);
  // Feature-access changes (grants/revokes) aren't in this feed yet — Settings
  // shows the current state; a full grant/revoke audit trail is a later addition.
  entries.sort((a,b)=>new Date(b.at)-new Date(a.at));

  const card = el('div','card');
  if(!entries.length){ card.appendChild(emptyState('audit','No history yet','Activity across the system will show up here.')); page.appendChild(card); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Date/Time</th><th>User</th><th>Module</th><th>Action</th><th>Record</th>'));
  entries.slice(0,80).forEach(e=>{
    const tr = el('tr');
    const actionBadge = e.action==='Created' ? '<span class="badge ok">Created</span>' : '<span class="badge info">Updated</span>';
    tr.innerHTML = '<td>'+fmtDateTime(e.at)+'</td><td>'+personName(e.user)+'</td><td>'+e.module+'</td><td>'+actionBadge+'</td><td>'+e.record+'</td>';
    t.appendChild(tr);
  });
  wrap.appendChild(t); card.appendChild(wrap); page.appendChild(card);
}

// ============================== SETTINGS (My Account + admin Users & Access) ==============================
let adminUserList = [];
async function renderSettings(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Settings</h1><div class="page-sub">Your account'+(me.isAdmin?', plus user &amp; access administration':'')+'</div>'));

  const info = el('div','card');
  info.appendChild(el('div','card-title','My Account'));
  info.appendChild(el('div',null,'<div style="font-size:13px;color:var(--sub)">Signed in as <b style="color:var(--ink)">'+me.name+'</b>. '+
    (me.isAdmin?'<span class="badge info">Administrator</span>':(myFeatures.size?'Enabled features: '+[...myFeatures].join(', '):'No features enabled yet — ask your administrator.'))+
    '</div><div style="font-size:12px;color:var(--sub);margin-top:8px;">Use the "Change password" button in the top bar to update your own password anytime.</div>'));
  page.appendChild(info);

  if(!me.isAdmin){
    const n = el('div','card');
    n.appendChild(el('div','notice','Only an Administrator can create users or change feature access. This is enforced by the database itself, not just this screen.'));
    page.appendChild(n);
    return;
  }

  // ---- Admin: create user ----
  const create = el('div','card');
  create.appendChild(el('div','card-title','Create a user'));
  create.appendChild(el('div',null,'<div style="font-size:12px;color:var(--sub);margin-bottom:8px;">There is no self-signup — this is the only way new accounts are created.</div>'));
  const grid = el('div','grid2');
  const nameW=el('div'); nameW.appendChild(el('label','field-label','Full name')); const nameI=el('input'); nameW.appendChild(nameI);
  const emailW=el('div'); emailW.appendChild(el('label','field-label','Email *')); const emailI=el('input'); emailI.type='email'; emailW.appendChild(emailI);
  const pwW=el('div'); pwW.appendChild(el('label','field-label','Temporary password (min 8 chars) *')); const pwI=el('input'); pwI.type='text'; pwW.appendChild(pwI);
  grid.appendChild(nameW); grid.appendChild(emailW); grid.appendChild(pwW);
  create.appendChild(grid);
  const createBtn = el('button','btn','Create user');
  createBtn.onclick = async ()=>{
    if(!emailI.value.trim() || pwI.value.length<8){ alert('Email and an 8+ character password are required.'); return; }
    createBtn.disabled = true;
    const {data, error} = await sb.functions.invoke('admin-create-user', {
      body: { email: emailI.value.trim(), password: pwI.value, full_name: nameI.value.trim() }
    });
    createBtn.disabled = false;
    if(error || (data && data.error)){ alert('Failed: '+(data?.error || error.message)); return; }
    nameI.value=''; emailI.value=''; pwI.value='';
    alert('User created. Share the temporary password with them directly — have them change it after first login.');
    await loadAdminUserList(); renderUsersTable(usersHost);
  };
  create.appendChild(document.createElement('br'));
  create.appendChild(createBtn);
  page.appendChild(create);

  // ---- Admin: users & feature access ----
  const listCard = el('div','card');
  listCard.appendChild(el('div','card-title','Users &amp; Access'));
  const usersHost = el('div');
  listCard.appendChild(usersHost);
  page.appendChild(listCard);
  await loadAdminUserList();
  renderUsersTable(usersHost);
}
async function loadAdminUserList(){
  const {data} = await sb.from('profiles').select('id, full_name, email, is_admin').order('full_name');
  adminUserList = data || [];
}
function renderUsersTable(host){
  host.innerHTML = '';
  if(!adminUserList.length){ host.appendChild(emptyState('settings','No users yet','')); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Name</th><th>Email</th><th>Status</th><th></th>'));
  adminUserList.forEach(u=>{
    const tr = el('tr');
    tr.innerHTML = '<td>'+(u.full_name||'—')+'</td><td>'+(u.email||'—')+'</td><td>'+
      (u.is_admin?'<span class="badge info">Administrator</span>':'<span class="badge gray">Standard user</span>')+'</td>';
    const tdAct = el('td');
    if(!u.is_admin){
      const btn = el('button','btn sec','Manage access');
      btn.onclick = ()=>openFeatureModal(u);
      tdAct.appendChild(btn);
    }
    tr.appendChild(tdAct);
    t.appendChild(tr);
  });
  wrap.appendChild(t); host.appendChild(wrap);
}
async function openFeatureModal(u){
  const {data:current} = await sb.from('user_features').select('feature_key, enabled').eq('user_id', u.id);
  const currentMap = {}; (current||[]).forEach(r=>currentMap[r.feature_key]=r.enabled);
  const body = el('div');
  body.appendChild(el('div',null,'<div style="font-size:12px;color:var(--sub);margin-bottom:10px;">Toggle what <b>'+(u.full_name||u.email)+'</b> can do. Changes save immediately.</div>'));
  const modules = {};
  allFeatures.forEach(f=>{ (modules[f.module]=modules[f.module]||[]).push(f); });
  Object.keys(modules).forEach(mod=>{
    body.appendChild(el('div',null,'<div style="font-size:11px;font-weight:700;color:var(--sub);text-transform:uppercase;margin:10px 0 4px;">'+mod+'</div>'));
    modules[mod].forEach(f=>{
      const row = el('label');
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;cursor:pointer;';
      const cb = el('input'); cb.type='checkbox'; cb.style.cssText='width:auto;min-height:auto;';
      cb.checked = !!currentMap[f.key];
      cb.onchange = async ()=>{
        const {error} = await sb.from('user_features').upsert({
          user_id:u.id, feature_key:f.key, enabled:cb.checked, updated_at:new Date().toISOString(), updated_by:me.id
        });
        if(error){ alert('Failed: '+error.message); cb.checked=!cb.checked; }
      };
      row.appendChild(cb);
      const txt = el('span'); txt.innerHTML = '<b>'+f.label+'</b><br><span style="color:var(--sub);font-size:11px;">'+(f.description||'')+'</span>';
      row.appendChild(txt);
      body.appendChild(row);
    });
  });
  openModal('Manage access', body, null);
}

init();
