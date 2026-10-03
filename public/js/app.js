const sb = window.supabase.createClient(window.LMS_CONFIG.SUPABASE_URL, window.LMS_CONFIG.SUPABASE_ANON_KEY);

const ACTIVITY_TYPES = ['Top-up','Oil replacement','Drain and refill','Greasing','Lubricant replenishment',
  'Filter replacement','Sampling','Inspection','Flushing','Corrective lubrication','Emergency lubrication','Other'];
const CRITICALITY_OPTIONS = ['High','Medium','Low'];
const STATUS_OPTIONS = ['Active','Inactive'];
const LUBRICATION_TYPES = ['Oil', 'Grease', 'Automatic Lubricator', 'Circulating Oil System', 'Other'];
let dlCounter = 0;

// Plain dropdown of fixed string options.
function selectField(options, value){
  const s = el('select');
  const blank = el('option',null,'— select —'); blank.value=''; s.appendChild(blank);
  options.forEach(o=>{ const opt=el('option',null,o); opt.value=o; s.appendChild(opt); });
  s.value = value || '';
  return s;
}

// Free-text input with browser-native suggestions from existing values —
// the user can pick a suggestion or type something new.
function datalistField(existingValues, value, placeholder){
  dlCounter++;
  const listId = 'dl-'+dlCounter;
  const wrap = el('div');
  const input = el('input'); input.type='text'; input.setAttribute('list', listId);
  input.value = value || ''; if(placeholder) input.placeholder = placeholder;
  const dl = el('datalist'); dl.id = listId;
  [...new Set(existingValues.filter(Boolean))].forEach(v=>{ const o=el('option'); o.value=v; dl.appendChild(o); });
  wrap.appendChild(input); wrap.appendChild(dl);
  return {wrapper: wrap, input};
}

// Constrained search-select: user types, sees matching suggestions, and
// can ONLY choose one of the given options — free text that doesn't match
// is rejected at save time via getValue() returning ''.
function typeaheadField(initialOptions, initialValue, placeholder){
  let opts = initialOptions; // [{value,label}]
  let selected = '';
  const wrap = el('div'); wrap.style.position = 'relative';
  const input = el('input'); input.type='text'; input.autocomplete='off';
  if(placeholder) input.placeholder = placeholder;
  const list = el('div');
  list.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--line);border-radius:8px;max-height:180px;overflow-y:auto;z-index:60;box-shadow:var(--shadow);display:none;margin-top:2px;';
  wrap.appendChild(input); wrap.appendChild(list);

  if(initialValue){
    const match = opts.find(o=>o.value===initialValue);
    if(match){ input.value = match.label; selected = match.value; }
  }

  function renderList(){
    const q = input.value.trim().toLowerCase();
    const matches = (q ? opts.filter(o=>o.label.toLowerCase().includes(q)) : opts).slice(0,30);
    list.innerHTML = '';
    matches.forEach(o=>{
      const item = el('div', null, o.label);
      item.style.cssText = 'padding:8px 10px;cursor:pointer;font-size:13px;';
      item.onmouseenter = ()=>item.style.background='var(--bg)';
      item.onmouseleave = ()=>item.style.background='';
      item.onmousedown = (e)=>{
        e.preventDefault();
        input.value = o.label; selected = o.value;
        list.style.display='none';
        input.dispatchEvent(new CustomEvent('typeahead-select', {detail:o}));
      };
      list.appendChild(item);
    });
    list.style.display = matches.length ? 'block' : 'none';
  }
  input.oninput = ()=>{ selected=''; renderList(); };
  input.onfocus = renderList;
  input.onblur = ()=>{ setTimeout(()=>{ list.style.display='none'; }, 150); };

  return {
    wrapper: wrap, input,
    getValue: ()=> selected,
    setOptions: (newOpts)=>{ opts = newOpts; selected=''; input.value=''; },
    onSelect: (fn)=> input.addEventListener('typeahead-select', e=>fn(e.detail)),
  };
}
function equipmentOptions(){
  return cache.equipment.map(e=>({value:e.sap_equipment_number, label:e.sap_equipment_number+' — '+(e.description||'')}));
}
function componentOptionsFor(equipmentNumber){
  return cache.components.filter(c=>c.equipment_number===equipmentNumber).map(c=>({value:c.name, label:c.name}));
}

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
let me = {id:null, name:'', isAdmin:false};
let myFeatures = new Set();
let allFeatures = [];
let cache = {equipment:[], components:[], points:[], lubricants:[], activities:[], lubricantsMaster:[], compTypeSuggestions:[], ptNameSuggestions:[], resources:[], equipmentResourceMappings:[], profiles:{}};
let editing = {};
let workOrderFilter = '';
let inventorySubtab = 'lubricants';
let pointsSubtab = 'points';

