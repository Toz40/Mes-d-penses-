const STORAGE_KEY='mes-depenses-pwa-v1';
const DEFAULT_CATEGORIES=['Restaurant','Courses','Transport','Logement','Loisirs','Shopping','Santé','Autre'];
const CATEGORY_ICONS={Restaurant:'utensils',Courses:'shopping-cart',Transport:'car',Logement:'house',Loisirs:'party-popper',Shopping:'shopping-bag','Santé':'heart-pulse',Autre:'circle-ellipsis'};
const CURRENCIES=['EUR','MAD','USD','GBP','CHF','CAD'];
const MAD_RATE=0.091427;
const DATA_VERSION=6;
const PAYMENT_METHODS=['CB','Espèces','Virement','Chèque','Autre'];
const CLOUD_STORAGE_KEY='mes-depenses-cloud-v1';
let balanceSummary='category';
let balanceParticipantId='';
let expenseFilters={dates:[],categories:[],payerIds:[],paymentMethods:[],search:''};
let cloud=loadCloudConfig();
let cloudSyncInterval=null;
let cloudPushTimer=null;
let cloudBusy=false;
const CATEGORY_COLORS={Restaurant:'#e11d48',Courses:'#16a34a',Transport:'#2563eb',Logement:'#9333ea',Loisirs:'#f59e0b',Shopping:'#db2777','Santé':'#dc2626',Autre:'#64748b'};
const iconUrl=(name,color)=>{const icon=CATEGORY_ICONS[name]||name||'tag',c=(color||CATEGORY_COLORS[name]||'#0b6b5b').replace('#','%23');return `https://api.iconify.design/lucide/${icon}.svg?color=${c}`};
const categoryIconUrl=c=>iconUrl(c.iconName||CATEGORY_ICONS[c.name]||'tag',c.color||CATEGORY_COLORS[c.name]||'#0b6b5b');
const fmt=(n,c)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:c||'EUR',maximumFractionDigits:2}).format(Number(n||0));
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const today=()=>new Date().toISOString().slice(0,10);
const fmtDate=(value)=>{if(!value)return '';const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(value)};
let state=load();let tab='home';let deferredPrompt=null;

function defaultState(){const gid=uid();return{dataVersion:DATA_VERSION,activeGroupId:gid,groups:[{id:gid,name:'Mon groupe',currency:'EUR',participants:[{id:uid(),name:'Moi'}],expenses:[],withdrawals:[]}]};}
function migrateToV5(s){
 if(!s||!Array.isArray(s.groups))return defaultState();
 if(Number(s.dataVersion||0)>=DATA_VERSION)return s;
 s.groups.forEach(g=>{
  if(!g.lastRates)g.lastRates={EUR:1};g.lastRates.MAD=MAD_RATE;
  (g.withdrawals||[]).forEach(w=>{w.currency='MAD';w.rate=MAD_RATE;w.amountEur=Number(w.amount||0)*MAD_RATE});
  (g.expenses||[]).forEach(e=>{const oldRate=Number(e.rate||1)||1;let nativeSplits={};if(e.splits&&Object.keys(e.splits).length)nativeSplits={...e.splits};else if(e.splitsEur&&Object.keys(e.splitsEur).length)Object.entries(e.splitsEur).forEach(([pid,v])=>nativeSplits[pid]=Number(v||0)/oldRate);e.currency='MAD';e.rate=MAD_RATE;e.amountEur=Number(e.amount||0)*MAD_RATE;e.splits=nativeSplits;delete e.splitsEur;if(!e.paymentMethod)e.paymentMethod=e.withdrawalId?'Espèces':'CB';});
  if(!g.categories)g.categories=DEFAULT_CATEGORIES.map(name=>({id:uid(),name,iconName:CATEGORY_ICONS[name]||'tag',color:CATEGORY_COLORS[name]||'#0b6b5b'}));
  g.categories.forEach((c,i)=>{if(!c.iconName){const m=String(c.icon||'').match(/lucide\/([^.?/]+)\.svg/);c.iconName=m?m[1]:(CATEGORY_ICONS[c.name]||'tag')}if(!c.color)c.color=CATEGORY_COLORS[c.name]||['#e11d48','#16a34a','#2563eb','#9333ea','#f59e0b','#db2777','#dc2626','#64748b'][i%8];c.icon=categoryIconUrl(c)});
 });
 s.dataVersion=DATA_VERSION;return s;
}
function load(){try{const migrated=migrateToV5(JSON.parse(localStorage.getItem(STORAGE_KEY))||defaultState());localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));return migrated}catch{const fresh=defaultState();localStorage.setItem(STORAGE_KEY,JSON.stringify(fresh));return fresh}}
function ensureGroupData(g){if(!g.categories)g.categories=DEFAULT_CATEGORIES.map(name=>({id:uid(),name,iconName:CATEGORY_ICONS[name]||'tag',color:CATEGORY_COLORS[name]||'#0b6b5b'}));g.categories.forEach((c,i)=>{if(!c.iconName)c.iconName=CATEGORY_ICONS[c.name]||'tag';if(!c.color)c.color=CATEGORY_COLORS[c.name]||['#e11d48','#16a34a','#2563eb','#9333ea','#f59e0b','#db2777','#dc2626','#64748b'][i%8];c.icon=categoryIconUrl(c)});if(!g.lastRates)g.lastRates={EUR:1};g.lastRates.MAD=MAD_RATE;if(!g.expenses)g.expenses=[];g.expenses.forEach(e=>{if(!e.paymentMethod)e.paymentMethod=e.withdrawalId?'Espèces':'CB';if(e.info===undefined)e.info=''});if(!g.withdrawals)g.withdrawals=[];if(!g.settlements)g.settlements=[];return g}
function loadCloudConfig(){try{return JSON.parse(localStorage.getItem(CLOUD_STORAGE_KEY))||{enabled:false,url:'',anonKey:'',shareCode:'',secret:'',lastUpdatedAt:''}}catch{return{enabled:false,url:'',anonKey:'',shareCode:'',secret:'',lastUpdatedAt:''}}}
function persistCloudConfig(){localStorage.setItem(CLOUD_STORAGE_KEY,JSON.stringify(cloud))}
function cloudReady(){return !!(cloud.enabled&&cloud.url&&cloud.anonKey&&cloud.shareCode&&cloud.secret)}
function normalizeCloudUrl(v=''){return String(v).trim().replace(/\/+$/,'')}
function bytesToBase64(bytes){let s='';bytes.forEach(b=>s+=String.fromCharCode(b));return btoa(s)}
function base64ToBytes(s){const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
function bytesToBase64Url(bytes){return bytesToBase64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function base64UrlToBytes(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return base64ToBytes(s)}
function randomSecret(){const a=new Uint8Array(32);crypto.getRandomValues(a);return bytesToBase64Url(a)}
async function sha256Hex(text){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function deriveShareCode(secret){return (await sha256Hex(secret)).slice(0,24)}
async function cloudCryptoKey(){return crypto.subtle.importKey('raw',base64UrlToBytes(cloud.secret),{name:'AES-GCM'},false,['encrypt','decrypt'])}
async function encryptPayload(obj){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await cloudCryptoKey(),plain=new TextEncoder().encode(JSON.stringify(obj)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);return{iv:bytesToBase64Url(iv),data:bytesToBase64Url(new Uint8Array(cipher))}}
async function decryptPayload(env){const key=await cloudCryptoKey(),iv=base64UrlToBytes(env.iv),data=base64UrlToBytes(env.data),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data);return JSON.parse(new TextDecoder().decode(plain))}
function cloudHeaders(extra={}){return{'apikey':cloud.anonKey,'Authorization':'Bearer '+cloud.anonKey,'Content-Type':'application/json',...extra}}
function cloudBaseEndpoint(){return `${normalizeCloudUrl(cloud.url)}/rest/v1/shared_groups`}
function scheduleCloudPush(){if(!cloudReady())return;clearTimeout(cloudPushTimer);cloudPushTimer=setTimeout(()=>cloudPush().catch(()=>{}),700)}
function save(skipCloud=false){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();if(!skipCloud)scheduleCloudPush()}
async function cloudPush(){if(!cloudReady()||cloudBusy)return;cloudBusy=true;try{const payload=await encryptPayload(group()),updatedAt=new Date().toISOString();const res=await fetch(cloudBaseEndpoint()+'?on_conflict=code',{method:'POST',headers:cloudHeaders({'Prefer':'resolution=merge-duplicates,return=representation'}),body:JSON.stringify([{code:cloud.shareCode,payload,updated_at:updatedAt}])});if(!res.ok)throw new Error('Envoi cloud impossible ('+res.status+')');const rows=await res.json();cloud.lastUpdatedAt=rows?.[0]?.updated_at||updatedAt;persistCloudConfig()}finally{cloudBusy=false}}
async function cloudPull(force=false){if(!cloudReady()||cloudBusy)return false;cloudBusy=true;try{const res=await fetch(cloudBaseEndpoint()+`?code=eq.${encodeURIComponent(cloud.shareCode)}&select=code,payload,updated_at`,{headers:cloudHeaders()});if(!res.ok)throw new Error('Lecture cloud impossible ('+res.status+')');const rows=await res.json();if(!rows.length)return false;const row=rows[0];if(!force&&cloud.lastUpdatedAt&&String(row.updated_at)<=String(cloud.lastUpdatedAt))return false;const remote=ensureGroupData(await decryptPayload(row.payload));const idx=state.groups.findIndex(g=>g.id===remote.id);if(idx>=0)state.groups[idx]=remote;else state.groups.push(remote);state.activeGroupId=remote.id;cloud.lastUpdatedAt=row.updated_at||'';persistCloudConfig();save(true);return true}finally{cloudBusy=false}}
function startCloudSync(){if(cloudSyncInterval){clearInterval(cloudSyncInterval);cloudSyncInterval=null}if(!cloudReady())return;cloudSyncInterval=setInterval(()=>cloudPull(false).catch(()=>{}),8000)}
async function createCloudShare(){const url=normalizeCloudUrl(document.getElementById('cloudUrl')?.value||cloud.url),anonKey=String(document.getElementById('cloudAnonKey')?.value||cloud.anonKey).trim();if(!url||!anonKey)return alert('Saisissez l’URL Supabase et la clé anon publique.');cloud={enabled:true,url,anonKey,shareCode:'',secret:randomSecret(),lastUpdatedAt:''};cloud.shareCode=await deriveShareCode(cloud.secret);persistCloudConfig();try{await cloudPush();startCloudSync();render();alert('Partage activé. Vous pouvez maintenant copier le lien d’invitation.')}catch(e){cloud.enabled=false;persistCloudConfig();render();alert(e.message+'\nVérifiez le projet Supabase et la table shared_groups.')}}
function inviteLink(){const cfg={u:cloud.url,k:cloud.anonKey,c:cloud.shareCode,s:cloud.secret};const token=bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cfg)));return location.origin+location.pathname+'#join='+token}
async function copyInviteLink(){if(!cloudReady())return alert('Activez d’abord le partage.');const link=inviteLink();try{await navigator.clipboard.writeText(link);alert('Lien d’invitation copié. Envoyez-le au participant Android.')}catch{prompt('Copiez ce lien et envoyez-le au participant :',link)}}
async function syncNow(){try{const changed=await cloudPull(true);if(!changed)await cloudPush();alert('Synchronisation terminée.')}catch(e){alert(e.message)}}
function disableCloud(){if(!confirm('Désactiver la synchronisation sur cet appareil ? Les données locales seront conservées.'))return;cloud.enabled=false;persistCloudConfig();startCloudSync();render()}
async function handleInviteHash(){if(!location.hash.startsWith('#join='))return;try{const token=location.hash.slice(6),cfg=JSON.parse(new TextDecoder().decode(base64UrlToBytes(token)));cloud={enabled:true,url:normalizeCloudUrl(cfg.u),anonKey:String(cfg.k||''),shareCode:String(cfg.c||''),secret:String(cfg.s||''),lastUpdatedAt:''};persistCloudConfig();history.replaceState(null,'',location.pathname+location.search);await cloudPull(true);startCloudSync();tab='home';render();alert('Groupe partagé ajouté. Les données se synchronisent automatiquement sur cet appareil.')}catch(e){alert('Lien d’invitation invalide ou groupe inaccessible. '+e.message)}}

