// ══════════════════════════════════════════════
// Curbside Frontend — app.js
// ══════════════════════════════════════════════
let TOKEN=null, USER=null, CURRENT_CONSULT=null;
let CURRENT_DOCS=null;
let jitsiApi=null, recognition=null, transcribing=false;
let pollTimer=null, transcriptPollTimer=null, restartTimer=null;
// Deep link: /?accept=<consultId> from SMS
const PENDING_ACCEPT = new URLSearchParams(location.search).get('accept');

function log(m){const e=document.getElementById('log');if(!e)return;e.textContent+=`[${new Date().toLocaleTimeString()}] ${m}\n`;e.scrollTop=e.scrollHeight;}

async function api(method,path,body=null){
  const o={method,headers:{'Content-Type':'application/json'}};
  if(TOKEN)o.headers['Authorization']='Bearer '+TOKEN;
  if(body)o.body=JSON.stringify(body);
  const res=await fetch('/api'+path,o);
  let data; try{data=await res.json();}catch{data={};}
  if(!res.ok)log(`✗ ${method} ${path} → ${res.status}: ${data.error||''}`);
  return {ok:res.ok,status:res.status,data};
}
function showStatus(id,msg,type){const e=document.getElementById(id);if(!e)return;e.className=`status status-${type}`;e.textContent=msg;e.classList.remove('hidden');}

// ════════ AUTH ════════
function toggleRegister(){
  const f=document.getElementById('register-fields');f.classList.toggle('hidden');
  document.getElementById('login-btn').textContent=f.classList.contains('hidden')?'Login':'Create Account';
}
async function doLogin(){
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  const reg=document.getElementById('register-fields');
  let r;
  if(!reg.classList.contains('hidden')){
    const role=document.getElementById('reg-role').value;
    r=await api('POST','/auth/register',{email,password,role,
      first_name:document.getElementById('reg-first').value.trim(),
      last_name:document.getElementById('reg-last').value.trim(),
      phone:document.getElementById('reg-phone').value.trim()||undefined,
      ahpra_number:document.getElementById('reg-ahpra').value.trim()||undefined,
      practice_name:document.getElementById('reg-practice').value.trim()||undefined,
      specialty:role==='specialist'?(document.getElementById('reg-specialty').value.trim()||undefined):undefined,
      qualifications:document.getElementById('reg-quals').value.trim()||undefined});
  }else{
    r=await api('POST','/auth/login',{email,password});
  }
  if(r.ok){TOKEN=r.data.token;USER=r.data.user;showDashboard();}
  else showStatus('auth-status',r.data.error||'Failed','err');
}
function doLogout(){
  stopTranscription();closeVideoRoom();
  clearInterval(pollTimer);clearInterval(transcriptPollTimer);
  TOKEN=null;USER=null;CURRENT_CONSULT=null;
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('auth-section').classList.remove('hidden');
}
function openSettings(){
  const p=document.getElementById('settings-panel');p.classList.remove('hidden');
  document.getElementById('set-email').value=USER.email||'';
  p.scrollIntoView({behavior:'smooth'});
}

const DASH_PANELS=['gp-panel','spec-panel','admin-panel','docs-panel','consults-card','room-section'];
function switchView(view){
  const billing=view==='billing';
  document.getElementById('billing-view').classList.toggle('hidden',!billing);
  DASH_PANELS.forEach(id=>{const e=document.getElementById(id);if(e&&!e.classList.contains('always-hidden')){
    // only hide panels relevant to this role; billing view hides everything dashboard
    if(billing)e.classList.add('view-hidden');else e.classList.remove('view-hidden');
  }});
  document.getElementById('nav-dash').className='btn-sm '+(billing?'btn-secondary':'btn-primary');
  document.getElementById('nav-bill').className='btn-sm '+(billing?'btn-primary':'btn-secondary');
  if(billing)loadBillingView();
  window.scrollTo({top:0,behavior:'smooth'});
}

async function loadBillingView(){
  const s=await api('GET','/billing/stats');
  const sum=document.getElementById('billing-view-summary');
  const note=document.getElementById('billing-view-note');
  if(s.ok){
    const d=s.data;let cells;
    if(USER.role==='gp')cells=[['MBS Billed',d.gp_billed],['Consults',d.count],['PES',d.pes_count],['Flagged',d.flagged_count]];
    else if(USER.role==='specialist')cells=[['Billed',d.specialist_billed],['Your Payout',d.specialist_payout],['Platform Fee',d.platform_fees],['Consults',d.count]];
    else cells=[['Total MBS',d.total_mbs],['Platform Fees',d.platform_fees],['PES',d.pes_count],['Flagged',d.flagged_count]];
    sum.innerHTML=cells.map(([k,v])=>`<div class="stat"><span class="stat-n">${v}</span><span class="stat-l">${k}</span></div>`).join('');
    note.textContent=`Pathways: ${Object.entries(d.by_pathway||{}).map(([k,v])=>k+' ('+v+')').join(', ')||'none yet'}. Fees are approximate — validate against MBS Online.`;
  }
  const h=await api('GET','/billing/history');
  const tbl=document.getElementById('billing-view-table');
  if(h.ok){
    const items=h.data.items||[];
    if(!items.length){tbl.innerHTML='<p class="muted">No billed consults yet. Complete a consult to generate billing.</p>';return;}
    tbl.innerHTML=`<table class="bill-table"><thead><tr><th>Ref</th><th>Patient</th><th>Specialty</th><th>GP item</th><th>GP fee</th><th>Spec item</th><th>Spec fee</th><th>Pathway</th><th>Status</th></tr></thead><tbody>`+
      items.map(it=>`<tr${(it.compliance_flags||[]).length?' style="background:rgba(239,68,68,.06)"':''}>
        <td><b>${it.ref_code}</b></td><td>${it.patient||''}</td><td>${it.specialty}</td>
        <td>${it.gp_mbs_item||'—'}</td><td>${it.gp_fee}</td>
        <td>${it.specialist_mbs_item||'—'}</td><td>${it.specialist_fee}</td>
        <td>${it.billing_pathway}${(it.compliance_flags||[]).length?' ⚠':''}</td>
        <td>${it.billing_status}</td></tr>`).join('')+`</tbody></table>`;
  }
}
function closeSettings(){document.getElementById('settings-panel').classList.add('hidden');}
function setSettingsStatus(msg,type){const e=document.getElementById('settings-status');e.className='status status-'+(type==='ok'?'ok':'err');e.textContent=msg;e.classList.remove('hidden');e.style.cssText='padding:7px 11px;border-radius:9px;font-size:13px;margin-bottom:10px;'+(type==='ok'?'background:rgba(16,185,129,.12);color:#34d399;border:1px solid rgba(16,185,129,.3)':'background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.3)');}
async function changeEmail(){
  const email=document.getElementById('set-email').value.trim();
  const r=await api('PATCH','/auth/me/email',{email});
  if(r.ok){USER=r.data.user;setSettingsStatus('Email updated.','ok');}
  else setSettingsStatus(r.data.error||'Failed','err');
}
async function changePassword(){
  const current_password=document.getElementById('set-curpw').value;
  const new_password=document.getElementById('set-newpw').value;
  const r=await api('POST','/auth/me/password',{current_password,new_password});
  if(r.ok){setSettingsStatus('Password updated.','ok');document.getElementById('set-curpw').value='';document.getElementById('set-newpw').value='';}
  else setSettingsStatus(r.data.error||'Failed','err');
}
function showTopNav(){
  ['nav-dash','nav-bill','nav-sep','nav-settings','nav-logout'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('hidden');});
  const chip=document.getElementById('user-chip');
  if(chip&&USER){chip.textContent=`Dr ${USER.first_name||''} ${USER.last_name||''} · ${USER.role}`;chip.classList.remove('hidden');}
  const nd=document.getElementById('nav-dash');if(nd)nd.className='tnav active';
}
function showDashboard(){
  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('billing-view').classList.add('hidden');
  DASH_PANELS.forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove('view-hidden');});
  document.getElementById('nav-dash').className='btn-sm btn-primary';
  document.getElementById('nav-bill').className='btn-sm btn-secondary';
  document.getElementById('welcome-msg').textContent=`${USER.role==='admin'?'':'Dr '}${USER.first_name} ${USER.last_name}`;
  const b=document.getElementById('role-badge');b.textContent=USER.role;b.className=`badge badge-${USER.role}`;
  document.getElementById('gp-panel').classList.toggle('hidden',USER.role!=='gp');
  document.getElementById('spec-panel').classList.toggle('hidden',USER.role!=='specialist');
  document.getElementById('admin-panel').classList.toggle('hidden',USER.role!=='admin');
  document.getElementById('consults-card').classList.toggle('hidden',USER.role==='admin');

  clearInterval(pollTimer);
  showTopNav();
  if(USER.role==='gp'){loadConsults();loadLiveConsults();loadStats();loadBillingHistory();pollTimer=setInterval(()=>{pollCurrentConsult();loadLiveConsults();},4000);}
  if(USER.role==='specialist'){refreshAvailabilityLabel();loadConsults();loadInbox();loadSpecLive();loadSpecPast();loadStats();loadBillingHistory();pollTimer=setInterval(()=>{loadInbox();loadSpecLive();loadSpecPast();},5000);
    if(PENDING_ACCEPT)showDeepLinkConsult(PENDING_ACCEPT);}
  if(USER.role==='admin'){loadAdminOverview();loadAdminUsers('gp');loadAdminUsers('specialist');loadAdminBilling();loadAudit();}
}

