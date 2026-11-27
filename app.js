'use strict';
const $ = id => document.getElementById(id);
const key = 'home-poker-ledger-v1';
const money = n => n.toLocaleString('ru-RU') + ' ₽';
const date = t => new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types = {join:'Вход',buy:'Докуп',exit:'Выход',back:'Возврат'};
const id = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const sum = (events, payout) => events.filter(e=>(e.type==='exit')===payout).reduce((n,e)=>n+e.amount,0);
const balance = events => sum(events,false)-sum(events,true);
const active = events => events.length>0 && events.at(-1).type!=='exit';
const amountOK = (n,min) => Number.isSafeInteger(n)&&n>=min&&n<=1000000000;
function valid(games){
  if(!Array.isArray(games))return false;
  const ids=new Set();
  return games.every(g=>{
    if(!g || typeof g.id!=='string'|| !g.id || ids.has(g.id)|| typeof g.name!=='string'|| !g.name.trim() || !Number.isFinite(new Date(g.time).getTime())||!amountOK(g.unit,1)||!Array.isArray(g.events))return false;
    ids.add(g.id);
    const players=new Map();
    return g.events.every(e=>{
      if(!e || typeof e.player!=='string'||!e.player.trim()||!Object.hasOwn(types,e.type)||!amountOK(e.amount,e.type==='exit'?0:1)||!Number.isFinite(new Date(e.time).getTime()))return false;
      const playing=players.get(e.player);
      if(e.type==='join'? playing!==undefined : e.type==='back'? playing!==false : playing!==true)return false;
      players.set(e.player,e.type!=='exit');
      return true;
    });
  });
}
let games=[], selected, historyView=false, onSubmit, timer;
const current = () => games.find(g=>g.id===selected);
const button=(action,label,who='',cls='')=>'<button class="'+cls+'" data-act="'+action+'" data-who="'+esc(who)+'">'+esc(label)+'</button>';
function notify(message){$('notice').textContent=message;clearTimeout(timer);timer=setTimeout(()=>$('notice').textContent='',3200)}
const api='https://poker.178-212-15-91.sslip.io';
const fragment=new URLSearchParams(location.hash.slice(1));
const viewer=fragment.has('view');
const ownerKey='poker-v2-owner';
const online=location.hostname.endsWith('github.io');
let credential='', rev=-1, shares={}, working=false, ready=false;
const queueKey=()=> 'poker-v2-pending-'+credential;
const status=text=>{$('sync').textContent=text};
function initialise(){
  if(viewer || fragment.has('host')){
    credential=fragment.get(viewer?'view':'host');
    if(!/^[a-f0-9]{64}$/.test(credential))throw Error('Некорректная ссылка.');
    if(!viewer){
      localStorage.setItem(ownerKey,credential);
      window.history.replaceState(null,'',location.pathname);
    }
  }else{
    credential=localStorage.getItem(ownerKey);
    if(!credential){
      credential=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      localStorage.setItem(ownerKey,credential);
    }
  }
}
async function request(path,options={}){
  return fetch(api+path,{...options,cache:'no-store',signal:AbortSignal.timeout(12000),
    headers:{Authorization:(options.method==='PUT'?'Owner ':'Bearer ')+credential,...options.headers}});
}
async function pull(){
  const r=await request(viewer?'/view':'/owner');
  if(!r.ok)throw Error(viewer&&r.status===404?'Игра по этой ссылке не найдена.':'Сервер временно недоступен.');
  const data=await r.json();
  const next=viewer?[data]:data.games;
  if(!valid(next))throw Error('Не удалось прочитать игру.');
  const changed=viewer?JSON.stringify(games)!==JSON.stringify(next):rev!==data.rev;
  if(changed){
    if(!viewer && rev>=0 && $('editor').open)$('editor').close();
    games=next;rev=data.rev;shares=data.shares||{};
    if(!current())selected=games.at(-1)?.id;
    render();
  }
  ready=true;status(viewer?'Только просмотр · обновляется онлайн':'Сохранено на сервере');
}
async function deliver(pending){
  const r=await request('/owner',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
  if(!r.ok && r.status!==409 && r.status!==400 && r.status!==413)throw Error('Ждём подтверждения сервера');
  await pull();
  if(JSON.parse(localStorage.getItem(queueKey())||'null')?.op===pending.op)localStorage.removeItem(queueKey());
  if(r.status===409)throw Error('Стол изменился на другом устройстве. Проверь журнал и повтори действие.');
  if(!r.ok)throw Error('Запись отклонена. Проверь данные и размер истории.');
}
async function sync(){
  if(working)return;
  working=true;
  try{
    const pending=!viewer && JSON.parse(localStorage.getItem(queueKey())||'null');
    if(pending)await deliver(pending);else await pull();
  }catch(err){status(err.message.startsWith('Игра по')||err.message.startsWith('Стол изменился')?err.message:'Нет подтверждения сервера · повторяем подключение')}
  finally{working=false}
}
async function save(next){
  if(!online){localStorage.setItem(key,JSON.stringify(next));games=next;return}
  if(viewer || !ready || working || localStorage.getItem(queueKey()))throw Error('Дождись синхронизации.');
  const pending={op:crypto.randomUUID(),rev,games:next};
  localStorage.setItem(queueKey(),JSON.stringify(pending));working=true;status('Сохраняем…');
  try{await deliver(pending)}
  catch(err){
    if(localStorage.getItem(queueKey())){
      $('editor').close();status('Запись ожидает отправки · повторим автоматически');
      throw Error('Запись в очереди. Повторять ввод не нужно.');
    }
    throw err;
  }finally{working=false}
}
function showLink(kind){
  const value=kind==='share'?shares[selected]:credential;
  if(!value)return notify('Дождись подтверждения сервера.');
  const link=new URL(location.href);
  link.hash=(kind==='share'?'view=':'host=')+value;
  modal(kind==='share'?'Ссылка для игроков':'Личная ссылка ведущего',
    '<p>'+(kind==='share'?'По ссылке видна только эта игра.':'Сохрани для входа с другого устройства. По ней можно изменять все твои игры.')+'</p><label>Ссылка<input readonly id="shareURL" value="'+esc(link.href)+'"></label>',async()=>{
      await navigator.clipboard.writeText(link.href);notify('Ссылка скопирована');
    });
  $('form').querySelector('.primary').textContent='Скопировать';
  $('shareURL').select();
}
function draw(){
  const g=current();
  if(historyView)return '<div class="row"><h1>История игр</h1>'+button('new','Новая сессия')+'</div><section>'+(games.length?[...games].reverse().map(s=>'<div class="entry"><div><strong>'+esc(s.name)+'</strong><small>'+date(s.time)+' · Внесено '+money(sum(s.events,false))+'</small></div>'+button('open','Открыть',s.id)+'</div>').join(''):'<p>Здесь появятся сыгранные сессии.</p>')+'</section><section class="backups"><h2>Копия истории</h2><div class="actions">'+button('export','Скачать копию данных')+button('import','Загрузить копию')+'</div></section>';
  if(!g)return '<section class="felt empty"><h1>Домашняя игра</h1><p>Создай сессию, чтобы записывать взносы и считать фишки за столом.</p>'+button('new','Создать сессию')+'</section>';
  const names=[...new Set(g.events.map(e=>e.player))];
  const rows=names.map(n=>({n,events:g.events.filter(e=>e.player===n)})).sort((a,b)=>Number(active(b.events))-Number(active(a.events)));
  const cards=rows.map(({n,events})=>{
    const live=active(events),result=-balance(events);
    const paid=sum(events,true);
    const summary=(live?'':'Вышел · ')+'Внесено '+money(sum(events,false))+(paid?' · Выплачено '+money(paid):'');
    const total=live?'':'<strong class="'+(result<0?'neg':'pos')+'">Итог '+(result>0?'+':'')+money(result)+'</strong>';
    const controls=live
      ? button('buy','Докуп',n)+button('exit','Выход',n)
      : button('back','Вернуть за стол',n);
    const displayName=viewer?esc(n):'<button class="player-name" data-act="rename" data-who="'+esc(n)+'" aria-label="Изменить имя: '+esc(n)+'">'+esc(n)+' <span aria-hidden="true">✎</span></button>';
    return '<article class="card"><div class="row"><div><h3>'+displayName+'</h3><small>'+summary+'</small></div>'+total+'</div>'+(viewer?'':'<div class="actions">'+controls+'</div>')+'</article>';

  }).join('');
  const journal=g.events.map((e,index)=>{
    const remove=!viewer && e.type==='buy' ? button('remove-buy','Удалить',index) : '';
    return '<div class="entry"><div><strong>'+esc(e.player)+'</strong><small>'+types[e.type]+' · '+date(e.time)+'</small></div><b>'+(e.type==='exit'?'−':'+')+money(e.amount)+'</b>'+remove+'</div>';
  }).reverse().join('');
  const left=balance(g.events), live=rows.filter(r=>active(r.events)).length;
  return '<div class="row"><div><small>'+date(g.time)+'</small><h1>'+esc(g.name)+'</h1></div>'+button('new','Новая сессия')+'</div><section class="felt"><span>Сейчас в игре</span><b>'+money(left)+'</b><p>Внесено '+money(sum(g.events,false))+' · Выплачено '+money(sum(g.events,true))+'</p></section>'+(names.length&&!live?'<p><strong>'+(left===0?'Стол сошёлся.':'Расхождение '+money(left)+'. Проверь взносы и выплаты.')+'</strong></p>':'')+'<section><div class="row"><h2>Игроки · '+live+' за столом</h2>'+button('join','Добавить игрока','','primary')+'</div>'+(cards||'<p class="empty">Добавь первого игрока и его взнос.</p>')+'</section><section><div class="row"><h2>Журнал</h2>'+(journal?button('undo','Отменить последнюю'):'')+'</div>'+(journal?'<div class="journal-list">'+journal+'</div>':'<p class="empty">Здесь появятся входы, докупы и выходы.</p>')+'</section>';
}
function render(){
  $('app').innerHTML=draw();
  if(viewer){
    document.querySelector('nav').hidden=true;
    $('app').querySelectorAll('button').forEach(b=>b.remove());
  }else if(online){
    $('app').insertAdjacentHTML('beforeend','<div class="actions">'+(current()&&!historyView?button('share','Ссылка для игроков'):'')+button('host','Личная ссылка ведущего')+'</div>');
  }
  document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-current',b.dataset.act===(historyView?'history':'table')?'page':'false'));
}
const field=(name,label,value='',numeric=false,min=1)=>'<label>'+label+'<input name="'+name+'" required '+(numeric?'type="number" inputmode="numeric" step="1" min="'+min+'" max="1000000000"':'maxlength="60"')+' value="'+esc(value)+'"></label>';
function modal(title,html,run){
  $('form').querySelector('.primary').textContent='Сохранить';
  $('title').textContent=title;$('fields').innerHTML=html;$('error').textContent='';
  onSubmit=run;$('editor').showModal();
}
async function record(type,player,amount){
  const g=current();
  if(!amountOK(amount,type==='exit'?0:1))throw Error('Проверь сумму.');
  const events=[...g.events,{type,player,amount,time:new Date().toISOString()}];
  const next=games.map(s=>s===g?{...g,events}:s);
  if(!valid(next))throw Error('Проверь имя и состояние игрока.');
  await save(next);render();notify(types[type]+' · '+player+' · '+money(amount));
}
async function act(a,who){
  const g=current();
  if(viewer)return;
  if(a==='host'||a==='share')return showLink(a);
  if(a==='history'||a==='table'||a==='open'){historyView=a==='history';if(a==='open')selected=who;render();window.scrollTo(0,0);return}
  if(a==='new')return modal('Новая сессия',field('name','Название','Игра '+(games.length+1))+field('unit','Обычный докуп, ₽',500,true),async f=>{
    const name=f.get('name').trim(),unit=Number(f.get('unit'));if(!name||!amountOK(unit,1))throw Error('Проверь название и сумму.');
    const game={id:id(),name,unit,time:new Date().toISOString(),events:[]};
    await save([...games,game]);selected=game.id;historyView=false;render();
  });
  if(a==='export'){
    const url=URL.createObjectURL(new Blob([JSON.stringify(games,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='poker-history.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  if(a==='import')return $('file').click();
  if(a==='rename'){
    return modal('Изменить имя',field('name','Имя или ник',who),async f=>{
      if(current()!==g)throw Error('Игра изменилась. Открой карточку заново.');
      const name=f.get('name').trim();
      if(!name)throw Error('Введи имя игрока.');
      if(name===who)return;
      const folded=name.normalize('NFC').toLocaleLowerCase('ru');
      if(g.events.some(e=>e.player!==who && e.player.normalize('NFC').toLocaleLowerCase('ru')===folded)){
        throw Error('Это имя уже занято в этой игре.');
      }
      const events=g.events.map(e=>e.player===who?{...e,player:name}:e);
      await save(games.map(s=>s===g?{...g,events}:s));
      render();notify('Имя изменено');
    });
  }
  if(a==='remove-buy'){
    const index=Number(who);
    const event=g.events[index];
    if(event?.type!=='buy')return;
    modal('Удалить докуп?','<p>'+esc(event.player)+' · '+money(event.amount)+'</p><p>'+date(event.time)+'</p>',async()=>{
      if(current()!==g)throw Error('Игра изменилась. Открой журнал заново.');
      const events=g.events.filter((_,i)=>i!==index);
      await save(games.map(s=>s===g?{...g,events}:s));
      render();notify('Докуп удалён');
    });
    $('form').querySelector('.primary').textContent='Удалить докуп';
    return;
  }
  if(a==='undo'){
    const last=g.events.at(-1);
    return modal('Отменить последнюю запись?','<p>'+esc(last.player)+' · '+types[last.type]+' · '+money(last.amount)+'</p>',async()=>{
      await save(games.map(s=>s===g?{...g,events:g.events.slice(0,-1)}:s));render();
    });
  }
  const join=a==='join',exit=a==='exit';
  modal(join?'Новый игрок':types[a]+' · '+who,(join?field('name','Имя или ник'):'')+field('amount',exit?'Сколько забрал, ₽':a==='buy'?'Сумма докупа, ₽':'Взнос, ₽',exit?'':g.unit,true,exit?0:1),async f=>{
    const n=join?f.get('name').trim():who;
    if(join&&g.events.some(e=>e.player.toLocaleLowerCase()===n.toLocaleLowerCase()))throw Error('Такой игрок уже есть. Открой его карточку.');
    await record(a,n,Number(f.get('amount')));
  });
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(b)try{await act(b.dataset.act,b.dataset.who)}catch(err){notify(err.message)}});
$('form').onsubmit=async e=>{e.preventDefault();try{await onSubmit(new FormData(e.target));$('editor').close()}catch(err){$('error').textContent=err.message}};
$('cancel').onclick=()=>$('editor').close();
$('file').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const imported=JSON.parse(await file.text());
    if(!valid(imported))throw Error();
    modal('Загрузить копию?','<p>Сессий в файле — '+imported.length+'. Сессии с тем же номером записи будут восстановлены из копии. Остальные сохранятся.</p>',async()=>{
      const merged=new Map(games.map(s=>[s.id,s]));imported.forEach(s=>merged.set(s.id,s));await save([...merged.values()]);render();notify('История загружена');
    });
  }catch{notify('Файл не подходит. Выбери копию истории покера.')}
  e.target.value='';
};
if(online){
  $('app').textContent='Подключаемся к игре…';
  try{
    initialise();sync();setInterval(sync,3000);
    window.addEventListener('online',sync);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
  }catch(err){status(err.message)}
}else{
  games=JSON.parse(localStorage.getItem(key)||'[]');
  selected=games.at(-1)?.id;render();status('Локальная версия');
}
