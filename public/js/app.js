const sb = window.supabase.createClient(window.LMS_CONFIG.SUPABASE_URL, window.LMS_CONFIG.SUPABASE_ANON_KEY);

const ROLES = ['Technician','Supervisor','Engineer','Storekeeper','Procurement User','Manager','Administrator'];
const EDIT_ROLES = ['Engineer','Administrator'];
const ACTIVITY_TYPES = ['Top-up','Oil replacement','Drain and refill','Greasing','Lubricant replenishment',
  'Filter replacement','Sampling','Inspection','Flushing','Corrective lubrication','Emergency lubrication','Other'];

const PAGES = [
  {id:'dashboard', label:'Dashboard', icon:'dashboard'},
  {id:'assets', label:'Assets', icon:'assets'},
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
let me = {id:null, name:''};
let myRole = null;
let cache = {equipment:[], components:[], points:[], lubricants:[], activities:[], roles:[], profiles:{}};
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
  document.getElementById('btnSignUp').onclick = async ()=>{
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const full_name = document.getElementById('authName').value.trim();
    const {error} = await sb.auth.signUp({email, password, options:{data:{full_name}}});
    if(error) showAuthError(error.message);
    else showAuthError('Check your email to confirm your account, then sign in.', true);
  };
  document.getElementById('btnSignOut').onclick = async ()=>{ await sb.auth.signOut(); };
  document.getElementById('hamburger').onclick = ()=>document.body.classList.toggle('drawer-open');
  document.getElementById('backdrop').onclick = ()=>document.body.classList.remove('drawer-open');
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
  const {data:prof} = await sb.from('profiles').select('full_name').eq('id', me.id).maybeSingle();
  me.name = (prof && prof.full_name) ? prof.full_name : session.user.email;
  document.getElementById('tbName').textContent = me.name;
  document.getElementById('tbAvatar').textContent = (me.name||'?').trim().slice(0,1).toUpperCase();
  buildSidebar();
  await loadAll();
  document.getElementById('tbRole').textContent = myRole || 'No role assigned';
  render();
}

// ============================== DATA ==============================
async function loadAll(){
  const [eq, comp, pts, lub, act, roles] = await Promise.all([
    sb.from('equipment').select('*').order('created_at',{ascending:false}),
    sb.from('components').select('*').order('created_at',{ascending:false}),
    sb.from('lubrication_points').select('*').order('created_at',{ascending:false}),
    sb.from('lubricants').select('*').order('created_at',{ascending:false}),
    sb.from('activities').select('*').order('activity_date',{ascending:false}),
    sb.from('user_roles').select('*'),
  ]);
  cache.equipment = eq.data || [];
  cache.components = comp.data || [];
  cache.points = pts.data || [];
  cache.lubricants = lub.data || [];
  cache.activities = act.data || [];
  cache.roles = roles.data || [];
  const mine = cache.roles.find(r=>r.user_id===me.id);
  myRole = mine ? mine.role : null;

  const ids = new Set();
  cache.roles.forEach(r=>ids.add(r.user_id));
  [...cache.equipment, ...cache.components, ...cache.points, ...cache.lubricants, ...cache.activities].forEach(r=>{
    if(r.created_by) ids.add(r.created_by); if(r.updated_by) ids.add(r.updated_by);
  });
  if(ids.size){
    const {data:profs} = await sb.from('profiles').select('id, full_name').in('id', [...ids]);
    (profs||[]).forEach(p=>{ cache.profiles[p.id]=p.full_name; });
  }
}
function personName(id){ return cache.profiles[id] || (id ? 'Unknown user' : '—'); }
function canEditMasters(){ return myRole && EDIT_ROLES.includes(myRole); }
function canManageUsers(){ return myRole === 'Administrator'; }

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
    dashboard: renderDashboard, assets: ()=>renderMasterPage('assets'), points: renderPointsPage,
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
  head.appendChild(el('div',null,'<h1>Welcome back, '+ (me.name||'').split(' ')[0] +'!</h1><div class="page-sub">Riverside Plant — Lubrication Management &amp; Reliability</div>'));
  page.appendChild(head);

  const kpis = el('div','kpi-grid');
  const totalPoints = cache.points.length;
  const activePoints = cache.points.filter(p=>(p.status||'Active').toLowerCase()!=='inactive').length;
  const totalAssets = cache.equipment.length;
  const recentActs = cache.activities.filter(a=>{
    const d = new Date(a.activity_date); const now = new Date();
    return (now - d) / 86400000 <= 30;
  }).length;

  kpis.appendChild(kpiCard('assets','Total Lubrication Points', totalPoints, activePoints+' active', 'var(--accent)','var(--accent-tint)'));
  kpis.appendChild(kpiCard('workorders','Activities (Last 30 Days)', recentActs, 'recorded by your team', 'var(--ok)','var(--ok-tint)'));
  kpis.appendChild(kpiCard('assets','Total Assets', totalAssets, 'in the equipment master', 'var(--info)','var(--info-tint)'));
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
  roleCard.appendChild(el('div',null,'<div style="font-size:13px;color:var(--sub)">Functional role: <b style="color:var(--ink)">'+(myRole||'none assigned')+'</b></div>'));
  right.appendChild(roleCard);

  const rolesSummary = el('div','card');
  rolesSummary.appendChild(el('div','card-title','Team'));
  if(!cache.roles.length){
    rolesSummary.appendChild(emptyState('settings','No roles assigned','Assign roles under Settings.'));
  } else {
    rolesSummary.innerHTML += cache.roles.slice(0,6).map(r=>
      '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px;border-bottom:1px solid var(--line)"><span>'+personName(r.user_id)+'</span><span class="badge info">'+r.role+'</span></div>'
    ).join('');
  }
  right.appendChild(rolesSummary);
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