// ════════ STATS (GP + Specialist) ════════
async function loadStats(){
  const cr=await api('GET','/consults');
  const br=await api('GET','/billing/stats');
  if(!cr.ok)return;
  const cs=cr.data.consults||[];
  const total=cs.length;
  const active=cs.filter(c=>['draft','structured','broadcasting','accepted','active'].includes(c.status)).length;
  const completed=cs.filter(c=>c.status==='completed').length;
  const el=document.getElementById(USER.role==='gp'?'gp-stats':'spec-stats');
  if(!el)return;
  let cells=[['Total',total],['Active',active],['Completed',completed]];
  if(br.ok){
    if(USER.role==='gp')cells.push(['MBS Billed',br.data.gp_billed]);
    else cells.push(['Earnings',br.data.specialist_payout]);
  }
  el.classList.remove('hidden');
  el.innerHTML=cells.map(([k,v])=>`<div class="stat"><span class="stat-n">${v}</span><span class="stat-l">${k}</span></div>`).join('');
}

// ════════ BILLING HISTORY (GP + Specialist) ════════
async function loadBillingHistory(){
  const r=await api('GET','/billing/history');
  if(!r.ok)return;
  const el=document.getElementById(USER.role==='gp'?'gp-billing':'spec-billing');
  if(!el)return;
  const items=r.data.items||[];
  if(!items.length){el.innerHTML='<h2>Billing</h2><p class="muted">No billed consults yet.</p>';return;}
  const rows=items.map(it=>{
    const fee=USER.role==='gp'?it.gp_fee:it.specialist_fee;
    const item=USER.role==='gp'?it.gp_mbs_item:it.specialist_mbs_item;
    const flag=(it.compliance_flags||[]).length?` <span style="color:#f87171">⚠</span>`:'';
    const conf=USER.role==='gp'?it.gp_item_confirmed:it.specialist_item_confirmed;
    return `<div class="bill-row"><div><b>${it.ref_code}</b> · ${it.specialty} · ${it.patient||''}</div>
      <div class="muted">Item ${item||'—'} · ${fee} · ${it.billing_pathway}${flag} ${conf?'· ✓ confirmed':''}</div></div>`;
  }).join('');
  el.innerHTML=`<h2>Billing — ${items.length} consult(s)</h2>${rows}`;
}

// GP: live (accepted/active) consults pinned to top
async function loadLiveConsults(){
  if(USER.role!=='gp')return;
  const r=await api('GET','/consults');
  if(!r.ok)return;
  const live=(r.data.consults||[]).filter(c=>['accepted','active'].includes(c.status));
  const el=document.getElementById('gp-live');
  if(!live.length){el.classList.add('hidden');el.innerHTML='';return;}
  el.classList.remove('hidden');
  el.innerHTML=`<h2>🟢 Live Consults</h2>`+live.map(c=>`
    <div class="live-row">
      <div><b>${c.ref_code}</b> · ${c.specialty} · ${patientLabel(c)} · <span class="pill pill-ok">${c.status}</span></div>
      <div class="btn-row" style="margin:0">
        <button class="btn-primary btn-sm" onclick='joinLive(${JSON.stringify(c).replace(/'/g,"&#39;")})'>🎥 ${c.status==='active'?'Re-join':'Join'} Call</button>
        ${c.status==='active'?`<button class="btn-danger btn-sm" onclick="completeConsult(${c.id})">✓ Complete</button>`:''}
      </div>
    </div>`).join('');
}
async function joinLive(c){
  CURRENT_CONSULT=c;
  if(c.status==='accepted')await api('POST',`/consults/${c.id}/start`);
  const r=await api('GET',`/consults/${c.id}`);if(r.ok)CURRENT_CONSULT=r.data.consult;
  openVideoRoom(CURRENT_CONSULT,`${USER.first_name} ${USER.last_name} (GP)`);
}

// Specialist: open a consult arrived via SMS deep link
async function showDeepLinkConsult(id){
  const r=await api('GET',`/consults/${id}`);
  if(!r.ok){log('Deep-link consult not found.');return;}
  CURRENT_CONSULT=r.data.consult;
  const c=CURRENT_CONSULT;
  const el=document.getElementById('spec-consult-actions');el.classList.remove('hidden');
  let btns='';
  if(c.status==='broadcasting')btns=`<button class="btn-primary" onclick="acceptConsult(${c.id})">✓ Accept this consult</button>`;
  else if(c.status==='accepted'||c.status==='active')btns=`<button class="btn-primary" onclick="startCallAsSpecialist()">🎥 Join Video</button>`;
  else btns=`<span class="muted">This consult is ${c.status}.</span>`;
  el.innerHTML=`<h2>📩 Consult from SMS: ${c.ref_code}</h2><div class="meta">${c.specialty} · ${c.patient_initials} (${c.patient_age||''}${c.patient_sex||''}) · ${c.urgency}</div><div class="ai-box">${(c.case_summary||'').slice(0,200)}</div><div class="btn-row">${btns}</div>`;
  el.scrollIntoView({behavior:'smooth'});
  log(`Opened consult ${c.ref_code} from SMS deep link.`);
}