// ============================== AUTH ==============================
async 
// ============================== RUNNING HOURS TRACKER ==============================
function renderRunningHours(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Running Hours</h1><div class="page-sub">Track and update resource running hours; cascades to linked equipment</div>'));
  
  const card = el('div','card');
  card.appendChild(el('div','card-title','Update Resource Running Hours'));
  
  const grid = el('div','grid2');
  const resW = el('div'); resW.appendChild(el('label','field-label','Resource *'));
  const resSel = el('select');
  resSel.innerHTML = '<option value="">— select resource —</option>';
  cache.resources.forEach(r => {
    const opt = el('option'); opt.value = r.id; opt.textContent = r.resource_name + ' (' + (r.running_hours||0) + ' hrs)'; resSel.appendChild(opt);
  });
  resW.appendChild(resSel); grid.appendChild(resW);
  
  const hrsW = el('div'); hrsW.appendChild(el('label','field-label','Running Hours *'));
  const hrsInp = el('input'); hrsInp.type = 'number'; hrsInp.step = '0.01'; hrsW.appendChild(hrsInp); grid.appendChild(hrsW);
  
  card.appendChild(grid);
  const btn = el('button','btn','Update Running Hours');
  btn.onclick = async () => {
    if(!resSel.value || !hrsInp.value) { alert('Select a resource and enter running hours.'); return; }
    btn.disabled = true;
    const {error} = await sb.rpc('update_resource_running_hours', {res_id: resSel.value, new_hours: parseFloat(hrsInp.value)});
    btn.disabled = false;
    if(error) { alert('Failed: ' + error.message); return; }
    hrsInp.value = '';
    await loadAll(); render();
  };
  card.appendChild(document.createElement('br'));
  card.appendChild(btn);
  page.appendChild(card);
  
  // List resources and linked equipment
  const listCard = el('div','card');
  listCard.appendChild(el('div','card-title','Resource Status'));
  if(!cache.resources.length){ listCard.appendChild(emptyState('running-hours','No resources',''));  }
  else {
    const wrap = el('div','tablewrap');
    const t = el('table');
    t.appendChild(el('tr',null,'<th>Resource</th><th>Running Hours</th><th>Last Updated</th><th>Linked Equipment</th>'));
    cache.resources.forEach(r => {
      const linkedEq = cache.equipmentResourceMappings.filter(m => m.resource_id === r.id).map(m => {
        const eq = cache.equipment.find(e => e.id === m.equipment_id);
        return eq ? eq.description : '?';
      }).join(', ');
      const tr = el('tr');
      tr.innerHTML = '<td><b>' + r.resource_name + '</b></td><td>' + (r.running_hours || 0) + ' hrs</td>' +
        '<td>' + (r.last_running_hours_update ? new Date(r.last_running_hours_update).toLocaleDateString() : '—') + '</td>' +
        '<td>' + (linkedEq || '(none)') + '</td>';
      t.appendChild(tr);
    });
    wrap.appendChild(t); listCard.appendChild(wrap);
  }
  page.appendChild(listCard);
}


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
  const [eq, comp, pts, lub, act, lubMaster, compTypeSugg, ptSugg, res, eqResMaps, feats, myFeats] = await Promise.all([
    sb.from('equipment').select('*').order('created_at',{ascending:false}),
    sb.from('components').select('*').order('created_at',{ascending:false}),
    sb.from('lubrication_points').select('*').order('created_at',{ascending:false}),
    sb.from('lubricants').select('*').order('created_at',{ascending:false}),
    sb.from('activities').select('*').order('activity_date',{ascending:false}),
    sb.from('lubricants_master').select('*').order('name'),
    sb.from('component_type_suggestions').select('*').order('use_count', {ascending:false}),
    sb.from('lubrication_point_name_suggestions').select('*').order('use_count', {ascending:false}),
    sb.from('resources').select('*').order('resource_name'),
    sb.from('equipment_resource_mapping').select('*'),
    sb.from('features').select('*').order('module'),
    sb.from('user_features').select('feature_key').eq('user_id', me.id).eq('enabled', true),
  ]);
  cache.equipment = eq.data || [];
  cache.components = comp.data || [];
  cache.points = pts.data || [];
  cache.lubricants = lub.data || [];
  cache.activities = act.data || [];
  cache.lubricantsMaster = lubMaster.data || [];
  cache.compTypeSuggestions = compTypeSugg.data || [];
  cache.ptNameSuggestions = ptSugg.data || [];
  cache.resources = res.data || [];
  cache.equipmentResourceMappings = eqResMaps.data || [];
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

// ============================== TYPEAHEAD / AUTOCOMPLETE ==============================
function createTypeahead(inputEl, dataArray, keyFn, labelFn, onSelect) {
  // inputEl = the input element
  // dataArray = array of objects to search
  // keyFn = function(item) returns unique key
  // labelFn = function(item) returns display string
  // onSelect = callback(selectedItem) when item chosen
  const dropdown = el('div');
  dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;border:1px solid var(--line);background:white;z-index:100;display:none;';
  inputEl.parentNode.style.position = 'relative';
  inputEl.parentNode.appendChild(dropdown);

  inputEl.oninput = ()=>{
    const query = (inputEl.value || '').toLowerCase();
    const matches = query ? dataArray.filter(item => labelFn(item).toLowerCase().includes(query)).slice(0, 8) : [];
    dropdown.innerHTML = '';
    if(!query || !matches.length){ dropdown.style.display='none'; return; }
    matches.forEach(item => {
      const opt = el('div');
      opt.textContent = labelFn(item);
      opt.style.cssText = 'padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--line);';
      opt.onmouseover = ()=> opt.style.background = 'var(--line)';
      opt.onmouseout = ()=> opt.style.background = '';
      opt.onclick = ()=>{
        inputEl.value = labelFn(item);
        inputEl._selectedItem = item;
        dropdown.style.display = 'none';
        if(onSelect) onSelect(item);
      };
      dropdown.appendChild(opt);
    });
    dropdown.style.display = matches.length ? '' : 'none';
  };
  inputEl.onfocus = ()=>inputEl.oninput();
  document.addEventListener('click', (e)=>{
    if(!inputEl.parentNode.contains(e.target)) dropdown.style.display='none';
  });
}

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

