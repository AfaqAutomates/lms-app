const sb = window.supabase.createClient(window.LMS_CONFIG.SUPABASE_URL, window.LMS_CONFIG.SUPABASE_ANON_KEY);

const ACTIVITY_TYPES = ['Top-up','Oil replacement','Drain and refill','Greasing','Lubricant replenishment','Filter replacement','Sampling','Inspection','Flushing','Corrective lubrication','Emergency lubrication','Other'];
const CRITICALITY_OPTIONS = ['High','Medium','Low'];
const STATUS_OPTIONS = ['Active','Inactive'];
const LUBRICATION_TYPES = ['Oil', 'Grease', 'Automatic Lubricator', 'Circulating Oil System', 'Other'];

let session = null;
let me = {id:null, name:'', isAdmin:false};
let myFeatures = new Set();
let allFeatures = [];
let cache = {equipment:[], components:[], points:[], lubricants:[], activities:[], lubricantsMaster:[], compTypeSuggestions:[], ptNameSuggestions:[], resources:[], equipmentResourceMappings:[], profiles:{}};
let active = 'dashboard';
let pointsSubtab = 'points';

function el(tag='div', className='', html=''){const e = document.createElement(tag); if(className) e.className = className; if(html) e.innerHTML = html; return e;}
function icon(name){return window.ICON ? window.ICON(name) : '◆';}
function selectField(options, value, placeholder){const s = document.createElement('select'); if(placeholder) { const o = el('option',null,placeholder); o.value=''; s.appendChild(o); } options.forEach(opt => { const o = el('option'); o.value=opt; o.textContent=opt; s.appendChild(o); }); s.value = value || ''; return s;}
function statusBadge(status){const className = status==='Active' ? 'ok' : 'gray'; return '<span class="badge ' + className + '">' + status + '</span>';}
function emptyState(icon, title, text){const div = el('div'); div.style.cssText = 'text-align:center;padding:40px;color:var(--sub)'; div.innerHTML = '<div style="font-size:32px;margin-bottom:10px">' + icon + '</div><div style="font-size:14px;font-weight:700">' + title + '</div>' + (text ? '<div style="font-size:12px;margin-top:5px">' + text + '</div>' : ''); return div;}
function hasFeature(key){ return me.isAdmin || myFeatures.has(key); }

function createTypeahead(inputEl, dataArray, labelFn, onSelect) {
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
}