// ════════ GP ════════
let EDIT_ID=null;
let PENDING_ATTACHMENTS=[];
const MAX_FILE_BYTES=2*1024*1024; // 2MB per file
function onFilesSelected(){
  const input=document.getElementById('c-files');
  const files=Array.from(input.files||[]);
  PENDING_ATTACHMENTS=[];
  const listEl=document.getElementById('c-files-list');
  listEl.innerHTML='Reading…';
  let pending=files.length;
  if(!pending){listEl.innerHTML='';return;}
  files.forEach(f=>{
    if(f.size>MAX_FILE_BYTES){PENDING_ATTACHMENTS.push({name:f.name,type:f.type,size:f.size,data:null,note:'too large to embed (>2MB)'});if(--pending===0)renderAttachList();return;}
    const reader=new FileReader();
    reader.onload=()=>{PENDING_ATTACHMENTS.push({name:f.name,type:f.type,size:f.size,data:reader.result});if(--pending===0)renderAttachList();};
    reader.onerror=()=>{if(--pending===0)renderAttachList();};
    reader.readAsDataURL(f);
  });
}
function renderAttachList(){
  const listEl=document.getElementById('c-files-list');
  listEl.innerHTML=PENDING_ATTACHMENTS.map((a,i)=>`📎 ${a.name} (${Math.round(a.size/1024)}KB)${a.note?' — '+a.note:''} <a href="#" onclick="removeAttach(${i});return false" style="color:#f87171">remove</a>`).join('<br>');
}
function removeAttach(i){PENDING_ATTACHMENTS.splice(i,1);renderAttachList();}

function onBookingChange(){
  document.getElementById('c-sched-wrap').classList.toggle('hidden',document.getElementById('c-booking').value!=='scheduled');
}
function consultFormPayload(){
  return {
    specialty:document.getElementById('c-specialty').value,
    urgency:(document.getElementById('c-booking').value==='on_call'?'soon':'routine'),
    booking_type:document.getElementById('c-booking').value,
    scheduled_at:document.getElementById('c-booking').value==='scheduled'?document.getElementById('c-scheduled').value:null,
    patient_first_name:document.getElementById('c-first').value.trim(),
    patient_last_name:document.getElementById('c-last').value.trim(),
    patient_medicare:document.getElementById('c-medicare').value.trim(),
    patient_irn:document.getElementById('c-irn').value.trim(),
    patient_dob:document.getElementById('c-dob').value,
    patient_sex:document.getElementById('c-sex').value,
    case_summary:document.getElementById('c-summary').value,
    attachments:PENDING_ATTACHMENTS
  };
}
async function submitConsult(){
  const p=consultFormPayload();
  if(EDIT_ID){
    const r=await api('PATCH',`/consults/${EDIT_ID}`,p);
    if(r.ok){log('Consult updated.');CURRENT_CONSULT=r.data.consult;cancelEdit();renderConsultActions();loadConsults();}
    else showBanner(r.data.error||'Update failed','err');
  }else{
    const r=await api('POST','/consults',p);
    if(r.ok){CURRENT_CONSULT=r.data.consult;renderConsultActions();loadConsults();log('Consult created: '+r.data.consult.ref_code);
      PENDING_ATTACHMENTS=[];document.getElementById('c-files').value='';document.getElementById('c-files-list').innerHTML='';}
    else showBanner(r.data.error||'Create failed','err');
  }
}
function editConsult(c){
  EDIT_ID=c.id;
  document.getElementById('consult-form-title').textContent='Edit Consult '+c.ref_code;
  document.getElementById('consult-submit').textContent='Save Changes';
  document.getElementById('consult-cancel-edit').classList.remove('hidden');
  document.getElementById('c-specialty').value=c.specialty;
  document.getElementById('c-booking').value=c.booking_type||'on_call';onBookingChange();
  if(c.scheduled_at)document.getElementById('c-scheduled').value=c.scheduled_at.slice(0,16);
  document.getElementById('c-first').value=c.patient_first_name||'';
  document.getElementById('c-last').value=c.patient_last_name||'';
  document.getElementById('c-medicare').value=c.patient_medicare||'';
  document.getElementById('c-irn').value=c.patient_irn||'';
  document.getElementById('c-dob').value=c.patient_dob||'';
  document.getElementById('c-sex').value=c.patient_sex||'F';
  document.getElementById('c-summary').value=c.case_summary||'';
  window.scrollTo({top:0,behavior:'smooth'});
}
function cancelEdit(){
  EDIT_ID=null;
  document.getElementById('consult-form-title').textContent='New Consult Request';
  document.getElementById('consult-submit').textContent='Create Consult';
  document.getElementById('consult-cancel-edit').classList.add('hidden');
}
async function deleteConsult(id){
  if(!confirm('Delete this consult? This cannot be undone.'))return;
  const r=await api('DELETE',`/consults/${id}`);
  if(r.ok){log('Consult deleted.');if(CURRENT_CONSULT&&CURRENT_CONSULT.id===id){CURRENT_CONSULT=null;document.getElementById('consult-actions').classList.add('hidden');}loadConsults();loadLiveConsults();}
  else showBanner(r.data.error||'Delete failed','err');
}
async function structureConsult(){
  if(!CURRENT_CONSULT)return;
  const r=await api('POST',`/consults/${CURRENT_CONSULT.id}/structure`);
  if(r.ok){CURRENT_CONSULT.status='structured';CURRENT_CONSULT.ai_structured_summary=JSON.stringify(r.data.structured);renderConsultActions();}
}
async function broadcastConsult(){
  if(!CURRENT_CONSULT)return;
  const r=await api('POST',`/consults/${CURRENT_CONSULT.id}/broadcast`);
  if(r.ok){
    CURRENT_CONSULT.status='broadcasting';renderConsultActions();
    log(r.data.message);
    showBanner(r.data.message, r.data.online_count>0?'ok':'wait');
  }else{
    log('Broadcast failed: '+(r.data.error||'unknown'));
    showBanner(r.data.error||'Broadcast failed','err');
  }
}
function showBanner(msg,type){
  const el=document.getElementById('gp-banner');
  if(!el)return;
  el.className='banner banner-'+type;
  el.textContent=msg;
  el.classList.remove('hidden');
  setTimeout(()=>{el.classList.add('hidden');}, 8000);
}
async function pollCurrentConsult(){
  if(!CURRENT_CONSULT||USER.role!=='gp')return;
  if(!['broadcasting','accepted','active'].includes(CURRENT_CONSULT.status))return;
  const r=await api('GET',`/consults/${CURRENT_CONSULT.id}`);
  if(!r.ok)return;
  const f=r.data.consult;
  if(f.status!==CURRENT_CONSULT.status){CURRENT_CONSULT=f;renderConsultActions();loadConsults();}
}
function patientLabel(c){
  const name=(c.patient_first_name||c.patient_last_name)?`${c.patient_first_name||''} ${c.patient_last_name||''}`.trim():c.patient_initials||'Patient';
  const dob=c.patient_dob?` · DOB ${c.patient_dob}`:'';
  const mc=c.patient_medicare?` · MC ${c.patient_medicare}${c.patient_irn?'/'+c.patient_irn:''}`:'';
  return `${name} (${c.patient_age||''}${c.patient_sex||''})${dob}${mc}`;
}
function renderConsultActions(){
  const el=document.getElementById('consult-actions');el.classList.remove('hidden');
  const c=CURRENT_CONSULT;let btns='';
  const editable=['draft','structured','broadcasting','accepted'].includes(c.status);
  if(c.status==='draft')btns=`<button class="btn-secondary" onclick="structureConsult()">1 · AI Structure</button><button class="btn-primary" onclick="broadcastConsult()">2 · Broadcast</button>`;
  else if(c.status==='structured')btns=`<button class="btn-primary" onclick="broadcastConsult()">Broadcast to Specialists</button>`;
  else if(c.status==='broadcasting')btns=`<span class="pill pill-wait">⏳ Waiting for a specialist to accept…</span>`;
  else if(c.status==='accepted')btns=`<button class="btn-primary" onclick="joinCallAsGP()">🎥 Join Video Call</button>`;
  else if(c.status==='active')btns=`<button class="btn-primary" onclick="joinCallAsGP()">🎥 Re-join Video</button><button class="btn-danger" onclick="completeConsult(${c.id})">✓ Complete Consult</button>`;
  else if(c.status==='completed')btns=`<span class="pill pill-ok">✓ Completed</span><button class="btn-secondary btn-sm" onclick="viewConsultDocs(${c.id})">View Documents</button>`;
  // Edit/Delete only for non-past consults
  let manage='';
  if(editable)manage=`<button class="btn-secondary btn-sm" onclick='editConsult(${JSON.stringify(c).replace(/'/g,"&#39;")})'>✎ Edit</button><button class="btn-secondary btn-sm" onclick="deleteConsult(${c.id})">🗑 Delete</button>`;
  let ai='';
  if(c.ai_structured_summary){try{const s=JSON.parse(c.ai_structured_summary);ai=`<div class="ai-box"><b>AI summary:</b> ${s.presenting||''}<br><b>Differential:</b> ${(s.differential||[]).join(', ')}<br><b>Red flags:</b> ${s.red_flags||'None'}</div>`;}catch{}}
  const booking=c.booking_type==='scheduled'?`📅 Scheduled ${c.scheduled_at||''}`:'⚡ On-call';
  el.innerHTML=`<h2>${c.ref_code}</h2><div class="meta">${c.specialty} · ${booking} · ${patientLabel(c)} · <b>${c.status}</b></div>${ai}${attachmentsHtml(c)}<div class="btn-row">${btns}</div>${manage?`<div class="btn-row" style="margin-top:6px">${manage}</div>`:''}`;
}
async function joinCallAsGP(){
  if(!CURRENT_CONSULT)return;
  if(CURRENT_CONSULT.status==='accepted'){await api('POST',`/consults/${CURRENT_CONSULT.id}/start`);}
  const r=await api('GET',`/consults/${CURRENT_CONSULT.id}`);if(r.ok)CURRENT_CONSULT=r.data.consult;
  openVideoRoom(CURRENT_CONSULT,`${USER.first_name} ${USER.last_name} (GP)`);
}