function group(){return ensureGroupData(state.groups.find(g=>g.id===state.activeGroupId)||state.groups[0])}
function categories(){return group().categories}
function categoryObj(name){const c=categories().find(c=>c.name===name)||{name,iconName:CATEGORY_ICONS[name]||'tag',color:CATEGORY_COLORS[name]||'#0b6b5b'};c.icon=categoryIconUrl(c);return c}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function participantName(id){return group().participants.find(p=>p.id===id)?.name||'?'}
function eurAmount(e){return Number(e.amountEur??(Number(e.amount||0)*Number(e.rate||1)))}
function withdrawalCurrency(w){return w.currency||'EUR'}
function withdrawalRate(w){return Number(w.rate||1)}
function withdrawalAmountEur(w){return Number(w.amountEur??(Number(w.amount||0)*withdrawalRate(w)))}
function cashSpentNative(w,excludeExpenseId=''){return group().expenses.filter(e=>e.withdrawalId===w.id&&e.id!==excludeExpenseId).reduce((a,e)=>a+Number(e.amount||0),0)}
function cashRemainingNative(w,excludeExpenseId=''){return Math.max(0,Number(w.amount||0)-cashSpentNative(w,excludeExpenseId))}
function totalCashRemainingEur(){return group().withdrawals.reduce((a,w)=>a+cashRemainingNative(w)*withdrawalRate(w),0)}
function expenseSplitsNative(e){if(e.splits&&Object.keys(e.splits).length)return e.splits;if(e.splitsEur&&Object.keys(e.splitsEur).length){const r=Number(e.rate||1)||1;const out={};Object.entries(e.splitsEur).forEach(([pid,v])=>out[pid]=Number(v||0)/r);return out}return {}}
function balances(){const g=group(),b={};g.participants.forEach(p=>b[p.id]=0);g.expenses.forEach(e=>{const rate=Number(e.rate||1);if(b[e.payerId]!==undefined)b[e.payerId]+=eurAmount(e);Object.entries(expenseSplitsNative(e)).forEach(([pid,v])=>{if(b[pid]!==undefined)b[pid]-=Number(v)*rate});});(g.settlements||[]).forEach(r=>{const v=Number(r.amountEur||0);if(b[r.fromId]!==undefined)b[r.fromId]+=v;if(b[r.toId]!==undefined)b[r.toId]-=v;});return b}
function debts(){const b=balances(),cred=Object.entries(b).filter(([,v])=>v>.005).map(([id,v])=>({id,v})),deb=Object.entries(b).filter(([,v])=>v<-.005).map(([id,v])=>({id,v:-v}));const out=[];let i=0,j=0;while(i<deb.length&&j<cred.length){const x=Math.min(deb[i].v,cred[j].v);out.push({from:deb[i].id,to:cred[j].id,amount:x});deb[i].v-=x;cred[j].v-=x;if(deb[i].v<.005)i++;if(cred[j].v<.005)j++;}return out}
function totalExpenses(){return group().expenses.reduce((a,e)=>a+eurAmount(e),0)}
function ensureRuntimeStyles(){
 if(document.getElementById('runtimeStyles'))return;
 const st=document.createElement('style');st.id='runtimeStyles';st.textContent=`
 html,body{max-width:100%;overflow-x:hidden}
 #app.container{width:100%;max-width:760px;margin:0 auto;overflow-x:hidden}
 #modal{width:calc(100vw - 12px)!important;max-width:760px!important;margin:auto!important}
 #modalForm{width:100%;max-width:100%;overflow-x:hidden}
 #modalForm input,#modalForm select,#modalForm textarea{font-size:16px!important;max-width:100%;min-width:0}
 #modalForm .split-grid input{font-size:16px!important;width:100%;min-width:0}
 .filter-picker-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;border:1px solid #dde5e2;border-radius:12px;background:#fff;font-size:16px;text-align:left}
 .filter-options-panel{margin-top:8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;max-height:220px;overflow:auto}
 @media(max-width:430px){.filter-options-panel{grid-template-columns:1fr}}
 `;document.head.appendChild(st)
}
function centerApp(){const a=document.getElementById('app');if(a){a.style.width='100%';a.style.maxWidth='760px';a.style.margin='0 auto';a.style.overflowX='hidden'}}
function render(){
 ensureRuntimeStyles();
 if(tab==='balances')tab='home';
 const balanceTab=document.querySelector('.tab[data-tab="balances"]');if(balanceTab)balanceTab.style.display='none';
 const nav=document.querySelector('.tabbar');if(nav)nav.style.gridTemplateColumns='repeat(4,1fr)';
 document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 document.getElementById('app').innerHTML=({home:homeView,expenses:expensesView,cash:cashView,settings:settingsView}[tab]||homeView)();
 centerApp();
 bindDynamic();
}

