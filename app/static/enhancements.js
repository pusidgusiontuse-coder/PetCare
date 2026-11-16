/* Account security and PWA controls; all data operations use authenticated API. */
const featureRoot=document.createElement('section');
featureRoot.className='panel'; featureRoot.id='account-tools';
featureRoot.innerHTML=`<h2>Безопасность и приложение</h2><div class="row wrap" id="account-actions">
<button type="button" class="btn" data-security="verify_email">Подтвердить почту</button>
<button type="button" class="btn" data-security="password_change">Изменить пароль</button>
<button type="button" class="btn" data-security="email_change">Изменить почту</button>
<button type="button" class="btn" id="sessions-open">Устройства и входы</button>
<button type="button" class="btn" id="logout-everywhere">Выйти на всех устройствах</button>
<button type="button" class="btn" id="export-account">Скачать свои данные</button></div>
<p id="email-status"></p><p id="plan-status"></p><label><input type="checkbox" id="email-reminders"> Получать напоминания по почте</label><p><button type="button" class="btn primary" id="install-petcare">Установить PetCare</button> <button type="button" class="btn" id="subscribe-push">Уведомления при закрытом сайте</button></p>
<div id="session-list"></div><div id="server-members"></div><p id="feature-feedback" role="status"></p>`;
document.querySelector('#settings-security-body')?.append(featureRoot);
const appBody=document.getElementById('settings-app-body');
appBody.append(document.getElementById('plan-status'), document.getElementById('install-petcare'));
const notificationBody=document.getElementById('settings-notifications-body');
notificationBody.append(document.getElementById('email-reminders').closest('label'),document.getElementById('subscribe-push'));
document.getElementById('settings-sharing-body').append(document.getElementById('server-members'));
featureRoot.querySelector('h2').textContent='Доступ и данные';
const securityDialog=document.createElement('dialog'); securityDialog.id='security-dialog';
securityDialog.innerHTML=`<form id="security-form" class="panel"><h2 id="security-title">Подтверждение</h2><p id="security-info">Код действует 10 минут.</p>
<label class="field" id="security-current-wrap">Текущий пароль<input type="password" id="security-current" autocomplete="current-password"></label>
<label class="field" id="security-email-wrap">Электронная почта<input type="email" id="security-email" autocomplete="email"></label>
<label class="field" id="security-code-wrap" hidden>Код из письма<input id="security-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label>
<label class="field" id="security-new-wrap" hidden>Новый пароль<input type="password" id="security-new" minlength="8" autocomplete="new-password"></label>
<p id="security-error" role="alert"></p><div class="row"><button class="btn primary" id="security-submit">Получить код</button><button class="btn" type="button" id="security-resend" hidden>Отправить ещё раз</button><button class="btn" type="button" id="security-close">Закрыть</button></div></form>`;
document.body.append(securityDialog);
let securityPurpose='',securityChallenge='',securityResendAt=0;
const feedback=(text)=>{
 const group=document.activeElement?.closest('.settings-group');
 if(!group){notify(text);return;}
 const body=group.querySelector('.settings-body');
 let message=body.querySelector(':scope > .settings-feedback');
 if(!message){message=document.createElement('p');message.className='settings-feedback';message.setAttribute('role','status');body.append(message);}
 message.textContent=text;message.scrollIntoView({block:'nearest'});
};
function acceptSession(result){authToken=result.access_token; localStorage.setItem(STORAGE_AUTH_KEY,authToken); localStorage.removeItem('petcare-logged-out'); state.user={id:result.user.id,name:result.user.full_name,email:result.user.email,timezone:result.user.timezone};}
function openSecurity(purpose,challenge=''){
 securityPurpose=purpose;securityChallenge=challenge; securityResendAt=Date.now()+60000;
 $('security-form').reset(); $('security-error').textContent='';
 $('security-title').textContent=({register:'Подтверждение регистрации',password_reset:'Восстановление пароля',password_change:'Изменение пароля',email_change:'Изменение почты',verify_email:'Подтверждение почты',delete_account:'Удаление аккаунта'})[purpose];
 $('security-current-wrap').hidden=!['password_change','email_change','delete_account'].includes(purpose);
 $('security-email-wrap').hidden=!['password_reset','email_change'].includes(purpose);
 $('security-info').textContent='Код действует 10 минут. После смены пароля или почты прежние входы будут завершены.';
 if(purpose==='delete_account')$('security-info').textContent='Будут безвозвратно удалены ваш аккаунт, ваши питомцы и их записи. Введите текущий пароль, затем код из почты только если хотите удалить эти данные.';
 updateSecurityStage(); securityDialog.showModal();
}
function updateSecurityStage(){const has=Boolean(securityChallenge);$('security-code-wrap').hidden=!has;$('security-new-wrap').hidden=!(has&&['password_reset','password_change'].includes(securityPurpose));$('security-submit').textContent=has?'Подтвердить':'Получить код';$('security-resend').hidden=!has||securityPurpose==='register';}
async function requestSecurityCode(){
 const data={purpose:securityPurpose,email:securityPurpose==='password_reset'?$('security-email').value:(state.user.email||'no@example.com'),current_password:$('security-current').value,new_email:$('security-email').value};
 const result=await apiFetch(securityPurpose==='password_reset'?'/auth/codes':'/auth/account-codes',{method:'POST',body:JSON.stringify(data)});securityChallenge=result.challenge_id;securityResendAt=Date.now()+60000;updateSecurityStage();$('security-info').textContent=result.message||'Код отправлен на почту. Проверьте папку «Спам».';
}
$('security-form').onsubmit=async(e)=>{e.preventDefault();$('security-error').textContent='';$('security-submit').disabled=true;try{if(!securityChallenge){await requestSecurityCode();}else{const result=await apiFetch('/auth/confirm',{method:'POST',body:JSON.stringify({challenge_id:securityChallenge,code:$('security-code').value,new_password:$('security-new').value||null})});if(result.deleted){authToken='';localStorage.removeItem(STORAGE_AUTH_KEY);location.reload();return;}acceptSession(result);securityDialog.close();await syncServerData();feedback('Изменения подтверждены.');}}catch(err){$('security-error').textContent=err.message;}finally{$('security-submit').disabled=false;}};
$('security-resend').onclick=async()=>{try{if(Date.now()<securityResendAt)throw Error('Повторная отправка доступна через минуту.');await requestSecurityCode();}catch(e){$('security-error').textContent=e.message;}};
$('security-close').onclick=()=>securityDialog.close();
document.querySelectorAll('[data-security]').forEach(b=>b.onclick=()=>openSecurity(b.dataset.security));
const forgot=document.createElement('button');forgot.type='button';forgot.className='btn ghost';forgot.textContent='Забыли пароль?';forgot.onclick=()=>{$('auth-dialog').close();openSecurity('password_reset');};$('auth-form').append(forgot);
$('sessions-open').onclick=async()=>{try{const list=await apiFetch('/auth/sessions');$('session-list').innerHTML='<h3>Активные входы</h3>'+list.map(s=>`<div class="record">${esc(s.device)} ${s.current?' · это устройство':''}<br>${esc(s.created_at)} <button type="button" class="btn tiny" data-revoke="${esc(s.id)}">Завершить</button></div>`).join('');document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{try{await apiFetch('/auth/sessions/'+b.dataset.revoke,{method:'DELETE'});await $('sessions-open').onclick();}catch(e){feedback(e.message);}});}catch(e){feedback(e.message);}};
$('logout-everywhere').onclick=async()=>{try{await apiFetch('/auth/logout-all',{method:'POST'});authToken='';localStorage.removeItem(STORAGE_AUTH_KEY);location.reload();}catch(e){feedback(e.message);}};
$('export-account').onclick=async()=>{try{const result=await apiFetch('/account/export');const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='petcare-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){feedback(e.message);}};
let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
$('install-petcare').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else if(matchMedia('(display-mode: standalone)').matches){feedback('PetCare уже открыт как приложение.');}else{feedback(/iPhone|iPad|iPod/.test(navigator.userAgent)?'В Safari нажмите «Поделиться» → «На экран Домой» → «Добавить».':'Откройте меню браузера → «Установить приложение» или «Добавить на главный экран».');}};
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>feedback('Не удалось подготовить установку приложения. Проверьте сеть и HTTPS.'));
function base64Key(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}
$('subscribe-push').onclick=async()=>{try{
 if(!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('Этот браузер не поддерживает push. На iPhone сначала установите PetCare на главный экран.');
 const config=await apiFetch('/notifications/config');if(!config.configured||!config.public_key)throw Error('Сервер уведомлений ещё не настроен.');
 if(await Notification.requestPermission()!=='granted')throw Error('Разрешите уведомления в настройках браузера.');
 const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64Key(config.public_key)});
 await apiFetch('/notifications/subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())}); window.petcareServerPush=true;feedback('Серверные уведомления подключены на этом устройстве.');
 }catch(e){feedback(e.message);}};