// ════════ SPECIALIST ════════
async function refreshAvailabilityLabel(){
  const r=await api('GET','/specialists/me/stats');
  if(r.ok){const btn=document.getElementById('avail-btn');
    btn.textContent=r.data.is_available?'🟢 Available — click to go offline':'⚪ Offline — click to go available';
    btn.className=r.data.is_available?'btn-primary':'btn-secondary';
    const dd=document.getElementById('avail-dot');
    if(dd){dd.className='dot '+(r.data.is_available?'dot-on':'dot-off');}}
}
async function toggleAvailability(){const r=await api('POST','/specialists/toggle');if(r.ok){log(`Availability: ${r.data.is_available?'ONLINE':'OFFLINE'}`);refreshAvailabilityLabel();loadInbox();}}

// Specialist: live (accepted/active) consults assigned to me, pinned to top
async function loadSpecLive(){
  if(USER.role!=='specialist')return;
  const r=await api('GET','/consults');
  if(!r.ok)return;
  const live=(r.data.consults||[]).filter(c=>c.specialist_id===USER.id && ['accepted','active'].includes(c.status));
  const el=document.getElementById('spec-live');
  if(!live.length){el.classList.add('hidden');el.innerHTML='';return;}
  el.classList.remove('hidden');
  el.innerHTML=`<h2>🟢 Live Consults</h2>`+live.map(c=>`
    <div class="live-row">
      <div><b>${c.ref_code}</b> · ${c.specialty} · ${c.patient_initials} (${c.patient_age||''}${c.patient_sex||''}) · <span class="pill pill-ok">${c.status}</span></div>
      <div class="btn-row" style="margin:0">
        <button class="btn-primary btn-sm" onclick='joinSpecLive(${JSON.stringify(c).replace(/'/g,"&#39;")})'>🎥 ${c.status==='active'?'Re-join':'Join'} Call</button>
        ${c.status==='active'?`<button class="btn-danger btn-sm" onclick="completeConsult(${c.id})">✓ Complete</button>`:''}
      </div>
    </div>`).join('');
}
async function joinSpecLive(c){
  CURRENT_CONSULT=c;
  if(c.status==='accepted')await api('POST',`/consults/${c.id}/start`);
  const r=await api('GET',`/consults/${c.id}`);if(r.ok)CURRENT_CONSULT=r.data.consult;
  openVideoRoom(CURRENT_CONSULT,`${USER.first_name} ${USER.last_name} (Specialist)`);
}
function consultRow(c,{showAccept=true}={}){
  const att=c.attachment_count?` · 📎 ${c.attachment_count}`:'';
  return `<div class="inbox-item"><div><b>${c.ref_code}</b> · ${c.specialty} · <span class="badge badge-${c.urgency}">${c.urgency}</span>${att}</div>`+
    `<div class="meta">${c.patient_initials} (${c.patient_age||''}${c.patient_sex||''})</div>`+
    `<div class="muted">${(c.case_summary||'').slice(0,120)}…</div>`+
    `<div class="btn-row">`+
    (showAccept?`<button class="btn-primary btn-sm" onclick="acceptConsult(${c.id})">Accept</button><button class="btn-secondary btn-sm" onclick="declineConsult(${c.id})">Decline</button>`:'')+
    `<button class="btn-secondary btn-sm" onclick="openSpecConsult(${c.id})">View</button></div></div>`;
}
async function loadInbox(){
  const inboxEl=document.getElementById('spec-inbox');
  const r=await api('GET','/consults/incoming');
  if(!r.ok){if(inboxEl)inboxEl.innerHTML='<p class="muted">Could not load.</p>';return;}
  if(!r.data.available){
    inboxEl.innerHTML='<p class="muted">⚪ You\'re offline — toggle <b>Available</b> above to see incoming consults.</p>';return;
  }
  const all=[...(r.data.mine||[]),...(r.data.others||[])].sort((a,b)=>new Date(b.broadcast_at||b.created_at)-new Date(a.broadcast_at||a.created_at));
  inboxEl.innerHTML=all.length?all.map(c=>consultRow(c)).join(''):'<p class="muted">No incoming consults right now.</p>';
}
async function loadSpecPast(){
  const el=document.getElementById('spec-past');if(!el)return;
  const r=await api('GET','/consults/past');if(!r.ok)return;
  const completed=r.data.completed||[],declined=r.data.declined||[];
  let html='';
  if(completed.length)html+=completed.map(c=>`<div class="inbox-item"><div><b>${c.ref_code}</b> · ${c.specialty} · <span class="pill pill-ok">${c.status}</span></div><div class="meta">${c.patient_initials} (${c.patient_age||''}${c.patient_sex||''})</div><div class="btn-row"><button class="btn-secondary btn-sm" onclick="openSpecConsult(${c.id})">View</button>${c.status==='completed'?`<button class="btn-secondary btn-sm" onclick="viewConsultDocs(${c.id})">Documents</button>`:''}</div></div>`).join('');
  if(declined.length)html+=declined.map(c=>`<div class="inbox-item" style="opacity:.7"><div><b>${c.ref_code}</b> · ${c.specialty} · <span class="badge">declined by you</span></div><div class="meta">${c.patient_initials} (${c.patient_age||''}${c.patient_sex||''})</div><div class="btn-row"><button class="btn-secondary btn-sm" onclick="openSpecConsult(${c.id})">View</button></div></div>`).join('');
  el.innerHTML=html||'<p class="muted">No past cases yet.</p>';
}
// Open a consult (fetch full detail incl. attachments) into the action panel
async function openSpecConsult(id){
  const r=await api('GET',`/consults/${id}`);if(!r.ok)return;
  CURRENT_CONSULT=r.data.consult;CURRENT_DOCS=r.data;renderSpecActions();
  document.getElementById('spec-consult-actions').scrollIntoView({behavior:'smooth'});
}
async function acceptConsult(id){
  const r=await api('POST',`/consults/${id}/accept`);
  if(r.ok){log(`Accepted ${r.data.consult_ref}.`);
    const cr=await api('GET',`/consults/${id}`);if(cr.ok){CURRENT_CONSULT=cr.data.consult;CURRENT_DOCS=cr.data;renderSpecActions();}
    loadInbox();loadSpecLive();loadConsults();}
  else log(r.data.error||'Could not accept (maybe already taken).');
}
async function declineConsult(id){await api('POST',`/consults/${id}/decline`);loadInbox();loadSpecPast();}
function attachmentsHtml(consult){
  let atts=[];try{atts=JSON.parse(consult.attachments||'[]');}catch{atts=consult.attachments||[];}
  if(!atts||!atts.length)return '';
  return `<div style="margin-top:10px"><b style="font-size:13px">Attachments</b><div class="btn-row" style="flex-wrap:wrap;margin-top:6px">`+
    atts.map((a,i)=>{
      const data=a.data?`data:${a.type||'application/octet-stream'};base64,${a.data}`:null;
      const kb=a.size?` (${Math.round(a.size/1024)} KB)`:'';
      return data?`<a class="btn-secondary btn-sm" href="${data}" download="${a.name||'attachment-'+i}" target="_blank">📎 ${a.name||'file'}${kb}</a>`
                 :`<span class="btn-secondary btn-sm">📎 ${a.name||'file'}${kb}</span>`;
    }).join('')+`</div></div>`;
}
function renderSpecActions(){
  const el=document.getElementById('spec-consult-actions');if(!el)return;el.classList.remove('hidden');
  const c=CURRENT_CONSULT;let btns='';
  if(c.status==='broadcasting')btns=`<button class="btn-primary" onclick="acceptConsult(${c.id})">Accept this consult</button><button class="btn-secondary" onclick="declineConsult(${c.id})">Decline</button>`;
  else if(c.status==='accepted')btns=`<button class="btn-primary" onclick="startCallAsSpecialist()">▶ Start Consult (open video)</button>`;
  else if(c.status==='active')btns=`<button class="btn-primary" onclick="startCallAsSpecialist()">🎥 Re-join Video</button><button class="btn-danger" onclick="completeConsult(${c.id})">✓ Complete Consult</button>`;
  else if(c.status==='completed')btns=`<span class="pill pill-ok">✓ Completed</span><button class="btn-secondary btn-sm" onclick="viewConsultDocs(${c.id})">View Documents</button>`;
  el.innerHTML=`<h2>Case: ${c.ref_code}</h2><div class="meta">${c.specialty} · ${c.patient_initials} (${c.patient_age||''}${c.patient_sex||''}) · <b>${c.status}</b></div><div class="muted" style="margin-top:6px">${(c.case_summary||'')}</div>${attachmentsHtml(c)}<div class="btn-row" style="margin-top:10px">${btns}</div>`;
}
async function startCallAsSpecialist(){
  if(!CURRENT_CONSULT)return;
  if(CURRENT_CONSULT.status==='accepted'){const r=await api('POST',`/consults/${CURRENT_CONSULT.id}/start`);if(r.ok)CURRENT_CONSULT.status='active';}
  const r=await api('GET',`/consults/${CURRENT_CONSULT.id}`);if(r.ok)CURRENT_CONSULT=r.data.consult;
  openVideoRoom(CURRENT_CONSULT,`${USER.first_name} ${USER.last_name} (Specialist)`);renderSpecActions();
}