// ============================== ASSETS (equipment) ==============================
const MASTER_CONFIG = {
  assets: {
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
  head.appendChild(el('div',null,'<h1>Assets</h1><div class="page-sub">Plant equipment, keyed by SAP Equipment Number</div>'));
  if(canEditMasters()){
    const addBtn = el('button','btn', icon('plus')+' Add Asset');
    addBtn.onclick = ()=>openMasterModal(kind, null);
    head.appendChild(addBtn);
  }
  page.appendChild(head);

  const list = cache.equipment;
  const card = el('div','card');
  if(!list.length){ card.appendChild(emptyState('assets','No assets yet', canEditMasters()?'Click "Add Asset" to create your first one.':'Ask an Engineer or Administrator to add assets.')); page.appendChild(card); return; }

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
    if(canEditMasters()){
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
  if(canEditMasters()){
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
    if(!list.length){ card.appendChild(emptyState('points','No lubrication points yet', canEditMasters()?'Click "Add Lubrication Point" to create your first one.':'Ask an Engineer or Administrator to add points.')); }
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
        if(canEditMasters()){
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
    if(!list.length){ card.appendChild(emptyState('points','No components yet', canEditMasters()?'Click "Add Component" to create your first one.':'Ask an Engineer or Administrator to add components.')); }
    else {
      const wrap = el('div','tablewrap');
      const t = el('table');
      t.appendChild(el('tr',null,'<th>Component</th><th>Asset</th><th>Type</th><th>Criticality</th><th>Status</th><th></th>'));
      list.forEach(rec=>{
        const tr = el('tr');
        tr.innerHTML = '<td>'+rec.name+'</td><td>'+(rec.equipment_number||'—')+'</td><td>'+(rec.type||'—')+'</td><td>'+(rec.criticality||'—')+'</td><td>'+statusBadge(rec.status)+'</td>';
        const tdAct = el('td'); tdAct.className='row-actions';
        if(canEditMasters()){
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
    if(canEditMasters()){
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
  if(canEditMasters() && inventorySubtab==='lubricants'){
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
  if(!list.length){ card.appendChild(emptyState('inventory','No lubricants yet', canEditMasters()?'Click "Add Lubricant" to create your first one.':'Ask an Engineer or Administrator to add lubricants.')); page.appendChild(card); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Item Code</th><th>Product Name</th><th>Type</th><th>Manufacturer</th><th>UOM</th><th>Status</th><th></th>'));
  list.forEach(rec=>{
    const tr = el('tr');
    tr.innerHTML = '<td>'+(rec.sap_material_code||'—')+'</td><td>'+rec.brand+' '+rec.product_name+'</td><td>'+(rec.lubricant_type||'—')+'</td>'+
      '<td>'+(rec.manufacturer||'—')+'</td><td>'+(rec.uom||'—')+'</td><td>'+statusBadge(rec.status)+'</td>';
    const tdAct = el('td'); tdAct.className='row-actions';
    if(canEditMasters()){
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
  push(cache.equipment, 'Assets', r=>r.sap_equipment_number+' — '+(r.description||''));
  push(cache.components, 'Lubrication Points', r=>'Component: '+r.name+' ('+r.equipment_number+')');
  push(cache.points, 'Lubrication Points', r=>'Point: '+r.point_name+' ('+r.equipment_number+')');
  push(cache.lubricants, 'Inventory', r=>r.brand+' '+r.product_name);
  push(cache.activities, 'Work Orders', r=>(r.activity_type||'Activity')+' — '+r.equipment_number);
  push(cache.roles, 'Settings', r=>personName(r.user_id)+' \u2192 '+r.role);
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

// ============================== SETTINGS (users & roles) ==============================
function renderSettings(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Settings</h1><div class="page-sub">Users, functional roles and access</div>'));

  const info = el('div','card');
  info.appendChild(el('div','card-title','Your access'));
  info.appendChild(el('div',null,'<div style="font-size:13px;color:var(--sub)">Functional role: <b style="color:var(--ink)">'+(myRole||'none assigned — ask an Administrator')+'</b></div>'));
  page.appendChild(info);

  if(!canManageUsers()){
    const n = el('div','card');
    n.appendChild(el('div','notice','Only Administrators can assign roles. This is enforced by the database itself (Postgres row-level security), not just this screen.'));
    page.appendChild(n);
  } else {
    const assign = el('div','card');
    assign.appendChild(el('div','card-title','Assign a role'));
    assign.appendChild(el('div',null,'<div style="font-size:12px;color:var(--sub);margin-bottom:8px;">Find the person\'s User UID in Supabase → Authentication → Users, then paste it below.</div>'));
    const row = el('div','filter-bar');
    const uidInput = el('input'); uidInput.placeholder='User UID';
    const roleSel = el('select'); ROLES.forEach(r=>{ const o=el('option',null,r); o.value=r; roleSel.appendChild(o); });
    row.appendChild(uidInput); row.appendChild(roleSel);
    const btn = el('button','btn','Assign role');
    btn.onclick = async ()=>{
      const uid = uidInput.value.trim();
      if(!uid){ alert('Enter a User UID.'); return; }
      const {error} = await sb.from('user_roles').upsert({user_id:uid, role:roleSel.value, updated_at:new Date().toISOString(), updated_by:me.id});
      if(error){ alert('Failed: '+error.message); return; }
      uidInput.value=''; await loadAll(); render();
    };
    row.appendChild(btn); assign.appendChild(row);
    page.appendChild(assign);
  }

  const list = el('div','card');
  list.appendChild(el('div','card-title','Assigned roles ('+cache.roles.length+')'));
  if(!cache.roles.length){ list.appendChild(emptyState('settings','No roles assigned yet','')); }
  else {
    const wrap = el('div','tablewrap');
    const t = el('table');
    t.appendChild(el('tr',null,'<th>Person</th><th>Role</th><th></th>'));
    cache.roles.forEach(r=>{
      const tr = el('tr');
      tr.innerHTML = '<td>'+personName(r.user_id)+'</td><td><span class="badge info">'+r.role+'</span></td>';
      const tdAct = el('td');
      if(canManageUsers()){
        const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
        del.onclick=async()=>{ if(confirm('Remove this role assignment?')){ const {error}=await sb.from('user_roles').delete().eq('user_id',r.user_id); if(error) alert(error.message); else { await loadAll(); render(); } } };
        tdAct.appendChild(del);
      }
      tr.appendChild(tdAct); t.appendChild(tr);
    });
    wrap.appendChild(t); list.appendChild(wrap);
  }
  page.appendChild(list);
}

init();