async function refreshMembers(){
 const p=pet();$('server-members').innerHTML='';if(!p||p.ownerId!==state.user.id)return;
 const list=await apiFetch('/pets/'+p.serverId+'/members');
 $('server-members').innerHTML='<h3>Доступ к питомцу</h3>'+list.map(m=>`<div class="record">${esc(m.name)} · ${esc(m.email)} · ${m.role==='viewer'?'Просмотр':'Редактор'} · ${esc(m.expires_at||'Без срока')} <button type="button" class="btn tiny" data-remove-member="${m.id}">Отозвать доступ</button></div>`).join('')+'<button type="button" class="btn" id="rotate-invite">Перевыпустить код приглашения</button>';
 document.querySelectorAll('[data-remove-member]').forEach(b=>b.onclick=async()=>{try{await apiFetch(`/pets/${p.serverId}/members/${b.dataset.removeMember}`,{method:'DELETE'});await refreshMembers();}catch(e){feedback(e.message);}});
 $('rotate-invite').onclick=async()=>{try{const r=await apiFetch('/pets/'+p.serverId+'/rotate-code',{method:'POST'});p.shareCode=r.share_code;render();await refreshMembers();feedback('Новый код готов. Старый код больше не работает; уже выданные права сохранены.');}catch(e){feedback(e.message);}};
}
const originalRenderProfile=renderProfile;
renderProfile=function(){originalRenderProfile();if(authToken)refreshMembers().catch(e=>feedback(e.message));};
const deleteAccountButton=document.createElement('button');deleteAccountButton.type='button';deleteAccountButton.className='btn danger';deleteAccountButton.textContent='Удалить аккаунт и своих питомцев';deleteAccountButton.onclick=()=>openSecurity('delete_account');$('account-actions').append(deleteAccountButton);
const adminPanel=document.createElement('section');adminPanel.className='panel';adminPanel.id='admin-panel';adminPanel.hidden=true;
adminPanel.innerHTML='<h2>Администрирование</h2><div id="admin-stats"></div><label class="field">Поиск по имени или почте<input id="admin-search" type="search"></label><button type="button" class="btn" id="admin-refresh">Показать пользователей</button><div id="admin-users"></div><button type="button" class="btn" id="admin-next">Следующая страница</button><button type="button" class="btn" id="admin-audit-button">Журнал действий</button><div id="admin-audit"></div>';featureRoot.after(adminPanel);
let adminOffset=0;
async function loadAdmin(){
 const me=await apiFetch('/auth/me');featureRoot.querySelector('[data-security=verify_email]').hidden=Boolean(me.email_verified);$('plan-status').textContent=me.premium?'Расширенный доступ: ИИ и больше трёх питомцев.':'Бесплатный доступ: до трёх питомцев. ИИ доступен в платной версии; доступ выдаёт администратор.';$('email-reminders').checked=Boolean(state.settings.emailEnabled);$('email-status').textContent=me.email_verified?'Почта подтверждена':'Подтвердите почту для восстановления доступа. Администратору сначала нужно указать настоящую почту через «Изменить почту».';
 adminPanel.hidden=!me.is_admin;if(!me.is_admin)return;
 const stats=await apiFetch('/admin/status');$('admin-stats').textContent=`Пользователей: ${stats.users}, питомцев: ${stats.pets}, документов: ${stats.documents}. Почта: ${stats.smtp_configured?'подключена':'не подключена'}, ИИ: ${stats.ocr_configured?'подключён':'нужен API-ключ'}, Push: ${stats.push_configured?'ключи созданы':'не настроен'}.`;
 const r=await apiFetch('/admin/users?offset='+adminOffset+'&search='+encodeURIComponent($('admin-search').value));
 $('admin-users').innerHTML=r.users.map(u=>`<article class="record"><strong>${esc(u.full_name)}</strong> · ${esc(u.email)} · питомцев: ${u.pet_count}<p>${u.disabled?'Заблокирован':'Активен'} · ${u.premium?'Платный доступ '+esc(u.premium_until||'бессрочно'):'Бесплатный: до 3 питомцев'}</p><button type="button" class="btn tiny" data-premium="${u.id}">Доступ на 30 дней</button> <button type="button" class="btn tiny" data-permanent="${u.id}">Бессрочный доступ</button> <button type="button" class="btn tiny" data-free="${u.id}">Отозвать платный доступ</button> <button type="button" class="btn tiny" data-user-sessions="${u.id}">Завершить входы</button> ${u.is_admin?'':`<button type="button" class="btn tiny" data-block="${u.id}" data-blocked="${u.disabled}">${u.disabled?'Разблокировать':'Блокировать'}</button>`}</article>`).join('');
 $('admin-next').hidden=adminOffset+100>=r.total;
 for(const [attr,path,body] of [['premium','premium',{enabled:true,days:30}],['permanent','premium',{enabled:true}],['free','premium',{enabled:false}]])document.querySelectorAll('[data-'+attr+']').forEach(b=>b.onclick=async()=>{try{await apiFetch(`/admin/users/${b.dataset[attr]}/${path}`,{method:'PATCH',body:JSON.stringify(body)});await loadAdmin();}catch(e){feedback(e.message);}});
 document.querySelectorAll('[data-user-sessions]').forEach(b=>b.onclick=async()=>{try{await apiFetch(`/admin/users/${b.dataset.userSessions}/revoke-sessions`,{method:'POST'});feedback('Входы завершены.');}catch(e){feedback(e.message);}});
 document.querySelectorAll('[data-block]').forEach(b=>b.onclick=async()=>{try{await apiFetch(`/admin/users/${b.dataset.block}/blocked`,{method:'PATCH',body:JSON.stringify({blocked:b.dataset.blocked!=='true'})});await loadAdmin();}catch(e){feedback(e.message);}});
}
$('admin-refresh').onclick=()=>{adminOffset=0;loadAdmin().catch(e=>feedback(e.message));};$('admin-next').onclick=()=>{adminOffset+=100;loadAdmin().catch(e=>feedback(e.message));};
$('admin-audit-button').onclick=async()=>{try{const r=await apiFetch('/admin/audit');$('admin-audit').innerHTML=r.map(x=>`<p>${esc(x.at)} · админ ${x.actor_id} · пользователь ${x.target_id} · ${esc(x.action)}</p>`).join('');}catch(e){feedback(e.message);}};
const profileWithMembers=renderProfile;renderProfile=function(){profileWithMembers();if(authToken)loadAdmin().catch(e=>feedback(e.message));else adminPanel.hidden=true;};

if('serviceWorker' in navigator)navigator.serviceWorker.ready.then(async r=>{window.petcareServerPush=Boolean(await r.pushManager.getSubscription());}).catch(()=>{});

$('email-reminders').onchange=async()=>{const previous=Boolean(state.settings.emailEnabled);state.settings.emailEnabled=$('email-reminders').checked;try{await savePushSettings();}catch(e){state.settings.emailEnabled=previous;$('email-reminders').checked=previous;}};