// ════════ VIDEO + SCRIBE ════════
function openVideoRoom(consult,displayName){
  if(!consult.video_room_id){log('No video room.');return;}
  const section=document.getElementById('room-section');section.classList.remove('hidden');
  document.getElementById('room-title').textContent=`Live Consult — ${consult.ref_code} · ${consult.patient_initials}`;
  closeVideoRoom();
  const domain=(consult.video_room_url||'').includes('://')?consult.video_room_url.split('/')[2]:'meet.jit.si';
  try{
    jitsiApi=new JitsiMeetExternalAPI(domain,{roomName:consult.video_room_id,width:'100%',height:480,
      parentNode:document.getElementById('jitsi-container'),userInfo:{displayName},
      configOverwrite:{prejoinPageEnabled:false},interfaceConfigOverwrite:{MOBILE_APP_PROMO:false}});
    log(`Joined video room: ${consult.video_room_id}`);
  }catch(e){log('Jitsi embed failed; opening new tab.');window.open(consult.video_room_url,'_blank');}

  // SCRIBE ↔ MUTE BINDING: the Web Speech recogniser only runs while THIS participant
  // is unmuted, so a muted session never transcribes the other person's voice bleeding
  // from its speakers. Each session labels its own speech with its own identity, so
  // attribution stays correct (GP vs Specialist) and never alternates from one mic.
  if(jitsiApi){
    jitsiApi.addListener('audioMuteStatusChanged',(e)=>{
      if(e && e.muted){
        stopTranscription();
        const st=document.getElementById('transcript-status'); if(st)st.textContent='🔇 Muted — not scribing.';
        const it=document.getElementById('interim-text'); if(it)it.textContent='';
      } else {
        startTranscription(consult.id,displayName);
      }
    });
    // Start in the correct state based on whether we join muted or not.
    Promise.resolve(jitsiApi.isAudioMuted?jitsiApi.isAudioMuted():false)
      .then(muted=>{ if(!muted) startTranscription(consult.id,displayName); })
      .catch(()=>startTranscription(consult.id,displayName));
  } else {
    // No Jitsi (fallback tab) — run scribe directly.
    startTranscription(consult.id,displayName);
  }
  clearInterval(transcriptPollTimer);
  transcriptPollTimer=setInterval(()=>refreshTranscript(consult.id),2500);
  refreshTranscript(consult.id);
  section.scrollIntoView({behavior:'smooth'});
}
function closeVideoRoom(){if(jitsiApi){try{jitsiApi.dispose();}catch{}jitsiApi=null;}const c=document.getElementById('jitsi-container');if(c)c.innerHTML='';}

