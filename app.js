let data=[
{stage:"Aguardando liquidação",count:17,value:201304.98},
{stage:"Aguardando boleto",count:13,value:164204.21},
{stage:"Análise banco",count:5,value:50850.49},
{stage:"Análise crédito",count:1,value:14218.37},
{stage:"Análise documental",count:1,value:6648.81},
{stage:"Aguardando quitação",count:1,value:5381.45},
  {stage:"Cancelados",count:0,value:0}];
let total=442608.31;
const fmt=n=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const share=n=>total ? n/total*100 : 0;
const percent=n=>share(n).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const escapeHTML=value=>value.replace(/[&<>"']/g,char=>({
 '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[char]));
const filter=document.getElementById('stageFilter'),search=document.getElementById('search');
function updateFilters() {
 const selected=filter.value;
 filter.replaceChildren(new Option('Todas as etapas','all'));
 data.forEach(d=>filter.add(new Option(d.stage,d.stage)));
 filter.value=data.some(d=>d.stage===selected)?selected:'all';
}
function render() {
 const q=search.value.toLocaleLowerCase('pt-BR');
 const items=data.filter(d=>(filter.value==='all'||d.stage===filter.value)&&d.stage.toLocaleLowerCase('pt-BR').includes(q));
 document.getElementById('bars').innerHTML=items.map(d=>`<div class="bar-row"><div class="bar-name">${escapeHTML(d.stage)}</div><div class="bar-track"><div class="bar-fill" style="width:${share(d.value)}%"></div></div><div class="bar-value">${fmt(d.value)}</div></div>`).join('')||'<p class="panel-sub">Nenhuma etapa encontrada.</p>';
 document.getElementById('rows').innerHTML=items.map(d=>`<tr><td>${escapeHTML(d.stage)}</td><td>${d.count}</td><td>${fmt(d.value)}</td><td>${percent(d.value)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum registro encontrado.</td></tr>';
}
updateFilters();
filter.addEventListener('change',render);search.addEventListener('input',render);render();

const syncStatus=document.getElementById('sync-status');
const syncNote=document.getElementById('sync-note');
let lastUpdate;

function renderSnapshot(stages, updatedAt) {
 data=stages;
 total=data.reduce((sum,d)=>sum+Math.round(d.value*100),0)/100;
 const count=data.reduce((sum,d)=>sum+d.count,0);
 const boleto=data.find(d=>d.stage==='Aguardando boleto');
 const liquidacao=data.find(d=>d.stage==='Aguardando liquidação');
 const pagos=data.find(d=>d.stage==='Pagos');
 const combinedCount=(boleto?.count??0)+(liquidacao?.count??0);
 const combinedValue=(Math.round((boleto?.value??0)*100)+Math.round((liquidacao?.value??0)*100))/100;

 const values=[count,fmt(total),fmt(combinedValue),pagos?fmt(pagos.value):'—'];
 document.querySelectorAll('#overview .kpi strong').forEach((el,i)=>{el.textContent=values[i]});
 document.querySelector('#overview .kpi.t small').textContent=`${combinedCount} propostas · ${percent(combinedValue)} do valor`;
 document.querySelector('#overview .kpi.g small').textContent=pagos?`${pagos.count} propostas pagas`:'Etapa ausente na carteira recebida';
 const quickStats=[liquidacao?.count??0,boleto?.count??0,combinedCount,percent(combinedValue)];
 document.querySelectorAll('#overview .stat b').forEach((el,i)=>{el.textContent=quickStats[i]});
 document.querySelector('#overview .callout p').textContent=pagos
  ? `${fmt(pagos.value)} em propostas com status de pagamento, incluídos no total da carteira.`
  : 'A carteira recebida não contém propostas com status de pagamento.';
 document.querySelector('#overview .detail .pill').textContent=`${data.length} etapas`;
 document.getElementById('sync-date').textContent=`Última sincronização · ${new Date(updatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`;
 updateFilters();
 render();
}

async function refreshDashboard() {
 try {
  const response=await fetch('/api/konsig/carteira',{cache:'no-store',signal:AbortSignal.timeout(5000)});
  const {state,stages,updatedAt}=await response.json();
  if(state==='demo') return;
  if(updatedAt&&updatedAt!==lastUpdate) {
   renderSnapshot(stages,updatedAt);
   lastUpdate=updatedAt;
  }
  if(state==='ready') {
   syncStatus.textContent='● KONSIG';
   syncNote.textContent='Carteira atualizada automaticamente pela Konsig';
  } else if(state==='pending') {
   syncNote.textContent='Dados demonstrativos · Aguardando a primeira sincronização';
  } else {
   showSyncError();
  }
 } catch {
  showSyncError();
 } finally {
  setTimeout(refreshDashboard,15000);
 }
}

function showSyncError() {
 syncStatus.textContent=lastUpdate?'● KONSIG · DESATUALIZADO':'● DEMONSTRATIVO';
 syncNote.textContent=lastUpdate
  ? 'Falha na atualização · Exibindo a última carteira recebida'
  : 'Sincronização indisponível · Exibindo dados demonstrativos';
}

const sellerSource=document.getElementById('seller-source');
const goalForm=document.getElementById('goal-form');
const goalCards=document.getElementById('goal-cards');
const goalMessage=document.getElementById('goal-message');
const goalButton=goalForm.querySelector('[type="submit"]');
const goalScope=document.getElementById('goal-scope');
const goalTvToggle=document.getElementById('goal-tv-toggle');
const goalTvSync=document.getElementById('goal-tv-sync');
const goalTvPrev=document.getElementById('goal-tv-prev');
const goalTvNext=document.getElementById('goal-tv-next');
const goalTrendChart=document.getElementById('goal-trend-chart');
const goalTrendNote=document.getElementById('goal-trend-note');
const goalLegend=document.getElementById('goal-chart-legend');
const goalRankingRows=document.getElementById('goal-ranking-rows');
const goalViews={summary:goalCards,trend:document.getElementById('goal-trend'),ranking:document.getElementById('goal-ranking')};
const goalViewButtons=document.querySelectorAll('[data-goal-view]');
const removeGoalButtons=goalForm.querySelectorAll('[data-remove-goal]');
const goalsEndpoint='/api/soumaisblu/metas';
let goalEdited=false;
let goalRequest=0;
let goalOptions='';
let goalTargets;
let goalSaving=false;
let goalAnalysis;

function showGoalView(view) {
 for(const [key,pane] of Object.entries(goalViews)) pane.hidden=key!==view;
 for(const button of goalViewButtons) button.setAttribute('aria-pressed',String(button.dataset.goalView===view));
 if(view==='trend') drawGoalTrend();
}
for(const button of goalViewButtons) button.addEventListener('click',()=>showGoalView(button.dataset.goalView));
new ResizeObserver(drawGoalTrend).observe(goalTrendChart);
goalRankingRows.addEventListener('click',event=>{
 const button=event.target.closest('[data-goal-seller]');
 if(!button||goalScope.disabled) return;
 goalScope.value=button.dataset.goalSeller;
 goalScope.dispatchEvent(new Event('change'));
 showGoalView('summary');
 goalScope.focus();
});

function drawGoalTrend() {
 if(!goalAnalysis||goalViews.trend.hidden) return;
 const {trend,targets,monthly}=goalAnalysis;
 const chart=goalTrendChart;
 const hasData=monthly.production!==null;
 chart.hidden=!hasData;
 goalLegend.hidden=!hasData;
 if(!hasData) {
  goalTrendNote.textContent='Aguardando produção do Sou+BLU.';
  return;
 }
 const target=targets.monthly;
 const current=trend.find(point=>point.day===monthly.to);
 const deviation=monthly.production-(current?.planned??0);
 const comparison=deviation===0?'No ritmo planejado':`${fmt(Math.abs(deviation)/100)} ${deviation<0?'abaixo':'acima'} do ritmo planejado`;
 goalTrendNote.textContent=`${fmt(monthly.production/100)} acumulados${target?` · ${comparison}`:' · Meta mensal a definir'}`;
 goalLegend.querySelectorAll('span').forEach((node,i)=>{node.hidden=i>0&&!target});
 chart.setAttribute('aria-label',`Produção acumulada no mês. ${goalTrendNote.textContent}`);
 const width=chart.clientWidth;
 const height=chart.clientHeight;
 if(!width||!height) return;
 const scale=window.devicePixelRatio||1;
 chart.width=Math.round(width*scale);
 chart.height=Math.round(height*scale);
 const ctx=chart.getContext('2d');
 ctx.scale(scale,scale);
 const left=width<500?65:90;
 const right=width-30;
 const top=16;
 const bottom=height-30;
 const maximum=Math.max(100,target,...trend.map(point=>point.actual??0))*1.08;
 const minimum=Math.min(0,...trend.map(point=>point.actual??0));
 const x=i=>left+i/(trend.length-1)*(right-left);
 const y=value=>bottom-(value-minimum)/(maximum-minimum)*(bottom-top);
 const compact=new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
 ctx.font=`${Math.min(16,Math.max(10,width/65))}px system-ui`;
 ctx.textAlign='right';
 ctx.textBaseline='middle';
 for(let i=0;i<=4;i++) {
  const value=minimum+(maximum-minimum)*i/4;
  ctx.strokeStyle='#dce8ef';
  ctx.beginPath();
  ctx.moveTo(left,y(value));
  ctx.lineTo(right,y(value));
  ctx.stroke();
  ctx.fillStyle='#465f76';
  ctx.fillText('R$ '+compact.format(value/100),left-7,y(value));
 }
 ctx.textAlign='center';
 const labels=new Set([0,Math.round((trend.length-1)/2),trend.length-1]);
 for(const index of labels) ctx.fillText(trend[index].day.slice(8)+'/'+trend[index].day.slice(5,7),x(index),height-13);
 const line=(points,color,dash,thickness)=>{
  ctx.strokeStyle=color;
  ctx.lineWidth=thickness;
  ctx.setLineDash(dash);
  ctx.beginPath();
  points.forEach(([i,value],index)=>index===0?ctx.moveTo(x(i),y(value)):ctx.lineTo(x(i),y(value)));
  ctx.stroke();
 };
 if(target) {
  line([[0,target],[trend.length-1,target]],'#9b6210',[7,6],2);
  line(trend.map((point,i)=>[i,point.planned]),'#537995',[4,5],2);
 }
 const actual=trend.flatMap((point,i)=>point.actual===null?[]:[[i,point.actual]]);
 line(actual,'#087c80',[],3);
 const latest=actual.at(-1);
 if(latest) {
  ctx.fillStyle='#087c80';
  ctx.beginPath();
  ctx.arc(x(latest[0]),y(latest[1]),4,0,Math.PI*2);
  ctx.fill();
 }
}

function renderGoalRanking(ranking) {
 goalRankingRows.innerHTML=ranking.map(({ key,name,production,target,percent },index)=>{
  const rate=percent.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  return `<div class="goal-rank-row"><span class="goal-rank-position">${index+1}</span>
   <div><button type="button" data-goal-seller="${escapeHTML(key)}">${escapeHTML(name)}</button>
   <span class="panel-sub">${fmt(production/100)} de ${fmt(target/100)}</span>
   <progress max="100" value="${Math.max(0,Math.min(percent,100))}" aria-label="Atingimento, ${escapeHTML(name)}"></progress></div>
   <strong>${rate}</strong></div>`;
 }).join('')||'<p class="panel-sub">O ranking aparece quando houver produção sincronizada e metas mensais individuais definidas.</p>';
}

function setGoalTv(active) {
 document.body.classList.toggle('goal-tv',active);
 goalTvToggle.textContent=active?'Sair do modo TV':'Modo TV';
 goalTvToggle.setAttribute('aria-pressed',String(active));
 document.querySelectorAll('.goal-tv-only').forEach(node=>{node.hidden=!active});
 goalTvToggle.focus({preventScroll:true});
 if(active) window.scrollTo(0,0);
}

goalTvToggle.addEventListener('click',async()=>{
 const active=!document.body.classList.contains('goal-tv');
 setGoalTv(active);
 try {
  if(active&&document.fullscreenEnabled) await document.documentElement.requestFullscreen();
  else if(!active&&document.fullscreenElement===document.documentElement) await document.exitFullscreen();
 } catch {
  // A interface de apresentação também funciona dentro da janela.
 }
});
document.addEventListener('fullscreenchange',()=>{
 if(!document.fullscreenElement&&document.body.classList.contains('goal-tv')) setGoalTv(false);
});

function stepGoalScope(direction) {
 if(goalScope.disabled||goalScope.length<2) return;
 goalScope.selectedIndex=(goalScope.selectedIndex+direction+goalScope.length)%goalScope.length;
 goalScope.dispatchEvent(new Event('change'));
}
goalTvPrev.addEventListener('click',()=>stepGoalScope(-1));
goalTvNext.addEventListener('click',()=>stepGoalScope(1));
document.addEventListener('keydown',event=>{
 if(!document.body.classList.contains('goal-tv')||document.querySelector('dialog[open]')) return;
 if(event.key==='Escape'&&!document.fullscreenElement) setGoalTv(false);
 if(event.target.closest('input,select,textarea,button')&&event.target!==goalTvToggle) return;
 if(event.key==='ArrowLeft'||event.key==='ArrowRight') {
  event.preventDefault();
  stepGoalScope(event.key==='ArrowLeft'?-1:1);
 }
});

function updateGoalButtons() {
 goalScope.disabled=goalSaving;
 goalButton.disabled=goalSaving||!goalTargets;
 goalTvPrev.disabled=goalTvNext.disabled=goalSaving||goalScope.length<2;
 for(const button of removeGoalButtons) {
  button.disabled=goalSaving||!goalTargets?.[button.dataset.removeGoal];
 }
}

async function refreshGoals() {
 const request=++goalRequest;
 try {
  const seller=goalScope.value;
  const response=await fetch(goalsEndpoint+'?'+new URLSearchParams({seller}),{cache:'no-store',signal:AbortSignal.timeout(5000)});
  if(!response.ok) throw new Error();
  const data=await response.json();
  if(request!==goalRequest) return;
  goalTvSync.textContent=data.updatedAt
   ? `${data.stale?'Última sincronização':'Atualizado'} · ${new Date(data.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`
   : 'Aguardando sincronização com o Sou+BLU';
  const signature=JSON.stringify(data.sellers);
  if(signature!==goalOptions) {
   goalScope.replaceChildren(new Option('Empresa inteira',''),...data.sellers.map(([id,name])=>new Option(name,id)));
   goalOptions=signature;
   if(seller&&!data.sellers.some(([id])=>id===seller)) {
    void refreshGoals();
    return;
   }
   goalScope.value=seller;
  }
  goalTargets=data.targets;
  updateGoalButtons();
  goalAnalysis=data;
  drawGoalTrend();
  renderGoalRanking(data.ranking);
  const day=value=>value.split('-').reverse().join('/');
  goalCards.innerHTML=[['monthly','Mês atual'],['weekly','Semana atual']].map(([key,title])=>{
   const {production,from,to,count,paidCount,paidValue}=data[key];
   const target=data.targets[key];
   const hasProduction=production!==null;
   const percent=hasProduction&&target?production/target*100:null;
   const gap=hasProduction&&target?Math.max(0,target-production):null;
   const hit=percent!==null&&percent>=100;
   const rate=percent===null?'—':percent.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
   let pace='';
   if(key==='monthly'&&gap!==null) {
    const days=data.remainingDays;
    if(hit) {
     pace=production===target?'Meta atingida':`${fmt((production-target)/100)} acima da meta`;
    } else if(days) {
     pace=`${fmt(Math.ceil(gap/days)/100)} por dia útil · ${days} ${days===1?'dia restante':'dias restantes'}`;
    } else {
     pace='Sem dias úteis restantes após hoje.';
    }
   }
   return `<article class="goal-card" data-goal-period="${key}"><h3>${title}</h3><span class="panel-sub">${day(from)} a ${day(to)}</span>
    <dl><div><dt>Produção acumulada</dt><dd>${hasProduction?fmt(production/100):'—'}</dd></div>
    <div><dt>Meta</dt><dd>${target?fmt(target/100):'A definir'}</dd></div>
    <div><dt>Falta para a meta</dt><dd class="${hit?'goal-hit':'goal-gap'}">${gap===null?'—':fmt(gap/100)}</dd></div>
    <div><dt>Atingimento</dt><dd class="${hit?'goal-hit':''}">${rate}</dd></div>
    <div><dt>Propostas</dt><dd>${hasProduction?count.toLocaleString('pt-BR'):'—'}</dd></div>
    <div><dt>Propostas pagas</dt><dd>${hasProduction?paidCount.toLocaleString('pt-BR'):'—'}</dd></div>
    <div><dt>Valor das propostas pagas</dt><dd>${hasProduction?fmt(paidValue/100):'—'}</dd></div>
    <div><dt>Ticket médio</dt><dd>${count?fmt(production/count/100):'—'}</dd></div></dl>
    ${percent===null?'':`<progress max="100" value="${Math.max(0,Math.min(percent,100))}" aria-label="Atingimento da meta, ${title.toLowerCase()}"></progress>`}
    ${pace?`<p class="goal-pace${hit?' goal-hit':''}">${pace}${hit?'':`<span>Considera segunda a sexta após hoje, sem descontar feriados.</span>`}</p>`:''}
    ${hasProduction?`<button type="button" class="goal-proposals" data-from="${from}" data-to="${to}">Ver propostas do período</button>`:''}</article>`;
  }).join('');
  if(!goalEdited) {
   for(const key of ['weekly','monthly']) goalForm.elements[key].value=data.targets[key]?String(data.targets[key]/100):'';
  }
  if(data.stale&&data.updatedAt) {
   const note=document.createElement('p');
   note.className='panel-sub';
   note.textContent='Falha na sincronização. Exibindo a última produção recebida.';
   goalCards.append(note);
  }
 } catch {
  if(request===goalRequest&&!goalCards.querySelector('.goal-card')) {
   goalCards.textContent='Produção indisponível. Abra o painel conectado ao Sou+BLU.';
  }
 }
}

goalScope.addEventListener('change',()=>{
 goalEdited=false;
 goalTargets=undefined;
 goalForm.reset();
 goalMessage.textContent='';
 goalCards.textContent='Carregando metas…';
 updateGoalButtons();
 void refreshGoals();
});
goalForm.addEventListener('input',()=>{goalEdited=true;goalMessage.textContent=''});

async function changeGoals(change) {
 if(goalSaving||!goalTargets) return;
 goalSaving=true;
 updateGoalButtons();
 goalMessage.textContent=change.remove?'Excluindo meta…':'Salvando metas…';
 try {
  const response=await fetch(goalsEndpoint,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({seller:goalScope.value,...change}),signal:AbortSignal.timeout(5000)
  });
  if(!response.ok) throw new Error();
  if(change.remove) goalForm.elements[change.remove].value='';
  else goalEdited=false;
  await refreshGoals();
  goalMessage.textContent=change.remove?'Meta excluída.':'Metas salvas.';
 } catch {
  goalMessage.textContent=change.remove?'Não foi possível excluir a meta.':'Não foi possível salvar as metas.';
 } finally {
  goalSaving=false;
  updateGoalButtons();
 }
}
goalForm.addEventListener('submit',event=>{
 event.preventDefault();
 const targets=Object.fromEntries(['weekly','monthly'].map(key=>[key,Math.round(Number(goalForm.elements[key].value)*100)]));
 void changeGoals(targets);
});
for(const button of removeGoalButtons) {
 button.addEventListener('click',()=>void changeGoals({remove:button.dataset.removeGoal}));
}
const sellerServerLink=document.getElementById('seller-server-link');
const sellerFilters=document.getElementById('seller-filters');
const sellerPeriod=document.getElementById('seller-period');
const sellerDimensions=sellerFilters.querySelectorAll('[data-dimension]');
const sellerExports=document.getElementById('seller-exports');
let sellerQuery=new URLSearchParams();
let renderedSellerQuery='';
let sellerRequest=0;
let sellerUpdatedAt;
const proposalDialog=document.getElementById('proposal-dialog');
const proposalTitle=document.getElementById('proposal-title');
const proposalSummary=document.getElementById('proposal-summary');
const proposalRows=document.getElementById('proposal-rows');
let proposalRequest;

function proposalStatusColor(status, paid) {
 const key=status.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase();
 if(/CANCEL|REPROV|RECUS/.test(key)) return 'red';
 if(paid||/^(PAGO|PAGA)$/.test(key)) return 'green';
 if(/DIGITAD/.test(key)) return 'gray';
 if(/PEND|AGUARD|^AG\./.test(key)) return 'amber';
 if(/ANDAMENTO|ANALISE|VALIDAD/.test(key)) return 'blue';
 return 'gray';
}

document.getElementById('seller-rows').addEventListener('click',event=>{
 const button=event.target.closest('[data-seller-detail]');
 if(!button) return;
 const query=new URLSearchParams(renderedSellerQuery);
 query.set('detail',button.dataset.sellerDetail);
 void openProposals(button.querySelector('.seller-name').textContent,query);
});
goalCards.addEventListener('click',event=>{
 const button=event.target.closest('.goal-proposals');
 if(!button) return;
 const query=new URLSearchParams({
  view:'proposals',date:'created',start:button.dataset.from,end:button.dataset.to
 });
 if(goalScope.value) query.set('seller',goalScope.value);
 const period=button.closest('.goal-card').querySelector('h3').textContent;
 void openProposals(`${period} · ${goalScope.selectedOptions[0].textContent}`,query);
});

async function openProposals(title,query,endpoint='/api/soumaisblu/compra-divida') {
 const controller=new AbortController();
 proposalRequest=controller;
 proposalTitle.textContent=title;
 proposalSummary.textContent='Carregando propostas…';
 proposalRows.replaceChildren();
 proposalDialog.showModal();
 try {
  const response=await fetch(endpoint+'?'+query,{
   cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])
  });
  const {items}=await response.json();
  if(!response.ok||!Array.isArray(items)) throw new Error('Propostas indisponíveis');
  if(proposalRequest!==controller||!proposalDialog.open) return;
  const total=items.reduce((sum,item)=>sum+Math.round(item.value*100),0)/100;
  proposalSummary.textContent=`${items.length} propostas no recorte · ${fmt(total)} em produção`;
  proposalRows.innerHTML=items.map(item=>{
   const day=value=>value?value.split('-').reverse().join('/'):'—';
   const original=item.originalValue===null?'—':fmt(item.originalValue);
   const status=item.status||'—';
   const color=proposalStatusColor(status,item.paid);
   return `<tr><td>${escapeHTML(item.number)}</td><td>${escapeHTML(item.seller||'—')}</td><td><span class="proposal-status proposal-status--${color}">${escapeHTML(status)}</span></td><td>${day(item.created)}</td><td>${day(item.entered)}</td><td>${day(item.paidDate)}</td><td>${original}</td><td>${fmt(item.value)}</td></tr>`;
  }).join('')||'<tr><td colspan="8">Nenhuma proposta no recorte selecionado.</td></tr>';
 } catch {
  if(proposalRequest===controller&&proposalDialog.open) proposalSummary.textContent='Não foi possível carregar as propostas. Feche e tente novamente.';
 }
}
proposalDialog.addEventListener('close',()=>proposalRequest?.abort());
document.getElementById('seller-rows').addEventListener('error',event=>{
 if(event.target.classList.contains('seller-avatar-photo')) event.target.remove();
},true);

function setFilterOptions(options) {
 const allLabels={seller:'Todos os vendedores',status:'Todos os status',operationStatus:'Todos os status',
  agreement:'Todos os convênios',agency:'Todos os órgãos',entryBank:'Todos os bancos',purchaseBank:'Todos os bancos'};
 for(const select of sellerDimensions) {
  const previous=select.value;
  select.replaceChildren(new Option(allLabels[select.name],'__all'));
  for(const [value,label] of options[select.name]??[]) select.add(new Option(label,value));
  if([...select.options].some(option=>option.value===previous)) select.value=previous;
 }
}
setFilterOptions({});

const startDate=sellerFilters.elements.start;
const endDate=sellerFilters.elements.end;
sellerPeriod.addEventListener('change',()=>{
 const mode=sellerPeriod.value;
 if(mode==='custom') return;
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'});
 const first=new Date(today+'T00:00:00Z');
 if(mode==='month') first.setUTCDate(1);
 if(mode==='7'||mode==='30') first.setUTCDate(first.getUTCDate()-Number(mode)+1);
 startDate.value=mode==='all'?'':first.toISOString().slice(0,10);
 endDate.value=mode==='all'?'':today;
 endDate.setCustomValidity('');
});
for(const input of [startDate,endDate]) input.addEventListener('input',()=>{
 sellerPeriod.value='custom';
 endDate.setCustomValidity('');
});
const minValue=sellerFilters.elements.min;
const maxValue=sellerFilters.elements.max;
for(const input of [minValue,maxValue]) input.addEventListener('input',()=>maxValue.setCustomValidity(''));
sellerFilters.addEventListener('submit',event=>{
 event.preventDefault();
 if(startDate.value&&endDate.value&&startDate.value>endDate.value) {
  endDate.setCustomValidity('A data final deve ser igual ou posterior à inicial.');
  endDate.reportValidity();
  return;
 }
 if(minValue.value&&maxValue.value&&Number(minValue.value)>Number(maxValue.value)) {
  maxValue.setCustomValidity('O valor máximo deve ser igual ou superior ao mínimo.');
  maxValue.reportValidity();
  return;
 }
 sellerQuery=new URLSearchParams();
 for(const [key,value] of new FormData(sellerFilters)) {
  const field=sellerFilters.elements.namedItem(key);
  if(field.hasAttribute('data-dimension')?value!=='__all':value!=='') sellerQuery.set(key,value);
 }
 if(location.protocol!=='file:') void refreshSellers();
});
sellerFilters.addEventListener('reset',()=>{
 endDate.setCustomValidity('');
 maxValue.setCustomValidity('');
 sellerQuery=new URLSearchParams();
 if(location.protocol!=='file:') void refreshSellers();
});

const chartMetric=document.getElementById('seller-chart-metric');
let currentCharts;
chartMetric.addEventListener('change',()=>{if(currentCharts) renderSellerCharts(currentCharts)});

function renderSellerCharts(charts) {
 const metric=chartMetric.value;
 const other=metric==='value'?'count':'value';
 const format=(value,key)=>key==='value'?fmt(value):value.toLocaleString('pt-BR');
 const maxOf=points=>points.reduce((max,point)=>Math.max(max,point[metric]),0);
 const size=(value,max)=>max?Math.max(0,value/max*100):0;
 const empty='<p class="panel-sub">Nenhum dado para os filtros selecionados.</p>';
 const timeline=document.getElementById('seller-timeline');
 const maximum=maxOf(charts.timeline);
 const dates={created:'cadastro',entered:'digitação',paidDate:'pagamento'};
 const granularity=charts.timeline[0]?.label.length===10?'Dia':'Mês';
 const missing=charts.missingDate?` · ${charts.missingDate.toLocaleString('pt-BR')} sem data de ${dates[charts.dateField]}`:'';
 document.getElementById('seller-timeline-note').textContent=`${granularity} de ${dates[charts.dateField]}${missing}`;
 timeline.innerHTML=charts.timeline.length?`<dl class="chart-columns">${charts.timeline.map(point=>{
  const [year,month,day]=point.label.split('-');
  const label=day?`${day}/${month}`:`${month}/${year}`;
  const value=format(point[metric],metric);
  return `<div class="chart-column"><dt>${label}</dt><dd>${value}</dd><dd class="chart-track" aria-hidden="true"><div class="chart-fill" style="--chart-size:${size(point[metric],maximum)}%"></div></dd></div>`;
 }).join('')}</dl>`:empty;
 for(const [id,points,colorByStatus] of [
  ['seller-status-chart',charts.statuses,true],
  ['seller-agreement-chart',charts.agreements,false]
 ]) {
  const max=maxOf(points);
  const sorted=[...points].sort((a,b)=>b[metric]-a[metric]||a.label.localeCompare(b.label,'pt-BR'));
  document.getElementById(id).innerHTML=sorted.map(point=>{
   const color=colorByStatus?` chart-fill--${proposalStatusColor(point.label,false)}`:'';
   const label=escapeHTML(point.label);
   return `<div><div class="chart-bar-heading"><span>${label}</span><strong>${format(point[metric],metric)}</strong></div><div class="chart-track" aria-hidden="true"><span class="chart-fill${color}" style="--chart-size:${size(point[metric],max)}%"></span></div><div class="chart-bar-meta">${format(point[other],other)}${other==='count'?' propostas':''}</div></div>`;
  }).join('')||empty;
 }
}

function sellerAvatar(seller) {
 const initials=seller.name.trim().split(/\s+/).filter((_,i,words)=>i===0||i===words.length-1)
  .map(word=>word[0]).join('').toLocaleUpperCase('pt-BR');
 const photo=seller.hasPhoto
  ?`<img class="seller-avatar-photo" src="/api/soumaisblu/foto-vendedor?id=${encodeURIComponent(seller.key)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'';
 return `<span class="seller-avatar" aria-hidden="true">${escapeHTML(initials)}${photo}</span>`;
}

function renderSellers(sellers) {
 const sum=field=>sellers.reduce((value,seller)=>value+seller[field],0);
 const production=sum('value');
 const count=sum('count');
 const ticket=count?production/count:0;
 const values=[sellers.filter(seller=>seller.name!=='Sem vendedor identificado').length,fmt(production),count,fmt(ticket),sum('paidCount')];
 document.querySelectorAll('#seller .kpi strong').forEach((el,i)=>{el.textContent=values[i]});
 document.querySelector('#seller .kpi:last-child small').textContent=`${fmt(sum('paidValue'))} em propostas pagas`;
 const percentage=value=>production?value/production*100:0;
 const formatPercentage=value=>percentage(value).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
 const top=sellers[0];
 const stats=[fmt(top?.value??0),Math.max(0,...sellers.map(seller=>seller.count)),fmt(ticket),formatPercentage(top?.value??0)];
 document.querySelectorAll('#seller .stat b').forEach((el,i)=>{el.textContent=stats[i]});
 document.getElementById('seller-count').textContent=`${values[0]} vendedores`;
 document.getElementById('seller-ranking').innerHTML=sellers.slice(0,10).map(seller=>
  `<div class="bar-row"><div class="bar-name">${escapeHTML(seller.name)}</div><div class="bar-track"><div class="bar-fill" style="width:${top.value>0?Math.max(0,seller.value/top.value*100):0}%"></div></div><div class="bar-value">${fmt(seller.value)}</div></div>`
 ).join('')||'<p class="panel-sub">Nenhuma proposta para os filtros selecionados.</p>';
 document.getElementById('seller-rows').innerHTML=sellers.map((seller,i)=>
  `<tr><td>${i+1}</td><td><button type="button" class="seller-detail-link" data-seller-detail="${escapeHTML(seller.key)}">${sellerAvatar(seller)}<span class="seller-name">${escapeHTML(seller.name)}</span></button></td><td>${seller.count}</td><td>${fmt(seller.value)}</td><td>${fmt(seller.value/seller.count)}</td><td>${formatPercentage(seller.value)}</td><td>${seller.paidCount}</td><td>${fmt(seller.paidValue)}</td></tr>`
 ).join('')||'<tr><td colspan="8">Nenhuma proposta para os filtros selecionados.</td></tr>';
}

async function refreshSellers() {
 const request=++sellerRequest;
 const query=sellerQuery.toString();
 try {
  const response=await fetch('/api/soumaisblu/compra-divida?'+query,{cache:'no-store',signal:AbortSignal.timeout(5000)});
  if(request!==sellerRequest) return;
  if(!response.headers.get('content-type')?.includes('application/json')) {
   showSellerPreview();
   return;
  }
  const {state,sellers,options,charts,updatedAt}=await response.json();
  if(request!==sellerRequest) return;
  sellerServerLink.hidden=true;
  if(updatedAt&&(updatedAt!==sellerUpdatedAt||query!==renderedSellerQuery)) {
   if(updatedAt!==sellerUpdatedAt) setFilterOptions(options);
   renderSellers(sellers);
   currentCharts=charts;
   renderSellerCharts(charts);
   renderedSellerQuery=query;
   for(const link of sellerExports.querySelectorAll('[data-seller-report]')) {
    const params=new URLSearchParams(query);
    params.set('report',link.dataset.sellerReport);
    link.href='/api/soumaisblu/relatorios?'+params;
   }
   sellerExports.hidden=false;
   sellerUpdatedAt=updatedAt;
  }
  const lastSync=sellerUpdatedAt?new Date(sellerUpdatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'';
  const messages={
   ready:`Sou+BLU · Atualizado em ${lastSync}`,
   pending:'Sou+BLU · Aguardando a primeira sincronização',
   unconfigured:'Sou+BLU · Aguardando configuração da chave da API',
   error:lastSync?`Sou+BLU · Falha na atualização. Última sincronização em ${lastSync}`:'Sou+BLU · Falha ao consultar a esteira'
  };
  sellerSource.textContent=messages[state]??messages.error;
 } catch {
  if(request!==sellerRequest) return;
  if(!sellerUpdatedAt&&location.origin!==new URL(sellerServerLink.href).origin) {
   showSellerPreview();
  } else {
   sellerSource.textContent=sellerUpdatedAt?'Sou+BLU · Conexão indisponível. Exibindo os últimos dados.':'Sou+BLU · Conexão indisponível';
  }
 }
}

function showSellerPreview() {
 sellerSource.textContent='A prévia estática não carrega os dados do Sou+BLU.';
 sellerServerLink.hidden=false;
}

const cpEndpoint='/api/soumaisblu/cp-mercantil';
const cpFilters=document.getElementById('cp-filters');
const cpSource=document.getElementById('cp-source');
const cpRows=document.getElementById('cp-rows');
const cpExports=document.getElementById('cp-exports');
let cpQuery=new URLSearchParams();
let cpRenderedQuery;
let cpUpdatedAt;
let cpRequest=0;

function setCpOptions(options) {
 for(const [key,all] of [['seller','Todos os vendedores'],['status','Todos os status']]) {
  const select=cpFilters.elements[key];
  const current=select.value;
  select.replaceChildren(new Option(all,'__all'),...(options[key]??[]).map(([value,label])=>new Option(label,value)));
  if([...select.options].some(option=>option.value===current)) select.value=current;
 }
}
setCpOptions({});
const cpStart=cpFilters.elements.start;
const cpEnd=cpFilters.elements.end;
for(const input of [cpStart,cpEnd]) input.addEventListener('input',()=>cpEnd.setCustomValidity(''));
cpFilters.addEventListener('submit',event=>{
 event.preventDefault();
 if(cpStart.value&&cpEnd.value&&cpStart.value>cpEnd.value) {
  cpEnd.setCustomValidity('A data final deve ser igual ou posterior à inicial.');
  cpEnd.reportValidity();
  return;
 }
 cpQuery=new URLSearchParams();
 for(const [key,value] of new FormData(cpFilters)) {
  if(['seller','status'].includes(key)?value!=='__all':value!=='') cpQuery.set(key,value);
 }
 if(location.protocol!=='file:') void refreshCp();
});
cpFilters.addEventListener('reset',()=>{
 cpEnd.setCustomValidity('');
 cpQuery=new URLSearchParams();
 if(location.protocol!=='file:') void refreshCp();
});
cpRows.addEventListener('error',event=>{
 if(event.target.classList.contains('seller-avatar-photo')) event.target.remove();
},true);
cpRows.addEventListener('click',event=>{
 const button=event.target.closest('[data-seller-detail]');
 if(!button) return;
 const query=new URLSearchParams(cpRenderedQuery);
 query.set('detail',button.dataset.sellerDetail);
 void openProposals(button.querySelector('.seller-name').textContent,query,cpEndpoint);
});

function renderCp(sellers) {
 const sum=key=>sellers.reduce((acc,seller)=>acc+seller[key],0);
 const totals=[sum('count'),fmt(sum('value')),sum('paidCount')];
 document.querySelectorAll('#cpmercantil .kpi strong').forEach((node,i)=>{node.textContent=totals[i]});
 document.getElementById('cp-paid-value').textContent=`${fmt(sum('paidValue'))} em propostas pagas`;
 cpRows.innerHTML=sellers.map(seller=>
  `<tr><td><button type="button" class="seller-detail-link" data-seller-detail="${escapeHTML(seller.key)}">${sellerAvatar(seller)}<span class="seller-name">${escapeHTML(seller.name)}</span></button></td><td>${seller.count}</td><td>${fmt(seller.value)}</td><td>${seller.paidCount}</td><td>${fmt(seller.paidValue)}</td></tr>`
 ).join('')||'<tr><td colspan="5">Nenhuma proposta da Gestão de Crédito no recorte selecionado.</td></tr>';
}

async function refreshCp() {
 const request=++cpRequest;
 const query=cpQuery.toString();
 try {
  const response=await fetch(cpEndpoint+'?'+query,{cache:'no-store',signal:AbortSignal.timeout(5000)});
  const {state,sellers,options,updatedAt}=await response.json();
  if(request!==cpRequest) return;
  if(updatedAt&&(updatedAt!==cpUpdatedAt||query!==cpRenderedQuery)) {
   if(updatedAt!==cpUpdatedAt) setCpOptions(options);
   renderCp(sellers);
   cpUpdatedAt=updatedAt;
   cpRenderedQuery=query;
   for(const link of cpExports.querySelectorAll('[data-cp-report]')) {
    const params=new URLSearchParams(query);
    params.set('area','cp-mercantil');
    params.set('report',link.dataset.cpReport);
    link.href='/api/soumaisblu/relatorios?'+params;
   }
   cpExports.hidden=false;
  }
  const stamp=cpUpdatedAt?new Date(cpUpdatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'';
  const messages={
   ready:`Gestão de Crédito · Atualizado em ${stamp}`,
   pending:'Gestão de Crédito · Aguardando a primeira sincronização',
   unconfigured:'Gestão de Crédito · Aguardando configuração do Sou+BLU',
   error:stamp?`Gestão de Crédito · Falha ao atualizar. Última sincronização em ${stamp}`:'Gestão de Crédito · Falha ao consultar o Sou+BLU'
  };
  cpSource.textContent=messages[state]??messages.error;
 } catch {
  if(request===cpRequest) cpSource.textContent='Gestão de Crédito · Abra pelo servidor do painel para consultar o Sou+BLU.';
 }
}

if(location.protocol!=='file:') {
 void refreshDashboard();
 void refreshSellers();
 void refreshGoals();
 setInterval(refreshSellers,15000);
 setInterval(refreshGoals,15000);
 setInterval(()=>{if(!document.getElementById('cpmercantil').hidden) void refreshCp()},15000);
} else {
 showSellerPreview();
}
document.querySelectorAll('.tabs .tab').forEach(btn=>btn.addEventListener('click',()=>{
 const target=btn.dataset.tab;
 document.querySelectorAll('.tabs .tab').forEach(b=>b.classList.toggle('active',b===btn));
 ['overview','seller','cpmercantil'].forEach(id=>{
  const panel=document.getElementById(id);
  if(panel) panel.hidden=(id!==target);
 });
 if(target==='cpmercantil'&&location.protocol!=='file:') void refreshCp();
}));
const initialTab=[...document.querySelectorAll('.tabs .tab')].find(btn=>'#'+btn.dataset.tab===location.hash);
initialTab?.click();