// ============================== ASSETS (equipment) ==============================
let _dlCounter = 0;
function selectField(options, value, placeholder){
  const sel = document.createElement('select');
  if(placeholder){ const o=document.createElement('option'); o.value=''; o.textContent=placeholder; sel.appendChild(o); }
  options.forEach(opt=>{ const o=document.createElement('option'); o.value=opt; o.textContent=opt; sel.appendChild(o); });
  sel.value = value || '';
  return sel;
}
function textWithSuggestions(options, value){
  const inp = document.createElement('input');
  const listId = 'dl-'+(_dlCounter++);
  inp.setAttribute('list', listId);
  inp.value = value || '';
  const dl = document.createElement('datalist'); dl.id = listId;
  [...new Set(options.filter(Boolean))].sort().forEach(o=>{ const opt=document.createElement('option'); opt.value=o; dl.appendChild(opt); });
  const frag = document.createDocumentFragment(); frag.appendChild(inp); frag.appendChild(dl);
  return {input: inp, node: frag};
}
function equipmentTypeahead(value){
  const listId = 'dl-eq-'+(_dlCounter++);
  const inp = document.createElement('input');
  inp.placeholder = 'Type to search equipment…'; inp.setAttribute('list', listId); inp.value = value || '';
  const dl = document.createElement('datalist'); dl.id = listId;
  cache.equipment.forEach(e=>{ const opt=document.createElement('option'); opt.value=e.sap_equipment_number; opt.textContent=e.sap_equipment_number+' — '+(e.description||''); dl.appendChild(opt); });
  const frag = document.createDocumentFragment(); frag.appendChild(inp); frag.appendChild(dl);
  return {input: inp, node: frag};
}
function validEquipmentNumber(v){ return cache.equipment.some(e=>e.sap_equipment_number===v); }