// Robust Web Speech scribing: explicit mic permission, retry, error recovery
async function startTranscription(consultId,speakerName){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const statusEl=document.getElementById('transcript-status');
  if(!SR){statusEl.textContent='Scribe needs Chrome. Use manual notes below.';log('⚠️ Web Speech API not available (use Chrome).');return;}

  // Explicitly request mic so the recognizer reliably gets a stream (helps 2nd user)
  try{ await navigator.mediaDevices.getUserMedia({audio:true}); }catch(e){ log('Mic permission needed for scribing.'); }

  stopTranscription(); // clear any prior instance
  recognition=new SR();
  recognition.continuous=true;recognition.interimResults=true;recognition.lang='en-AU';
  recognition.onresult=(ev)=>{
    let interim='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const t=ev.results[i][0].transcript;
      if(ev.results[i].isFinal){const c=t.trim();if(c)postTranscriptChunk(consultId,speakerName,c);}
      else interim+=t;
    }
    document.getElementById('interim-text').textContent=interim;
  };
  recognition.onerror=(e)=>{
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){statusEl.textContent='Mic blocked — allow mic & rejoin.';log('Scribe: mic permission denied.');transcribing=false;return;}
    if(e.error!=='no-speech'&&e.error!=='aborted')log(`Scribe: ${e.error} (will retry)`);
  };
  recognition.onend=()=>{
    if(transcribing){clearTimeout(restartTimer);restartTimer=setTimeout(()=>{try{recognition.start();}catch{}},400);}
  };
  try{recognition.start();transcribing=true;statusEl.textContent='🎙️ Scribing your mic…';log('Live scribing started.');}
  catch(e){log('Scribe start error: '+e.message);}
}
function stopTranscription(){transcribing=false;clearTimeout(restartTimer);if(recognition){try{recognition.onend=null;recognition.stop();}catch{}recognition=null;}}
async function postTranscriptChunk(id,speaker,text){await api('POST',`/consults/${id}/transcript`,{speaker,text});}
async function addManualLine(){
  if(!CURRENT_CONSULT)return;
  const inp=document.getElementById('manual-line');const text=inp.value.trim();if(!text)return;
  await postTranscriptChunk(CURRENT_CONSULT.id,`${USER.first_name} ${USER.last_name} (${USER.role})`,text);
  inp.value='';refreshTranscript(CURRENT_CONSULT.id);
}
async function refreshTranscript(id){
  const r=await api('GET',`/consults/${id}`);if(!r.ok)return;
  const t=r.data.consult.transcript||'';
  const box=document.getElementById('transcript-box');
  box.innerHTML=t.split('\n').filter(Boolean).map(line=>{
    const i=line.indexOf(':');const sp=i>-1?line.slice(0,i):'';const tx=i>-1?line.slice(i+1):line;
    const isSpec=/specialist/i.test(sp);
    return `<div class="t-line ${isSpec?'t-spec':'t-gp'}"><span class="t-sp">${sp}</span>${tx}</div>`;
  }).join('');
  box.scrollTop=box.scrollHeight;
}
// Leave the video but KEEP the consult open — transcript is already saved server-side,
// so either party can re-join later, or complete it. Does NOT generate documents.
function leaveVideoRoom(){
  stopTranscription();clearInterval(transcriptPollTimer);
  closeVideoRoom();
  const rs=document.getElementById('room-section');if(rs)rs.classList.add('hidden');
  log('Left video — consult still open, transcript saved. You can re-join or complete it.');
  if(CURRENT_CONSULT){ if(USER.role==='gp')renderConsultActions(); else renderSpecActions(); }
  loadConsults(); if(USER.role==='specialist')loadSpecLive();
}