function homeView(){const g=group();return`<section class="card hero"><div class="muted small">${esc(g.name)}</div><h2 style="margin:4px 0 14px">${fmt(totalExpenses(),'EUR')}</h2><div class="grid"><div><div class="muted small">Dépenses</div><strong>${g.expenses.length}</strong></div><div><div class="muted small">Cash disponible</div><strong>${fmt(totalCashRemainingEur(),'EUR')}</strong></div></div></section>${balanceDashboardView()}`}
function expRow(e){const c=categoryObj(e.category);return`<div class="row"><div><img src="${esc(c.icon)}" alt="" style="width:22px;height:22px;vertical-align:middle;margin-right:6px">${e.photo?`<img class="photo" src="${e.photo}" style="width:46px;height:46px;float:left;margin-right:10px">`:''}<strong>${esc(e.title)}</strong><div class="small muted">${esc(e.category)} · ${esc(participantName(e.payerId))}${e.withdrawalId?' · Espèces':''}</div></div><div class="amount">${fmt(eurAmount(e),'EUR')}${(e.currency||'EUR')!=='EUR'?`<div class="small muted">${fmt(e.amount,e.currency)} · taux ${Number(e.rate||1).toFixed(6)}</div>`:''}</div></div>`}
function expenseDisplayRow(e,{showPayment=false}={}){
 const c=categoryObj(e.category),cur=e.currency||'EUR',splits=expenseSplitsNative(e);
 const splitRows=Object.entries(splits).filter(([,v])=>Math.abs(Number(v||0))>.0001).map(([pid,v])=>`<div class="small muted" style="display:flex;justify-content:space-between;gap:14px;margin-top:4px"><span>${esc(participantName(pid))}</span><span style="white-space:nowrap;font-weight:700">${fmt(v,cur)}</span></div>`).join('')||'<div class="small muted" style="margin-top:4px">Aucune répartition</div>';
 const payment=showPayment?`<span style="white-space:nowrap;font-weight:700">${esc(e.paymentMethod||'CB')}</span>`:'<span></span>';
 const info=e.info?`<div class="small muted" style="margin-top:5px;white-space:pre-wrap"><strong>Informations :</strong> ${esc(e.info)}</div>`:'';
 return`<div style="padding:10px 0;border-bottom:1px solid #dce6e2">
   <div style="display:flex;align-items:center;gap:8px;min-width:0">
     <span style="display:inline-flex;width:34px;height:34px;border-radius:10px;background:${esc(c.color)}18;align-items:center;justify-content:center;flex:0 0 auto"><img src="${esc(c.icon)}" alt="" style="width:22px;height:22px"></span>
     <strong style="font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1">${esc(e.title)}</strong>
   </div>
   <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:baseline;gap:14px">
     <span class="small muted">${esc(fmtDate(e.date||''))}</span>
     <span style="font-size:18px;font-weight:800;white-space:nowrap">${fmt(e.amount,cur)}</span>
   </div>
   <div style="margin-top:2px;display:flex;justify-content:space-between;align-items:baseline;gap:14px">
     <span class="small muted">${payment}</span>
     <span class="small muted" style="white-space:nowrap;font-weight:700">≈ ${fmt(eurAmount(e),'EUR')}</span>
   </div>
   <div class="small muted" style="margin-top:6px"><strong>Catégorie :</strong> ${esc(e.category)}</div>
   ${info}
   <div style="margin-top:5px">${splitRows}</div>
 </div>`
}
function withdrawalDetailExpenseRow(e){return expenseDisplayRow(e,{showPayment:true})}
function filteredExpenses(){
 let es=group().expenses.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 const f=expenseFilters;
 if((f.dates||[]).length)es=es.filter(e=>f.dates.includes(e.date));
 if((f.categories||[]).length)es=es.filter(e=>f.categories.includes(e.category));
 if((f.payerIds||[]).length)es=es.filter(e=>f.payerIds.includes(e.payerId));
 if((f.paymentMethods||[]).length)es=es.filter(e=>f.paymentMethods.includes(e.paymentMethod||'CB'));
 if(f.search){const q=f.search.trim().toLocaleLowerCase('fr');es=es.filter(e=>`${e.title||''} ${e.info||''}`.toLocaleLowerCase('fr').includes(q));}
 return es;
}
function activeExpenseFilterCount(){return ['dates','categories','payerIds','paymentMethods'].reduce((n,k)=>n+((expenseFilters[k]||[]).length?1:0),0)+(expenseFilters.search?1:0)}
function expenseToolbar(){const n=activeExpenseFilterCount();return`<div style="position:sticky;top:calc(72px + env(safe-area-inset-top));z-index:7;margin:-4px -4px 12px;padding:8px 4px 10px;background:rgba(245,247,246,.97);backdrop-filter:blur(12px);border-bottom:1px solid #dde5e2">
 <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px"><button class="primary" data-action="expense" style="padding:10px 5px;font-size:13px">+ Dépense</button><button class="secondary" data-action="withdrawal" style="padding:10px 5px;font-size:13px">+ Espèces</button><button class="secondary" data-action="income" style="padding:10px 5px;font-size:13px">+ Revenu</button></div>
 <div style="display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:7px"><input id="expenseSearchInput" value="${esc(expenseFilters.search)}" placeholder="Rechercher titre ou informations" autocomplete="off" style="min-width:0;padding:10px;border:1px solid #dde5e2;border-radius:11px;font-size:16px;background:#fff"><button class="ghost" id="expenseFiltersBtn" style="padding:9px 10px;font-size:13px">Filtres${n?` (${n})`:''}</button></div>
 </div>`}