function renderAssetsPage(){
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Assets</h1><div class="page-sub">Plant equipment, keyed by SAP Equipment Number</div>'));
  if(hasFeature('assets.edit')){
    const addBtn = el('button','btn', icon('plus')+' Add Asset');
    addBtn.onclick = ()=>openEquipmentModal(null);
    head.appendChild(addBtn);
  }
  page.appendChild(head);

  const list = cache.equipment;
  const card = el('div','card');
  if(!list.length){ card.appendChild(emptyState('assets','No assets yet', hasFeature('assets.edit')?'Click "Add Asset" to create your first one.':'Ask your administrator for access.')); page.appendChild(card); return; }

  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>SAP #</th><th>Description</th><th>Area</th><th>Type</th><th>Status</th><th>Criticality</th><th>Lubrication Points</th><th>Resources</th><th></th>'));
  list.forEach(rec=>{
    const lpCount = cache.points.filter(p=>p.equipment_number===rec.sap_equipment_number).length;
    const resCount = cache.equipmentResourceMappings.filter(m => m.equipment_id === rec.id).length;
    const tr = el('tr');
    tr.innerHTML = '<td><b>'+rec.sap_equipment_number+'</b></td><td>'+rec.description+'</td><td>'+(rec.area||'—')+'</td>'+
      '<td>'+(rec.equipment_type||'—')+'</td><td>'+statusBadge(rec.status)+'</td>'+
      '<td><span class="badge '+(rec.lubrication_criticality==='High'?'bad':rec.lubrication_criticality==='Medium'?'warn':'ok')+'">'+rec.lubrication_criticality+'</span></td>'+
      '<td>'+lpCount+'</td><td>'+resCount+'</td>';
    const tdAct = el('td'); tdAct.className='row-actions';
    const hist = el('button','icon-btn', icon('history')); hist.title='History';
    hist.onclick=()=>{ workOrderFilter = rec.sap_equipment_number; active='workorders'; render(); };
    tdAct.appendChild(hist);
    if(hasFeature('assets.edit')){
      const ed = el('button','icon-btn', icon('settings')); ed.title='Edit';
      ed.onclick=()=>openEquipmentModal(rec);
      const del = el('button','icon-btn', icon('close')); del.title='Delete'; del.style.color='var(--bad)';
      del.onclick=async()=>{ if(confirm('Delete this asset and all related data?')){ const {error}=await sb.from('equipment').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
      tdAct.appendChild(ed); tdAct.appendChild(del);
    }
    tr.appendChild(tdAct);
    t.appendChild(tr);
  });
  wrap.appendChild(t); card.appendChild(wrap); page.appendChild(card);
}
function openEquipmentModal(edit){
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  
  // SAP Equipment #
  const sapW = el('div'); sapW.appendChild(el('label','field-label','SAP Equipment # *'));
  const sapInp = el('input'); sapInp.value = edit ? (edit.sap_equipment_number || '') : ''; inputs.sap_equipment_number = sapInp;
  sapW.appendChild(sapInp); grid.appendChild(sapW);
  
  // Description
  const descW = el('div'); descW.appendChild(el('label','field-label','Description *'));
  const descInp = el('input'); descInp.value = edit ? (edit.description || '') : ''; inputs.description = descInp;
  descW.appendChild(descInp); grid.appendChild(descW);
  
  // Functional Location
  const locW = el('div'); locW.appendChild(el('label','field-label','Functional Location'));
  const locInp = el('input'); locInp.value = edit ? (edit.functional_location || '') : ''; inputs.functional_location = locInp;
  locW.appendChild(locInp); grid.appendChild(locW);
  
  // Plant
  const plantW = el('div'); plantW.appendChild(el('label','field-label','Plant'));
  const plantInp = el('input'); plantInp.value = edit ? (edit.plant || '') : ''; inputs.plant = plantInp;
  plantW.appendChild(plantInp); grid.appendChild(plantW);
  
  // Area
  const areaW = el('div'); areaW.appendChild(el('label','field-label','Area'));
  const areaInp = el('input'); areaInp.value = edit ? (edit.area || '') : ''; inputs.area = areaInp;
  areaW.appendChild(areaInp); grid.appendChild(areaW);
  
  // Equipment Type
  const typeW = el('div'); typeW.appendChild(el('label','field-label','Equipment Type'));
  const typeInp = el('input'); typeInp.value = edit ? (edit.equipment_type || '') : ''; inputs.equipment_type = typeInp;
  typeW.appendChild(typeInp); grid.appendChild(typeW);
  
  // Status
  const statusW = el('div'); statusW.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(['Active','Inactive'], edit ? (edit.status || 'Active') : 'Active');
  statusW.appendChild(statusSel); inputs.status = statusSel; grid.appendChild(statusW);
  
  // Lubrication Criticality
  const critW = el('div'); critW.appendChild(el('label','field-label','Lubrication Criticality'));
  const critSel = selectField(['High','Medium','Low'], edit ? (edit.lubrication_criticality || 'Medium') : 'Medium');
  critW.appendChild(critSel); inputs.lubrication_criticality = critSel; grid.appendChild(critW);
  
  // Lubrication Notes
  const notesW = el('div'); notesW.appendChild(el('label','field-label','Lubrication Notes'));
  const notesInp = document.createElement('textarea'); notesInp.value = edit ? (edit.lubrication_notes || '') : ''; inputs.lubrication_notes = notesInp;
  notesW.appendChild(notesInp); grid.appendChild(notesW);
  
  // Resources (checkboxes)
  const resW = el('div'); resW.appendChild(el('label','field-label','Attached Resources'));
  const resBox = el('div'); resBox.style.maxHeight = '150px'; resBox.style.overflowY = 'auto'; resBox.style.border = '1px solid var(--line)'; resBox.style.padding = '8px';
  const attachedRes = new Set();
  if(edit){
    cache.equipmentResourceMappings.filter(m => m.equipment_id === edit.id).forEach(m => attachedRes.add(m.resource_id));
  }
  cache.resources.forEach(r => {
    const label = el('label'); label.style.display = 'flex'; label.style.gap = '8px'; label.style.alignItems = 'center';
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = attachedRes.has(r.id); cb._resourceId = r.id;
    label.appendChild(cb);
    label.appendChild(el('span',null,r.resource_name + ' (' + r.description + ')'));
    resBox.appendChild(label);
  });
  inputs._resourceCheckboxes = resBox.querySelectorAll('input[type="checkbox"]');
  resW.appendChild(resBox); grid.appendChild(resW);
  
  body.appendChild(grid);
  openModal(edit ? 'Edit equipment' : 'Add new equipment', body, async () => {
    const data = {};
    ['sap_equipment_number','description','functional_location','plant','area','equipment_type','status','lubrication_criticality','lubrication_notes'].forEach(key => {
      data[key] = inputs[key].value.trim();
    });
    if(!data.sap_equipment_number || !data.description) { alert('SAP Equipment # and Description are required.'); return false; }
    data.updated_at = new Date().toISOString(); data.updated_by = me.id;
    try {
      let eqId = edit ? edit.id : null;
      if(edit) { 
        const {error} = await sb.from('equipment').update(data).eq('id', edit.id); 
        if(error) throw error; 
      } else { 
        data.created_by = me.id; 
        const {data: newEq, error} = await sb.from('equipment').insert(data).select().single(); 
        if(error) throw error; 
        eqId = newEq.id;
      }
      
      // Update resource mappings
      if(edit) {
        await sb.from('equipment_resource_mapping').delete().eq('equipment_id', eqId);
      }
      const selectedRes = Array.from(inputs._resourceCheckboxes).filter(cb => cb.checked).map(cb => ({equipment_id: eqId, resource_id: cb._resourceId}));
      if(selectedRes.length) {
        const {error} = await sb.from('equipment_resource_mapping').insert(selectedRes);
        if(error) throw error;
      }
    } catch(e) { alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit ? 'Save changes' : 'Add equipment');
}

function openComponentModal(edit){
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  
  // SAP Equipment # (typeahead)
  const sapW = el('div'); sapW.appendChild(el('label','field-label','SAP Equipment # *'));
  const sapInp = el('input'); sapInp.placeholder = 'Type to search...'; 
  sapInp.value = edit ? (edit.equipment_number || '') : '';
  inputs.equipment_number = sapInp;
  sapW.appendChild(sapInp);
  createTypeahead(sapInp, cache.equipment, e=>e.id, e=>(e.sap_equipment_number||'')+(e.description?' - '+e.description:''), (item)=>{
    sapInp.value = item.sap_equipment_number || '';
    sapInp._selectedItem = item;
  });
  grid.appendChild(sapW);
  
  // Component Name (typeahead)
  const nameW = el('div'); nameW.appendChild(el('label','field-label','Component Name *'));
  const nameInp = el('input'); nameInp.value = edit ? (edit.name || '') : ''; inputs.name = nameInp;
  nameW.appendChild(nameInp);
  createTypeahead(nameInp, cache.components, c=>c.id, c=>c.name);
  grid.appendChild(nameW);
  
  // Component Type (typeahead)
  const typeW = el('div'); typeW.appendChild(el('label','field-label','Component Type'));
  const typeInp = el('input'); typeInp.value = edit ? (edit.type || '') : ''; inputs.type = typeInp;
  typeW.appendChild(typeInp);
  createTypeahead(typeInp, cache.compTypeSuggestions, s=>s.type_name, s=>s.type_name);
  grid.appendChild(typeW);
  
  // Description
  const descW = el('div'); descW.appendChild(el('label','field-label','Description'));
  const descInp = el('input'); descInp.value = edit ? (edit.description || '') : ''; inputs.description = descInp;
  descW.appendChild(descInp); grid.appendChild(descW);
  
  // Criticality
  const critW = el('div'); critW.appendChild(el('label','field-label','Criticality'));
  const critSel = selectField(['High','Medium','Low'], edit ? (edit.criticality || 'Medium') : 'Medium');
  critW.appendChild(critSel); inputs.criticality = critSel; grid.appendChild(critW);
  
  // Status
  const statusW = el('div'); statusW.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(['Active','Inactive'], edit ? (edit.status || 'Active') : 'Active');
  statusW.appendChild(statusSel); inputs.status = statusSel; grid.appendChild(statusW);
  
  // Remarks
  const remW = el('div'); remW.appendChild(el('label','field-label','Remarks'));
  const remInp = document.createElement('textarea'); remInp.value = edit ? (edit.remarks || '') : ''; inputs.remarks = remInp;
  remW.appendChild(remInp); grid.appendChild(remW);
  
  body.appendChild(grid);
  openModal(edit ? 'Edit component' : 'Add new component', body, async () => {
    const data = {};
    ['equipment_number','name','type','description','criticality','status','remarks'].forEach(key => {
      data[key] = inputs[key].value.trim();
    });
    if(!data.equipment_number || !data.name) { alert('Equipment # and Component Name are required.'); return false; }
    if(data.type) await sb.rpc('track_component_type_suggestion', {type_name: data.type}).catch(()=>{});
    data.updated_at = new Date().toISOString(); data.updated_by = me.id;
    try {
      if(edit) { const {error} = await sb.from('components').update(data).eq('id', edit.id); if(error) throw error; }
      else { data.created_by = me.id; const {error} = await sb.from('components').insert(data); if(error) throw error; }
    } catch(e) { alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit ? 'Save changes' : 'Add component');
}

function openLubricantMasterModal(callback){
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  
  const nameW = el('div'); nameW.appendChild(el('label','field-label','Lubricant Name *'));
  const nameInp = el('input'); inputs.name = nameInp; nameW.appendChild(nameInp); grid.appendChild(nameW);
  
  const typeW = el('div'); typeW.appendChild(el('label','field-label','Type *'));
  const typeSel = selectField(LUBRICATION_TYPES, ''); inputs.lubricant_type = typeSel;
  typeW.appendChild(typeSel); grid.appendChild(typeW);
  
  const uomW = el('div'); uomW.appendChild(el('label','field-label','Unit of Measure'));
  const uomInp = el('input'); uomInp.value = 'L'; inputs.uom = uomInp; uomW.appendChild(uomInp); grid.appendChild(uomW);
  
  const descW = el('div'); descW.appendChild(el('label','field-label','Description'));
  const descInp = document.createElement('textarea'); inputs.description = descInp;
  descW.appendChild(descInp); grid.appendChild(descW);
  
  body.appendChild(grid);
  openModal('Add lubricant', body, async () => {
    if(!inputs.name.value.trim() || !inputs.lubricant_type.value) { alert('Name and Type are required.'); return false; }
    try {
      const {data, error} = await sb.from('lubricants_master').insert({
        name: inputs.name.value.trim(),
        lubricant_type: inputs.lubricant_type.value,
        uom: inputs.uom.value || 'L',
        description: inputs.description.value,
        created_by: me.id
      }).select().single();
      if(error) throw error;
      await loadAll();
      if(callback) callback(data);
    } catch(e) { alert('Failed: '+e.message); return false; }
  }, 'Add lubricant');
}

function openPointModal(edit){
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  
  // SAP Equipment # (typeahead)
  const sapW = el('div'); sapW.appendChild(el('label','field-label','SAP Equipment # *'));
  const sapInp = el('input'); sapInp.placeholder = 'Type to search...';
  sapInp.value = edit ? (edit.equipment_number || '') : '';
  inputs.equipment_number = sapInp;
  sapW.appendChild(sapInp);
  createTypeahead(sapInp, cache.equipment, e=>e.id, e=>(e.sap_equipment_number||'')+(e.description?' - '+e.description:''), (item) => {
    sapInp.value = item.sap_equipment_number || '';
    sapInp._selectedItem = item;
  });
  grid.appendChild(sapW);
  
  // Component Name (dropdown of actual components)
  const compW = el('div'); compW.appendChild(el('label','field-label','Component Name *'));
  const compSel = el('select');
  compSel._updateOptions = () => {
    compSel.innerHTML = '<option value="">— select component —</option>';
    if(sapInp._selectedItem) {
      cache.components.filter(c => c.equipment_number === sapInp._selectedItem.sap_equipment_number).forEach(c => {
        const opt = el('option'); opt.value = c.name; opt.textContent = c.name; compSel.appendChild(opt);
      });
    }
  };
  if(edit) compSel.value = edit.component_name || '';
  compSel._updateOptions();
  inputs.component_name = compSel;
  compW.appendChild(compSel); grid.appendChild(compW);
  sapInp.addEventListener('change', () => compSel._updateOptions());
  
  // Point Name (typeahead)
  const pointW = el('div'); pointW.appendChild(el('label','field-label','Point Name *'));
  const pointInp = el('input'); pointInp.value = edit ? (edit.name || '') : ''; inputs.name = pointInp;
  pointW.appendChild(pointInp);
  createTypeahead(pointInp, cache.ptNameSuggestions, s=>s.point_name, s=>s.point_name);
  grid.appendChild(pointW);
  
  // Lubrication Type
  const lubTypeW = el('div'); lubTypeW.appendChild(el('label','field-label','Lubrication Type'));
  const lubTypeSel = selectField(LUBRICATION_TYPES, edit ? (edit.lubrication_type || 'Oil') : 'Oil');
  lubTypeW.appendChild(lubTypeSel); inputs.lubrication_type = lubTypeSel; grid.appendChild(lubTypeW);
  
  // Lubricant
  const lubW = el('div'); lubW.appendChild(el('label','field-label','Lubricant'));
  const lubRow = el('div'); lubRow.style.display = 'flex'; lubRow.style.gap = '8px';
  const lubSel = el('select');
  lubSel.innerHTML = '<option value="">— select lubricant —</option>';
  cache.lubricantsMaster.forEach(l => {
    const opt = el('option'); opt.value = l.id; opt.textContent = l.name + ' (' + l.lubricant_type + ')'; lubSel.appendChild(opt);
  });
  lubSel.value = edit ? (edit.lubricant_id || '') : '';
  inputs.lubricant_id = lubSel;
  lubRow.appendChild(lubSel);
  const addLubBtn = el('button','btn sec','+ Add');
  addLubBtn.style.flex = '0 0 auto';
  addLubBtn.onclick = () => openLubricantMasterModal((newLub) => {
    const opt = el('option'); opt.value = newLub.id; opt.textContent = newLub.name + ' (' + newLub.lubricant_type + ')';
    lubSel.appendChild(opt);
    lubSel.value = newLub.id;
  });
  lubRow.appendChild(addLubBtn);
  lubW.appendChild(lubRow); grid.appendChild(lubW);
  
  // Required Qty
  const qtyW = el('div'); qtyW.appendChild(el('label','field-label','Required Qty'));
  const qtyInp = el('input'); qtyInp.value = edit ? (edit.required_quantity || '') : ''; inputs.required_quantity = qtyInp;
  qtyW.appendChild(qtyInp); grid.appendChild(qtyW);
  
  // UOM
  const uomW = el('div'); uomW.appendChild(el('label','field-label','UOM'));
  const uomInp = el('input'); uomInp.value = edit ? (edit.uom || '') : ''; inputs.uom = uomInp;
  uomW.appendChild(uomInp); grid.appendChild(uomW);
  
  // Frequency
  const freqW = el('div'); freqW.appendChild(el('label','field-label','Frequency'));
  const freqInp = el('input'); freqInp.value = edit ? (edit.frequency || '') : ''; inputs.frequency = freqInp;
  freqW.appendChild(freqInp); grid.appendChild(freqW);
  
  // Running-Hour Interval
  const rhW = el('div'); rhW.appendChild(el('label','field-label','Running-Hour Interval'));
  const rhInp = el('input'); rhInp.type = 'number'; rhInp.value = edit ? (edit.running_hours_interval || '') : ''; inputs.running_hours_interval = rhInp;
  rhW.appendChild(rhInp); grid.appendChild(rhW);
  
  // Calendar Interval
  const calW = el('div'); calW.appendChild(el('label','field-label','Calendar Interval (months)'));
  const calInp = el('input'); calInp.type = 'number'; calInp.value = edit ? (edit.calendar_interval_months || '') : ''; inputs.calendar_interval_months = calInp;
  calW.appendChild(calInp); grid.appendChild(calW);
  
  // Status
  const statusW = el('div'); statusW.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(['Active','Inactive'], edit ? (edit.status || 'Active') : 'Active');
  statusW.appendChild(statusSel); inputs.status = statusSel; grid.appendChild(statusW);
  
  // Criticality
  const critW = el('div'); critW.appendChild(el('label','field-label','Criticality'));
  const critSel = selectField(['High','Medium','Low'], edit ? (edit.criticality || 'Medium') : 'Medium');
  critW.appendChild(critSel); inputs.criticality = critSel; grid.appendChild(critW);
  
  // Special Instructions
  const specW = el('div'); specW.appendChild(el('label','field-label','Special Instructions'));
  const specInp = document.createElement('textarea'); specInp.value = edit ? (edit.special_instructions || '') : ''; inputs.special_instructions = specInp;
  specW.appendChild(specInp); grid.appendChild(specW);
  
  body.appendChild(grid);
  openModal(edit ? 'Edit lubrication point' : 'Add new lubrication point', body, async () => {
    const data = {};
    ['equipment_number','component_name','name','lubrication_type','lubricant_id','required_quantity','uom','frequency','running_hours_interval','calendar_interval_months','status','criticality','special_instructions'].forEach(key => {
      data[key] = inputs[key].value;
    });
    if(!data.equipment_number || !data.component_name || !data.name) { alert('Equipment, Component and Point Name are required.'); return false; }
    if(data.name) await sb.rpc('track_point_name_suggestion', {point_name: data.name}).catch(()=>{});
    data.updated_at = new Date().toISOString(); data.updated_by = me.id;
    try {
      if(edit) { const {error} = await sb.from('lubrication_points').update(data).eq('id', edit.id); if(error) throw error; }
      else { data.created_by = me.id; const {error} = await sb.from('lubrication_points').insert(data); if(error) throw error; }
    } catch(e) { alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit ? 'Save changes' : 'Add lubrication point');
}



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
    ['required_quantity','Required Qty'],['uom','UOM'],['frequency','Frequency (text)'],
    ['running_hour_interval','Running-Hour Interval'],['calendar_interval','Calendar Interval (months)'],
  ];
  const body = el('div');

  const eqWrap = el('div'); eqWrap.appendChild(el('label','field-label','SAP Equipment # *'));
  const eq = equipmentTypeahead(edit?edit.equipment_number:''); eqWrap.appendChild(eq.node); body.appendChild(eqWrap);

  const compWrap = el('div'); compWrap.appendChild(el('label','field-label','Component Name *'));
  const compSel = document.createElement('select'); compWrap.appendChild(compSel); body.appendChild(compWrap);
  function refreshComponentOptions(){
    const eqVal = eq.input.value.trim();
    compSel.innerHTML = '';
    const matches = cache.components.filter(c=>c.equipment_number===eqVal);
    if(!validEquipmentNumber(eqVal)){
      const o=document.createElement('option'); o.value=''; o.textContent='— select a valid asset first —'; compSel.appendChild(o); compSel.disabled=true; return;
    }
    compSel.disabled=false;
    const blank=document.createElement('option'); blank.value=''; blank.textContent = matches.length? '— select —' : '— no components on this asset yet —';
    compSel.appendChild(blank);
    matches.forEach(c=>{ const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; compSel.appendChild(o); });
    if(edit && edit.component_name && matches.some(c=>c.name===edit.component_name)) compSel.value = edit.component_name;
  }
  eq.input.addEventListener('input', refreshComponentOptions);
  eq.input.addEventListener('change', refreshComponentOptions);
  refreshComponentOptions();

  const grid = el('div','grid2'); const inputs = {};

  const pointWrap = el('div'); pointWrap.appendChild(el('label','field-label','Point Name *'));
  const pointSug = textWithSuggestions(cache.points.map(p=>p.point_name), edit?edit.point_name:'');
  pointWrap.appendChild(pointSug.node); grid.appendChild(pointWrap);

  const typeWrap = el('div'); typeWrap.appendChild(el('label','field-label','Lubrication Type'));
  const typeSel = selectField(LUBRICATION_TYPES, edit?edit.lubrication_type:'', '— select —'); typeWrap.appendChild(typeSel); grid.appendChild(typeWrap);

  const lubWrap = el('div'); lubWrap.appendChild(el('label','field-label','Lubricant'));
  const lubRow = el('div'); lubRow.style.cssText='display:flex;gap:6px;align-items:flex-start;';
  const lubSel = document.createElement('select'); lubSel.style.flex='1';
  function refreshLubricantOptions(selectId){
    lubSel.innerHTML='';
    const blank=document.createElement('option'); blank.value=''; blank.textContent='— select —'; lubSel.appendChild(blank);
    cache.lubricants.forEach(l=>{ const o=document.createElement('option'); o.value=l.id; o.textContent=l.brand+' '+l.product_name; lubSel.appendChild(o); });
    if(selectId) lubSel.value = selectId;
    else if(edit && edit.lubricant_id) lubSel.value = edit.lubricant_id;
  }
  refreshLubricantOptions();
  const addLubBtn = document.createElement('button'); addLubBtn.className='btn sec'; addLubBtn.type='button'; addLubBtn.textContent='+ New';
  addLubBtn.onclick = ()=> openLubricantModal(null, (newId)=>refreshLubricantOptions(newId));
  lubRow.appendChild(lubSel); lubRow.appendChild(addLubBtn);
  lubWrap.appendChild(lubRow); grid.appendChild(lubWrap);

  fields.forEach(([key,label,req,type])=>{
    const w = el('div'); w.appendChild(el('label','field-label', label+(req?' *':'')));
    const inp = document.createElement('input'); inp.value = edit ? (edit[key]||'') : '';
    w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });

  const critWrap = el('div'); critWrap.appendChild(el('label','field-label','Criticality'));
  const critSel = selectField(CRITICALITY_OPTIONS, edit?edit.criticality:'', '— select —'); critWrap.appendChild(critSel); grid.appendChild(critWrap);
  const statusWrap = el('div'); statusWrap.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(STATUS_OPTIONS, edit?edit.status:'Active'); statusWrap.appendChild(statusSel); grid.appendChild(statusWrap);

  body.appendChild(grid);
  const instrWrap = el('div'); instrWrap.appendChild(el('label','field-label','Special Instructions'));
  const instrInp = document.createElement('textarea'); instrInp.value = edit?(edit.special_instructions||''):''; instrWrap.appendChild(instrInp);
  body.appendChild(instrWrap);

  openModal(edit?'Edit lubrication point':'Add lubrication point', body, async ()=>{
    const eqVal = eq.input.value.trim();
    if(!eqVal){ alert('Enter an asset.'); return false; }
    if(!validEquipmentNumber(eqVal)){ alert('That SAP Equipment # doesn\'t match an existing asset. Pick one from the suggestions.'); return false; }
    if(!compSel.value){ alert('Select a component (add one under Components first if the list is empty).'); return false; }
    if(!pointSug.input.value.trim()){ alert('Point Name is required.'); return false; }
    const chosenLub = cache.lubricants.find(l=>l.id===lubSel.value);
    const data={
      equipment_number:eqVal, component_name:compSel.value, point_name:pointSug.input.value.trim(),
      lubrication_type:typeSel.value, lubricant_id: lubSel.value||null, lubricant_name: chosenLub ? (chosenLub.brand+' '+chosenLub.product_name) : '',
      criticality:critSel.value, status:statusSel.value, special_instructions:instrInp.value.trim(),
    };
    fields.forEach(([key])=>{ data[key]=inputs[key].value.trim(); });
    data.updated_at=new Date().toISOString(); data.updated_by=me.id;
    try{
      if(edit){ const {error}=await sb.from('lubrication_points').update(data).eq('id',edit.id); if(error) throw error; }
      else { data.created_by=me.id; const {error}=await sb.from('lubrication_points').insert(data); if(error) throw error; }
    }catch(e){ alert('Save failed: '+e.message); return false; }
    await loadAll(); render();
  });
}
function openComponentModal(edit){
  const fields = [['name','Component Name',1]];
  const body = el('div');
  const eqWrap = el('div'); eqWrap.appendChild(el('label','field-label','SAP Equipment # *'));
  const eq = equipmentTypeahead(edit?edit.equipment_number:''); eqWrap.appendChild(eq.node); body.appendChild(eqWrap);
  const grid = el('div','grid2'); const inputs = {};
  fields.forEach(([key,label,req,type])=>{
    const w = el('div'); w.appendChild(el('label','field-label', label+(req?' *':'')));
    const inp = document.createElement('input'); inp.value = edit ? (edit[key]||'') : '';
    w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });
  const typeWrap = el('div'); typeWrap.appendChild(el('label','field-label','Component Type'));
  const typeSug = textWithSuggestions(cache.components.map(c=>c.type), edit?edit.type:'');
  typeWrap.appendChild(typeSug.node); grid.appendChild(typeWrap);
  const critWrap = el('div'); critWrap.appendChild(el('label','field-label','Criticality'));
  const critSel = selectField(CRITICALITY_OPTIONS, edit?edit.criticality:'', '— select —'); critWrap.appendChild(critSel); grid.appendChild(critWrap);
  const statusWrap = el('div'); statusWrap.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(STATUS_OPTIONS, edit?edit.status:'Active'); statusWrap.appendChild(statusSel); grid.appendChild(statusWrap);
  body.appendChild(grid);
  const remWrap = el('div'); remWrap.appendChild(el('label','field-label','Remarks'));
  const remInp = document.createElement('textarea'); remInp.value = edit?(edit.remarks||''):''; remWrap.appendChild(remInp);
  body.appendChild(remWrap);
  openModal(edit?'Edit component':'Add component', body, async ()=>{
    const eqVal = eq.input.value.trim();
    if(!eqVal){ alert('Enter an asset.'); return false; }
    if(!validEquipmentNumber(eqVal)){ alert('That SAP Equipment # doesn\'t match an existing asset. Pick one from the suggestions.'); return false; }
    const data={equipment_number:eqVal, type:typeSug.input.value.trim(), criticality:critSel.value, status:statusSel.value, remarks:remInp.value.trim()};
    let missing=false;
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
function openLubricantModal(edit, onDone){
  const fields = [
    ['brand','Brand',1],['product_name','Product Name',1],['lubricant_type','Lubricant Type'],['base_oil','Base Oil'],
    ['iso_vg','ISO VG'],['nlgi_grade','NLGI Grade'],['manufacturer','Manufacturer'],['uom','UOM'],
    ['sap_material_code','SAP Material Code'],
  ];
  const body = el('div'); const grid = el('div','grid2'); const inputs = {};
  fields.forEach(([key,label,req,type])=>{
    const w = el('div'); w.appendChild(el('label','field-label', label+(req?' *':'')));
    const inp = type==='textarea' ? document.createElement('textarea') : document.createElement('input');
    inp.value = edit ? (edit[key]||'') : ''; w.appendChild(inp); inputs[key]=inp; grid.appendChild(w);
  });
  const statusWrap = el('div'); statusWrap.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(STATUS_OPTIONS, edit?edit.status:'Active'); statusWrap.appendChild(statusSel); grid.appendChild(statusWrap);
  body.appendChild(grid);
  const notesWrap = el('div'); notesWrap.appendChild(el('label','field-label','Notes'));
  const notesInp = document.createElement('textarea'); notesInp.value = edit?(edit.notes||''):''; notesWrap.appendChild(notesInp);
  body.appendChild(notesWrap);
  openModal(edit?'Edit lubricant':'Add lubricant', body, async ()=>{
    const data={status:statusSel.value, notes:notesInp.value.trim()}; let missing=false;
    fields.forEach(([key,label,req])=>{ const v=inputs[key].value.trim(); if(req&&!v)missing=true; data[key]=v; });
    if(missing){ alert('Please fill required fields (*)'); return false; }
    data.updated_at=new Date().toISOString(); data.updated_by=me.id;
    try{
      if(edit){ const {error}=await sb.from('lubricants').update(data).eq('id',edit.id); if(error) throw error; }
      else {
        data.created_by=me.id;
        const {data:inserted, error}=await sb.from('lubricants').insert(data).select().single();
        if(error) throw error;
        await loadAll();
        if(onDone) onDone(inserted.id);
        render();
        return;
      }
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

// ============================== RUNNING HOURS (resource-based) ==============================
function renderRunningHoursPage(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Running Hours</h1><div class="page-sub">Update resource running hours — auto-propagates to attached equipment</div>'));

  const card = el('div','card');
  card.appendChild(el('div','card-title','Update Resource Running Hours'));
  
  const grid = el('div','grid2');
  const resW = el('div'); resW.appendChild(el('label','field-label','Select Resource *'));
  const resSel = el('select'); resSel.innerHTML = '<option value="">— select resource —</option>';
  cache.resources.forEach(r => {
    const opt = el('option'); opt.value = r.id; opt.textContent = r.resource_name + ' (' + r.description + ')'; resSel.appendChild(opt);
  });
  resW.appendChild(resSel); grid.appendChild(resW);
  
  const hrsW = el('div'); hrsW.appendChild(el('label','field-label','Running Hours *'));
  const hrsInp = el('input'); hrsInp.type = 'number'; hrsInp.step = '0.01'; hrsW.appendChild(hrsInp); grid.appendChild(hrsW);
  
  card.appendChild(grid);
  const updateBtn = el('button','btn','Update Running Hours');
  updateBtn.onclick = async () => {
    const resId = resSel.value;
    const hrs = parseFloat(hrsInp.value);
    if(!resId || isNaN(hrs)) { alert('Select a resource and enter running hours.'); return; }
    updateBtn.disabled = true;
    try {
      const {error} = await sb.rpc('update_resource_running_hours', {res_id: resId, new_hours: hrs});
      if(error) throw error;
      alert('Running hours updated. All attached equipment have been updated automatically.');
      await loadAll(); render();
    } catch(e) {
      alert('Failed: '+e.message);
    }
    updateBtn.disabled = false;
  };
  card.appendChild(updateBtn);
  page.appendChild(card);
  
  // Show resource details
  const detailCard = el('div','card');
  detailCard.appendChild(el('div','card-title','Resources & Attached Equipment'));
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Resource</th><th>Current Hours</th><th>Attached Equipment</th>'));
  cache.resources.forEach(r => {
    const attached = cache.equipment.filter(e => 
      cache.equipmentResourceMappings.some(m => m.resource_id === r.id && m.equipment_id === e.id)
    ).map(e => e.sap_equipment_number).join(', ');
    const tr = el('tr');
    tr.innerHTML = '<td><b>'+r.resource_name+'</b><br><span style="font-size:11px;color:var(--sub)">'+r.description+'</span></td>'+
      '<td>'+r.running_hours.toFixed(2)+'</td>'+
      '<td><span style="font-size:12px;">'+(attached||'(none)')+'</span></td>';
    t.appendChild(tr);
  });
  wrap.appendChild(t); detailCard.appendChild(wrap);
  page.appendChild(detailCard);
}

init();