// Complete the consult (either party) → generates SOAP + documents from the SAVED transcript.
async function completeConsult(id){
  if(!confirm('Complete this consult? This finalises it and generates the SOAP note and documents from everything transcribed so far.'))return;
  stopTranscription();clearInterval(transcriptPollTimer);
  const location_type=(document.getElementById('room-location')||{}).value||'in_rooms';
  const r=await api('POST',`/consults/${id}/end`,{location_type,consult_mode:'video'});
  closeVideoRoom();const rs=document.getElementById('room-section');if(rs)rs.classList.add('hidden');
  if(r.ok){
    log('Consult completed. Documents generated.');
    if(r.data.billing){const b=r.data.billing;log(`Billing: ${b.pathway||b.billing_pathway} · GP ${b.gp_mbs_item||'—'} ${b.gp_fee||''} · Spec ${b.specialist_mbs_item||'—'} ${b.specialist_fee||''}`);}
    if(CURRENT_CONSULT&&CURRENT_CONSULT.id===id)CURRENT_CONSULT.status='completed';
    if(USER.role==='gp')renderConsultActions();else renderSpecActions();
    viewConsultDocs(id);loadConsults();if(USER.role==='specialist')loadSpecLive();
  } else log(r.data.error||'Could not complete consult.');
}
async function endConsultFromRoom(){
  if(!CURRENT_CONSULT)return;
  completeConsult(CURRENT_CONSULT.id);
}
async function viewConsultDocs(id){
  const r=await api('GET',`/consults/${id}`);if(!r.ok)return;
  const docs=r.data.documents||[];const p=document.getElementById('docs-panel');p.classList.remove('hidden');
  // Billing card
  let billingHtml='';
  const br=await api('GET',`/billing/${id}`);
  if(br.ok){
    const b=br.data.billing;
    const flags=(b.compliance_flags||[]).length?`<div style="color:#f87171;font-size:12px;margin-top:4px">⚠ ${b.compliance_flags.join(', ')}</div>`:'';
    const eligible=b.billing_pathway==='PES';
    const claimLine=(b.gp_claim_id||b.specialist_claim_id)
      ? `<br><b>Medicare claims:</b> GP ${b.gp_claim_status||'—'}${b.specialist_claim_id?` · Spec ${b.specialist_claim_status||'—'}`:''}`
      : '';
    let claimBtns='';
    if(eligible){
      claimBtns=`<button class="btn-secondary btn-sm" onclick="confirmBilling(${id})">Confirm my item</button>`;
      if(b.gp_claim_id||b.specialist_claim_id){
        claimBtns+=`<button class="btn-secondary btn-sm" onclick="refreshClaim(${id})">↻ Refresh claim status</button>`;
      }else{
        claimBtns+=`<button class="btn-primary btn-sm" onclick="submitClaim(${id})">Submit to Medicare (bulk-bill)</button>`;
      }
    }
    billingHtml=`<div class="doc" style="border-color:rgba(245,158,11,.4)">
      <div class="doc-type" style="color:#fbbf24">MBS Billing — ${b.billing_pathway}</div>
      <div style="font-size:13px;line-height:1.7">
        <b>GP item:</b> ${b.gp_mbs_item||'—'} (${b.gp_fee})<br>
        <b>Specialist item:</b> ${b.specialist_mbs_item||'—'} (${b.specialist_fee})<br>
        <b>Decision:</b> ${b.decision_rule_applied}<br>
        <b>Face-to-face:</b> ${Math.round((b.duration_patient_face_seconds||0)/60)} min · ${b.location_type}<br>
        <b>Status:</b> ${b.billing_status} ${b.gp_item_confirmed?'· GP ✓':''} ${b.specialist_item_confirmed?'· Spec ✓':''}${claimLine}
        ${flags}
      </div>
      <div class="btn-row">${claimBtns}</div>
    </div>`;
  }
  // Attachments (viewable/downloadable after the consult)
  let attachHtml='';
  try{
    const atts=JSON.parse(r.data.consult.attachments||'[]');
    if(atts.length){
      attachHtml=`<h2 style="font-size:13px;margin-top:12px">Attachments</h2>`+atts.map(a=>{
        const uri=a.data?`data:${a.type||'application/octet-stream'};base64,${a.data}`:null;
        const kb=Math.round((a.size||0)/1024);
        return uri
          ?`<div class="doc" style="display:flex;justify-content:space-between;align-items:center"><span>📎 ${a.name} <span class="muted">(${kb}KB)</span></span><span class="btn-row" style="margin:0"><a class="btn-secondary btn-sm" href="${uri}" target="_blank" rel="noopener">View</a><a class="btn-secondary btn-sm" href="${uri}" download="${a.name}">Download</a></span></div>`
          :`<div class="doc muted">📎 ${a.name} — ${a.note||'unavailable'}</div>`;
      }).join('');
    }
  }catch{}
  // Docs as collapsible accordions
  const docsHtml=docs.map((d,i)=>{
    let c=d.content;
    if(d.doc_type==='soap_note'){try{const s=JSON.parse(d.content);c=`SUBJECTIVE\n${s.subjective||'—'}\n\nOBJECTIVE\n${s.objective||'—'}\n\nASSESSMENT\n${s.assessment||'—'}\n\nPLAN\n${(s.plan&&s.plan.length?s.plan:['—']).join('\n')}\n\nFOLLOW-UP\n${s.follow_up||'—'}`+(s.safety_netting?`\n\nSAFETY-NETTING\n${s.safety_netting}`:'')+(s.mbs_item_recommendation?`\n\nMBS\n${s.mbs_item_recommendation}`:'');}catch{}}
    const safe=c.replace(/`/g,'\\`').replace(/\$/g,'\\$');
    const did=`doc-${id}-${i}`;
    window.__docs=window.__docs||{};window.__docs[did]={name:d.doc_type,content:c};
    return `<details class="doc-acc"${i===0?' open':''}><summary>${d.doc_type.replace(/_/g,' ')}</summary>
      <pre id="${did}">${c}</pre>
      <div class="btn-row"><button class="btn-secondary btn-sm" onclick="copyDoc('${did}')">Copy</button><button class="btn-secondary btn-sm" onclick="downloadDoc('${did}')">Download .txt</button></div>
    </details>`;
  }).join('');
  p.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Case ${r.data.consult.ref_code}</h2><button class="btn-secondary btn-sm" onclick="document.getElementById('docs-panel').classList.add('hidden')">Close</button></div>`
  +billingHtml+attachHtml
  +`<h2 style="font-size:13px;margin-top:12px">Generated Documents</h2>`+(docsHtml||'<p class="muted">No documents.</p>')
  +`<h2 style="font-size:13px;margin-top:12px">Notes</h2>`
  +((r.data.notes||[]).length?(r.data.notes||[]).map(n=>`<div class="doc"><div class="doc-type">${n.note_type} note</div><pre>${n.content}</pre></div>`).join(''):'<p class="muted">No notes yet.</p>')
  +`<div class="note-input"><input id="note-${id}" placeholder="Add a clinical note…"><button class="btn-secondary btn-sm" onclick="addNote(${id},'note-${id}')">Add Note</button></div>`;
  p.scrollIntoView({behavior:'smooth'});
}
function copyDoc(did){const el=document.getElementById(did);if(el){navigator.clipboard.writeText(el.textContent);log('Copied to clipboard.');}}
function downloadDoc(did){const d=(window.__docs||{})[did];if(!d)return;const blob=new Blob([d.content],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=d.name+'.txt';a.click();}
async function confirmBilling(id){
  const r=await api('POST',`/billing/${id}/confirm`);
  if(r.ok){log('Billing item confirmed.');viewConsultDocs(id);}
}
async function submitClaim(id){
  if(!confirm('Submit Medicare claims (bulk-bill) for this consult?'))return;
  const r=await api('POST',`/billing/${id}/submit`,{bulk_bill:true});
  if(r.ok){log('Claims submitted: '+JSON.stringify(r.data.results||{}));if((r.data.warnings||[]).length)showBanner(r.data.warnings.join('; '),'wait');viewConsultDocs(id);}
  else showBanner(r.data.error||'Submit failed','err');
}
async function refreshClaim(id){
  const r=await api('POST',`/billing/${id}/refresh-status`);
  if(r.ok){log('Claim status: '+JSON.stringify(r.data.statuses||{}));viewConsultDocs(id);}
}

// ════════ SHARED CONSULT LISTS (active vs past) ════════
async function loadConsults(){
  const r=await api('GET','/consults');if(!r.ok)return;
  const cs=r.data.consults||[];
  const active=cs.filter(c=>['draft','structured','broadcasting','accepted','active'].includes(c.status));
  const past=cs.filter(c=>['completed','cancelled','expired'].includes(c.status));
  renderList('active-list',active,'No active consults.');
  renderList('past-list',past,'No past consults.');
}
function renderList(elId,items,empty){
  const el=document.getElementById(elId);if(!el)return;
  if(!items.length){el.innerHTML=`<p class="muted">${empty}</p>`;return;}
  el.innerHTML=items.slice(0,20).map(c=>{
    const nm=(c.patient_first_name||c.patient_last_name)?`${c.patient_first_name||''} ${c.patient_last_name||''}`.trim():c.patient_initials||'';
    return `<div class="consult-row" onclick='selectConsult(${JSON.stringify(c).replace(/'/g,"&#39;")})'><b>${c.ref_code}</b> · ${c.specialty} · <span class="muted">${c.status}</span> · ${nm}</div>`;
  }).join('');
}
async function selectConsult(c){
  const r=await api('GET',`/consults/${c.id}`);
  CURRENT_CONSULT=(r.ok&&r.data.consult)?r.data.consult:c;CURRENT_DOCS=r.ok?r.data:null;
  if(USER.role==='gp')renderConsultActions();if(USER.role==='specialist')renderSpecActions();
  if(['completed'].includes(CURRENT_CONSULT.status))viewConsultDocs(CURRENT_CONSULT.id);
}

