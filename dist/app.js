'use strict';
const $=id=>document.getElementById(id);
const API='https://api-mainnet.xo.market/api';
const BOOK_URL='wss://orderbooks.xo.market/ws/market';
const state={
  markets:[],selected:null,side:'Yes',category:'',page:1,request:0,selection:0,plans:[],view:'workspace',
  windowKey:'1D',conn:'connecting',plot:[],lastShown:null,tapeSig:'',hover:null
};
try{
  const p=JSON.parse(localStorage.getItem('xo-lens-plans')||'[]');
  if(Array.isArray(p))state.plans=p.filter(x=>x&&typeof x.title==='string'&&x.inputs).slice(0,500);
}catch{}
const money=n=>(n<0?'−':n>0?'+':'')+'$'+Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function marketTitle(m){return m.groupTitle&&!m.title.toLowerCase().includes(m.groupTitle.toLowerCase())?m.title+' · '+m.groupTitle:m.title}
function shortTitle(m){const t=m.groupTitle||m.title||'Market';return t.length>42?t.slice(0,40)+'…':t}
function safeURL(s){try{const u=new URL(s);return u.protocol==='https:'?u.href:''}catch{return ''}}
function calculate(price,budget,prob,costs){
  if(![price,budget,prob,costs].every(Number.isFinite)||price<=0||price>=100||budget<=0||budget>1e6||prob<0||prob>100||costs<0||costs>1e6)throw Error('Use a price between 0 and 100¢, a positive budget up to $1,000,000, and non-negative costs.');
  const shares=budget/(price/100),total=budget+costs,be=total/shares*100;
  return{shares,win:shares-total,loss:-total,ev:prob/100*shares-total,breakeven:be,edge:prob-be};
}
function inputs(){return{price:Number($('price').value),budget:Number($('budget').value),prob:Number($('prob').value),costs:Number($('costs').value)}}
function update(){
  const i=inputs();
  $('probvalue').textContent=i.prob+'%';
  try{
    const r=calculate(i.price,i.budget,i.prob,i.costs);
    $('validation').textContent='';
    $('save').disabled=false;
    for(const k of ['ev','win','loss'])$(k).textContent=money(r[k]);
    $('ev').classList.toggle('pos',r.ev>0);
    $('ev').classList.toggle('neg',r.ev<0);
    $('breakeven').textContent=r.breakeven.toFixed(1)+'%';
    $('edge').textContent=(r.edge>0?'+':'')+r.edge.toFixed(1)+' pp';
    $('edgefill').style.width=Math.max(0,Math.min(100,i.prob))+'%';
    $('breakmarker').style.left=Math.max(0,Math.min(100,r.breakeven))+'%';
    $('interpretation').textContent=r.breakeven>100?'Costs exceed the possible payout, even if you’re right.':r.edge>0?'Your estimate is above break-even. The outcome remains uncertain.':r.edge<0?'Your estimate is below break-even at this entry price.':'Your estimate matches the break-even probability.';
    return r;
  }catch(e){
    $('validation').textContent=e.message;
    $('save').disabled=true;
    for(const k of ['ev','win','loss','breakeven','edge'])$(k).textContent='—';
    $('ev').classList.remove('pos','neg');
    return null;
  }
}
function setSide(side,resetPrice=true){
  state.side=side;
  $('sidetext').textContent=side;
  for(const s of ['Yes','No']){
    $(s.toLowerCase()).classList.toggle('selected',s===side);
    $(s.toLowerCase()).setAttribute('aria-pressed',s===side);
  }
  if(resetPrice&&state.selected){
    const o=state.selected.outcomes?.find(o=>o.title.toLowerCase()===side.toLowerCase());
    const p=Number(o?.currentPrice)/10000;
    if(p>0&&p<100)$('price').value=p.toFixed(1);
  }
  $('prob').value=100-Number($('prob').value);
  update();
}