function expenseResultsHtml(){const es=filteredExpenses();return`${es.map(e=>`${expenseDisplayRow(e,{showPayment:true})}<div class="btnrow" style="justify-content:flex-end"><button class="secondary small" data-edit-exp="${e.id}">Modifier</button><button class="danger small" data-delete-exp="${e.id}">Supprimer</button></div>`).join('')||'<div class="empty">Aucune dépense ne correspond aux filtres.</div>'}`}
function expensesView(){return`${expenseToolbar()}<section class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3 style="margin-right:auto">Toutes les dépenses</h3>${activeExpenseFilterCount()?'<button class="ghost small" id="resetExpenseFilters">Réinitialiser</button>':''}</div><div id="expenseResults">${expenseResultsHtml()}</div></section>`}
function refreshExpenseResults(){const box=document.getElementById('expenseResults');if(!box)return;box.innerHTML=expenseResultsHtml();bindExpenseResultActions()}
function bindExpenseResultActions(){document.querySelectorAll('[data-edit-exp]').forEach(x=>x.onclick=e=>{e.stopPropagation();openExpense('',x.dataset.editExp)});document.querySelectorAll('[data-delete-exp]').forEach(x=>x.onclick=e=>{e.stopPropagation();if(confirm('Supprimer cette dépense ?')){group().expenses=group().expenses.filter(y=>y.id!==x.dataset.deleteExp);save()}})}
function filterChecks(name,items,selected,labelFn=x=>x.label||x.value){return items.map(x=>`<label style="display:flex;align-items:center;gap:10px;padding:10px 11px;border:1px solid #dde5e2;border-radius:11px;background:#fff"><input type="checkbox" name="${name}" value="${esc(x.value)}" ${(selected||[]).includes(x.value)?'checked':''} style="width:20px;height:20px;flex:0 0 auto"><span>${esc(labelFn(x))}</span></label>`).join('')}
function filterSummary(values,items,emptyLabel){if(!(values||[]).length)return emptyLabel;const labels=items.filter(x=>values.includes(x.value)).map(x=>x.label);return labels.length<=2?labels.join(', '):`${labels.length} sélectionnés`}
function openExpenseFilters(){
 const g=group();
 const dates=[...new Set(g.expenses.map(e=>e.date).filter(Boolean))].sort((a,b)=>b.localeCompare(a)).map(v=>({value:v,label:fmtDate(v)}));
 const cats=categories().map(c=>({value:c.name,label:c.name}));
 const payers=g.participants.map(p=>({value:p.id,label:p.name}));
 const methods=PAYMENT_METHODS.map(v=>({value:v,label:v}));
 modal(`<h2>Filtrer les dépenses</h2>
 <div class="field"><label>Date</label><button type="button" class="filter-picker-btn" data-filter-toggle="dates"><span id="summary_dates">${esc(filterSummary(expenseFilters.dates,dates,'Toutes les dates'))}</span><span>⌄</span></button><div id="panel_dates" class="filter-options-panel hidden">${filterChecks('dates',dates,expenseFilters.dates)}</div></div>
 <div class="field"><label>Catégorie</label><button type="button" class="filter-picker-btn" data-filter-toggle="categories"><span id="summary_categories">${esc(filterSummary(expenseFilters.categories,cats,'Toutes les catégories'))}</span><span>⌄</span></button><div id="panel_categories" class="filter-options-panel hidden">${filterChecks('categories',cats,expenseFilters.categories)}</div></div>
 <div class="field"><label>Payeur</label><button type="button" class="filter-picker-btn" data-filter-toggle="payerIds"><span id="summary_payerIds">${esc(filterSummary(expenseFilters.payerIds,payers,'Tous les payeurs'))}</span><span>⌄</span></button><div id="panel_payerIds" class="filter-options-panel hidden">${filterChecks('payerIds',payers,expenseFilters.payerIds)}</div></div>
 <div class="field"><label>Mode de paiement</label><button type="button" class="filter-picker-btn" data-filter-toggle="paymentMethods"><span id="summary_paymentMethods">${esc(filterSummary(expenseFilters.paymentMethods,methods,'Tous les modes'))}</span><span>⌄</span></button><div id="panel_paymentMethods" class="filter-options-panel hidden">${filterChecks('paymentMethods',methods,expenseFilters.paymentMethods)}</div></div>
 <div class="modal-actions"><button type="button" class="ghost" id="cancelModal">Annuler</button><button type="button" class="secondary" id="clearExpenseFilterModal">Effacer</button><button class="primary" type="submit">Appliquer</button></div>`,(fd,d)=>{
   expenseFilters.dates=fd.getAll('dates').map(String);expenseFilters.categories=fd.getAll('categories').map(String);expenseFilters.payerIds=fd.getAll('payerIds').map(String);expenseFilters.paymentMethods=fd.getAll('paymentMethods').map(String);d.close();render()
 });
 setTimeout(()=>{
   document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close();
   document.getElementById('clearExpenseFilterModal').onclick=()=>{expenseFilters={dates:[],categories:[],payerIds:[],paymentMethods:[],search:expenseFilters.search||''};document.getElementById('modal').close();render()};
   const all={dates,categories:cats,payerIds:payers,paymentMethods:methods};
   document.querySelectorAll('[data-filter-toggle]').forEach(b=>b.onclick=()=>{const key=b.dataset.filterToggle,p=document.getElementById('panel_'+key);p.classList.toggle('hidden')});
   Object.keys(all).forEach(key=>document.querySelectorAll(`input[name="${key}"]`).forEach(cb=>cb.onchange=()=>{const vals=[...document.querySelectorAll(`input[name="${key}"]:checked`)].map(x=>x.value);const sm=document.getElementById('summary_'+key);if(sm)sm.textContent=filterSummary(vals,all[key],key==='dates'?'Toutes les dates':key==='categories'?'Toutes les catégories':key==='payerIds'?'Tous les payeurs':'Tous les modes')}));
 },0)
}
function cashView(){const ws=group().withdrawals.slice().sort((a,b)=>b.date.localeCompare(a.date));return`<div class="btnrow"><button class="primary" data-action="withdrawal">+ Nouveau retrait</button></div>${ws.map(w=>{const cur=withdrawalCurrency(w),spent=cashSpentNative(w),rem=cashRemainingNative(w),pct=Math.min(100,spent/Number(w.amount||0)*100||0),count=group().expenses.filter(e=>e.withdrawalId===w.id).length;return`<section class="card" data-open-withdrawal="${w.id}" style="cursor:pointer"><div class="row"><div><strong>${esc(w.title||'Retrait espèces')}</strong><div class="small muted">${fmtDate(w.date)} · ${esc(participantName(w.ownerId))} · ${count} dépense${count>1?'s':''}</div></div><div class="amount">${fmt(w.amount,cur)}${cur!=='EUR'?`<div class="small muted">≈ ${fmt(withdrawalAmountEur(w),'EUR')}</div>`:''}</div></div><div class="grid"><div class="stat"><span class="small muted">Dépensé</span><strong>${fmt(spent,cur)}</strong></div><div class="stat"><span class="small muted">Restant</span><strong>${fmt(rem,cur)}</strong></div></div><div class="cash-progress" style="margin:12px 0"><span style="width:${pct}%"></span></div><div class="btnrow"><button class="secondary" data-cash-expense="${w.id}">+ Dépense</button><button class="secondary" data-edit-withdrawal="${w.id}">Modifier</button><button class="danger" data-delete-w="${w.id}">Supprimer</button></div></section>`}).join('')||'<section class="card empty">Aucun retrait espèces</section>'}`}
function summaryExpenseLine(e,amountNative=null){const cur=e.currency||'EUR',native=amountNative===null?Number(e.amount||0):Number(amountNative||0),eur=native*Number(e.rate||1);return`<div class="row" style="align-items:flex-start"><div style="min-width:0"><strong>${esc(e.title)}</strong><div class="small muted">${esc(fmtDate(e.date||''))} · ${esc(e.category)}</div>${e.info?`<div class="small muted" style="margin-top:3px">${esc(e.info)}</div>`:''}</div><div class="amount" style="text-align:right">${fmt(native,cur)}${cur!=='EUR'?`<div class="small muted">≈ ${fmt(eur,'EUR')}</div>`:''}</div></div>`}
function summaryGroups(mode){const g=group(),es=g.expenses.slice().sort((a,b)=>b.date.localeCompare(a.date));if(mode==='payer')return g.participants.map(p=>({title:p.name,items:es.filter(e=>e.payerId===p.id).map(e=>({e,amount:null}))})).filter(x=>x.items.length);if(mode==='participant')return g.participants.map(p=>({title:p.name,items:es.map(e=>({e,amount:Number(expenseSplitsNative(e)[p.id]||0)})).filter(x=>x.amount>0.0001)})).filter(x=>x.items.length);return categories().map(c=>({title:c.name,items:es.filter(e=>e.category===c.name).map(e=>({e,amount:null}))})).filter(x=>x.items.length)}
function summaryTotalEur(gr){return gr.items.reduce((a,x)=>a+(x.amount===null?eurAmount(x.e):Number(x.amount||0)*Number(x.e.rate||1)),0)}
function participantCategoryGroups(pid){
 const g=group(),es=g.expenses.slice().sort((a,b)=>b.date.localeCompare(a.date));
 return categories().map(c=>({
   title:c.name,
   items:es.filter(e=>e.category===c.name).map(e=>({e,amount:Number(expenseSplitsNative(e)[pid]||0)})).filter(x=>x.amount>0.0001)
 })).filter(x=>x.items.length)
}
function balanceDashboardView(){
 const g=group(),b=balances(),ds=debts();
 if(!balanceParticipantId||!g.participants.some(p=>p.id===balanceParticipantId))balanceParticipantId=g.participants[0]?.id||'';
 const buttons=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px"><button class="${balanceSummary==='category'?'primary':'secondary'} small" data-summary="category" style="padding-left:6px;padding-right:6px">Par catégorie</button><button class="${balanceSummary==='payer'?'primary':'secondary'} small" data-summary="payer" style="padding-left:6px;padding-right:6px">Par payeur</button><button class="${balanceSummary==='participant'?'primary':'secondary'} small" data-summary="participant" style="padding-left:6px;padding-right:6px">Par participant</button></div>`;
 let recap='';
 if(balanceSummary==='participant'){
   const p=g.participants.find(x=>x.id===balanceParticipantId);
   const groups=participantCategoryGroups(balanceParticipantId);
   const participantTotal=groups.reduce((a,gr)=>a+summaryTotalEur(gr),0);
   recap=`<div class="field" style="margin-top:0"><label>Participant</label><select id="balanceParticipantSelect">${g.participants.map(x=>`<option value="${x.id}" ${x.id===balanceParticipantId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div style="display:flex;justify-content:space-between;gap:12px;margin:12px 0 4px;font-weight:900;font-size:19px;color:#d51f2b"><span>${esc(p?.name||'')}</span><span style="white-space:nowrap">${fmt(participantTotal,'EUR')}</span></div>${groups.map(gr=>`<div style="display:flex;justify-content:space-between;gap:12px;margin:16px 0 6px;font-weight:800;font-size:17px;color:#d51f2b"><span>${esc(gr.title)}</span><span style="white-space:nowrap">${fmt(summaryTotalEur(gr),'EUR')}</span></div>${gr.items.map(x=>summaryExpenseLine(x.e,x.amount)).join('')}`).join('')||'<div class="empty">Aucune dépense pour ce participant</div>'}`;
 }else{
   const groups=summaryGroups(balanceSummary);
   recap=groups.map(gr=>`<div style="display:flex;justify-content:space-between;gap:12px;margin:16px 0 6px;font-weight:800;font-size:17px;color:#d51f2b"><span>${esc(gr.title)}</span><span style="white-space:nowrap">${fmt(summaryTotalEur(gr),'EUR')}</span></div>${gr.items.map(x=>summaryExpenseLine(x.e,x.amount)).join('')}`).join('')||'<div class="empty">Aucune dépense</div>';
 }
 return`<section class="card"><h3>Solde par participant</h3>${g.participants.map(p=>`<div class="row"><span>${esc(p.name)}</span><span class="amount">${fmt(b[p.id],'EUR')}</span></div>`).join('')}</section><section class="card"><h3>Remboursements suggérés</h3>${ds.map(d=>`<div class="row"><span><strong>${esc(participantName(d.from))}</strong> rembourse <strong>${esc(participantName(d.to))}</strong></span><span class="amount">${fmt(d.amount,'EUR')}</span></div>`).join('')||'<div class="empty">Tout est équilibré</div>'}</section><section class="card"><h3>Récapitulatif des dépenses</h3>${buttons}${recap}</section>`
}
function balancesView(){return balanceDashboardView()}
function settingsView(){const g=group();const cloudStatus=cloudReady()?`<div class="small" style="margin-bottom:10px"><strong style="color:#0b6b5b">Synchronisation active</strong><br>Code du groupe : <strong>${esc(cloud.shareCode)}</strong><br><span class="muted">Les modifications de ce groupe sont partagées entre les appareils.</span></div>`:`<div class="small muted" style="margin-bottom:10px">Activez le partage pour utiliser le même groupe sur iPhone, Android ou ordinateur.</div>`;return`<section class="card"><h3>Groupe actif</h3><div class="field"><label>Changer de groupe</label><select id="groupSelect">${state.groups.map(x=>`<option value="${x.id}" ${x.id===g.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="btnrow"><button class="primary" data-action="group">+ Nouveau groupe</button><button class="secondary" data-action="participant">+ Participant</button></div></section><section class="card"><h3>Partage multi-appareils</h3>${cloudStatus}<div class="field"><label>URL Supabase</label><input id="cloudUrl" value="${esc(cloud.url||'')}" placeholder="https://xxxx.supabase.co"></div><div class="field"><label>Clé anon publique</label><input id="cloudAnonKey" value="${esc(cloud.anonKey||'')}" placeholder="eyJ..."></div><div class="btnrow">${cloudReady()?`<button class="primary" id="copyInviteBtn">Copier le lien d’invitation</button><button class="secondary" id="syncNowBtn">Synchroniser</button><button class="ghost" id="disableCloudBtn">Désactiver</button>`:`<button class="primary" id="createCloudBtn">Activer le partage</button>`}</div><p class="small muted">Le lien d’invitation contient la clé nécessaire pour déchiffrer le groupe. Envoyez-le uniquement aux participants concernés. Sur Android : ouvrir le lien dans Chrome puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p></section><section class="card"><h3>Catégories</h3>${categories().map(c=>`<div class="row"><span><span style="display:inline-flex;width:34px;height:34px;border-radius:10px;background:${esc(c.color)}18;align-items:center;justify-content:center;margin-right:8px"><img src="${esc(categoryIconUrl(c))}" style="width:22px;height:22px"></span>${esc(c.name)}</span><div class="btnrow"><button class="secondary small" data-edit-cat="${c.id}">Modifier</button><button class="danger small" data-delete-cat="${c.id}">Supprimer</button></div></div>`).join('')}<div class="btnrow"><button class="secondary" data-action="category">+ Catégorie</button></div><p class="small muted">Chaque catégorie peut avoir son propre nom, son icône et sa couleur.</p></section><section class="card"><h3>Participants</h3>${g.participants.map(p=>`<div class="row"><span>${esc(p.name)}</span><div class="btnrow"><button class="secondary small" data-edit-p="${p.id}">Modifier</button>${g.participants.length>1?`<button class="danger small" data-delete-p="${p.id}">Supprimer</button>`:''}</div></div>`).join('')}</section><section class="card"><h3>Données</h3><div class="btnrow"><button class="secondary" id="exportBtn">Exporter</button><label class="btn secondary" style="display:inline-block">Importer<input id="importFile" type="file" accept="application/json" hidden></label></div><p class="small muted">Une copie locale reste conservée sur cet appareil. L’export JSON permet également une sauvegarde manuelle.</p></section>`}


function bindDynamic(){
 document.querySelectorAll('[data-action="expense"]').forEach(x=>x.onclick=()=>openExpense());
 document.querySelectorAll('[data-action="withdrawal"]').forEach(x=>x.onclick=()=>openWithdrawal());
 document.querySelectorAll('[data-action="income"]').forEach(x=>x.onclick=()=>openIncome());
 document.querySelectorAll('[data-action="group"]').forEach(x=>x.onclick=openGroup);
 document.querySelectorAll('[data-action="category"]').forEach(x=>x.onclick=openCategory);
 document.querySelectorAll('[data-edit-cat]').forEach(x=>x.onclick=()=>openCategory(x.dataset.editCat));
 document.querySelectorAll('[data-action="participant"]').forEach(x=>x.onclick=openParticipant);document.querySelectorAll('[data-edit-p]').forEach(x=>x.onclick=()=>openEditParticipant(x.dataset.editP));
 document.querySelectorAll('[data-cash-expense]').forEach(x=>x.onclick=e=>{e.stopPropagation();openExpense(x.dataset.cashExpense)});
 bindExpenseResultActions();
 document.querySelectorAll('[data-edit-withdrawal]').forEach(x=>x.onclick=e=>{e.stopPropagation();openWithdrawal(x.dataset.editWithdrawal)});
 document.querySelectorAll('[data-open-withdrawal]').forEach(x=>x.onclick=()=>openWithdrawalDetails(x.dataset.openWithdrawal));
 document.querySelectorAll('[data-delete-w]').forEach(x=>x.onclick=e=>{e.stopPropagation();if(group().expenses.some(y=>y.withdrawalId===x.dataset.deleteW))return alert('Ce retrait contient des dépenses. Supprimez ou détachez-les d’abord.');if(confirm('Supprimer ce retrait ?')){group().withdrawals=group().withdrawals.filter(w=>w.id!==x.dataset.deleteW);save()}});
 document.querySelectorAll('[data-delete-cat]').forEach(x=>x.onclick=()=>{const id=x.dataset.deleteCat,c=categories().find(y=>y.id===id);if(c&&group().expenses.some(e=>e.category===c.name))return alert('Cette catégorie est utilisée dans des dépenses.');group().categories=categories().filter(y=>y.id!==id);save()});
 document.querySelectorAll('[data-delete-p]').forEach(x=>x.onclick=()=>{const id=x.dataset.deleteP;if(group().expenses.some(e=>e.payerId===id||e.splitsEur?.[id]||e.splits?.[id])||group().withdrawals.some(w=>w.ownerId===id)||(group().settlements||[]).some(r=>r.fromId===id||r.toId===id))return alert('Ce participant est utilisé dans des opérations.');group().participants=group().participants.filter(p=>p.id!==id);save()});
 const gs=document.getElementById('groupSelect');if(gs)gs.onchange=e=>{state.activeGroupId=e.target.value;save()};
 const ex=document.getElementById('exportBtn');if(ex)ex.onclick=exportData;
 const im=document.getElementById('importFile');if(im)im.onchange=importData;
 document.querySelectorAll('[data-summary]').forEach(x=>x.onclick=()=>{balanceSummary=x.dataset.summary;render()});const bps=document.getElementById('balanceParticipantSelect');if(bps)bps.onchange=e=>{balanceParticipantId=e.target.value;render()};
 const esi=document.getElementById('expenseSearchInput');if(esi){let t;esi.oninput=()=>{clearTimeout(t);const value=String(esi.value||'');expenseFilters.search=value.trim();t=setTimeout(()=>refreshExpenseResults(),80)}};
 const efb=document.getElementById('expenseFiltersBtn');if(efb)efb.onclick=()=>openExpenseFilters();
 const erf=document.getElementById('resetExpenseFilters');if(erf)erf.onclick=()=>{expenseFilters={dates:[],categories:[],payerIds:[],paymentMethods:[],search:''};render()};
 const ccb=document.getElementById('createCloudBtn');if(ccb)ccb.onclick=()=>createCloudShare();
 const cib=document.getElementById('copyInviteBtn');if(cib)cib.onclick=()=>copyInviteLink();
 const snb=document.getElementById('syncNowBtn');if(snb)snb.onclick=()=>syncNow();
 const dcb=document.getElementById('disableCloudBtn');if(dcb)dcb.onclick=()=>disableCloud();
}
function prepareModalPosition(d,f){d.style.width='calc(100vw - 12px)';d.style.maxWidth='760px';d.style.margin='auto';f.style.width='100%';f.style.maxWidth='100%';requestAnimationFrame(()=>{f.scrollTop=0;d.scrollTop=0})}
function modal(html,onSubmit){ensureRuntimeStyles();const d=document.getElementById('modal'),f=document.getElementById('modalForm');f.innerHTML=html;f.onsubmit=e=>{e.preventDefault();onSubmit(new FormData(f),d)};prepareModalPosition(d,f);d.showModal();requestAnimationFrame(()=>{f.scrollTop=0;d.scrollTop=0})}
function closeOnlyModal(html){ensureRuntimeStyles();const d=document.getElementById('modal'),f=document.getElementById('modalForm');f.innerHTML=html;f.onsubmit=e=>e.preventDefault();prepareModalPosition(d,f);d.showModal();requestAnimationFrame(()=>{f.scrollTop=0;d.scrollTop=0})}
function splitFields(values={}){return group().participants.map(p=>`<div class="split-grid"><span>${esc(p.name)}</span><input name="split_${p.id}" inputmode="decimal" type="number" step="0.01" min="0" value="${Number(values[p.id]||0)}" style="font-size:16px;width:100%;min-width:0"></div>`).join('')}
function currencyOptions(selected){return CURRENCIES.map(c=>`<option value="${c}" ${c===selected?'selected':''}>${c}</option>`).join('')}
function participantOptions(selected){return group().participants.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}
function paymentOptions(selected){return PAYMENT_METHODS.map(m=>`<option value="${m}" ${m===selected?'selected':''}>${m}</option>`).join('')}

function openExpense(withdrawalId='',expenseId=''){
 const g=group(),existing=expenseId?g.expenses.find(e=>e.id===expenseId):null;
 const w=withdrawalId?g.withdrawals.find(x=>x.id===withdrawalId):(existing?.withdrawalId?g.withdrawals.find(x=>x.id===existing.withdrawalId):null);
 const linkedWithdrawalId=w?.id||'';
 const forcedCurrency=w?withdrawalCurrency(w):null;
 const selectedCurrency=forcedCurrency||(existing?.currency||'MAD');
 const defaultPayer=existing?.payerId||(w?.ownerId||g.participants[0]?.id||'');
 const defaultRate=Number(existing?.rate??g.lastRates[selectedCurrency]??(selectedCurrency==='MAD'?MAD_RATE:(w?withdrawalRate(w):1)));
 const existingAmount=Number(existing?.amount||0);
 const max=w?cashRemainingNative(w,existing?.id||''):null;
 const existingSplits=existing?expenseSplitsNative(existing):{};
 const hasCustom=existing&&Object.values(existingSplits).length>0;
 const defaultPayment=existing?.paymentMethod||(w?'Espèces':'CB');
 modal(`<div style="position:sticky;top:-18px;z-index:30;margin:-18px -18px 14px;padding:12px 18px;background:rgba(255,255,255,.98);backdrop-filter:blur(10px);border-bottom:1px solid #dde5e2;display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="ghost" id="cancelModal">Annuler</button><button class="primary" type="button" id="saveExpenseBtn">${existing?'Enregistrer':'Ajouter'}</button></div>
 <h2 style="margin-top:6px">${existing?'Modifier la dépense':w?'Dépense du retrait':'Nouvelle dépense'}</h2>
 <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:end;width:100%">
  <div class="field" style="min-width:0;margin:12px 0"><label>Date</label><input name="date" type="date" value="${existing?.date||today()}" required style="width:100%;min-width:0;max-width:100%"></div>
  <div class="field" style="min-width:0;margin:12px 0"><label>Payé par</label><select name="payerId" style="width:100%;min-width:0;max-width:100%">${participantOptions(defaultPayer)}</select></div>
 </div>
 <div class="field"><label>Libellé</label><input name="title" required value="${esc(existing?.title||'')}" placeholder="Ex. Restaurant"></div>
 <div class="field"><label>Informations</label><textarea name="info" placeholder="Ex. adresse, détail, commentaire...">${esc(existing?.info||'')}</textarea></div>
 <div style="display:grid;grid-template-columns:1.1fr .9fr .8fr;gap:8px;align-items:end">
  <div class="field"><label>Mode de paiement</label><select name="paymentMethod">${paymentOptions(defaultPayment)}</select></div>
  <div class="field"><label>Montant${max!==null?` (max ${fmt(max,selectedCurrency)})`:''}</label><input name="amount" id="expenseAmount" type="number" step="0.01" min="0.01" ${max!==null?`max="${max}"`:''} value="${existingAmount||''}" required></div>
  <div class="field"><label>Devise</label>${forcedCurrency?`<input value="${forcedCurrency}" disabled><input type="hidden" name="currency" value="${forcedCurrency}">`:`<select name="currency" id="expenseCurrency">${currencyOptions(selectedCurrency)}</select>`}</div>
 </div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">
  <div class="field"><label>Taux vers EUR</label><input name="rate" id="expenseRate" type="number" step="0.000001" min="0.000001" value="${defaultRate}" required></div>
  <div class="field"><label>Résultat en euros</label><div id="expenseEuroResult" style="padding:12px;border:1px solid #dde5e2;border-radius:12px;background:#f8fbfa;font-size:18px;font-weight:800;text-align:right">${fmt(existingAmount*defaultRate,'EUR')}</div></div>
 </div>
 <div class="field"><label>Catégorie</label><select name="category">${categories().map(c=>`<option ${c.name===existing?.category?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
 <div class="field"><label>Répartition (${selectedCurrency})</label><select name="mode" id="splitMode"><option value="equal" ${!hasCustom?'selected':''}>À parts égales</option><option value="custom" ${hasCustom?'selected':''}>Montants personnalisés (${selectedCurrency})</option></select></div>
 <div id="customSplit" class="${hasCustom?'':'hidden'}">${splitFields(existingSplits)}</div>
 <div class="field"><label>Ticket</label><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button type="button" id="takePhotoBtn" class="secondary" aria-label="Prendre le ticket en photo" style="width:54px;height:48px;padding:0;font-size:24px">📷</button><button type="button" id="removePhotoBtn" class="danger" ${existing?.photo?'':'style="display:none"'}>Supprimer la photo</button><span class="small muted">Touchez l’appareil photo pour prendre ou choisir le ticket.</span></div><input id="expensePhotoInput" name="photo" type="file" accept="image/*" capture="environment" hidden><input type="hidden" name="removePhoto" id="removePhotoFlag" value="0"></div>
 <div id="expensePhotoPreviewWrap" style="${existing?.photo?'':'display:none;'}margin-top:8px"><img id="expensePhotoPreview" src="${existing?.photo||''}" alt="Aperçu du ticket" style="display:block;width:100%;max-height:420px;object-fit:contain;border-radius:14px;border:1px solid #dde5e2;background:#f8fbfa"></div><button type="submit" id="expenseHiddenSubmit" style="display:none" tabindex="-1">Valider</button>`,async(fd,d)=>{
   const amount=Number(fd.get('amount')),currency=String(fd.get('currency')||selectedCurrency),rate=Number(fd.get('rate')),amountEur=amount*rate;
   if(max!==null&&amount>max+.001)return alert('Cette dépense dépasse le cash restant du retrait.');
   let splits={};
   if(fd.get('mode')==='equal'){const each=amount/g.participants.length;g.participants.forEach((p,i)=>splits[p.id]=i===g.participants.length-1?amount-each*(g.participants.length-1):each)}
   else{let total=0;g.participants.forEach(p=>{const v=Number(fd.get('split_'+p.id)||0);splits[p.id]=v;total+=v});if(Math.abs(total-amount)>.01)return alert(`La somme des répartitions doit être égale au montant de la dépense (${fmt(amount,currency)}).`)}
   let photo=fd.get('removePhoto')==='1'?'':(existing?.photo||'');const file=fd.get('photo');if(file&&file.size)photo=await compressImage(file);
   g.lastRates[currency]=rate;
   const data={id:existing?.id||uid(),title:fd.get('title'),info:String(fd.get('info')||''),amount,currency,rate,amountEur,date:fd.get('date'),category:fd.get('category'),payerId:fd.get('payerId'),paymentMethod:fd.get('paymentMethod')||'CB',splits,withdrawalId:linkedWithdrawalId||null,photo};
   if(existing)Object.assign(existing,data);else g.expenses.push(data);
   d.close();save();
 });
 setTimeout(()=>{
   const cur=document.getElementById('expenseCurrency'),rate=document.getElementById('expenseRate'),amount=document.getElementById('expenseAmount'),result=document.getElementById('expenseEuroResult');
   const updateEuro=()=>{const a=Number(amount?.value||0),r=Number(rate?.value||0);if(result)result.textContent=fmt(a*r,'EUR')};
   if(cur)cur.onchange=()=>{rate.value=g.lastRates[cur.value]||(cur.value==='MAD'?MAD_RATE:1);updateEuro()};if(rate)rate.oninput=updateEuro;if(amount)amount.oninput=updateEuro;
   document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close();const saveBtn=document.getElementById('saveExpenseBtn'),form=document.getElementById('modalForm');if(saveBtn&&form)saveBtn.onclick=()=>{const title=form.querySelector('[name=title]')?.value?.trim();const amt=Number(form.querySelector('[name=amount]')?.value||0);const rt=Number(form.querySelector('[name=rate]')?.value||0);if(!title)return alert('Saisissez un libellé.');if(!(amt>0))return alert('Saisissez un montant supérieur à 0.');if(!(rt>0))return alert('Saisissez un taux de conversion valide.');form.requestSubmit(document.getElementById('expenseHiddenSubmit'));};document.getElementById('splitMode').onchange=e=>document.getElementById('customSplit').classList.toggle('hidden',e.target.value!=='custom');
   const pi=document.getElementById('expensePhotoInput'),pb=document.getElementById('takePhotoBtn'),rb=document.getElementById('removePhotoBtn'),rf=document.getElementById('removePhotoFlag'),pr=document.getElementById('expensePhotoPreview'),pw=document.getElementById('expensePhotoPreviewWrap');if(pb&&pi)pb.onclick=()=>pi.click();if(pi)pi.onchange=()=>{const f=pi.files?.[0];if(!f)return;const u=URL.createObjectURL(f);pr.src=u;pw.style.display='block';if(rf)rf.value='0';if(rb)rb.style.display='inline-block'};if(rb)rb.onclick=()=>{if(pi)pi.value='';if(pr)pr.src='';if(pw)pw.style.display='none';if(rf)rf.value='1';rb.style.display='none'};
 },0)
}

function openIncome(){
 const g=group(),ds=debts();
 if(!ds.length)return alert('Il n’y a actuellement aucune dette à rembourser.');
 const first=ds[0];
 modal(`<h2>+ Revenu</h2><p class="small muted">Enregistrez le remboursement d’une dette entre deux participants. Le montant est saisi en euros et vient diminuer la dette restante.</p>
 <div class="field"><label>Participant qui rembourse</label><select name="fromId">${participantOptions(first.from)}</select></div>
 <div class="field"><label>Participant remboursé</label><select name="toId">${participantOptions(first.to)}</select></div>
 <div class="field"><label>Montant remboursé (EUR)</label><input name="amountEur" type="number" step="0.01" min="0.01" max="${first.amount.toFixed(2)}" value="${first.amount.toFixed(2)}" required></div>
 <div class="field"><label>Date</label><input name="date" type="date" value="${today()}" required></div>
 <div class="small muted">Dette suggérée actuellement : ${esc(participantName(first.from))} → ${esc(participantName(first.to))} : ${fmt(first.amount,'EUR')}</div>
 <div class="modal-actions"><button type="button" class="ghost" id="cancelModal">Annuler</button><button class="primary">Enregistrer</button></div>`,(fd,d)=>{
   const fromId=String(fd.get('fromId')),toId=String(fd.get('toId')),amountEur=Number(fd.get('amountEur'));
   if(fromId===toId)return alert('Choisissez deux participants différents.');
   const debt=debts().find(x=>x.from===fromId&&x.to===toId);
   if(!debt)return alert('Aucune dette n’est actuellement due entre ces deux participants dans ce sens.');
   if(!amountEur||amountEur<=0)return alert('Saisissez un montant supérieur à 0.');
   if(amountEur>debt.amount+0.005)return alert(`Le remboursement dépasse la dette restante (${fmt(debt.amount,'EUR')}).`);
   if(!g.settlements)g.settlements=[];
   g.settlements.push({id:uid(),fromId,toId,amountEur,date:fd.get('date'),type:'repayment'});
   d.close();save();
 });
 setTimeout(()=>document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close(),0)
}

function openWithdrawal(withdrawalId=''){
 const g=group(),existing=withdrawalId?g.withdrawals.find(w=>w.id===withdrawalId):null,cur=withdrawalCurrency(existing||{}),rate=existing?withdrawalRate(existing):(g.lastRates[cur]||1);
 modal(`<h2>${existing?'Modifier le retrait':'Nouveau retrait espèces'}</h2>
 <div class="field"><label>Libellé</label><input name="title" value="${esc(existing?.title||'Retrait espèces')}" required></div>
 <div class="field"><label>Montant</label><input name="amount" type="number" step="0.01" min="0.01" value="${existing?.amount||''}" required></div>
 <div class="field"><label>Devise</label><select name="currency" id="withdrawalCurrency">${currencyOptions(cur)}</select></div>
 <div class="field"><label>Taux de conversion vers EUR (1 unité = ? EUR)</label><input name="rate" id="withdrawalRate" type="number" step="0.000001" min="0.000001" value="${rate}" required></div>
 <div class="field"><label>Date</label><input name="date" type="date" value="${existing?.date||today()}" required></div>
 <div class="field"><label>Retiré par</label><select name="ownerId">${participantOptions(existing?.ownerId||g.participants[0]?.id)}</select></div>
 ${existing?'<p class="small muted">Si vous changez la devise, les dépenses déjà liées à ce retrait prendront automatiquement la même devise. Leur taux de conversion restera modifiable individuellement.</p>':''}
 <div class="modal-actions"><button type="button" class="ghost" id="cancelModal">Annuler</button><button class="primary">${existing?'Enregistrer les modifications':'Enregistrer'}</button></div>`,(fd,d)=>{
   const amount=Number(fd.get('amount')),currency=String(fd.get('currency')),newRate=Number(fd.get('rate')),ownerId=fd.get('ownerId');
   const spent=cashSpentNative(existing||{id:''});if(existing&&amount+0.001<spent)return alert(`Le montant du retrait ne peut pas être inférieur aux dépenses déjà ventilées (${fmt(spent,withdrawalCurrency(existing))}).`);
   g.lastRates[currency]=newRate;
   const data={id:existing?.id||uid(),title:fd.get('title'),amount,currency,rate:newRate,amountEur:amount*newRate,date:fd.get('date'),ownerId};
   if(existing){const oldCurrency=withdrawalCurrency(existing);Object.assign(existing,data);if(oldCurrency!==currency){g.expenses.filter(e=>e.withdrawalId===existing.id).forEach(e=>{e.currency=currency;e.amountEur=Number(e.amount||0)*Number(e.rate||newRate)})}}
   else g.withdrawals.push(data);
   d.close();save();
 });
 setTimeout(()=>{const c=document.getElementById('withdrawalCurrency'),r=document.getElementById('withdrawalRate');c.onchange=()=>r.value=g.lastRates[c.value]||1;document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close()},0)
}

function openWithdrawalDetails(id){
 const w=group().withdrawals.find(x=>x.id===id);if(!w)return;const cur=withdrawalCurrency(w),expenses=group().expenses.filter(e=>e.withdrawalId===id).sort((a,b)=>b.date.localeCompare(a.date)),spent=cashSpentNative(w),rem=cashRemainingNative(w);
 closeOnlyModal(`<div style="position:sticky;top:-18px;z-index:30;margin:-18px -18px 14px;padding:12px 18px;background:rgba(255,255,255,.98);backdrop-filter:blur(10px);border-bottom:1px solid #dde5e2;display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><button type="button" class="secondary" id="detailAddExpense" style="padding:10px 6px">+ Dépense</button><button type="button" class="secondary" id="detailEditWithdrawal" style="padding:10px 6px">Modifier le retrait</button><button type="button" class="ghost" id="cancelModal" style="padding:10px 6px">Fermer</button></div><h2>${esc(w.title||'Retrait espèces')}</h2><div class="small muted">${fmtDate(w.date)} · ${esc(participantName(w.ownerId))}</div><div class="grid" style="margin-top:12px"><div class="stat"><span class="small muted">Montant</span><strong>${fmt(w.amount,cur)}</strong></div><div class="stat"><span class="small muted">Restant</span><strong>${fmt(rem,cur)}</strong></div></div><h3 style="margin-top:18px">Détail des dépenses</h3>${expenses.map(e=>`${withdrawalDetailExpenseRow(e)}<div class="btnrow" style="justify-content:flex-end"><button type="button" class="secondary small" data-detail-edit-exp="${e.id}">Modifier</button></div>`).join('')||'<div class="empty">Aucune dépense liée à ce retrait.</div>'}`);
 setTimeout(()=>{document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close();document.getElementById('detailAddExpense').onclick=()=>{document.getElementById('modal').close();openExpense(w.id)};document.getElementById('detailEditWithdrawal').onclick=()=>{document.getElementById('modal').close();openWithdrawal(w.id)};document.querySelectorAll('[data-detail-edit-exp]').forEach(x=>x.onclick=()=>{document.getElementById('modal').close();openExpense('',x.dataset.detailEditExp)})},0)
}

function openGroup(){modal(`<h2>Nouveau groupe / voyage</h2><div class="field"><label>Nom</label><input name="name" required placeholder="Ex. Marrakech 2026"></div><div class="field"><label>Devise</label><select name="currency">${currencyOptions('EUR')}</select></div><div class="modal-actions"><button type="button" class="ghost" id="cancelModal">Annuler</button><button class="primary">Créer</button></div>`,(fd,d)=>{const id=uid();state.groups.push({id,name:fd.get('name'),currency:fd.get('currency'),participants:[{id:uid(),name:'Moi'}],expenses:[],withdrawals:[]});state.activeGroupId=id;d.close();save()});setTimeout(()=>document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close(),0)}
function openParticipant(){modal(`<h2>Ajouter un participant</h2><div class="field"><label>Nom</label><input name="name" required></div><div class="modal-actions"><button type="button" class="ghost" id="cancelModal">Annuler</button><button class="primary">Ajouter</button></div>`,(fd,d)=>{group().participants.push({id:uid(),name:fd.get('name')});d.close();save()});setTimeout(()=>document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close(),0)}
function openEditParticipant(id){const p=group().participants.find(p=>p.id===id);if(!p)return;modal(`<h2>Modifier le participant</h2><div class="field"><label>Nom</label><input name="name" value="${esc(p.name)}" required></div><div class="modal-actions"><button type="button" class="ghost" id="cancelModal">Annuler</button><button class="primary">Enregistrer</button></div>`,(fd,d)=>{const name=String(fd.get('name')||'').trim();if(!name)return alert('Saisissez un nom.');p.name=name;d.close();save()});setTimeout(()=>document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close(),0)}
function openCategory(categoryId=''){const g=group(),existing=categoryId?categories().find(c=>c.id===categoryId):null;const defaultIcon=existing?.iconName||CATEGORY_ICONS[existing?.name]||'tag',defaultColor=existing?.color||CATEGORY_COLORS[existing?.name]||'#0b6b5b';modal(`<h2>${existing?'Modifier la catégorie':'Ajouter une catégorie'}</h2><div class="field"><label>Nom</label><input name="name" required value="${esc(existing?.name||'')}" placeholder="Ex. Café"></div><div class="field"><label>Icône</label><input name="iconName" value="${esc(defaultIcon)}" placeholder="Ex. coffee"><div class="small muted">Nom d’icône Lucide : coffee, plane, fuel, hotel, gift, etc.</div></div><div class="field"><label>Couleur de l’icône</label><input name="color" type="color" value="${esc(defaultColor)}" style="height:48px;padding:4px"></div><div class="modal-actions"><button type="button" class="ghost" id="cancelModal">Annuler</button><button class="primary">${existing?'Enregistrer':'Ajouter'}</button></div>`,(fd,d)=>{const oldName=existing?.name||'',name=String(fd.get('name')).trim(),iconName=String(fd.get('iconName')).trim().toLowerCase().replace(/[^a-z0-9-]/g,'-')||'tag',color=String(fd.get('color')||'#0b6b5b');if(existing){existing.name=name;existing.iconName=iconName;existing.color=color;existing.icon=categoryIconUrl(existing);if(oldName!==name)g.expenses.forEach(e=>{if(e.category===oldName)e.category=name})}else{const c={id:uid(),name,iconName,color};c.icon=categoryIconUrl(c);g.categories.push(c)}d.close();save()});setTimeout(()=>document.getElementById('cancelModal').onclick=()=>document.getElementById('modal').close(),0)}
async function compressImage(file){return new Promise((resolve,reject)=>{const img=new Image(),r=new FileReader();r.onload=()=>img.src=r.result;r.onerror=reject;img.onload=()=>{const max=1200,scale=Math.min(1,max/img.width,max/img.height),c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.7))};r.readAsDataURL(file)})}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mes-depenses-sauvegarde.json';a.click();URL.revokeObjectURL(a.href)}
function importData(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);if(!x.groups)throw 0;if(confirm('Remplacer les données actuelles par cette sauvegarde ?')){state=migrateToV5(x);save()}}catch{alert('Fichier de sauvegarde invalide.')}};r.readAsText(f)}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{tab=b.dataset.tab==='balances'?'home':b.dataset.tab;render()});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;document.getElementById('installBtn').classList.remove('hidden')});
document.getElementById('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();deferredPrompt=null}else alert('Sur iPhone : Safari > Partager > Sur l’écran d’accueil')};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js'));
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudReady())cloudPull(false).catch(()=>{})});
render();
startCloudSync();
setTimeout(()=>handleInviteHash(),100);