// ════════ ADMIN ════════
async function loadAdminOverview(){
  const r=await api('GET','/admin/overview');if(!r.ok)return;const d=r.data;
  document.getElementById('admin-stats').innerHTML=
    [['GPs',d.gps],['Specialists',d.specialists],['Online',d.specialists_online],['Active consults',d.active_consults],['Completed',d.completed_consults],['Total',d.total_consults]]
    .map(([k,v])=>`<div class="stat"><span class="stat-n">${v}</span><span class="stat-l">${k}</span></div>`).join('');
}
async function loadAdminUsers(role){
  const r=await api('GET',`/admin/users?role=${role}`);if(!r.ok)return;
  const el=document.getElementById(role==='gp'?'admin-gps':'admin-specs');
  const users=r.data.users||[];
  if(!users.length){el.innerHTML='<p class="muted">None yet.</p>';return;}
  el.innerHTML=users.map(u=>`<div class="user-row">
    <div><b>${u.first_name} ${u.last_name}</b> ${u.specialty?`· ${u.specialty}`:''}
      ${u.is_active?'<span class="dot dot-on"></span>':'<span class="dot dot-off"></span>'}
      ${u.verified?'<span class="badge badge-gp" style="font-size:9px;">verified</span>':''}</div>
    <div class="muted">${u.email} ${u.phone?'· '+u.phone:''} ${u.ahpra_number?'· '+u.ahpra_number:''}</div>
    <div class="btn-row">
      <button class="btn-secondary btn-sm" onclick="toggleActive(${u.id})">${u.is_active?'Deactivate':'Activate'}</button>
      ${!u.verified?`<button class="btn-secondary btn-sm" onclick="verifyUser(${u.id})">Verify</button>`:''}
      <button class="btn-secondary btn-sm" onclick="viewUserConsults(${u.id},'${u.first_name} ${u.last_name}')">Consults</button>
    </div></div>`).join('');
}
async function toggleActive(id){const r=await api('PATCH',`/admin/users/${id}/toggle-active`);if(r.ok){log(r.data.message);loadAdminUsers('gp');loadAdminUsers('specialist');loadAdminOverview();}}
async function verifyUser(id){const r=await api('PATCH',`/admin/users/${id}/verify`);if(r.ok){log('Verified');loadAdminUsers('gp');loadAdminUsers('specialist');}}
async function viewUserConsults(id,name){
  const r=await api('GET',`/admin/users/${id}/consults`);if(!r.ok)return;
  const p=document.getElementById('admin-user-consults');p.classList.remove('hidden');
  const cs=r.data.consults||[];
  p.innerHTML=`<h2>${name} — Consults (${cs.length})</h2>`+(cs.length?cs.map(c=>`<div class="consult-row" onclick="adminConsultDetail(${c.id})"><b>${c.ref_code}</b> · ${c.specialty} · ${c.status} · ${(c.patient_first_name||'')+' '+(c.patient_last_name||'')||c.patient_initials} · ${(c.created_at||'').slice(0,10)}</div>`).join(''):'<p class="muted">No consults.</p>');
  p.scrollIntoView({behavior:'smooth'});
}
async function adminConsultDetail(id){
  const r=await api('GET',`/consults/${id}`);if(!r.ok)return;
  const c=r.data.consult;const docs=r.data.documents||[];const notes=r.data.notes||[];const billing=r.data.billing;
  const p=document.getElementById('admin-consult-detail');p.classList.remove('hidden');
  let docsHtml=docs.map(d=>{
    let content=d.content;
    if(d.doc_type==='soap_note'){try{const s=JSON.parse(d.content);content=`SUBJECTIVE\n${s.subjective||'—'}\n\nOBJECTIVE\n${s.objective||'—'}\n\nASSESSMENT\n${s.assessment||'—'}\n\nPLAN\n${(s.plan&&s.plan.length?s.plan:['—']).join('\n')}\n\nFOLLOW-UP\n${s.follow_up||'—'}`+(s.safety_netting?`\n\nSAFETY-NETTING\n${s.safety_netting}`:'');}catch{}}
    return `<div class="doc"><div class="doc-type">${d.doc_type.replace(/_/g,' ')}</div><pre>${content}</pre></div>`;
  }).join('')||'<p class="muted">No documents.</p>';
  let notesHtml=notes.length?notes.map(n=>`<div class="doc"><div class="doc-type">${n.note_type} note</div><pre>${n.content}</pre></div>`).join(''):'<p class="muted">No notes.</p>';
  const transcript=c.transcript?`<div class="doc"><div class="doc-type">transcript</div><pre>${c.transcript}</pre></div>`:'';
  const struct=c.ai_structured_summary?`<div class="doc"><div class="doc-type">AI pre-consult structure</div><pre>${(()=>{try{return JSON.stringify(JSON.parse(c.ai_structured_summary),null,2);}catch{return c.ai_structured_summary;}})()}</pre></div>`:'';
  p.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Consult ${c.ref_code}</h2><button class="btn-secondary btn-sm" onclick="document.getElementById('admin-consult-detail').classList.add('hidden')">Close</button></div>
    <div class="meta">${c.specialty} · ${c.status} · ${c.booking_type==='scheduled'?'Scheduled '+(c.scheduled_at||''):'On-call'}</div>
    <div class="ai-box"><b>Patient:</b> ${(c.patient_first_name||'')+' '+(c.patient_last_name||'')||c.patient_initials} · ${c.patient_sex||''} · DOB ${c.patient_dob||'—'} · Medicare ${c.patient_medicare||'—'}${c.patient_irn?'/'+c.patient_irn:''}<br><b>Case:</b> ${c.case_summary}</div>
    ${billing?`<div class="ai-box"><b>Billing:</b> ${billing.billing_pathway} · GP ${billing.gp_mbs_item||'—'} · Spec ${billing.specialist_mbs_item||'—'}</div>`:''}
    <h2 style="font-size:13px;margin-top:10px">AI Structure</h2>${struct||'<p class="muted">None.</p>'}
    <h2 style="font-size:13px;margin-top:10px">Transcript</h2>${transcript||'<p class="muted">None.</p>'}
    <h2 style="font-size:13px;margin-top:10px">Documents</h2>${docsHtml}
    <h2 style="font-size:13px;margin-top:10px">Notes</h2>${notesHtml}
    <div class="note-input"><input id="anote-${c.id}" placeholder="Add an admin note…"><button class="btn-secondary btn-sm" onclick="addNote(${c.id},'anote-${c.id}')">Add Note</button></div>`;
  p.scrollIntoView({behavior:'smooth'});
}

// ════════ ADMIN BILLING + AUDIT ════════
async function loadAdminBilling(){
  const s=await api('GET','/billing/stats');
  const el=document.getElementById('admin-billing');
  if(!el)return;
  if(s.ok){
    const d=s.data;
    const pathways=Object.entries(d.by_pathway||{}).map(([k,v])=>`${k}: ${v}`).join(' · ')||'—';
    el.innerHTML=`<h2>Billing Overview</h2>
      <div class="stats">
        <div class="stat"><span class="stat-n">${d.total_mbs}</span><span class="stat-l">Total MBS</span></div>
        <div class="stat"><span class="stat-n">${d.platform_fees}</span><span class="stat-l">Platform fees</span></div>
        <div class="stat"><span class="stat-n">${d.pes_count}</span><span class="stat-l">PES consults</span></div>
        <div class="stat"><span class="stat-n">${d.flagged_count}</span><span class="stat-l">Flagged</span></div>
      </div>
      <p class="muted" style="margin-top:8px">Pathways: ${pathways}</p>`;
  }
  const h=await api('GET','/billing/history');
  const tbl=document.getElementById('admin-billing-table');
  if(h.ok&&tbl){
    const items=h.data.items||[];
    tbl.innerHTML=items.length?items.map(it=>`<div class="bill-row"><div><b>${it.ref_code}</b> · ${it.specialty} · ${it.patient||''}</div><div class="muted">GP ${it.gp_mbs_item||'—'} ${it.gp_fee} · Spec ${it.specialist_mbs_item||'—'} ${it.specialist_fee} · ${it.billing_pathway} ${(it.compliance_flags||[]).length?'⚠':''}</div></div>`).join(''):'<p class="muted">No billing yet.</p>';
  }
}
async function loadAudit(){
  const r=await api('GET','/admin/audit');
  const el=document.getElementById('admin-audit');
  if(!el||!r.ok)return;
  const logs=r.data.logs||[];
  el.innerHTML=logs.length?logs.slice(0,30).map(l=>`<div class="audit-row"><span class="audit-ev">${l.event}</span> <span class="muted">${(l.created_at||'').slice(0,19).replace('T',' ')}</span></div>`).join(''):'<p class="muted">No events.</p>';
}

// ════════ NOTES ════════
async function addNote(consultId, inputId){
  const inp=document.getElementById(inputId);const content=inp.value.trim();if(!content)return;
  const r=await api('POST',`/notes/${consultId}`,{content});
  if(r.ok){inp.value='';log('Note added.');if(USER.role==='admin')adminConsultDetail(consultId);else viewConsultDocs(consultId);}
}



// boot
fetch("/api/health").then(r=>r.json()).then(d=>log(`Backend: ${d.ok?"OK":"DOWN"} · ${d.app}`)).catch(()=>log("Backend not reachable."));