function sparkPath(points){
  if(!points||points.length<2)return '';
  const ys=points.map(p=>p.yes);
  let min=Math.min(...ys),max=Math.max(...ys);
  if(max-min<0.4){const mid=(min+max)/2;min=mid-.2;max=mid+.2}
  const w=72,h=28,pad=2;
  return points.map((p,i)=>{
    const x=pad+(i/(points.length-1))*(w-pad*2);
    const y=pad+(1-(p.yes-min)/(max-min))*(h-pad*2);
    return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1);
  }).join(' ');
}
function sparkMarkup(id){
  const pts=sparks.get(id);
  if(!pts||pts.length<2)return '<svg class="spark" viewBox="0 0 72 28" aria-hidden="true"></svg>';
  const down=pts.at(-1).yes<pts[0].yes;
  return `<svg class="spark${down?' down':''}" viewBox="0 0 72 28" aria-hidden="true"><path d="${sparkPath(pts)}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function renderMarkets(){
  const container=$('marketlist');
  const scroll=container.scrollTop;
  container.replaceChildren();
  for(const m of state.markets){
    const b=document.createElement('button');
    b.type='button';
    b.className='market'+(state.selected?.id===m.id?' selected':'');
    b.dataset.id=m.id;
    const shown=liveYes(m);
    const open=quote(m,'yes');
    const p=shown==null?open:shown;
    const image=safeURL(m.imageUrl);
    const pillClass=open!=null&&p!=null?(p>open+.05?' up':p<open-.05?' down':''):'';
    b.innerHTML=`<div class="market-top">${image?`<img src="${esc(image)}" alt="" loading="lazy">`:''}<strong>${esc(marketTitle(m))}</strong></div><div class="market-bottom"><span class="cat">${esc(m.categoryPath?.[0]?.name||m.category?.[0]?.name||'Market')}</span>${sparkMarkup(m.id)}<span class="pricepill${pillClass}" data-open="${open??''}">Yes ${p!=null&&p>=0&&p<=100?p.toFixed(1)+'¢':'—'}</span></div>`;
    b.onclick=()=>selectMarket(m);
    container.append(b);
    wantSpark(m);
  }
  if(!state.markets.length){
    const p=document.createElement('p');
    p.className='empty';
    p.textContent='No matching markets. Try another search or a custom scenario.';
    container.append(p);
  }
  container.scrollTop=scroll;
  renderTape(true);
}
async function loadMarkets(append=false){
  const req=++state.request;
  $('feedstatus').textContent='Loading markets…';
  $('refresh').disabled=true;
  $('loadmore').disabled=true;
  const params=new URLSearchParams({take:'18',page:String(state.page),statuses:'ACTIVE',sortBy:'totalVolumeInUSD',sortOrder:'DESC'});
  if($('search').value.trim())params.set('search',$('search').value.trim());
  if(state.category)params.set('categories',state.category);
  try{
    const r=await fetch(API+'/markets/browse?'+params,{signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error();
    const data=await r.json();
    if(req!==state.request)return;
    const rows=data.data.flatMap(row=>row.kind==='event'&&row.event?.slug?(row.markets||[]).map(item=>({...item.market,eventSlug:row.event.slug,groupTitle:item.groupTitle})):[]).filter(isCurrentMarket).sort((a,b)=>Number(b.totalVolumeInUSD)-Number(a.totalVolumeInUSD));
    state.markets=append?[...new Map([...state.markets.filter(isCurrentMarket),...rows].map(m=>[m.id,m])).values()]:rows;
    renderMarkets();
    $('feedstatus').textContent='● Catalogue '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' · open markets only';
    $('loadmore').hidden=!data.meta?.hasNextPage;
    rebuildTokenIndex();
    syncSubscriptions();
    if(!state.selected&&state.markets.length&&state.selection===0)selectMarket(state.markets[0]);
  }catch{
    if(req!==state.request)return;
    state.markets=[];
    renderMarkets();
    $('feedstatus').textContent='XO unavailable. Refresh to verify current markets.';
    $('loadmore').hidden=true;
  }finally{
    if(req===state.request){$('refresh').disabled=false;$('loadmore').disabled=false}
  }
}
async function selectMarket(m){
  const sel=++state.selection;
  let verified;
  try{
    verified=await fetchCurrentMarket(m);
    if(sel!==state.selection)return false;
    if(!isCurrentMarket(verified)){
      state.markets=state.markets.filter(x=>x.id!==m.id);
      renderMarkets();
      $('feedstatus').textContent='That market is no longer open. Choose another current market.';
      return false;
    }
  }catch{
    if(sel===state.selection)$('feedstatus').textContent='Could not verify this market on XO. Please retry.';
    return false;
  }
  m=verified;
  state.selected=m;
  state.lastShown=null;
  state.side='Yes';
  $('yes').classList.add('selected');
  $('no').classList.remove('selected');
  $('yes').setAttribute('aria-pressed','true');
  $('no').setAttribute('aria-pressed','false');
  $('sidetext').textContent='Yes';
  $('title').textContent=marketTitle(m);
  $('category').textContent=(m.categoryPath?.[0]?.name||'XO MARKET')+' / POSITION PLANNER';
  $('expiry').textContent=m.expiresAt?'Closes '+new Date(m.expiresAt).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'Deadline not supplied';
  $('marketlink').href='https://beta.xo.market/event/'+encodeURIComponent(m.eventSlug);
  $('customtitle').hidden=true;
  $('reviewed').checked=false;
  $('note').value='';
  $('savestatus').textContent='';
  const o=m.outcomes.find(x=>/^yes$/i.test(x.title));
  const p=Number(o?.currentPrice)/10000;
  $('price').value=p>0&&p<100?p.toFixed(1):50;
  $('prob').value=50;
  $('pricehint').textContent='Indicative XO price. Adjust to your actual fill price; available liquidity may differ.';
  noteObservation(m,quote(m,'yes'),quote(m,'no'));
  renderMarkets();
  update();
  renderQuote();
  loadHistory(m);
  rebuildTokenIndex();
  syncSubscriptions();
  $('rulestext').textContent='Loading published rules…';
  $('sources').replaceChildren();
  try{
    const d=verified;
    if(sel!==state.selection)return;
    state.selected={...m,...d};
    const rules=d.rules;
    const text=typeof rules==='string'?rules:rules?.description||Object.entries(rules||{}).map(([k,v])=>k+': '+(typeof v==='string'?v:JSON.stringify(v))).join('\n\n');
    $('rulestext').textContent=text||d.description||'Rules were not supplied by the API. Read the market on XO before planning a position.';
    for(const s of d.resolutionSources||[]){
      const url=safeURL(s);
      if(url){
        const a=document.createElement('a');
        a.href=url;a.target='_blank';a.rel='noopener';
        a.textContent=new URL(url).hostname+' ↗';
        $('sources').append(a);
      }
    }
  }catch{
    if(sel===state.selection)$('rulestext').textContent='Rules could not be loaded. Use “View on XO” to read the original market.';
  }
  return true;
}
function custom(){
  ++state.selection;
  state.selected=null;
  state.lastShown=null;
  renderQuote();
  $('title').textContent='Your next conviction.';
  $('category').textContent='CUSTOM SCENARIO';
  $('expiry').textContent='Enter your own assumptions';
  $('customtitle').hidden=false;
  $('marketlink').href='https://beta.xo.market';
  $('rulestext').textContent='Review the original market’s deadline, resolution sources, and void clause before trading.';
  $('sources').replaceChildren();
  $('reviewed').checked=false;
  $('pricehint').textContent='Enter your planned fill price. No order is placed.';
  renderMarkets();
  $('question').focus();
}
function show(view){
  state.view=view;
  $('workspace').hidden=view!=='workspace';
  $('journal').hidden=view!=='journal';
  $('exploreNav').classList.toggle('active',view==='workspace');
  $('journalNav').classList.toggle('active',view==='journal');
  if(view==='journal')renderPlans();
}
function save(){
  const r=update();
  if(!r)return;
  const title=(state.selected?marketTitle(state.selected):'')||$('question').value.trim();
  if(!title){$('savestatus').textContent='Add a market question before saving.';return}
  const plan={id:crypto.randomUUID(),title,market:state.selected,side:state.side,inputs:inputs(),note:$('note').value,reviewed:$('reviewed').checked,created:new Date().toISOString()};
  const next=[plan,...state.plans].slice(0,500);
  try{
    localStorage.setItem('xo-lens-plans',JSON.stringify(next));
    state.plans=next;
    $('count').textContent=next.length;
    $('savestatus').textContent='Plan saved. Find it in My plans.';
  }catch{$('savestatus').textContent='Your browser couldn’t save this plan. Storage may be full or disabled.'}
}
function renderPlans(){
  $('plans').replaceChildren();
  $('export').disabled=!state.plans.length;
  if(!state.plans.length){
    const d=document.createElement('div');
    d.className='empty';
    d.textContent='No plans yet. Build a scenario in the workspace and save your thinking.';
    $('plans').append(d);
    return;
  }
  for(const p of state.plans){
    let r;
    try{r=calculate(p.inputs.price,p.inputs.budget,p.inputs.prob,p.inputs.costs)}catch{continue}
    const d=document.createElement('article');
    d.className='plan';
    d.innerHTML=`<div class="eyebrow">${esc(new Date(p.created).toLocaleDateString())} · ${esc(p.side)} · ${p.reviewed?'RULES REVIEWED':'RULES NOT REVIEWED'}</div><h3>${esc(p.title)}</h3><p>$${esc(p.inputs.budget)} at ${esc(p.inputs.price)}¢ · Your probability ${esc(p.inputs.prob)}% · Expected net ${esc(money(r.ev))}</p><p>${esc(p.note||'No note added.')}</p>`;
    const reopen=document.createElement('button');
    reopen.type='button';
    reopen.className='chip';
    reopen.textContent='Reopen plan ↗';
    reopen.onclick=async()=>{
      show('workspace');
      if(p.market){
        const ok=await selectMarket(p.market);
        if(ok===false){custom();$('question').value=p.title;$('expiry').textContent='Saved scenario only · current XO market could not be verified'}
      }else{custom();$('question').value=p.title}
      state.side=p.side;
      for(const s of ['Yes','No']){
        $(s.toLowerCase()).classList.toggle('selected',s===p.side);
        $(s.toLowerCase()).setAttribute('aria-pressed',s===p.side);
      }
      $('sidetext').textContent=p.side;
      for(const[k,v]of Object.entries(p.inputs))$(k).value=v;
      $('note').value=p.note;
      $('reviewed').checked=p.reviewed;
      $('pricehint').textContent='Saved assumptions from '+new Date(p.created).toLocaleString()+'. Update your entry price before using this plan.';
      update();
    };
    const del=document.createElement('button');
    del.type='button';
    del.className='chip';
    del.textContent='Remove';
    del.onclick=()=>{
      const next=state.plans.filter(x=>x.id!==p.id);
      try{localStorage.setItem('xo-lens-plans',JSON.stringify(next));state.plans=next;$('count').textContent=next.length;renderPlans()}
      catch{del.textContent='Could not remove'}
    };
    d.append(reopen,del);
    $('plans').append(d);
  }
}

for(const id of ['price','budget','prob','costs'])$(id).addEventListener('input',update);
$('yes').onclick=()=>{if(state.side!=='Yes')setSide('Yes')};
$('no').onclick=()=>{if(state.side!=='No')setSide('No')};
$('searchform').onsubmit=e=>{e.preventDefault();state.page=1;loadMarkets()};
$('refresh').onclick=()=>{state.page=1;loadMarkets()};
$('loadmore').onclick=()=>{state.page++;loadMarkets(true)};
document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{
  state.category=b.dataset.cat;state.page=1;
  document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('chosen',x===b));
  loadMarkets();
});
document.querySelectorAll('[data-window]').forEach(b=>b.onclick=()=>{
  state.windowKey=b.dataset.window;
  document.querySelectorAll('[data-window]').forEach(x=>x.classList.toggle('chosen',x===b));
  if(state.selected)loadHistory(state.selected);
  else renderQuote();
});
$('manual').onclick=custom;
$('save').onclick=save;
$('exploreNav').onclick=()=>show('workspace');
$('journalNav').onclick=()=>show('journal');
$('export').onclick=()=>{
  const blob=new Blob([JSON.stringify({app:'XO Lens',exportedAt:new Date().toISOString(),plans:state.plans},null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='xo-lens-plans.json';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('count').textContent=state.plans.length;
document.addEventListener('keydown',e=>{
  if(e.key==='/'&&document.activeElement?.tagName!=='INPUT'&&document.activeElement?.tagName!=='TEXTAREA'){
    e.preventDefault();
    show('workspace');
    $('search').focus();
  }
});
if(document.modelContext?.registerTool){
  try{
    Promise.resolve(document.modelContext.registerTool({
      name:'configure_position_scenario',
      title:'Configure position scenario',
      description:'Update the visible scenario inputs without saving or trading.',
      inputSchema:{type:'object',properties:{price:{type:'number',exclusiveMinimum:0,exclusiveMaximum:100},budget:{type:'number',exclusiveMinimum:0,maximum:1000000},prob:{type:'number',minimum:0,maximum:100},costs:{type:'number',minimum:0,maximum:1000000}},required:['price','budget','prob','costs'],additionalProperties:false},
      annotations:{readOnlyHint:false},
      execute(v){
        const r=calculate(v.price,v.budget,v.prob,v.costs);
        for(const[k,val]of Object.entries(v)){
          if(!['price','budget','prob','costs'].includes(k))throw Error('Unknown field');
          $(k).value=val;
        }
        show('workspace');
        update();
        return r;
      }
    })).catch(()=>{});
  }catch{}
}

const observations=new Map(),histories=new Map(),books=new Map(),prints=new Map(),sparks=new Map(),tokenIndex=new Map();
const sparkQueue=[];
let sparkActive=0;
function blankBook(){return{yes:{bids:[],asks:[],bid:null,ask:null,last:null,lastSize:null,lastSide:'',ts:0},no:{bids:[],asks:[],bid:null,ask:null,last:null,lastSize:null,lastSide:'',ts:0}}}
function tokenOf(m,side){const o=m?.outcomes?.find(x=>x.title?.toLowerCase()===side);return o?.outcomeTokenId||o?.tokenId||''}
function isCurrentMarket(m){
  const now=Date.now();
  return m?.status==='ACTIVE'&&!m.resolvedAt&&Number.isFinite(Date.parse(m.expiresAt))&&Date.parse(m.expiresAt)>now&&(!m.startsAt||Date.parse(m.startsAt)<=now)&&m.id&&m.slug&&['yes','no'].every(side=>m.outcomes?.some(o=>o.title?.toLowerCase()===side));
}
function quote(m,side){
  const v=m?.outcomes?.find(o=>o.title?.toLowerCase()===side)?.currentPrice;
  const n=v==null?NaN:Number(v)/10000;
  return Number.isFinite(n)&&n>=0&&n<=100?n:null;
}
function centsFromBook(s){
  if(s==null||s==='')return null;
  const n=Number(s);
  if(!Number.isFinite(n)||n<0||n>1)return null;
  return n*100;
}
function parseSize(raw){
  const s=String(raw??'');
  const n=Number(s);
  if(!Number.isFinite(n)||n<0)return null;
  if(!s.includes('.')&&n>=1e6)return n/1e6;
  return n;
}
function parseLevels(rows){
  const out=[];
  for(const row of rows||[]){
    const price=centsFromBook(row.price);
    const size=parseSize(row.size);
    if(price==null||size==null||size<=0)continue;
    out.push({price,size});
  }
  return out;
}
function formatShares(n){
  if(n==null||!Number.isFinite(n))return '—';
  if(n>=1000)return n.toLocaleString(undefined,{maximumFractionDigits:0});
  if(n>=10)return n.toFixed(1);
  return n.toFixed(n>=1?1:2);
}
function noteObservation(m,yes,no){
  if(!m||yes==null)return;
  const list=observations.get(m.id)||[];
  const last=list.at(-1);
  if(last&&Math.abs(last.yes-yes)<0.005&&Date.now()-last.t<800)return;
  list.push({t:Date.now(),yes,no});
  observations.set(m.id,list.slice(-240));
}
function legOf(id,side){return (books.get(id)||blankBook())[side]}
function liveYes(m){
  if(!m)return null;
  const leg=books.get(m.id)?.yes;
  if(leg?.bid!=null&&leg?.ask!=null)return (leg.bid+leg.ask)/2;
  if(leg?.last!=null)return leg.last;
  if(leg?.bid!=null)return leg.bid;
  if(leg?.ask!=null)return leg.ask;
  return quote(m,'yes');
}
function liveNo(m){
  if(!m)return null;
  const leg=books.get(m.id)?.no;
  if(leg?.bid!=null&&leg?.ask!=null)return (leg.bid+leg.ask)/2;
  if(leg?.last!=null)return leg.last;
  if(leg?.bid!=null)return leg.bid;
  if(leg?.ask!=null)return leg.ask;
  return quote(m,'no');
}
function priceSource(m){
  const leg=books.get(m.id)?.yes;
  if(leg?.bid!=null&&leg?.ask!=null)return 'Mid';
  if(leg?.last!=null)return 'Last print';
  if(leg?.bid!=null)return 'Bid';
  if(leg?.ask!=null)return 'Ask';
  if(quote(m,'yes')!=null)return 'Catalogue';
  return 'No price';
}
async function fetchCurrentMarket(m){
  if(!m.eventSlug)throw Error('No verified event');
  const r=await fetch(API+'/v1/events/slug/'+encodeURIComponent(m.eventSlug),{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Event unavailable');
  const event=(await r.json()).data;
  const current=event?.markets?.find(x=>x.market?.id===m.id)?.market;
  if(!current)throw Error('Market no longer listed');
  return {...current,eventSlug:event.slug,groupTitle:event.markets.find(x=>x.market.id===m.id)?.groupTitle};
}
let historyReq=0;
async function loadHistory(m,windowKey=state.windowKey){
  const req=++historyReq;
  const key=m.id+':'+windowKey;
  try{
    const r=await fetch(API+'/charts/market/'+m.id+'/points?window='+windowKey,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('chart');
    const data=await r.json();
    const points=data.outcomes?.find(x=>x.title?.toLowerCase()==='yes')?.points||[];
    const rows=points.filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.p)&&x.p>=0&&x.p<=1).map(x=>({t:x.t*1000,yes:x.p*100})).sort((a,b)=>a.t-b.t);
    if(req!==historyReq)return;
    histories.set(key,rows);
    if(windowKey==='1H'&&rows.length>1){
      const step=Math.max(1,Math.floor(rows.length/28));
      sparks.set(m.id,rows.filter((_,i)=>i%step===0||i===rows.length-1));
      const svg=document.querySelector(`.market[data-id="${m.id}"] .spark`);
      if(svg)svg.outerHTML=sparkMarkup(m.id);
    }
  }catch{
    if(req===historyReq&&state.selected?.id===m.id&&state.windowKey===windowKey)$('chartnote').textContent='Chart history did not load. The live book is still shown when XO sends it.';
  }
  if(req===historyReq&&state.selected?.id===m.id&&state.windowKey===windowKey)renderQuote();
}
function wantSpark(m){
  if(sparks.has(m.id)||sparkQueue.includes(m.id))return;
  sparkQueue.push(m.id);
  pumpSparks();
}
function pumpSparks(){
  while(sparkActive<2&&sparkQueue.length){
    const id=sparkQueue.shift();
    sparkActive++;
    fetch(API+'/charts/market/'+id+'/points?window=1H',{cache:'no-store',signal:AbortSignal.timeout(10000)})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        const points=data?.outcomes?.find(x=>x.title?.toLowerCase()==='yes')?.points||[];
        const rows=points.filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.p)&&x.p>=0&&x.p<=1).map(x=>({t:x.t*1000,yes:x.p*100}));
        if(rows.length>1){
          const step=Math.max(1,Math.floor(rows.length/28));
          sparks.set(id,rows.filter((_,i)=>i%step===0||i===rows.length-1));
          const svg=document.querySelector(`.market[data-id="${id}"] .spark`);
          if(svg)svg.outerHTML=sparkMarkup(id);
        }else sparks.set(id,[]);
      })
      .catch(()=>{sparks.set(id,[])})
      .finally(()=>{sparkActive--;pumpSparks()});
  }
}

function renderTape(force){
  const sig=state.markets.map(m=>m.id).join(',');
  if(!force&&sig===state.tapeSig)return;
  state.tapeSig=sig;
  const once=state.markets.slice(0,14).map(m=>{
    const p=liveYes(m);
    return `<span class="tape-item" data-tape="${m.id}"><b>${esc(shortTitle(m))}</b><em>${p==null?'—':p.toFixed(1)+'¢'}</em></span>`;
  }).join('');
  const half=once&&state.markets.length<8?once.repeat(Math.ceil(8/state.markets.length)):once;
  $('tape').innerHTML=half?half+half:'<span class="tape-item"><b>Waiting for open XO markets</b><em>—</em></span>';
}
function patchPrices(){
  renderTape(false);
  for(const m of state.markets){
    const p=liveYes(m);
    const text=p==null?'—':p.toFixed(1)+'¢';
    document.querySelectorAll(`[data-tape="${m.id}"] em`).forEach(el=>{if(el.textContent!==text)el.textContent=text});
    const pill=document.querySelector(`.market[data-id="${m.id}"] .pricepill`);
    if(!pill||p==null)continue;
    const label='Yes '+p.toFixed(1)+'¢';
    if(pill.textContent!==label)pill.textContent=label;
    const open=pill.dataset.open===''?null:Number(pill.dataset.open);
    pill.classList.toggle('up',open!=null&&p>open+.05);
    pill.classList.toggle('down',open!=null&&p<open-.05);
  }
}

function ensureChart(){
  const svg=$('pricechart');
  if(svg.dataset.ready)return;
  svg.dataset.ready='1';
  svg.setAttribute('viewBox','0 0 720 248');
  svg.innerHTML=`<g id="chartgrid"></g><path id="chartarea" fill="#ff87a628"></path><path id="chartline" fill="none" stroke="#ffb7cb" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></path><path id="chartlive" fill="none" stroke="#ff87a6" stroke-width="1.6" stroke-dasharray="4 5"></path><g id="chartcross" hidden><line id="crossx" stroke="#ffffff40"/><line id="crossy" stroke="#ffffff2e"/><circle id="crossdot" r="4.5" fill="#fff7fa" stroke="#ff87a6" stroke-width="2"/></g><circle id="livedotglow" r="10" fill="#ff87a628"></circle><circle id="livedot" r="3.6" fill="#ffe4ee"></circle><rect id="charthit" width="720" height="248" fill="transparent"></rect>`;
  svg.addEventListener('pointermove',onChartPointer);
  svg.addEventListener('pointerleave',()=>{$('chartcross').setAttribute('hidden','');hideTip()});
}
function seriesOf(m){
  const history=histories.get(m.id+':'+state.windowKey)||[];
  const solid=history.map(p=>({t:p.t,yes:p.yes,source:'XO history'}));
  const lastT=solid.at(-1)?.t||0;
  for(const p of prints.get(m.id)||[]){
    if(p.t>lastT)solid.push({t:p.t,yes:p.yes,source:'Print '+formatShares(p.size)+' sh'});
  }
  const yes=liveYes(m);
  const src=priceSource(m);
  const live=yes==null?null:{t:Date.now(),yes,source:src==='Mid'?'Live mid':src,live:true};
  return {solid,live};
}
function presentPrice(next){
  const prev=state.lastShown;
  const el=$('liveprice');
  if(prev!=null&&next!=null&&Math.abs(next-prev)>=0.01){
    el.classList.remove('tick-up','tick-down');
    el.classList.add(next>prev?'tick-up':'tick-down');
    if(window.gsap&&!reduced.matches)gsap.fromTo(el,{scale:1.045},{scale:1,duration:.35,ease:'power2.out',overwrite:'auto'});
  }
  state.lastShown=next;
}
function renderBook(m){
  const asks=$('asks'),bids=$('bids');
  asks.replaceChildren();
  bids.replaceChildren();
  const leg=m?books.get(m.id)?.yes:null;
  const askLevels=(leg?.asks||[]).slice().sort((a,b)=>a.price-b.price).slice(0,6);
  const bidLevels=(leg?.bids||[]).slice().sort((a,b)=>b.price-a.price).slice(0,6);
  const max=Math.max(1,...askLevels.map(l=>l.size),...bidLevels.map(l=>l.size));
  const row=(level,kind)=>{
    const el=document.createElement('div');
    el.className='level '+kind;
    const bar=document.createElement('i');
    bar.style.transform='scaleX('+(level.size/max)+')';
    const price=document.createElement('b');
    price.textContent=level.price.toFixed(1)+'¢';
    const size=document.createElement('span');
    size.textContent=formatShares(level.size);
    el.append(bar,price,size);
    return el;
  };
  for(const level of askLevels.slice().reverse())asks.append(row(level,'ask'));
  for(const level of bidLevels)bids.append(row(level,'bid'));
  const has=askLevels.length||bidLevels.length;
  $('bookempty').hidden=!!has;
  if(!has)$('bookempty').textContent=m?(leg?.bid!=null||leg?.ask!=null?'Top of book is live. The depth snapshot follows.':'Waiting for the XO book on this market.'):'Select a market to see its book.';
  const spread=leg?.bid!=null&&leg?.ask!=null?leg.ask-leg.bid:null;
  $('spread').textContent=spread==null?'Spread —':'Spread '+spread.toFixed(2)+'¢';
  const last=leg?.last;
  $('lastprint').textContent=last==null?'Last print —':'Last print '+last.toFixed(2)+'¢'+(leg.lastSide?' · '+leg.lastSide.toLowerCase():'')+(leg.lastSize!=null?' · '+formatShares(leg.lastSize)+' sh':'');
}
function renderQuote(){
  ensureChart();
  const m=state.selected;
  if(!m){
    state.plot=[];
    $('chartempty').hidden=false;
    $('chartempty').textContent='Select a current market to start tracking.';
    $('liveprice').innerHTML='—<small>¢</small>';
    $('pricesource').textContent='YES · INDICATIVE';
    $('quotestatus').textContent='No live market selected';
    $('windowchange').textContent='Window —';
    $('sessionchange').textContent='Since open —';
    $('livevolume').textContent='Volume —';
    $('yesquote').textContent='Yes —';
    $('noquote').textContent='No —';
    $('yesweight').style.width='50%';
    $('chartstart').textContent=state.windowKey;
    $('chartend').textContent='LIVE BOOK';
    $('chartnote').textContent='Pick an open market. History comes from XO. The right edge is the live book, never a simulated path.';
    $('chartline').setAttribute('d','');
    $('chartarea').setAttribute('d','');
    $('chartlive').setAttribute('d','');
    $('chartgrid').replaceChildren();
    $('livedot').setAttribute('cx',-20);
    $('livedotglow').setAttribute('cx',-20);
    renderBook(null);
    return;
  }
  const {solid,live}=seriesOf(m);
  const yes=live?.yes??null;
  const no=liveNo(m);
  presentPrice(yes);
  $('pricesource').textContent='YES · '+priceSource(m).toUpperCase();
  $('liveprice').innerHTML=yes==null?'—<small>¢</small>':yes.toFixed(2)+'<small>¢</small>';
  const session=observations.get(m.id)||[];
  const sessionDelta=session.length&&yes!=null?yes-session[0].yes:null;
  $('sessionchange').textContent=sessionDelta==null?'Since open —':(sessionDelta>0?'+':'')+sessionDelta.toFixed(2)+'¢ since open';
  const history=histories.get(m.id+':'+state.windowKey)||[];
  const windowDelta=history.length&&yes!=null?yes-history[0].yes:null;
  $('windowchange').textContent=windowDelta==null?state.windowKey+' —':state.windowKey+' '+(windowDelta>0?'+':'')+windowDelta.toFixed(2)+'¢';
  $('livevolume').textContent='Volume '+new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(Number(m.totalVolumeInUSD)||0);
  $('yesquote').textContent=yes==null?'Yes —':'Yes '+yes.toFixed(2)+'¢';
  $('noquote').textContent=no==null?'No —':'No '+no.toFixed(2)+'¢';
  const yesW=yes!=null&&no!=null&&yes+no?100*yes/(yes+no):50;
  $('yesweight').style.width=yesW+'%';
  const socketLive=socket&&socket.readyState===1;
  $('quotestatus').textContent=(socketLive?'● Book ':'● ')+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  $('chartempty').hidden=!!(solid.length||live);
  const all=[...solid,...(live?[live]:[])];
  const ys=all.map(p=>p.yes);
  let min=ys.length?Math.min(...ys):0,max=ys.length?Math.max(...ys):100;
  if(max-min<1.2){const mid=(min+max)/2||50;min=mid-.6;max=mid+.6}
  min=Math.max(0,min-Math.max(.4,(max-min)*.18));
  max=Math.min(100,max+Math.max(.4,(max-min)*.18));
  if(max-min<1){min=Math.max(0,min-.5);max=Math.min(100,max+.5)}
  const t0=all[0]?.t||Date.now()-60000,t1=Math.max(t0+1000,(live?.t||solid.at(-1)?.t||t0));
  const X=t=>46+(t-t0)/(t1-t0)*662;
  const Y=v=>16+(1-(v-min)/(max-min))*196;
  const grid=$('chartgrid');
  grid.replaceChildren();
  const ticks=3;
  for(let i=0;i<ticks;i++){
    const v=min+(max-min)*i/(ticks-1);
    const y=Y(v);
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1','46');line.setAttribute('x2','708');line.setAttribute('y1',y);line.setAttribute('y2',y);line.setAttribute('stroke','#ffffff10');
    const label=document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('x','0');label.setAttribute('y',y+4);label.setAttribute('fill','#9a909c');label.setAttribute('font-size','10');
    label.textContent=v.toFixed(Math.abs(max-min)<8?1:0)+'¢';
    grid.append(line,label);
  }
  const stamp=(t,anchor)=>{
    const label=document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('x',anchor==='end'?708:46);label.setAttribute('y','240');label.setAttribute('fill','#8f8492');label.setAttribute('font-size','10');
    label.setAttribute('text-anchor',anchor||'start');
    const d=new Date(t);
    label.textContent=state.windowKey==='1W'?d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    grid.append(label);
  };
  if(all.length){stamp(t0,'start');stamp(t1,'end')}
  const pts=solid.map(p=>({...p,x:X(p.t),y:Y(p.yes)}));
  const d=pts.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ');
  $('chartline').setAttribute('d',d);
  const glow=pts.length>1?d+' L'+[...pts].reverse().map(p=>p.x.toFixed(2)+' '+Math.min(212,p.y+26).toFixed(2)).join(' L')+' Z':'';
  $('chartarea').setAttribute('d',glow);
  let livePt=null;
  if(live){
    livePt={...live,x:X(live.t),y:Y(live.yes)};
    const from=pts.at(-1);
    $('chartlive').setAttribute('d',from?`M${from.x.toFixed(2)} ${from.y.toFixed(2)} L${livePt.x.toFixed(2)} ${livePt.y.toFixed(2)}`:'');
    $('livedot').setAttribute('cx',livePt.x);$('livedot').setAttribute('cy',livePt.y);
    $('livedotglow').setAttribute('cx',livePt.x);$('livedotglow').setAttribute('cy',livePt.y);
  }else{
    $('chartlive').setAttribute('d','');
    $('livedot').setAttribute('cx',-20);$('livedotglow').setAttribute('cx',-20);
  }
  state.plot=[...pts,...(livePt?[livePt]:[])];
  const first=history[0];
  $('chartstart').textContent=(first?state.windowKey+' · '+new Date(first.t).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):state.windowKey+' · waiting');
  $('chartend').textContent='YES · '+(socketLive?'LIVE BOOK':'LAST KNOWN');
  $('chartnote').textContent=history.length?'Solid line is XO '+state.windowKey+' history. The dashed step is the live book at the right edge. Indicative, not an executable quote.':'No XO history in this window yet. The dot is the live book, not a drawn path.';
  $('pricechart').setAttribute('aria-label',`${m.title}. ${state.windowKey} Yes history, ${history.length} points. Latest ${yes==null?'unavailable':yes.toFixed(2)+' cents'} from ${priceSource(m)}.`);
  renderBook(m);
}
let deskFrame=0,deskSelected=false;
function scheduleDesk(selectedHit){
  if(selectedHit)deskSelected=true;
  if(deskFrame)return;
  deskFrame=requestAnimationFrame(()=>{
    deskFrame=0;
    const hit=deskSelected;
    deskSelected=false;
    patchPrices();
    if(hit)renderQuote();
  });
}
function onChartPointer(ev){
  const plot=state.plot;
  if(!plot.length)return;
  const rect=$('pricechart').getBoundingClientRect();
  const x=(ev.clientX-rect.left)/rect.width*720;
  let best=0,dist=Infinity;
  for(let i=0;i<plot.length;i++){
    const d=Math.abs(plot[i].x-x);
    if(d<dist){dist=d;best=i}
  }
  const p=plot[best];
  $('chartcross').removeAttribute('hidden');
  $('crossx').setAttribute('x1',p.x);$('crossx').setAttribute('x2',p.x);$('crossx').setAttribute('y1',16);$('crossx').setAttribute('y2',212);
  $('crossy').setAttribute('y1',p.y);$('crossy').setAttribute('y2',p.y);$('crossy').setAttribute('x1',46);$('crossy').setAttribute('x2',708);
  $('crossdot').setAttribute('cx',p.x);$('crossdot').setAttribute('cy',p.y);
  $('tipprice').textContent=p.yes.toFixed(2)+'¢';
  $('tiptime').textContent=new Date(p.t).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  $('tipsource').textContent=p.source;
  moveTip(ev.clientX,ev.clientY);
}
let tipStop=null,tipX=0,tipY=0;
const tipVirtual={getBoundingClientRect(){return{width:0,height:0,x:tipX,y:tipY,top:tipY,left:tipX,right:tipX,bottom:tipY}}};
function moveTip(x,y){
  tipX=x;tipY=y;
  const tip=$('charttip');
  tip.hidden=false;
  const F=window.FloatingUIDOM;
  if(!F)return;
  if(!tipStop){
    tipStop=F.autoUpdate(tipVirtual,tip,()=>{
      F.computePosition(tipVirtual,tip,{placement:'top',strategy:'fixed',middleware:[F.offset(12),F.flip(),F.shift({padding:8})]}).then(({x:px,y:py})=>{
        tip.style.left=px+'px';
        tip.style.top=py+'px';
      });
    },{animationFrame:true});
  }
}
function hideTip(){
  $('charttip').hidden=true;
  if(tipStop){tipStop();tipStop=null}
}

let socket=null,backoff=1000,reconnectTimer=0;
const subscribed=new Set();
function setConn(mode){
  state.conn=mode;
  const el=$('conn');
  el.className='conn '+mode;
  el.textContent=mode==='live'?'Live book':mode==='reconnecting'?'Reconnecting':mode==='rest'?'REST only':'Connecting';
}
function rebuildTokenIndex(){
  tokenIndex.clear();
  const add=m=>{
    if(!m)return;
    const yes=tokenOf(m,'yes'),no=tokenOf(m,'no');
    if(yes)tokenIndex.set(yes,{marketId:m.id,side:'yes'});
    if(no)tokenIndex.set(no,{marketId:m.id,side:'no'});
  };
  state.markets.forEach(add);
  add(state.selected);
}
function desiredAssets(){
  const ids=[];
  const seen=new Set();
  const add=id=>{if(id&&!seen.has(id)){seen.add(id);ids.push(id)}};
  for(const m of state.markets)add(tokenOf(m,'yes'));
  if(state.selected){add(tokenOf(state.selected,'yes'));add(tokenOf(state.selected,'no'))}
  return ids;
}
function connectBook(){
  if(socket&&(socket.readyState===0||socket.readyState===1))return;
  try{socket=new WebSocket(BOOK_URL)}catch{setConn('reconnecting');scheduleReconnect();return}
  socket.onopen=()=>{
    backoff=1000;
    subscribed.clear();
    setConn('live');
    syncSubscriptions();
  };
  socket.onmessage=ev=>{
    let msg;
    try{msg=JSON.parse(ev.data)}catch{return}
    const batch=Array.isArray(msg)?msg:[msg];
    let selectedHit=false;
    for(const item of batch)if(handleBookEvent(item))selectedHit=true;
    scheduleDesk(selectedHit);
  };
  socket.onclose=()=>{setConn('reconnecting');scheduleReconnect()};
  socket.onerror=()=>{try{socket.close()}catch{}};
}
function scheduleReconnect(){
  clearTimeout(reconnectTimer);
  reconnectTimer=setTimeout(connectBook,backoff);
  backoff=Math.min(15000,backoff*2);
}
function syncSubscriptions(){
  if(!socket||socket.readyState!==1)return;
  const next=desiredAssets();
  const nextSet=new Set(next);
  const remove=[...subscribed].filter(id=>!nextSet.has(id));
  const add=next.filter(id=>!subscribed.has(id));
  if(remove.length)socket.send(JSON.stringify({assets_ids:remove,operation:'unsubscribe'}));
  if(add.length)socket.send(JSON.stringify({type:'market',assets_ids:add,custom_feature_enabled:true,initial_dump:true}));
  for(const id of next)subscribed.add(id);
  for(const id of remove)subscribed.delete(id);
}
function touchLeg(marketId,side){
  const book=books.get(marketId)||blankBook();
  books.set(marketId,book);
  return book[side];
}
function handleBookEvent(msg){
  if(!msg||typeof msg!=='object'||!msg.event_type)return false;
  let selectedHit=false;
  const mark=id=>{if(id===state.selected?.id)selectedHit=true};
  if(msg.event_type==='book'){
    const meta=tokenIndex.get(msg.asset_id);
    if(!meta)return false;
    const leg=touchLeg(meta.marketId,meta.side);
    const bids=parseLevels(msg.bids).sort((a,b)=>b.price-a.price);
    const asks=parseLevels(msg.asks).sort((a,b)=>a.price-b.price);
    leg.bids=bids;leg.asks=asks;
    leg.bid=bids[0]?.price??null;
    leg.ask=asks[0]?.price??null;
    leg.ts=Number(msg.timestamp)||Date.now();
    if(meta.side==='yes'){
      const mid=leg.bid!=null&&leg.ask!=null?(leg.bid+leg.ask)/2:leg.bid??leg.ask;
      const market=state.markets.find(m=>m.id===meta.marketId)||(state.selected?.id===meta.marketId?state.selected:null);
      noteObservation(market,mid,null);
    }
    mark(meta.marketId);
  }else if(msg.event_type==='best_bid_ask'){
    const meta=tokenIndex.get(msg.asset_id);
    if(!meta)return false;
    const leg=touchLeg(meta.marketId,meta.side);
    const bid=centsFromBook(msg.best_bid),ask=centsFromBook(msg.best_ask);
    if(bid!=null)leg.bid=bid;
    if(ask!=null)leg.ask=ask;
    leg.ts=Number(msg.timestamp)||Date.now();
    mark(meta.marketId);
  }else if(msg.event_type==='price_change'){
    for(const ch of msg.price_changes||[]){
      const meta=tokenIndex.get(ch.asset_id);
      if(!meta)continue;
      const leg=touchLeg(meta.marketId,meta.side);
      const bid=centsFromBook(ch.best_bid),ask=centsFromBook(ch.best_ask);
      if(bid!=null)leg.bid=bid;
      if(ask!=null)leg.ask=ask;
      leg.ts=Number(msg.timestamp)||Date.now();
      mark(meta.marketId);
    }
  }else if(msg.event_type==='last_trade_price'){
    const meta=tokenIndex.get(msg.asset_id);
    if(!meta)return false;
    const price=centsFromBook(msg.price);
    if(price==null)return false;
    const size=parseSize(msg.size);
    const leg=touchLeg(meta.marketId,meta.side);
    leg.last=price;leg.lastSize=size;leg.lastSide=msg.side||'';leg.ts=Number(msg.timestamp)||Date.now();
    if(meta.side==='yes'){
      const list=prints.get(meta.marketId)||[];
      list.push({t:leg.ts,yes:price,size});
      prints.set(meta.marketId,list.slice(-80));
    }
    mark(meta.marketId);
  }
  return selectedHit;
}

let polling=false;
async function refreshQuote(){
  if(polling||document.hidden||!state.selected)return;
  polling=true;
  const id=state.selected.id,selection=state.selection;
  try{
    const m=await fetchCurrentMarket(state.selected);
    if(selection!==state.selection||state.selected?.id!==id)return;
    if(!isCurrentMarket(m)){
      state.markets=state.markets.filter(x=>x.id!==id);
      custom();
      $('expiry').textContent='This market has closed or is no longer active on XO.';
      $('feedstatus').textContent='Closed market removed. Choose another current market.';
      return;
    }
    state.selected=m;
    if(!socket||socket.readyState!==1)noteObservation(m,quote(m,'yes'),quote(m,'no'));
    const next=state.markets.filter(isCurrentMarket).map(x=>x.id===id?m:x);
    const same=next.length===state.markets.length&&next.every((row,i)=>row.id===state.markets[i].id);
    state.markets=next;
    rebuildTokenIndex();
    if(same){
      document.querySelectorAll('.market').forEach(el=>el.classList.toggle('selected',el.dataset.id===String(id)));
      patchPrices();
    }else renderMarkets();
    renderQuote();
  }catch{
    if(selection===state.selection){
      $('quotestatus').textContent='Refresh failed · last quote shown';
      $('chartnote').textContent='Connection interrupted. Displayed prices are from the last successful check.';
    }
  }finally{polling=false}
}
setInterval(refreshQuote,20000);
setInterval(()=>{if(!document.hidden&&state.selected)loadHistory(state.selected)},60000);
setInterval(()=>{
  if(document.hidden)return;
  const active=state.markets.filter(isCurrentMarket);
  if(active.length!==state.markets.length){state.markets=active;renderMarkets();rebuildTokenIndex();syncSubscriptions()}
  if(state.selected&&!isCurrentMarket(state.selected)){custom();$('expiry').textContent='Market deadline passed. Select another open market.'}
},10000);
document.addEventListener('visibilitychange',()=>{
  document.body.classList.toggle('motion-paused',document.hidden);
  if(!document.hidden){refreshQuote();if(state.selected)loadHistory(state.selected)}
});
connectBook();

const audio=$('ambient-audio'),music=$('music-toggle');
audio.volume=.18;
function syncMusic(){
  const on=!audio.paused;
  music.setAttribute('aria-pressed',String(on));
  music.setAttribute('aria-label',on?'Turn background music off':'Turn background music on');
  music.title=on?'Music on · click to turn off':'Music off · click to play';
  music.classList.toggle('playing',on);
  music.querySelector('span').textContent=on?'X':'O';
}
music.onclick=async()=>{
  if(!audio.paused){audio.pause();syncMusic();return}
  music.disabled=true;
  try{await audio.play()}catch{music.title='Music could not play. Click to retry.'}
  finally{music.disabled=false;syncMusic()}
};
audio.addEventListener('play',syncMusic);
audio.addEventListener('pause',syncMusic);
audio.addEventListener('error',()=>{audio.pause();syncMusic();music.title='Audio unavailable. Click to retry.'});

const orbitBodies=[
  {id:'orbit-x',cx:280,cy:148,rx:172,ry:54,rot:-16*Math.PI/180,offset:0,spin:1,kind:'x'},
  {id:'orbit-o',cx:276,cy:158,rx:120,ry:78,rot:22*Math.PI/180,offset:0,spin:-1,kind:'o'},
  {id:'spark-a',cx:280,cy:148,rx:172,ry:54,rot:-16*Math.PI/180,offset:.18,spin:1,kind:'spark'},
  {id:'spark-b',cx:280,cy:148,rx:172,ry:54,rot:-16*Math.PI/180,offset:.62,spin:1,kind:'spark'},
  {id:'spark-c',cx:276,cy:158,rx:120,ry:78,rot:22*Math.PI/180,offset:.08,spin:-1,kind:'spark'}
];
const orbitStage=$('orbit-stage');
let orbitPhase=.18,orbitOn=false,heroVisible=true;
function placeOrbit(p){
  if(!orbitStage)return;
  const placed=[];
  for(const body of orbitBodies){
    const el=$(body.id);
    if(!el)continue;
    const a=((p+body.offset)%1)*Math.PI*2*body.spin;
    const x=Math.cos(a)*body.rx,y=Math.sin(a)*body.ry;
    const c=Math.cos(body.rot),s=Math.sin(body.rot);
    const depth=(Math.sin(a)+1)/2;
    const scale=body.kind==='spark'?(.55+depth*.7):(.58+depth*.42);
    const rot=body.kind==='x'?(-6+(depth-.5)*14):0;
    el.setAttribute('transform',`translate(${(body.cx+x*c-y*s).toFixed(2)} ${(body.cy+x*s+y*c).toFixed(2)}) scale(${scale.toFixed(3)}) rotate(${rot.toFixed(2)})`);
    el.setAttribute('opacity',(body.kind==='spark'?(.2+depth*.8):(.42+depth*.58)).toFixed(3));
    placed.push({el,depth});
  }
  placed.sort((a,b)=>a.depth-b.depth);
  for(const item of placed)orbitStage.appendChild(item.el);
}
function orbitTick(time,delta){
  if(!orbitOn)return;
  orbitPhase=(orbitPhase+delta/28000)%1;
  placeOrbit(orbitPhase);
}
function syncOrbit(){
  orbitOn=Boolean(window.gsap)&&!reduced.matches&&!document.hidden&&heroVisible;
  if(!orbitOn)placeOrbit(reduced.matches?0.18:orbitPhase);
}
placeOrbit(orbitPhase);
if(window.gsap){
  gsap.ticker.add(orbitTick);
  reduced.addEventListener('change',syncOrbit);
  document.addEventListener('visibilitychange',syncOrbit);
  const art=document.querySelector('.intro-art');
  if(art&&'IntersectionObserver' in window)new IntersectionObserver(entries=>{heroVisible=entries[0].isIntersecting;syncOrbit()},{threshold:.08}).observe(art);
  syncOrbit();
  gsap.matchMedia().add({reduce:'(prefers-reduced-motion: reduce)',ok:'(prefers-reduced-motion: no-preference)'},context=>{
    if(context.conditions.reduce)return;
    gsap.from('.hero-copy > *',{y:16,autoAlpha:0,duration:.7,ease:'power3.out',stagger:.07});
    gsap.from('.intro-art',{y:18,autoAlpha:0,duration:.85,ease:'power3.out',delay:.06});
    gsap.from('.howto-head > *',{y:14,autoAlpha:0,duration:.65,ease:'power3.out',stagger:.06,delay:.12});
    gsap.from('.howto-steps li',{y:18,autoAlpha:0,duration:.7,ease:'power3.out',stagger:.08,delay:.2});
    gsap.from('.howto-go',{autoAlpha:0,y:8,duration:.5,ease:'power3.out',delay:.48});
    const lx=gsap.quickTo('.liquid-light','x',{duration:.35,ease:'power2.out'});
    const ly=gsap.quickTo('.liquid-light','y',{duration:.35,ease:'power2.out'});
    const ox=gsap.quickTo('.orbit-float','x',{duration:.4,ease:'power2.out'});
    const oy=gsap.quickTo('.orbit-float','y',{duration:.4,ease:'power2.out'});
    const orx=gsap.quickTo('.orbit-float','rotationX',{duration:.55,ease:'power2.out'});
    const ory=gsap.quickTo('.orbit-float','rotationY',{duration:.55,ease:'power2.out'});
    window.addEventListener('pointermove',e=>{
      if(document.hidden||!heroVisible)return;
      const nx=e.clientX/innerWidth-.5,ny=e.clientY/innerHeight-.5;
      lx(nx*-14);ly(ny*-8);ox(nx*10);oy(ny*6);ory(nx*7);orx(ny*-4);
    },{passive:true});
  });
}
if(window.anime?.svg&&!reduced.matches){
  try{
    anime.animate(anime.svg.createDrawable('#ring-a'),{draw:['0 0','0 1'],duration:1700,ease:'inOutQuad'});
    anime.animate(anime.svg.createDrawable('#ring-b'),{draw:['0 0','0 1'],duration:1900,delay:160,ease:'inOutQuad'});
  }catch{/* rings stay fully drawn if the drawable helper cannot attach */}
}
if(window.Lenis){
  new Lenis({autoRaf:true,autoToggle:true,anchors:true,lerp:.12});
}

update();
loadMarkets();