async function route(){
  const {data:{session:s}} = await sb.auth.getSession();
  session = s;
  if(!session){ showAuthScreen(); return; }
  document.getElementById('authScreen').style.display='none';
  document.getElementById('appScreen').style.display='';
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

function showAuthScreen(){
  document.getElementById('authScreen').style.display='';
  document.getElementById('appScreen').style.display='none';
}

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

function buildSidebar(){
  const nav = document.getElementById('sidebar');
  nav.innerHTML = '<div class="nav-brand"><div class="logo" id="sideLogo"></div><div><b>LubriTrack</b></div></div>';
  document.getElementById('sideLogo').appendChild(el('div',null,icon('logo')));
  
  const pages = ['dashboard','assets','points','workorders','running-hours','oilanalysis','inventory','alerts','reports','audit','settings'];
  const labels = {dashboard:'📊 Dashboard', assets:'🏭 Assets', points:'🔧 Lubrication Points', workorders:'✓ Work Orders', 'running-hours':'⏱️ Running Hours', oilanalysis:'🧪 Oil Analysis', inventory:'📦 Inventory', alerts:'🔔 Alerts', reports:'📄 Reports', audit:'📋 Audit', settings:'⚙️ Settings'};
  pages.forEach(page => {
    const b = el('div', 'nav-item', labels[page]);
    b.onclick = ()=>{ active=page; render(); };
    nav.appendChild(b);
  });
}

function render(){
  const pages = ['dashboard','assets','points','workorders','running-hours','oilanalysis','inventory','alerts','reports','audit','settings'];
  document.querySelectorAll('.nav-item').forEach((n,i) => { n.className = i === pages.indexOf(active) ? 'nav-item active' : 'nav-item'; });
  
  const page = document.getElementById('page');
  page.innerHTML = '';
  
  switch(active){
    case 'dashboard': renderDashboard(); break;
    case 'assets': renderAssetsPage(); break;
    case 'points': renderPointsPage(); break;
    case 'workorders': renderWorkOrdersPage(); break;
    case 'running-hours': renderRunningHours(); break;
    case 'oilanalysis': page.appendChild(emptyState('🧪','Oil Analysis','Coming in Phase 4')); break;
    case 'inventory': renderInventoryPage(); break;
    case 'alerts': page.appendChild(emptyState('🔔','Alerts','Coming in Phase 5')); break;
    case 'reports': page.appendChild(emptyState('📄','Reports','Coming in Phase 6')); break;
    case 'audit': renderAuditPage(); break;
    case 'settings': renderSettings(); break;
  }
}

function renderDashboard(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Dashboard</h1><div class="page-sub">Lubrication & Reliability Overview</div>'));
  
  const grid = el('div','grid4');
  const kpis = [
    ['Total Equipment', cache.equipment.length, 'assets'],
    ['Total Points', cache.points.length, 'points'],
    ['Active Resources', cache.resources.filter(r=>r.running_hours).length, 'running-hours'],
    ['Completed Activities', cache.activities.length, 'workorders'],
  ];
  kpis.forEach(([title, value, icon]) => {
    const card = el('div','card');
    card.innerHTML = '<div style="font-size:12px;color:var(--sub);text-transform:uppercase">' + title + '</div><div style="font-size:28px;font-weight:700;margin:10px 0">' + value + '</div>';
    grid.appendChild(card);
  });
  page.appendChild(grid);
}

function renderAssetsPage(){
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Assets</h1><div class="page-sub">Equipment keyed by SAP Equipment Number</div>'));
  if(hasFeature('assets.edit')){
    const addBtn = el('button','btn', icon('plus')+' Add Asset');
    addBtn.onclick = ()=>openEquipmentModal(null);
    head.appendChild(addBtn);
  }
  page.appendChild(head);

  const card = el('div','card');
  const list = cache.equipment;
  if(!list.length){ card.appendChild(emptyState('assets','No assets yet', hasFeature('assets.edit')?'Click "Add Asset" to create your first one.':'Ask your administrator for access.')); page.appendChild(card); return; }

  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>SAP #</th><th>Description</th><th>Status</th><th>Criticality</th><th></th>'));
  list.forEach(rec=>{
    const tr = el('tr');
    tr.innerHTML = '<td><b>'+rec.sap_equipment_number+'</b></td><td>'+rec.description+'</td><td>'+statusBadge(rec.status||'Active')+'</td>'+
      '<td><span class="badge '+(rec.lubrication_criticality==='High'?'bad':rec.lubrication_criticality==='Medium'?'warn':'ok')+'">'+(rec.lubrication_criticality||'Medium')+'</span></td>';
    const tdAct = el('td');
    if(hasFeature('assets.edit')){
      const ed = el('button','icon-btn', icon('settings')); ed.onclick=()=>openEquipmentModal(rec);
      const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
      del.onclick=async()=>{ if(confirm('Delete?')){ const {error}=await sb.from('equipment').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
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
  
  const fields = [
    ['sap_equipment_number','SAP Equipment # *'],
    ['description','Description *'],
    ['functional_location','Functional Location'],
    ['plant','Plant'],
    ['area','Area'],
    ['equipment_type','Equipment Type'],
  ];
  
  fields.forEach(([key, label]) => {
    const w = el('div');
    w.appendChild(el('label','field-label', label));
    const inp = el('input');
    inp.value = edit ? (edit[key] || '') : '';
    w.appendChild(inp);
    inputs[key] = inp;
    grid.appendChild(w);
  });
  
  const statusW = el('div'); statusW.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(['Active','Inactive'], edit ? (edit.status || 'Active') : 'Active');
  statusW.appendChild(statusSel); inputs.status = statusSel; grid.appendChild(statusW);
  
  const critW = el('div'); critW.appendChild(el('label','field-label','Lubrication Criticality'));
  const critSel = selectField(['High','Medium','Low'], edit ? (edit.lubrication_criticality || 'Medium') : 'Medium');
  critW.appendChild(critSel); inputs.lubrication_criticality = critSel; grid.appendChild(critW);
  
  body.appendChild(grid);
  openModal(edit ? 'Edit Equipment' : 'Add Equipment', body, async () => {
    const data = {};
    Object.keys(inputs).forEach(key => data[key] = inputs[key].value.trim());
    if(!data.sap_equipment_number || !data.description) { alert('SAP # and Description required'); return false; }
    data.updated_at = new Date().toISOString(); data.updated_by = me.id;
    try {
      if(edit){ const {error} = await sb.from('equipment').update(data).eq('id', edit.id); if(error) throw error; }
      else { data.created_by = me.id; const {error} = await sb.from('equipment').insert(data); if(error) throw error; }
    } catch(e) { alert('Failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit ? 'Save' : 'Add');
}

function renderPointsPage(){
  const page = document.getElementById('page');
  const head = el('div','page-head');
  head.appendChild(el('div',null,'<h1>Lubrication Points</h1><div class="page-sub">Points & Components</div>'));
  if(hasFeature('points.edit')){
    const addBtn = el('button','btn', icon('plus')+(pointsSubtab==='points'?' Add Point':' Add Component'));
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
    if(!list.length){ card.appendChild(emptyState('points','No points yet', hasFeature('points.edit')?'Click "Add Point" to create your first one.':'Ask your administrator for access.')); page.appendChild(card); return; }
    const wrap = el('div','tablewrap');
    const t = el('table');
    t.appendChild(el('tr',null,'<th>Point</th><th>Equipment</th><th>Component</th><th>Type</th><th>Status</th><th></th>'));
    list.forEach(rec=>{
      const tr = el('tr');
      tr.innerHTML = '<td><b>'+rec.name+'</b></td><td>'+(rec.equipment_number||'—')+'</td><td>'+(rec.component_name||'—')+'</td>'+
        '<td>'+(rec.lubrication_type||'—')+'</td><td>'+statusBadge(rec.status||'Active')+'</td>';
      const tdAct = el('td');
      if(hasFeature('points.edit')){
        const ed = el('button','icon-btn', icon('settings')); ed.onclick=()=>openPointModal(rec);
        const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
        del.onclick=async()=>{ if(confirm('Delete?')){ const {error}=await sb.from('lubrication_points').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
        tdAct.appendChild(ed); tdAct.appendChild(del);
      }
      tr.appendChild(tdAct);
      t.appendChild(tr);
    });
    wrap.appendChild(t); card.appendChild(wrap);
  } else {
    const list = cache.components;
    if(!list.length){ card.appendChild(emptyState('points','No components yet', hasFeature('points.edit')?'Click "Add Component" to create your first one.':'Ask your administrator for access.')); page.appendChild(card); return; }
    const wrap = el('div','tablewrap');
    const t = el('table');
    t.appendChild(el('tr',null,'<th>Component</th><th>Equipment</th><th>Type</th><th>Criticality</th><th>Status</th><th></th>'));
    list.forEach(rec=>{
      const tr = el('tr');
      tr.innerHTML = '<td><b>'+rec.name+'</b></td><td>'+(rec.equipment_number||'—')+'</td><td>'+(rec.type||'—')+'</td><td>'+(rec.criticality||'—')+'</td><td>'+statusBadge(rec.status||'Active')+'</td>';
      const tdAct = el('td');
      if(hasFeature('points.edit')){
        const ed = el('button','icon-btn', icon('settings')); ed.onclick=()=>openComponentModal(rec);
        const del = el('button','icon-btn', icon('close')); del.style.color='var(--bad)';
        del.onclick=async()=>{ if(confirm('Delete?')){ const {error}=await sb.from('components').delete().eq('id',rec.id); if(error) alert(error.message); else { await loadAll(); render(); } } };
        tdAct.appendChild(ed); tdAct.appendChild(del);
      }
      tr.appendChild(tdAct);
      t.appendChild(tr);
    });
    wrap.appendChild(t); card.appendChild(wrap);
  }
  page.appendChild(card);
}

function openComponentModal(edit){
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  
  const sapW = el('div'); sapW.appendChild(el('label','field-label','SAP Equipment # *'));
  const sapInp = el('input'); sapInp.placeholder='Type to search...'; sapInp.value = edit ? (edit.equipment_number || '') : '';
  inputs.equipment_number = sapInp; sapW.appendChild(sapInp);
  createTypeahead(sapInp, cache.equipment, e=>(e.sap_equipment_number||'')+(e.description?' - '+e.description:''), (item)=>{ sapInp._selectedItem = item; });
  grid.appendChild(sapW);
  
  const nameW = el('div'); nameW.appendChild(el('label','field-label','Component Name *'));
  const nameInp = el('input'); nameInp.value = edit ? (edit.name || '') : ''; inputs.name = nameInp; nameW.appendChild(nameInp);
  grid.appendChild(nameW);
  
  const typeW = el('div'); typeW.appendChild(el('label','field-label','Component Type'));
  const typeInp = el('input'); typeInp.value = edit ? (edit.type || '') : ''; inputs.type = typeInp; typeW.appendChild(typeInp);
  grid.appendChild(typeW);
  
  const critW = el('div'); critW.appendChild(el('label','field-label','Criticality'));
  const critSel = selectField(['High','Medium','Low'], edit ? (edit.criticality || 'Medium') : 'Medium');
  critW.appendChild(critSel); inputs.criticality = critSel; grid.appendChild(critW);
  
  const statusW = el('div'); statusW.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(['Active','Inactive'], edit ? (edit.status || 'Active') : 'Active');
  statusW.appendChild(statusSel); inputs.status = statusSel; grid.appendChild(statusW);
  
  body.appendChild(grid);
  openModal(edit ? 'Edit Component' : 'Add Component', body, async () => {
    const data = {};
    ['equipment_number','name','type','criticality','status'].forEach(key => data[key] = inputs[key].value.trim());
    if(!data.equipment_number || !data.name) { alert('Equipment # and Name required'); return false; }
    data.updated_at = new Date().toISOString(); data.updated_by = me.id;
    try {
      if(edit){ const {error} = await sb.from('components').update(data).eq('id', edit.id); if(error) throw error; }
      else { data.created_by = me.id; const {error} = await sb.from('components').insert(data); if(error) throw error; }
    } catch(e) { alert('Failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit ? 'Save' : 'Add');
}

function openPointModal(edit){
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  
  const sapW = el('div'); sapW.appendChild(el('label','field-label','SAP Equipment # *'));
  const sapInp = el('input'); sapInp.placeholder='Type to search...'; sapInp.value = edit ? (edit.equipment_number || '') : '';
  inputs.equipment_number = sapInp; sapW.appendChild(sapInp);
  createTypeahead(sapInp, cache.equipment, e=>(e.sap_equipment_number||'')+(e.description?' - '+e.description:''), (item) => { sapInp._selectedItem = item; });
  grid.appendChild(sapW);
  
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
  compSel._updateOptions();
  inputs.component_name = compSel; compW.appendChild(compSel); grid.appendChild(compW);
  sapInp.addEventListener('change', () => compSel._updateOptions());
  
  const pointW = el('div'); pointW.appendChild(el('label','field-label','Point Name *'));
  const pointInp = el('input'); pointInp.value = edit ? (edit.name || '') : ''; inputs.name = pointInp; pointW.appendChild(pointInp);
  grid.appendChild(pointW);
  
  const lubTypeW = el('div'); lubTypeW.appendChild(el('label','field-label','Lubrication Type'));
  const lubTypeSel = selectField(LUBRICATION_TYPES, edit ? (edit.lubrication_type || 'Oil') : 'Oil');
  lubTypeW.appendChild(lubTypeSel); inputs.lubrication_type = lubTypeSel; grid.appendChild(lubTypeW);
  
  const lubW = el('div'); lubW.appendChild(el('label','field-label','Lubricant'));
  const lubRow = el('div'); lubRow.style.display = 'flex'; lubRow.style.gap = '8px';
  const lubSel = el('select');
  lubSel.innerHTML = '<option value="">— select lubricant —</option>';
  cache.lubricantsMaster.forEach(l => { const opt = el('option'); opt.value = l.id; opt.textContent = l.name; lubSel.appendChild(opt); });
  lubSel.value = edit ? (edit.lubricant_id || '') : ''; inputs.lubricant_id = lubSel; lubRow.appendChild(libSel);
  const addLubBtn = el('button','btn sec','+ Add'); addLubBtn.style.flex = '0 0 auto';
  addLubBtn.onclick = () => openLubricantModal((newLub) => {
    const opt = el('option'); opt.value = newLub.id; opt.textContent = newLub.name; lubSel.appendChild(opt); libSel.value = newLub.id;
  });
  lubRow.appendChild(addLubBtn); lubW.appendChild(libRow); grid.appendChild(lubW);
  
  const statusW = el('div'); statusW.appendChild(el('label','field-label','Status'));
  const statusSel = selectField(['Active','Inactive'], edit ? (edit.status || 'Active') : 'Active');
  statusW.appendChild(statusSel); inputs.status = statusSel; grid.appendChild(statusW);
  
  body.appendChild(grid);
  openModal(edit ? 'Edit Lubrication Point' : 'Add Lubrication Point', body, async () => {
    const data = {};
    ['equipment_number','component_name','name','lubrication_type','lubricant_id','status'].forEach(key => data[key] = inputs[key].value);
    if(!data.equipment_number || !data.component_name || !data.name) { alert('Equipment, Component and Point Name required'); return false; }
    data.updated_at = new Date().toISOString(); data.updated_by = me.id;
    try {
      if(edit){ const {error} = await sb.from('lubrication_points').update(data).eq('id', edit.id); if(error) throw error; }
      else { data.created_by = me.id; const {error} = await sb.from('lubrication_points').insert(data); if(error) throw error; }
    } catch(e) { alert('Failed: '+e.message); return false; }
    await loadAll(); render();
  }, edit ? 'Save' : 'Add');
}

function openLubricantModal(callback){
  const body = el('div');
  const grid = el('div','grid2');
  const inputs = {};
  
  const nameW = el('div'); nameW.appendChild(el('label','field-label','Lubricant Name *'));
  const nameInp = el('input'); inputs.name = nameInp; nameW.appendChild(nameInp); grid.appendChild(nameW);
  
  const typeW = el('div'); typeW.appendChild(el('label','field-label','Type *'));
  const typeSel = selectField(LUBRICATION_TYPES, ''); inputs.lubricant_type = typeSel; typeW.appendChild(typeSel); grid.appendChild(typeW);
  
  body.appendChild(grid);
  openModal('Add Lubricant', body, async () => {
    if(!inputs.name.value.trim() || !inputs.lubricant_type.value) { alert('Name and Type required'); return false; }
    try {
      const {data, error} = await sb.from('lubricants_master').insert({ name: inputs.name.value.trim(), lubricant_type: inputs.lubricant_type.value, created_by: me.id }).select().single();
      if(error) throw error;
      await loadAll();
      if(callback) callback(data);
    } catch(e) { alert('Failed: '+e.message); return false; }
  }, 'Add Lubricant');
}

function renderRunningHours(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Running Hours</h1><div class="page-sub">Track resource running hours — auto-cascades to linked equipment</div>'));
  
  const card = el('div','card');
  card.appendChild(el('div','card-title','Update Resource Running Hours'));
  
  const grid = el('div','grid2');
  const resW = el('div'); resW.appendChild(el('label','field-label','Resource *'));
  const resSel = el('select'); resSel.innerHTML = '<option value="">— select resource —</option>';
  cache.resources.forEach(r => { const opt = el('option'); opt.value = r.id; opt.textContent = r.resource_name + ' (' + (r.running_hours||0) + ' hrs)'; resSel.appendChild(opt); });
  resW.appendChild(resSel); grid.appendChild(resW);
  
  const hrsW = el('div'); hrsW.appendChild(el('label','field-label','Running Hours *'));
  const hrsInp = el('input'); hrsInp.type = 'number'; hrsInp.step = '0.01'; hrsW.appendChild(hrsInp); grid.appendChild(hrsW);
  
  card.appendChild(grid);
  const btn = el('button','btn','Update Running Hours');
  btn.onclick = async () => {
    if(!resSel.value || !hrsInp.value) { alert('Select resource and enter hours'); return; }
    btn.disabled = true;
    const {error} = await sb.rpc('update_resource_running_hours', {res_id: resSel.value, new_hours: parseFloat(hrsInp.value)});
    btn.disabled = false;
    if(error) { alert('Failed: '+error.message); return; }
    hrsInp.value = '';
    await loadAll(); render();
  };
  card.appendChild(document.createElement('br'));
  card.appendChild(btn);
  page.appendChild(card);
  
  const listCard = el('div','card');
  listCard.appendChild(el('div','card-title','Resource Status'));
  if(!cache.resources.length){ listCard.appendChild(emptyState('running-hours','No resources','')); }
  else {
    const wrap = el('div','tablewrap');
    const t = el('table');
    t.appendChild(el('tr',null,'<th>Resource</th><th>Running Hours</th><th>Last Updated</th>'));
    cache.resources.forEach(r => {
      const tr = el('tr');
      tr.innerHTML = '<td><b>' + r.resource_name + '</b></td><td>' + (r.running_hours || 0) + ' hrs</td>' +
        '<td>' + (r.last_running_hours_update ? new Date(r.last_running_hours_update).toLocaleDateString() : '—') + '</td>';
      t.appendChild(tr);
    });
    wrap.appendChild(t); listCard.appendChild(wrap);
  }
  page.appendChild(listCard);
}

function renderWorkOrdersPage(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Work Orders</h1><div class="page-sub">Recorded activities</div>'));
  const card = el('div','card');
  const list = cache.activities;
  if(!list.length){ card.appendChild(emptyState('workorders','No activities yet','')); page.appendChild(card); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Date</th><th>Type</th><th>Recorded By</th>'));
  list.slice(0,20).forEach(r=>{ const tr = el('tr');  tr.innerHTML = '<td>'+(new Date(r.activity_date||r.created_at).toLocaleDateString())+'</td><td>'+r.activity_type+'</td><td>'+((r.created_by && cache.profiles[r.created_by])||'—')+'</td>'; t.appendChild(tr); });
  wrap.appendChild(t); card.appendChild(wrap); page.appendChild(card);
}

function renderInventoryPage(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Inventory</h1><div class="page-sub">Lubricants</div>'));
  const card = el('div','card');
  const list = cache.lubricantsMaster;
  if(!list.length){ card.appendChild(emptyState('inventory','No lubricants yet','')); page.appendChild(card); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Name</th><th>Type</th><th>UOM</th>'));
  list.forEach(r=>{ const tr = el('tr'); tr.innerHTML = '<td>'+r.name+'</td><td>'+r.lubricant_type+'</td><td>'+(r.uom||'—')+'</td>'; t.appendChild(tr); });
  wrap.appendChild(t); card.appendChild(wrap); page.appendChild(card);
}

function renderAuditPage(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Audit History</h1><div class="page-sub">All changes</div>'));
  const card = el('div','card');
  const events = [];
  [...cache.equipment, ...cache.components, ...cache.points, ...cache.activities].forEach(r=>{ if(r.created_at) events.push({date: r.created_at, action: 'Created', user: r.created_by || '—'}); if(r.updated_at && r.updated_at !== r.created_at) events.push({date: r.updated_at, action: 'Updated', user: r.updated_by || '—'}); });
  events.sort((a,b) => new Date(b.date) - new Date(a.date));
  if(!events.length){ card.appendChild(emptyState('audit','No history yet','')); page.appendChild(card); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Date</th><th>Action</th><th>User</th>'));
  events.slice(0,50).forEach(e=>{ const tr = el('tr'); tr.innerHTML = '<td>'+new Date(e.date).toLocaleString()+'</td><td>'+e.action+'</td><td>'+((e.user && cache.profiles[e.user]) || e.user)+'</td>'; t.appendChild(tr); });
  wrap.appendChild(t); card.appendChild(wrap); page.appendChild(card);
}

async function renderSettings(){
  const page = document.getElementById('page');
  page.appendChild(el('div','page-head','<h1>Settings</h1><div class="page-sub">Your account'+(me.isAdmin?', plus user & access administration':'')+'</div>'));

  if(!me.isAdmin){
    const n = el('div','card');
    n.appendChild(el('div','notice','Only an Administrator can manage users.'));
    page.appendChild(n);
    return;
  }

  const create = el('div','card');
  create.appendChild(el('div','card-title','Create a user'));
  const grid = el('div','grid2');
  const nameW=el('div'); nameW.appendChild(el('label','field-label','Full name')); const nameI=el('input'); nameW.appendChild(nameI);
  const emailW=el('div'); emailW.appendChild(el('label','field-label','Email *')); const emailI=el('input'); emailI.type='email'; emailW.appendChild(emailI);
  const pwW=el('div'); pwW.appendChild(el('label','field-label','Password (min 8 chars) *')); const pwI=el('input'); pwI.type='text'; pwW.appendChild(pwI);
  grid.appendChild(nameW); grid.appendChild(emailW); grid.appendChild(pwW);
  create.appendChild(grid);
  const createBtn = el('button','btn','Create user');
  createBtn.onclick = async ()=>{ if(!emailI.value.trim() || pwI.value.length<8){ alert('Email and password required'); return; } createBtn.disabled = true; const {data, error} = await sb.functions.invoke('admin-create-user', { body: { email: emailI.value.trim(), password: pwI.value, full_name: nameI.value.trim() } }); createBtn.disabled = false; if(error || (data && data.error)){ alert('Failed: '+(data?.error || error.message)); return; } nameI.value=''; emailI.value=''; pwI.value=''; alert('User created. Share the password.'); await loadAll(); render(); };
  create.appendChild(document.createElement('br'));
  create.appendChild(createBtn);
  page.appendChild(create);

  const listCard = el('div','card');
  listCard.appendChild(el('div','card-title','Users & Access'));
  const {data: users} = await sb.from('profiles').select('id, full_name, email, is_admin').order('full_name');
  if(!users || !users.length){ listCard.appendChild(emptyState('settings','No users','')); page.appendChild(listCard); return; }
  const wrap = el('div','tablewrap');
  const t = el('table');
  t.appendChild(el('tr',null,'<th>Name</th><th>Email</th><th>Status</th><th></th>'));
  users.forEach(u=>{ const tr = el('tr'); tr.innerHTML = '<td>'+(u.full_name||'—')+'</td><td>'+(u.email||'—')+'</td><td>'+(u.is_admin?'<span class="badge info">Administrator</span>':'<span class="badge gray">Standard user</span>')+'</td>'; const tdAct = el('td'); if(!u.is_admin){ const btn = el('button','btn sec','Manage access'); btn.onclick = ()=>openFeatureModal(u); tdAct.appendChild(btn); } tr.appendChild(tdAct); t.appendChild(tr); });
  wrap.appendChild(t); listCard.appendChild(wrap);
  page.appendChild(listCard);
}

async function openFeatureModal(u){
  const {data:current} = await sb.from('user_features').select('feature_key, enabled').eq('user_id', u.id);
  const currentMap = {}; (current||[]).forEach(r=>currentMap[r.feature_key]=r.enabled);
  const body = el('div');
  body.appendChild(el('div',null,'<div style="font-size:12px;color:var(--sub);margin-bottom:10px;">Toggle what <b>'+(u.full_name||u.email)+'</b> can do.</div>'));
  const modules = {};
  allFeatures.forEach(f=>{ (modules[f.module]=modules[f.module]||[]).push(f); });
  Object.keys(modules).forEach(mod=>{ body.appendChild(el('div',null,'<div style="font-size:11px;font-weight:700;color:var(--sub);text-transform:uppercase;margin:10px 0 4px;">'+mod+'</div>')); modules[mod].forEach(f=>{ const row = el('label'); row.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;cursor:pointer;'; const cb = el('input'); cb.type='checkbox'; cb.style.cssText='width:auto;min-height:auto;'; cb.checked = !!currentMap[f.key]; cb.onchange = async ()=>{ const {error} = await sb.from('user_features').upsert({user_id:u.id, feature_key:f.key, enabled:cb.checked, updated_at:new Date().toISOString(), updated_by:me.id}); if(error){ alert('Failed: '+error.message); cb.checked=!cb.checked; } }; row.appendChild(cb); const txt = el('span'); txt.innerHTML = '<b>'+f.label+'</b><br><span style="color:var(--sub);font-size:11px;">'+(f.description||'')+'</span>'; row.appendChild(txt); body.appendChild(row); }); });
  openModal('Manage access', body, null);
}

function openModal(title, bodyEl, onSave, saveLabel){
  const modal = el('div','modal-overlay');
  const card = el('div','modal-card');
  const head = el('div','modal-head');
  head.appendChild(el('div',null,'<h2>'+title+'</h2>'));
  const closeBtn = el('button','modal-close','×');
  closeBtn.onclick = ()=>modal.remove();
  head.appendChild(closeBtn);
  card.appendChild(head);
  card.appendChild(bodyEl);
  const foot = el('div','modal-foot');
  if(onSave){ const btn = el('button','btn',saveLabel||'Save'); btn.onclick = async ()=>{ if(await onSave()){ modal.remove(); } }; foot.appendChild(btn); }
  const cancelBtn = el('button','btn sec','Cancel');
  cancelBtn.onclick = ()=>modal.remove();
  foot.appendChild(cancelBtn);
  card.appendChild(foot);
  modal.appendChild(card);
  modal.onclick = (e)=>{ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
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

  document.getElementById('btnSignIn').onclick = async ()=>{ const email = document.getElementById('authEmail').value.trim(); const password = document.getElementById('authPassword').value; const {error} = await sb.auth.signInWithPassword({email, password}); if(error) document.getElementById('authError').textContent = error.message; };
  document.getElementById('btnSignOut').onclick = async ()=>{ await sb.auth.signOut(); };
  document.getElementById('btnChangePw').onclick = ()=>{ const body = el('div'); const p1 = el('input'); p1.type='password'; p1.placeholder='New password'; const p2 = el('input'); p2.type='password'; p2.placeholder='Confirm'; body.appendChild(p1); body.appendChild(p2); openModal('Change password', body, async ()=>{ if(p1.value.length<8){ alert('Min 8 chars'); return false; } if(p1.value!==p2.value){ alert('Mismatch'); return false; } const {error} = await sb.auth.updateUser({password:p1.value}); if(error){ alert(error.message); return false; } return true; }, 'Change'); };
  document.getElementById('hamburger').onclick = ()=>document.body.classList.toggle('drawer-open');
  document.getElementById('backdrop').onclick = ()=>document.body.classList.remove('drawer-open');
}

init();
