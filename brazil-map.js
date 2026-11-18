(() => {
 const canvas=document.getElementById('brazil-map');
 const stateSelect=document.getElementById('brazil-map-state');
 const label=document.getElementById('brazil-map-label');
 const count=document.getElementById('brazil-map-count');
 const note=document.getElementById('brazil-map-note');
 const ranking=document.getElementById('brazil-map-ranking');
 const context=canvas.getContext('2d');
 const number=new Intl.NumberFormat('pt-BR');
 let states=[];
 let shapes=[];
 let report;
 let selected='';
 let hovered='';
 let loading=false;

 function color(value,maximum) {
  if(!value) return '#e8f0f7';
  const ratio=.12+.88*Math.sqrt(value/maximum);
  return 'rgb('+[220,235,248].map((channel,index)=>Math.round(channel+([16,69,129][index]-channel)*ratio)).join(',')+')';
 }

 function paint() {
  const scale=window.devicePixelRatio||1;
  context.setTransform(scale,0,0,scale,0,0);
  context.clearRect(0,0,canvas.width/scale,canvas.height/scale);
  const maximum=report?.states[0]?.count||1;
  const counts=new Map(report?.states.map(state=>[state.uf,state.count]));
  for(const shape of shapes) {
   context.fillStyle=color(counts.get(shape.uf)||0,maximum);
   context.fill(shape.path,'evenodd');
   context.strokeStyle='#fff';
   context.lineWidth=1;
   context.stroke(shape.path);
  }
  const active=shapes.find(shape=>shape.uf===(hovered||selected));
  if(active) {
   context.strokeStyle='#127985';
   context.lineWidth=2.1;
   context.stroke(active.path);
  }
 }

 function resize() {
  const {clientWidth:width,clientHeight:height}=canvas;
  if(!width||!height||!states.length) return;
  const scale=window.devicePixelRatio||1;
  canvas.width=Math.round(width*scale);
  canvas.height=Math.round(height*scale);
  const bounds=[-74,-34,-28,6];
  const stretch=.94;
  const factor=Math.min((width-16)/((bounds[2]-bounds[0])*stretch),(height-16)/(bounds[3]-bounds[1]));
  const left=(width-(bounds[2]-bounds[0])*factor*stretch)/2;
  const top=(height-(bounds[3]-bounds[1])*factor)/2;
  const project=([lon,lat])=>[left+(lon-bounds[0])*factor*stretch,top+(bounds[3]-lat)*factor];
  shapes=states.map(({geometry,properties})=>{
   const path=new Path2D();
   const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
   for(const polygon of polygons) {
    for(const ring of polygon) {
     if(!ring.length) continue;
     path.moveTo(...project(ring[0]));
     for(const point of ring.slice(1)) path.lineTo(...project(point));
     path.closePath();
    }
   }
   return {...properties,path};
  });
  paint();
 }

 function hit(event) {
  const rect=canvas.getBoundingClientRect();
  context.save();
  context.resetTransform();
  const shape=shapes.find(item=>context.isPointInPath(item.path,event.clientX-rect.left,event.clientY-rect.top,'evenodd'));
  context.restore();
  return shape;
 }

 function showSelection() {
  const state=states.find(feature=>feature.properties.uf===selected)?.properties;
  const record=report?.states.find(item=>item.uf===selected);
  label.textContent=state?`${state.name} · ${state.uf}`:'Brasil';
  count.textContent=report?number.format(state?record?.count??0:report.total-report.unknown):'—';
  for(const button of ranking.querySelectorAll('button')) button.setAttribute('aria-pressed',String(button.dataset.uf===selected));
 }

 function select(uf) {
  selected=uf;
  stateSelect.value=uf;
  showSelection();
  paint();
 }

 canvas.addEventListener('pointermove',event=>{
  const shape=hit(event);
  if(hovered===(shape?.uf??'')) return;
  hovered=shape?.uf??'';
  canvas.style.cursor=shape?'pointer':'default';
  const value=report?.states.find(state=>state.uf===hovered)?.count;
  canvas.title=shape?`${shape.name}${value===undefined?'':` · ${number.format(value)} propostas`}`:'';
  paint();
 });
 canvas.addEventListener('pointerleave',()=>{hovered='';paint()});
 canvas.addEventListener('click',event=>{const shape=hit(event);if(shape) select(shape.uf)});
 stateSelect.addEventListener('change',()=>select(stateSelect.value));
 ranking.addEventListener('click',event=>{
  const button=event.target.closest('button[data-uf]');
  if(button) select(button.dataset.uf);
 });
 new ResizeObserver(resize).observe(canvas);

 async function refresh() {
  if(loading||location.protocol==='file:') return;
  loading=true;
  try {
   const response=await fetch('/api/soumaisblu/mapa',{cache:'no-store',signal:AbortSignal.timeout(5000)});
   const data=await response.json();
   if(data.updatedAt&&(!report||report.updatedAt!==data.updatedAt)) {
    report=data;
    ranking.replaceChildren(...data.states.filter(state=>state.count>0).slice(0,5).map(state=>{
     const item=document.createElement('li');
     const button=document.createElement('button');
     button.type='button';
     button.dataset.uf=state.uf;
     button.append(state.name);
     const total=document.createElement('strong');
     total.textContent=number.format(state.count);
     button.append(total);
     item.append(button);
     return item;
    }));
    showSelection();
    paint();
   }
   const messages={
    ready:report?`${number.format(report.unknown)} de ${number.format(report.total)} propostas sem UF identificada.`:'',
    pending:'Aguardando a primeira sincronização com o Sou+BLU.',
    unconfigured:'Aguardando configuração do Sou+BLU.',
    error:report?'Exibindo a última distribuição recebida do Sou+BLU.':'Distribuição por estado indisponível.'
   };
   note.textContent=messages[data.state]??messages.error;
  } catch {
   note.textContent=report?'Exibindo a última distribuição recebida do Sou+BLU.':'Distribuição por estado indisponível.';
  } finally {
   loading=false;
  }
 }

 fetch('./brasil-ufs.geojson')
  .then(response=>{if(!response.ok) throw new Error();return response.json()})
  .then(geo=>{
   states=geo.features;
   const names=states.map(feature=>feature.properties).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
   stateSelect.append(...names.map(state=>new Option(`${state.name} · ${state.uf}`,state.uf)));
   resize();
   void refresh();
   if(location.protocol==='file:') note.textContent='Abra o painel pelo servidor para consultar o Sou+BLU.';
   else setInterval(refresh,15000);
  })
  .catch(()=>{note.textContent='Malha territorial indisponível.'});
})();
