import { createApiClient } from '../lib/api';
import { publishNutrition, resetNutritionFilters } from '../features/nutrition/store';

// =====================================================================
// 1. CORE HELPERS & API CLIENT (ZERO-STORAGE JWT + BACKEND SYNC)
// =====================================================================
const $ = id => document.getElementById(id);
// Temporarily paused; retain all Friends UI, API integration and stored profiles.
const FRIENDS_ENABLED = false;
document.documentElement.dataset.friendsEnabled = String(FRIENDS_ENABLED);
document.querySelector('.nav [data-page="match"]').hidden = !FRIENDS_ENABLED;
document.getElementById('match').hidden = !FRIENDS_ENABLED;

const STORAGE_AUTH_KEY = 'petcare_jwt';
const STORAGE_PUSH_KEY = 'petcare_push_settings';
let authToken = '';

function cleanLegacyStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== STORAGE_AUTH_KEY && k !== STORAGE_PUSH_KEY && (k.startsWith('petcare_') || k.startsWith('petcare-'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}
cleanLegacyStorage();

try {
  authToken = localStorage.getItem(STORAGE_AUTH_KEY) || '';
} catch (e) {
  authToken = '';
}

const apiFetch = createApiClient({
  getToken: () => authToken,
  onUnauthorized: () => {
    authToken = '';
    try { localStorage.removeItem(STORAGE_AUTH_KEY); } catch {}
  },
  onMutationError: error => setTimeout(() => {
    notify('Не сохранено: ' + error.message);
    if (authToken) syncServerData(true);
  }, 100),
});

const uid = () => crypto.randomUUID?.() || String(Date.now() + Math.random());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = s => s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const money = n => n ? Number(n).toLocaleString('ru-RU') + ' ₽' : '—';

const mskDateParts = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
const mskDay = (d = new Date()) => { const v = mskDateParts(d); return v.year + '-' + v.month + '-' + v.day; };
const today = () => mskDay();
const mskMoment = at => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(at) ? at : at + '+03:00');
const mskLabel = at => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(mskMoment(at));
const when = s => mskLabel(s);
const mskNow = () => { const x = mskDateParts(); return x.year + '-' + x.month + '-' + x.day + 'T' + x.hour + ':' + x.minute; };
const mskShift = (day, amount) => { const d = new Date(day + 'T12:00:00+03:00'); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); };

const kindLabel = { food: 'Корм', treat: 'Лакомство', supplement: 'Добавка' };
const healthLabel = { vaccination: 'Прививка', parasite: 'Обработка', vet: 'Ветеринар', other: 'Другое' };
const rating = v => v === 'yes' ? 'Да' : v === 'no' ? 'Нет' : 'Не указано';

// =====================================================================
// 2. APPLICATION STATE & INITIAL SEED
// =====================================================================
let savedPushSettings = null;
try {
  savedPushSettings = JSON.parse(localStorage.getItem(STORAGE_PUSH_KEY) || 'null');
} catch {}

let state = {
  user: { id: 1, name: 'Илья', email: 'demo1@petcare.app', timezone: 'Europe/Moscow' },
  selected: null,
  pets: [],
  events: [],
  activity: [],
  health: [],
  prescriptions: [],
  weights: [],
  nutrition: [],
  mealPlans: [],
  feedingLogs: [],
  documents: [],
  shopping: [],
  members: [],
  contacts: {},
  avatar: {},
  settings: savedPushSettings || {
    pushEnabled: typeof Notification !== 'undefined' && Notification.permission === 'granted',
    quietStart: '22:00',
    quietEnd: '08:00',
    quietEnabled: false,
    types: ['Кормление', 'Препарат', 'Процедура', 'Ветеринар', 'Прогулка']
  }
};

async function savePushSettings() {
  try {
    if(authToken) await apiFetch('/notifications/settings',{method:'PUT',body:JSON.stringify(state.settings)});
    localStorage.setItem(STORAGE_PUSH_KEY,JSON.stringify(state.settings));
  } catch(err) { notify('Настройки не сохранены: '+err.message); throw err; }

}

let page = 'health', healthFilter = 'all', careFilter = 'all', documentFilter = 'all', toastTimer, modalType = '', lastChange = null, expandedHistoryPet = null;
const pet = () => state.pets.find(p => p.id === state.selected) || state.pets[0] || null;

function isForPet(item, currentPet) {
  if (!item || !currentPet) return false;
  return String(item.petId ?? item.pet_id ?? '') === String(currentPet.id);
}

function showCopiedToast(message = 'Скопировано') {
  $('toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 3000);
}

function notify(message) {
  if ($('editor')?.open) {
    $('editor-error').textContent = message;
    $('editor-error').hidden = false;
    $('editor-error').focus();
  } else {
    showCopiedToast(message);
  }
}

function clearEditorError() {
  $('editor-error').hidden = true;
  $('editor-error').textContent = '';
}

window.copyPetCode = function(code) {
  if (!code) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(code).then(() => {
      showCopiedToast('Скопировано');
    }).catch(() => {
      notify('Не удалось скопировать. Выделите код и скопируйте вручную.');
    });
  } else {
    notify('Выделите код и скопируйте вручную.');
  }
};

function logActivity(petId, action, icon = '🐾', actor = state.user.name || 'Владелец') {
  const entry = { id: uid(), petId: String(petId), actor, action, icon, at: new Date().toISOString() };
  state.activity.unshift(entry);
  state.activity = state.activity.slice(0, 50);
  const targetPet = state.pets.find(x => x.id === String(petId));
  if (targetPet?.serverId) {
    apiFetch('/pets/' + targetPet.serverId + '/activity', {
      method: 'POST',
      body: JSON.stringify({ action, actor, icon })
    }).catch(() => {});
  }
}

// =====================================================================
// 3. BACKEND SYNCHRONIZATION (syncServerData)
// =====================================================================
// Queue explicit refreshes: parallel responses must not append into shared arrays.
let syncTail = Promise.resolve(), syncPending = 0;
function syncServerData(silent = false) {
  syncPending += 1;
  const request = syncTail.then(() => loadServerData(silent));
  syncTail = request.catch(() => {});
  return request.finally(() => { syncPending -= 1; });
}

async function loadServerData(silent = false) {
  try {
    if (!authToken) {
      updateAuthStatusUI();
      render();
      return;
    }

    // 1. Check user session
    const u = await apiFetch('/auth/session');
    if (u) {
      state.user = {
        id: u.id,
        name: u.full_name || state.user.name,
        email: u.email || state.user.email,
        timezone: u.timezone || 'Europe/Moscow'
      };
    }

    const remoteSettings = await apiFetch('/notifications/settings');
    state.settings = { ...state.settings, ...remoteSettings };

    // 2. Load pets
    const remotePets = await apiFetch('/pets');
    if (Array.isArray(remotePets)) {
      const prevSelected = state.selected;
      state.pets = remotePets.map(p => ({
        id: String(p.id),
        serverId: p.id,
        ownerId: p.owner_id,
        name: p.name,
        species: p.species,
        breed: p.breed || 'Метис',
        birthDate: p.birth_date || '',
        sex: p.sex === 'male' ? 'Самец' : p.sex === 'female' ? 'Самка' : (p.sex || 'Неизвестно'),
        sterilized: p.sterilized ? 'Да' : 'Нет',
        notes: p.notes || '',
        marks: p.marks || '',
        chip: p.microchip_number || '',
        photo: p.photo_file_id || null,
        shareCode: p.share_code || '',
        isShared: Boolean(p.is_shared),
        coOwners: Array.isArray(p.co_owners) ? p.co_owners : []
      }));

      if (!state.pets.some(p => p.id === prevSelected)) {
        state.selected = state.pets[0]?.id || null;
      }

      // Clear collections before populating from server
      state.health = [];
      state.nutrition = [];
      state.mealPlans = [];
      state.feedingLogs = [];
      state.weights = [];
      state.prescriptions = [];
      state.documents = [];
      state.shopping = [];
      state.activity = [];

      // 3. Load full details for each pet
      for (const p of state.pets) {
        try {
          const detail = await apiFetch('/pets/' + p.serverId);
          if (!detail) continue;

          state.contacts[p.id] = { clinicUrl: detail.clinic_url || '', doctor: detail.doctor_name || '' };
          state.avatar[p.id] = { background: detail.avatar_bg || 'lavender', accessory: detail.avatar_accessory || 'none' };
          if (Array.isArray(detail.co_owners)) p.coOwners = detail.co_owners;

          if (Array.isArray(detail.health_records)) {
            detail.health_records.forEach(r => {
              const normType = ({ parasite_treatment: 'parasite', vet_visit: 'vet' })[r.record_type] || r.record_type || 'other';
              state.health.push({
                id: 'sh_' + r.id,
                serverId: r.id,
                petId: p.id,
                type: normType,
                title: r.title,
                date: r.event_date,
                notes: r.comment || r.vet_conclusion || '',
                product: r.medicine_name || '',
                clinic: r.clinic || '',
                doctor: r.doctor || '',
                result: r.result || '',
                nextDate: r.next_date || '',
                attachment: r.file_data ? { name: r.file_name || 'Файл', data: r.file_data } : null
              });
            });
          }

          if (Array.isArray(detail.nutrition_logs)) {
            detail.nutrition_logs.forEach(n => {
              state.nutrition.push({
                id: 'sn_' + n.id,
                serverId: n.id,
                petId: p.id,
                food: n.food_name,
                brand: n.brand || '',
                kind: n.kind || 'food',
                date: n.date || today(),
                liked: n.liked || 'unknown',
                tolerated: n.tolerated || 'unknown',
                reactions: n.adverse_reactions ? n.adverse_reactions.split(',').map(s => s.trim()).filter(Boolean) : [],
                price: n.price || null,
                notes: n.notes || ''
              });
            });
          }

          if (Array.isArray(detail.meal_plans)) {
            detail.meal_plans.forEach(m => {
              state.mealPlans.push({
                id: 'smp_' + m.id,
                serverId: m.id,
                petId: p.id,
                food: m.food,
                time: m.time,
                endTime: m.end_time || '',
                notes: m.notes || '',
                completedOn: m.completed_on || null
              });
            });
          }

          if (Array.isArray(detail.feeding_logs)) {
            detail.feeding_logs.forEach(f => {
              state.feedingLogs.push({
                id: 'sfl_' + f.id,
                serverId: f.id,
                petId: p.id,
                food: f.food,
                amount: f.amount || '',
                at: f.at,
                actor: f.actor || 'Владелец',
                notes: f.notes || '',
                mealPlanId: f.meal_plan_id ? 'smp_' + f.meal_plan_id : null,
                reminderId: f.reminder_id ? 'sr_' + f.reminder_id : null,
                completionDay: f.completion_day || null
              });
            });
          }

          if (Array.isArray(detail.weights)) {
            detail.weights.forEach(w => {
              state.weights.push({
                id: 'sw_' + w.id,
                serverId: w.id,
                petId: p.id,
                date: w.date,
                kg: Number(w.kg)
              });
            });
          }

          if (Array.isArray(detail.prescriptions)) {
            detail.prescriptions.forEach(pr => {
              state.prescriptions.push({
                id: 'spr_' + pr.id,
                serverId: pr.id,
                petId: p.id,
                name: pr.name,
                dose: pr.dose || '',
                startDate: pr.start_date,
                duration: pr.duration || '',
                times: pr.times || '',
                status: pr.status || 'Активно'
              });
            });
          }

          if (Array.isArray(detail.documents)) {
            detail.documents.forEach(d => {
              state.documents.push({
                id: 'sdoc_' + d.id,
                serverId: d.id,
                petId: p.id,
                title: d.title,
                type: d.doc_type || 'other',
                date: d.date,
                file: { name: d.file_name || d.title, data: d.file_data || '#' }
              });
            });
          }

          if (Array.isArray(detail.shopping_items)) {
            detail.shopping_items.forEach(s => {
              state.shopping.push({
                id: 'sshop_' + s.id,
                serverId: s.id,
                petId: p.id,
                title: s.title,
                quantity: s.quantity || '',
                done: Boolean(s.is_done),
                by: s.bought_by || null
              });
            });
          }

          if (Array.isArray(detail.activities)) {
            detail.activities.forEach(a => {
              state.activity.push({
                id: 'sact_' + a.id,
                serverId: a.id,
                petId: p.id,
                actor: a.actor || 'Владелец',
                action: a.action,
                icon: a.icon || '🐾',
                at: a.at
              });
            });
          }
        } catch (e) {
          console.warn('Detail load err:', e);
        }
      }

      // 4. Load all reminders
      const rems = await apiFetch('/reminders').catch(() => []);
      if (Array.isArray(rems)) {
        state.events = rems.map(r => ({
          id: 'sr_' + r.id,
          serverId: r.id,
          petId: String(r.pet_id),
          title: r.title,
          type: r.reminder_type === 'feeding' ? 'Кормление' : r.reminder_type === 'vet_visit' ? 'Ветеринар' : r.reminder_type === 'medication' ? 'Препарат' : (['Кормление', 'Препарат', 'Процедура', 'Ветеринар', 'Прогулка'].includes(r.reminder_type) ? r.reminder_type : 'Процедура'),
          at: r.at || ((r.due_date || today()) + 'T12:00:00+03:00'),
          food: r.food || '',
          status: r.status || (r.is_completed ? 'completed' : 'pending'),
          doneBy: r.done_by || null,
          completedAt: r.completed_at || null,
          intervalDays: r.interval_days || null,
          intervalMonths: r.interval_months || null
        }));
      }
      // 5. Load match data for active pet
      await loadMatchDataForActivePet(true);
    }
    if (!silent) updateAuthStatusUI();
  } catch (err) {
    console.warn('syncServerData notice:', err.message);
  } finally {
    updateAuthStatusUI();
    render();
    if (typeof scheduleNextExactPush === 'function') scheduleNextExactPush();
  }
}

function updateAuthStatusUI() {
  const loggedIn = Boolean(authToken && state.user?.email);
  const openBtn = $('api-open');
  if (openBtn) {
    openBtn.hidden = loggedIn;
    openBtn.textContent = 'Войти в аккаунт';
  }
  const settingsBtn = $('btn-account-settings');
  if (settingsBtn) settingsBtn.hidden = !loggedIn;
  const logoutBtn = $('api-logout');
  if (logoutBtn) logoutBtn.hidden = !loggedIn;
  const loginModalBtn = $('btn-open-auth-modal');
  if (loginModalBtn) loginModalBtn.hidden = loggedIn;
}

// =====================================================================
// 4. SVG PET ILLUSTRATIONS & AVATARS (FROM NEW DESIGN)
// =====================================================================
function petKind(species) {
  const s = (species || '').toLowerCase();
  return /собак|пёс|пес|овчарк|корги/.test(s) ? 'dog' : /хомяк/.test(s) ? 'hamster' : /птиц|попуг|канар/.test(s) ? 'bird' : /рыб/.test(s) ? 'fish' : /ящер|геккон/.test(s) ? 'lizard' : /зме|питон/.test(s) ? 'snake' : 'cat';
}

function petMood(petId) {
  const events = state.events.filter(e => String(e.petId) === String(petId)), day = mskDay(), now = new Date();
  if (events.some(e => e.status === 'pending' && mskMoment(e.at) < now) || events.some(e => e.status === 'skipped' && mskDay(mskMoment(e.completedAt || e.at)) === day)) return 'sad';
  const due = events.filter(e => mskDay(mskMoment(e.at)) === day);
  return (due.length && due.every(e => e.status === 'completed')) || (!events.some(e => e.status === 'pending') && events.some(e => e.status === 'completed')) ? 'happy' : 'neutral';
}

function petArt(p, mood = petMood(p.id)) {
  const kind = petKind(p.species), colors = { cat: ['#dfb596', '#f2d5be'], dog: ['#caa789', '#ecd0aa'], hamster: ['#e8bd8e', '#ffe0b4'], bird: ['#9fb7df', '#d3e1f7'], fish: ['#f3ae93', '#ffd1b8'], lizard: ['#99c6ad', '#d8edd9'], snake: ['#b6b0d9', '#e2dcf3'] }[kind], c = colors[0], light = colors[1], ink = '#51455f';
  const face = (x = 60, y = 55, mouthY = y + 17) => '<g class="eyes" fill="' + ink + '"><ellipse cx="' + (x - 15) + '" cy="' + y + '" rx="2.7" ry="3.5"/><ellipse cx="' + (x + 15) + '" cy="' + y + '" rx="2.7" ry="3.5"/></g>' + (mood === 'sad' ? '<path d="M' + (x - 21) + ' ' + (y - 7) + 'l8 3M' + (x + 13) + ' ' + (y - 4) + 'l8-3" fill="none" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>' : '') + '<path d="' + (mood === 'happy' ? 'M' + (x - 9) + ' ' + (mouthY - 3) + ' Q' + x + ' ' + (mouthY + 10) + ' ' + (x + 9) + ' ' + (mouthY - 3) : mood === 'sad' ? 'M' + (x - 9) + ' ' + (mouthY + 6) + ' Q' + x + ' ' + (mouthY - 5) + ' ' + (x + 9) + ' ' + (mouthY + 6) : 'M' + (x - 5) + ' ' + mouthY + 'h10') + '" fill="none" stroke="' + ink + '" stroke-width="2.7" stroke-linecap="round"/>' + (mood === 'happy' ? '<circle cx="' + (x - 26) + '" cy="' + (y + 10) + '" r="4" fill="#e89aa5" opacity=".55"/><circle cx="' + (x + 26) + '" cy="' + (y + 10) + '" r="4" fill="#e89aa5" opacity=".55"/>' : '');
  let shape = '';
  if (kind === 'cat') shape = '<g class="tail"><path d="M83 88 Q111 91 103 63" fill="none" stroke="' + c + '" stroke-width="12" stroke-linecap="round"/></g><ellipse cx="59" cy="88" rx="29" ry="22" fill="' + c + '"/><path d="M28 37 L32 15 L49 28 Q60 24 72 28 L89 15 L93 37 Q101 49 94 67 Q86 82 60 83 Q34 82 26 67 Q20 49 28 37Z" fill="' + c + '" stroke="' + ink + '" stroke-width="2.5"/><path d="M35 25l9 9M85 25l-9 9" stroke="' + light + '" stroke-width="7" stroke-linecap="round"/><path d="M60 29v7M49 29l-3 6M71 29l3 6" stroke="' + light + '" stroke-width="3" stroke-linecap="round"/>' + face(60, 51, 64) + '<path d="M55 61l5 4 5-4Z" fill="#9e7485"/><path d="M29 63l-17-3M29 68l-16 3M91 63l17-3M91 68l16 3" stroke="' + ink + '" stroke-width="1.7" stroke-linecap="round"/>';
  if (kind === 'dog') shape = '<g class="tail"><path d="M85 89q22-7 22-27" fill="none" stroke="' + c + '" stroke-width="12" stroke-linecap="round"/></g><ellipse cx="59" cy="89" rx="29" ry="21" fill="' + c + '"/><ellipse cx="27" cy="43" rx="12" ry="25" transform="rotate(20 27 43)" fill="' + c + '"/><ellipse cx="93" cy="43" rx="12" ry="25" transform="rotate(-20 93 43)" fill="' + c + '"/><rect x="29" y="26" width="62" height="58" rx="27" fill="' + light + '" stroke="' + ink + '" stroke-width="2.5"/><ellipse cx="60" cy="66" rx="18" ry="13" fill="#fff0df"/>' + face(60, 51, 69) + '<ellipse cx="60" cy="60" rx="6" ry="4" fill="' + ink + '"/>';
  if (kind === 'hamster') shape = '<circle cx="33" cy="29" r="13" fill="' + c + '" stroke="' + ink + '" stroke-width="2"/><circle cx="87" cy="29" r="13" fill="' + c + '" stroke="' + ink + '" stroke-width="2"/><circle cx="33" cy="29" r="7" fill="#efa7a9"/><circle cx="87" cy="29" r="7" fill="#efa7a9"/><ellipse cx="60" cy="69" rx="41" ry="38" fill="' + c + '" stroke="' + ink + '" stroke-width="2.5"/><ellipse cx="60" cy="78" rx="24" ry="19" fill="' + light + '"/><circle cx="31" cy="64" r="13" fill="#f4d3b8"/><circle cx="89" cy="64" r="13" fill="#f4d3b8"/>' + face(60, 54, 71) + '<ellipse cx="60" cy="68" rx="4" ry="3" fill="#ae7c83"/>';
  if (kind === 'bird') shape = '<path d="M40 96v9M79 96v9" stroke="' + ink + '" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="60" cy="75" rx="32" ry="31" fill="' + c + '" stroke="' + ink + '" stroke-width="2.5"/><circle cx="60" cy="42" r="26" fill="' + light + '" stroke="' + ink + '" stroke-width="2.5"/><path d="M50 18q-6-13 4-13M60 17q0-15 9-14" fill="none" stroke="' + c + '" stroke-width="5" stroke-linecap="round"/><ellipse cx="32" cy="73" rx="14" ry="21" transform="rotate(-20 32 73)" fill="' + light + '"/><ellipse cx="88" cy="73" rx="14" ry="21" transform="rotate(20 88 73)" fill="' + light + '"/>' + face(60, 38, 62) + '<path d="M53 52h14l-7 9Z" fill="#eaaa79" stroke="' + ink + '" stroke-width="1.7"/>';
  if (kind === 'fish') shape = '<g class="tail"><path d="M86 58l22-19v39Z" fill="' + c + '" stroke="' + ink + '" stroke-width="2.5"/></g><path d="M46 36l14-22 14 22" fill="' + light + '" stroke="' + ink + '" stroke-width="2.5"/><ellipse cx="54" cy="61" rx="39" ry="30" fill="' + c + '" stroke="' + ink + '" stroke-width="2.5"/><path d="M49 78l14 20 13-21" fill="' + light + '" stroke="' + ink + '" stroke-width="2"/><path d="M32 39q-10 21 0 43M77 39q10 21 0 43" fill="none" stroke="' + light + '" stroke-width="5"/>' + face(52, 54, 69);
  if (kind === 'lizard') shape = '<g class="tail"><path d="M82 83Q112 89 106 105" fill="none" stroke="' + c + '" stroke-width="14" stroke-linecap="round"/></g><path d="M37 74l-20 13m64-13 20 13M40 87l-18 15m58-15 18 15" stroke="' + c + '" stroke-width="10" stroke-linecap="round"/><ellipse cx="61" cy="79" rx="31" ry="22" fill="' + c + '" stroke="' + ink + '" stroke-width="2"/><rect x="30" y="24" width="64" height="53" rx="24" fill="' + light + '" stroke="' + ink + '" stroke-width="2.5"/><circle cx="26" cy="62" r="4" fill="' + c + '"/><circle cx="96" cy="62" r="4" fill="' + c + '"/>' + face(62, 47, 62);
  if (kind === 'snake') shape = '<path d="M28 92q-21-24 13-22t49 8q21 18-15 21-30 2-21-22" fill="none" stroke="' + c + '" stroke-width="19" stroke-linecap="round"/><path d="M28 92q-21-24 13-22t49 8q21 18-15 21-30 2-21-22" fill="none" stroke="' + ink + '" stroke-width="2"/><ellipse cx="70" cy="43" rx="31" ry="24" fill="' + light + '" stroke="' + ink + '" stroke-width="2.5"/>' + face(71, 39, 56) + '<path d="M72 69v9m0 0-5 5m5-5 5 5" fill="none" stroke="#dd8d9a" stroke-width="2" stroke-linecap="round"/>';
  return '<svg class="pet-art mood-' + mood + '" viewBox="0 0 120 120" role="img" aria-label="' + esc(p.species || 'Питомец') + '" xmlns="http://www.w3.org/2000/svg"><ellipse cx="60" cy="111" rx="36" ry="5" fill="#71678b" opacity=".13"/>' + shape + '</svg>';
}

function petAvatar(p) {
  return p?.photo ? '<img src="' + esc(p.photo) + '" width="120" height="120" alt="" draggable="false">' : petArt(p || { species: 'Кот' }, 'neutral');
}

function petProfileAge(birthDate, now = new Date()) {
  if (!birthDate) return 'Возраст не указан';
  const birth = new Date(birthDate + 'T12:00:00');
  if (!Number.isFinite(birth.getTime())) return 'Возраст не указан';
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months--;
  if (months < 0) return 'Возраст не указан';
  if (months === 0) return 'Меньше месяца';
  const plural = (n, forms) => n + ' ' + forms[new Intl.PluralRules('ru-RU').select(n)];
  const years = Math.floor(months / 12), rest = months % 12;
  return [years ? plural(years, { one: 'год', few: 'года', many: 'лет', other: 'лет' }) : '', rest ? plural(rest, { one: 'месяц', few: 'месяца', many: 'месяцев', other: 'месяцев' }) : ''].filter(Boolean).join(' ');
}

function petProfileLocalDate(now = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

// =====================================================================
// 5. ACCOUNT SWITCHER & NAVIGATION
// =====================================================================
let accountMenuPinned = false;
let accountCloseTimer;

function openPetAccounts(pin = false) {
  if ($('editor').open || !pet() || !state.pets.length) return;
  clearTimeout(accountCloseTimer);
  if (pin) accountMenuPinned = true;
  $('pet-account-panel').hidden = false;
  $('pet-account-button').setAttribute('aria-expanded', 'true');
}

function closePetAccounts(restoreFocus = false) {
  clearTimeout(accountCloseTimer);
  accountMenuPinned = false;
  $('pet-account-panel').hidden = true;
  $('pet-account-button').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('pet-account-button').focus();
}

function renderPetAccountSwitcher() {
  const current = pet();
  if (!current) {
    closePetAccounts();
    $('account-avatar').innerHTML = '';
    $('account-name').textContent = 'Нет питомцев';
    $('pet-account-list').innerHTML = '';
    $('pet-account-button').disabled = true;
    return;
  }
  $('pet-account-button').disabled = false;
  $('account-avatar').innerHTML = petAvatar(current);
  $('account-name').textContent = current.name;
  $('pet-account-button').setAttribute('aria-label', 'Аккаунт питомца: ' + current.name);

  $('pet-account-list').innerHTML = state.pets.map(p => {
    const chosen = p.id === current.id;
    return '<button type="button" class="account-row ' + (chosen ? 'is-current' : '') + '" data-account-pet="' + esc(p.id) + '" aria-pressed="' + chosen + '">' +
      '<span class="account-avatar" aria-hidden="true">' + petAvatar(p) + '</span>' +
      '<span class="account-row-copy"><b>' + esc(p.name) + '</b><small>' + esc(p.species) + (p.isShared ? ' · Совместный уход' : '') + '</small></span>' +
      '<span class="account-check" aria-hidden="true">✓</span>' +
    '</button>';
  }).join('');
}

function setupPetAccountSwitcher() {
  const widget = $('pet-account-switcher'), trigger = $('pet-account-button'), panel = $('pet-account-panel');
  widget.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch' && pet()) openPetAccounts(); });
  widget.addEventListener('pointerleave', () => {
    accountCloseTimer = setTimeout(() => {
      if (!accountMenuPinned && !widget.contains(document.activeElement)) closePetAccounts();
    }, 180);
  });
  widget.addEventListener('focusout', event => { if (!widget.contains(event.relatedTarget)) closePetAccounts(); });
  trigger.onclick = () => {
    if (!pet()) return;
    if (!panel.hidden && accountMenuPinned) closePetAccounts();
    else openPetAccounts(true);
  };
  $('pet-account-list').onclick = event => {
    const button = event.target.closest('[data-account-pet]');
    if (!button) return;
    selectPet(button.dataset.accountPet);
    closePetAccounts(true);
  };
  $('account-add').onclick = () => { closePetAccounts(); openModal('pet'); };
  document.addEventListener('pointerdown', event => { if (!widget.contains(event.target)) closePetAccounts(); });
}

const pageLabels = { pets: 'Мои питомцы', health: 'Здоровье', nutrition: 'Питание', care: 'Уход и события', documents: 'Документы', match: 'Поиск друзей', profile: 'Профиль и настройки' };

function routeHash(name, petId = pet()?.id) {
  if (name === 'pets' || name === 'profile' || !petId) return '#/' + name;
  return '#/pet/' + encodeURIComponent(petId) + '/' + name;
}

function mayDiscardPetEdits() {
  const form = $('health-pet-form');
  if (form.dataset.dirty !== 'true') return true;
  if (!confirm('В карточке питомца есть несохранённые изменения. Выйти без сохранения?')) return false;
  renderHealthPetProfile(true);
  return true;
}

function setPetContext(id) {
  if (!state.pets.some(p => p.id === String(id))) return false;
  const changed = state.selected !== String(id);
  if (changed && !mayDiscardPetEdits()) return false;
  state.selected = String(id);
  healthFilter = 'all'; documentFilter = 'all'; careFilter = 'all';
  resetNutritionFilters();
  if (changed) {
    matchInspectProfileId = null;
    loadMatchDataForActivePet();
  }
  return true;
}

function selectPet(id, destination = page) {
  if (!setPetContext(id)) return;
  show(['pets', 'profile'].includes(destination) ? 'health' : destination);
}

function show(name, updateUrl = true) {
  if (name === 'match' && !FRIENDS_ENABLED) { name = 'pets'; history.replaceState(null, '', routeHash('pets')); }
  if (name === 'home') name = 'health';
  if (!Object.hasOwn(pageLabels, name) || (!pet() && !['pets', 'profile'].includes(name))) name = 'pets';
  if (name !== page && !mayDiscardPetEdits()) { history.replaceState(null, '', routeHash(page)); return; }
  const pageChanged = name !== page;
  const enteringMatch = name === 'match' && page !== 'match';
  page = name;
  if (enteringMatch && pet()) {
    const m = matchDataByPet[pet().id];
    if (m && m.loaded && !m.myProfile) {
      matchTab = 'profile';
    }
  }
  document.querySelectorAll('.section').forEach(section => section.classList.toggle('active', section.id === name));
  document.querySelectorAll('.nav [data-page]').forEach(button => {
    const selected = button.dataset.page === name;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (updateUrl) {
    const hash = routeHash(name);
    if (location.hash !== hash) history.pushState(null, '', hash);
  }
  render();
  window.scrollTo(0, 0);
  if (pageChanged) { const heading = $(name)?.querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); } }
}

function renderShell() {
  const current = pet();
  renderPetAccountSwitcher();
  $('pet-count').textContent = state.pets.length;
  $('owner-name').textContent = state.user.name || 'Владелец';
  $('owner-initial').textContent = (state.user.name || 'В').slice(0, 1).toUpperCase();
  const all = document.querySelector('.all-pets');
  all.classList.toggle('active', page === 'pets');
  if (page === 'pets') all.setAttribute('aria-current', 'page'); else all.removeAttribute('aria-current');
  $('breadcrumbs').innerHTML = page === 'pets' || !current
    ? '<span>PetCare</span><span aria-hidden="true">/</span><b>' + esc(pageLabels[page]) + '</b>'
    : '<button id="breadcrumb-pets" type="button">Мои питомцы</button><span aria-hidden="true">/</span><b>' + esc(current.name) + '</b><span aria-hidden="true">/</span><span>' + esc(pageLabels[page]) + '</span>';
  if ($('breadcrumb-pets')) $('breadcrumb-pets').onclick = () => show('pets');
  $('header-date').textContent = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', weekday: 'short' }).format(new Date());
  document.title = page === 'pets' || !current ? 'Мои питомцы · PetCare' : current.name + ' · ' + pageLabels[page] + ' · PetCare';
}

// =====================================================================
// 6. SECTION RENDERERS (NEW DESIGN + JOINT CARE + BACKEND)
// =====================================================================
const reminderStatus = e => {
  const moment = mskMoment(e.at), day = mskDay(moment), t = mskDay();
  if (moment < new Date()) return 'overdue';
  if (day === t) return 'today';
  if (day === mskShift(t, 1)) return 'tomorrow';
  return day <= mskShift(t, 6) ? 'week' : 'later';
};

function render() {
  const current = pet();
  document.querySelectorAll('.nav [data-page]').forEach(button => { button.href = routeHash(button.dataset.page); button.tabIndex = !current && button.dataset.page !== 'pets' ? -1 : 0; button.setAttribute('aria-disabled', String(!current && button.dataset.page !== 'pets')); });
  $('pet-account-button').disabled = !current;

  if (!current) {
    $('today-panel').hidden = true;
    if (!['pets', 'profile'].includes(page)) page = 'pets';
    document.querySelectorAll('.section').forEach(section => section.classList.toggle('active', section.id === page));
    $('pet-cards').innerHTML = '<p class="empty">Пока нет питомцев. Нажмите «+ Добавить питомца», чтобы создать карточку или подключиться по коду совместного ухода.</p>';
    $('pet-count').textContent = '0';
    $('account-avatar').innerHTML = '';
    $('account-name').textContent = 'Нет питомцев';
    renderShell();
    renderProfile();
    return;
  }

  renderShell();
  renderPetDirectory();
  renderHealth();
  renderNutrition();
  renderCare();
  renderDocuments();
  renderMatch();
  renderProfile();
  renderPetHighlights();
}

function renderPetDirectory() {
  const pending = id => state.events.filter(e => String(e.petId) === String(id) && e.status === 'pending').sort((a, b) => mskMoment(a.at) - mskMoment(b.at));
  const selected = pet();
  $('today-panel').hidden = false;
  const todayEvents = pending(selected.id).filter(e => mskDay(mskMoment(e.at)) === mskDay());
  const meals = dailyMealsForPet(selected.id);
  $('today-overview').innerHTML = '<p>' + esc(selected.name) + ' · расписание по Москве</p>' +
    (todayEvents.length ? todayEvents.slice(0, 3).map(e => '<p><a class="doc-link" href="' + esc(routeHash('care')) + '">' + esc(e.title) + ' · ' + esc(mskLabel(e.at)) + '</a></p>').join('') : '<p class="small">На сегодня процедур нет.</p>') +
    (meals.length ? '<a class="doc-link" href="' + esc(routeHash('nutrition')) + '">Кормления на сегодня: ' + meals.length + ' · открыть расписание</a>' : '');
  $('pet-cards').innerHTML = state.pets.map((p, index) => {
    const events = pending(p.id), overdueEvents = events.filter(e => reminderStatus(e) === 'overdue'), overdue = overdueEvents.length > 0;
    const status = overdue ? 'Просрочено: ' + overdueEvents[0].title + ' · ' + mskLabel(overdueEvents[0].at) + (overdueEvents.length > 1 ? ' · всего ' + overdueEvents.length : '') : events.length ? 'Ближайшее: ' + mskLabel(events[0].at) : (p.isShared ? 'Совместный уход активен' : 'Нет запланированных событий');
    const art = petAvatar(p);
    const shareHtml = p.shareCode
      ? '<button type="button" class="pet-card-code" data-copy-code="' + esc(p.shareCode) + '" title="Скопировать код для совместного ухода">' +
          '<span>Код:</span><code>' + esc(p.shareCode) + '</code><span class="copy-label">копировать</span>' +
        '</button>'
      : '';
    return '<div class="pet-card">' +
      '<span class="pet-card-visual">' +
        '<span class="pet-number">ПИТОМЕЦ ' + String(index + 1).padStart(2, '0') + (p.isShared ? ' · СОВМЕСТНЫЙ' : '') + '</span>' +
        '<span class="pet-visual-mark" aria-hidden="true"><svg><use href="#heart"/></svg></span>' +
        '<span class="avatar">' + art + '</span>' +
      '</span>' +
      '<span class="pet-card-body">' +
        '<strong>' + esc(p.name) + '</strong>' +
        '<span class="pet-card-meta">' + esc(p.species) + ' · ' + esc(p.breed || 'Метис') + ' · ' + esc(petProfileAge(p.birthDate)) + '</span>' +
        shareHtml +
        '<span class="pet-card-status"><span class="status-dot ' + (overdue ? 'warning' : '') + '"></span>' + esc(status) + '</span>' +
        (overdue ? '<button type="button" class="btn tiny" data-overdue-pet="' + esc(p.id) + '">' + (overdueEvents.length > 1 ? 'Посмотреть просроченные' : 'Посмотреть событие') + '</button>' : '') +
        '<button type="button" class="pet-card-footer" data-open-pet="' + esc(p.id) + '" aria-label="Открыть карточку: ' + esc(p.name) + '"><span>Открыть карточку</span><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg></span></button>' +
      '</span>' +
    '</div>';
  }).join('');

  $('pet-cards').querySelectorAll('[data-overdue-pet]').forEach(button => { button.onclick = () => { if (!setPetContext(button.dataset.overduePet)) return; careFilter = 'overdue'; show('care'); $('care-events').scrollIntoView({block: 'start'}); $('care-filters').querySelector('[data-care-filter=overdue]').focus(); }; });

  $('pet-cards').querySelectorAll('[data-copy-code]').forEach(badge => {
    badge.onclick = e => {
      e.stopPropagation();
      window.copyPetCode(badge.dataset.copyCode);
    };
  });

  $('pet-cards').querySelectorAll('[data-open-pet]').forEach(card => {
    card.onclick = () => {
      if (!setPetContext(card.dataset.openPet)) return;
      render();
      openModal('pet-details');
    };

  });
}

function renderPetHighlights() {
  const p = pet();
  if (!p) return;
  renderHealthPetProfile();
  const entries = state.activity.filter(a => isForPet(a, p)).slice(0, 12);
  $('care-activity').innerHTML = entries.map(a => '<div class="activity-item"><span class="activity-icon"><svg aria-hidden="true"><use href="#paw"/></svg></span><div><b>' + esc(a.action) + '</b><p>' + esc(a.actor) + '</p></div><time>' + esc(when(a.at)) + '</time></div>').join('') || '<p class="empty">Записей пока нет. Отметьте первое действие по уходу.</p>';
}

// HEALTH SECTION
const filters = [['all', 'Все'], ['vaccination', 'Прививки'], ['parasite', 'Обработки'], ['vet', 'Ветеринар'], ['other', 'Другое']];

function renderHealth() {
  // A background refresh must not collapse the action the user is opening.
  const openRecords = new Set(Array.from(
    $('health-records').querySelectorAll('[data-health-record] .record-actions[open]'),
    details => details.closest('[data-health-record]').dataset.healthRecord,
  ));
  const p = pet();
  if (!p) return;
  $('health-pet-name').textContent = p.name + (p.isShared ? ' · Совместный уход' : '');
  $('health-filters').innerHTML = filters.map(([v, t]) => '<button class="chip ' + (healthFilter === v ? 'active' : '') + '" data-health-filter="' + v + '" type="button">' + t + '</button>').join('');
  document.querySelectorAll('[data-health-filter]').forEach(b => b.onclick = () => { healthFilter = b.dataset.healthFilter; renderHealth(); });

  const rows = state.health.filter(x => isForPet(x, p) && (healthFilter === 'all' || x.type === healthFilter)).sort((a, b) => b.date.localeCompare(a.date));
  $('health-records').innerHTML = rows.length ? rows.map(x => '<article class="record" data-health-record="' + esc(x.id) + '"><div class="record-title"><b>' + esc(x.title || healthLabel[x.type]) + '</b><span class="type">' + esc(healthLabel[x.type] || 'Запись') + '</span></div><time>' + esc(date(x.date)) + '</time><p>' + [x.product, x.clinic && 'Клиника: ' + x.clinic, x.doctor && 'Врач: ' + x.doctor, x.result && 'Результат: ' + x.result, x.notes, x.nextDate && 'Следующая процедура: ' + date(x.nextDate)].filter(Boolean).map(esc).join(' · ') + '</p>' + (x.attachment?.data ? '<a class="doc-link" href="' + esc(x.attachment.data) + '" download="' + esc(x.attachment.name) + '">Скачать вложение: ' + esc(x.attachment.name) + '</a>' : '') + '<details class="record-actions"' + (openRecords.has(String(x.id)) ? ' open' : '') + '><summary aria-label="Ещё: ' + esc(x.title || healthLabel[x.type] || 'Запись о здоровье') + '">Ещё</summary><button class="btn tiny ghost danger" type="button" data-del-health="' + esc(x.id) + '">Удалить</button></details></article>').join('') : '<p class="empty">Записей пока нет.</p>';

  $('health-records').querySelectorAll('[data-del-health]').forEach(btn => {
    btn.onclick = async () => {
      const rec = state.health.find(x => x.id === btn.dataset.delHealth);
      if (!rec) return;
      if (!confirm('Удалить запись «' + (rec.title || 'О здоровье') + '»? Это действие нельзя отменить.')) return;
      btn.disabled = true;
      try {
        if (rec.serverId) await apiFetch('/health-records/' + rec.serverId, {method:'DELETE'});
        state.health = state.health.filter(x => x.id !== rec.id); renderHealth(); notify('Запись удалена');
      } catch (error) { notify('Не удалось удалить запись. ' + error.message); }
      finally { btn.disabled = false; }
    };
  });

  $('prescriptions').innerHTML = state.prescriptions.filter(x => isForPet(x, p)).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(x => '<article class="record"><div class="record-title"><b>' + esc(x.name) + '</b><span class="type">' + esc(x.status || 'Активно') + '</span></div><p>' + esc(x.dose || 'Дозировка не указана') + ' · ' + esc(x.times || 'По назначению') + ' · ' + esc(x.duration || 'Курс') + '</p><time>С ' + esc(date(x.startDate)) + '</time><details class="record-actions"><summary aria-label="Ещё: ' + esc(x.name) + '">Ещё</summary><button class="btn tiny ghost danger" type="button" data-del-presc="' + esc(x.id) + '">Удалить</button></details></article>').join('') || '<p class="empty">Назначений пока нет.</p>';

  $('prescriptions').querySelectorAll('[data-del-presc]').forEach(btn => {
    btn.onclick = async () => {
      const pr = state.prescriptions.find(x => x.id === btn.dataset.delPresc);
      if (!pr) return;
      if (!confirm('Удалить назначение «' + pr.name + '»? Это действие нельзя отменить.')) return;
      btn.disabled = true;
      try {
        if (pr.serverId) await apiFetch('/prescriptions/' + pr.serverId, {method:'DELETE'});
        state.prescriptions = state.prescriptions.filter(x => x.id !== pr.id); renderHealth(); notify('Назначение удалено');
      } catch (error) { notify('Не удалось удалить назначение. ' + error.message); }
      finally { btn.disabled = false; }
    };
  });

  renderWeight();
}

function renderWeight() {
  const p = pet(), period = $('weight-period').value, cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(period));
  const arr = state.weights.filter(w => isForPet(w, p) && (period === 'all' || new Date(w.date) >= cutoff)).sort((a, b) => a.date.localeCompare(b.date));
  $('last-weight').textContent = arr.length ? String(arr.at(-1).kg).replace('.', ',') + ' кг' : 'Нет измерений';
  $('weight-history').textContent = arr.map(x => date(x.date) + ' · ' + String(x.kg).replace('.', ',') + ' кг').join('  ·  ');
  if (!arr.length) {
    $('weight-chart').innerHTML = '<p class="empty">За выбранный период измерений нет.</p>';
    return;
  }
  const vals = arr.map(x => Number(x.kg)), lo = Math.max(0, Math.floor((Math.min(...vals) - 0.25) * 10) / 10), hi = Math.ceil((Math.max(...vals) + 0.25) * 10) / 10, span = Math.max(hi - lo, 0.5);
  const points = arr.map((x, i) => [arr.length === 1 ? 200 : 20 + i * 360 / (arr.length - 1), 145 - (Number(x.kg) - lo) / span * 105]);
  $('weight-chart').innerHTML = '<svg viewBox="0 0 400 170" role="img" aria-label="График веса"><path d="M20 145H380M20 90H380M20 38H380" stroke="#dce4da" stroke-dasharray="4 5"/><polyline points="' + points.map(pt => pt.join(',')).join(' ') + '" fill="none" stroke="#286247" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' + points.map(([x, y]) => '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="#286247" stroke="#fffefa" stroke-width="2"/>').join('') + '<text x="2" y="39" font-size="9" fill="#5e7065">' + hi.toFixed(1) + '</text><text x="2" y="148" font-size="9" fill="#5e7065">' + lo.toFixed(1) + '</text></svg><div class="chart-labels"><span>' + esc(date(arr[0].date)) + '</span><span>' + esc(date(arr.at(-1).date)) + '</span></div>';
}
$('weight-period').onchange = renderWeight;

// HEALTH INLINE PET PROFILE FORM
const field = (name, label, type = 'text', opts = {}) => '<label class="field ' + (opts.full ? 'full' : '') + '">' + label + (type === 'select' ? '<select name="' + name + '" ' + (opts.required ? 'required' : '') + '>' + opts.options.map(([v, t]) => '<option value="' + esc(v) + '">' + esc(t) + '</option>').join('') + '</select>' : type === 'textarea' ? '<textarea name="' + name + '" placeholder="' + esc(opts.placeholder || '') + '"></textarea>' : '<input name="' + name + '" type="' + type + '" ' + (opts.required ? 'required' : '') + ' ' + (opts.min ? 'min="' + opts.min + '"' : '') + ' ' + (opts.max ? 'max="' + opts.max + '"' : '') + ' ' + (opts.step ? 'step="' + opts.step + '"' : '') + ' placeholder="' + esc(opts.placeholder || '') + '">') + '</label>';
const f = { date: n => field(n, 'Дата', 'date', { required: true }), notes: () => field('notes', 'Комментарий', 'textarea', { full: true }) };

function petProfileFields(p) {
  const shareBlock = p?.shareCode
    ? '<div class="field wide-mobile"><label>Код совместного ухода</label><div class="join-input-group" style="margin-top:8px"><input type="text" aria-label="Код совместного ухода" value="' + esc(p.shareCode) + '" readonly aria-readonly="true"><button type="button" class="btn tiny" data-copy-pet-code="' + esc(p.shareCode) + '">Скопировать</button></div></div>'
    : '';
  return field('name', 'Имя', 'text', { required: true }) +
    field('species', 'Вид', 'text', { required: true, placeholder: 'Кошка, собака…' }) +
    field('breed', 'Порода', 'text', { placeholder: 'Порода или метис' }) +
    field('birthDate', 'Дата рождения', 'date', { max: petProfileLocalDate() }) +
    '<label class="field wide-mobile">Возраст<input name="calculatedAge" readonly aria-readonly="true"><span class="profile-age-hint">Рассчитывается по дате рождения</span></label>' +
    field('sex', 'Пол', 'select', { options: [['Неизвестно', 'Неизвестно'], ['Самец', 'Самец'], ['Самка', 'Самка']] }) +
    field('sterilized', 'Стерилизация', 'select', { options: [['Неизвестно', 'Неизвестно'], ['Да', 'Да'], ['Нет', 'Нет']] }) +
    '<label class="field wide-mobile">Номер чипа<input name="chip" type="text" placeholder="15-значный номер микрочипа"></label>' +
    shareBlock +
    '<div class="profile-notes-fields">' +
      field('notes', 'Особенности', 'textarea', { placeholder: 'Привычки, характер и особенности ухода' }) +
      field('marks', 'Важные отметки', 'textarea', { placeholder: 'Аллергии и другие важные сведения' }) +
    '</div>';
}

function fillHealthPetForm(p) {
  const form = $('health-pet-form');
  $('health-profile-fields').innerHTML = petProfileFields(p);
  for (const [key, value] of Object.entries(p)) {
    const input = form.elements.namedItem(key);
    if (input) input.value = value ?? '';
  }
  form.elements.namedItem('calculatedAge').value = petProfileAge(p.birthDate);
  form.elements.namedItem('birthDate').oninput = event => {
    form.elements.namedItem('calculatedAge').value = petProfileAge(event.target.value);
  };
  form.dataset.petId = p.id;
  form.dataset.dirty = 'false';
  $('health-profile-feedback').textContent = '';
  $('health-profile-feedback').classList.remove('is-error');
}

function renderHealthPetProfile(force = false) {
  const p = pet(), form = $('health-pet-form');
  if (!p) return;
  $('health-profile-avatar').innerHTML = petAvatar(p);
  $('health-profile-name').textContent = p.name;
  $('health-profile-meta').textContent = [p.species, p.breed, p.shareCode && ('Код: ' + p.shareCode)].filter(Boolean).join(' · ');
  if (force || form.dataset.petId !== p.id || form.dataset.dirty !== 'true') fillHealthPetForm(p);
}

const healthPetForm = $('health-pet-form');
healthPetForm.addEventListener('input', () => { healthPetForm.dataset.dirty = 'true'; });
healthPetForm.addEventListener('change', () => { healthPetForm.dataset.dirty = 'true'; });
$('health-profile-reset').onclick = () => { if (healthPetForm.dataset.dirty !== 'true' || confirm('Отменить изменения карточки питомца?')) renderHealthPetProfile(true); };

healthPetForm.onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const raw = Object.fromEntries(new FormData(form));
  const values = Object.fromEntries(['name', 'species', 'breed', 'birthDate', 'sex', 'sterilized', 'notes', 'marks', 'chip'].map(key => [key, String(raw[key] || '').trim()]));
  const feedback = $('health-profile-feedback');
  const fail = message => { feedback.textContent = message; feedback.classList.add('is-error'); feedback.focus(); };
  if (!values.name || !values.species) { fail('Укажите имя и вид питомца.'); return; }
  if (values.birthDate && values.birthDate > petProfileLocalDate()) { fail('Дата рождения не может быть в будущем.'); return; }
  const target = state.pets.find(p => p.id === form.dataset.petId) || pet();
  if (!target) return;

  const updated = {...target, ...values};
  if (target.serverId) {
    try {
      await apiFetch('/pets/' + target.serverId, {
        method: 'PUT',
        body: JSON.stringify({
          name: updated.name,
          species: updated.species,
          breed: updated.breed || 'Метис',
          birth_date: updated.birthDate || today(),
          sex: updated.sex,
          sterilized: updated.sterilized === 'Да',
          microchip_number: updated.chip || null,
          notes: updated.notes || null,
          marks: updated.marks || null
        })
      });
    } catch (err) {
      fail('Ошибка сохранения на сервере: ' + err.message);
      return;
    }
  }
  Object.assign(target, values);
  logActivity(target.id, 'Обновил(а) карточку питомца ' + updated.name, '🐾');
  form.dataset.dirty = 'false';
  render();
  feedback.classList.remove('is-error');
  feedback.textContent = 'Карточка сохранена на сервере';
};

// NUTRITION SECTION
function mealLocalDay(now = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
function mealIsComplete(meal, now = new Date()) {
  return meal.completedOn === mealLocalDay(now);
}
function dailyMealsForPet(petId) {
  return (state.mealPlans || []).filter(meal => String(meal.petId) === String(petId)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}
function mealTimeLabel(meal) {
  return meal.endTime ? meal.time + '–' + meal.endTime : meal.time;
}

function renderNutrition() {
  const p = pet();
  publishNutrition(p ? state.nutrition.filter(n => isForPet(n, p)) : [], () => openModal('nutrition'));
  if (!p) return;
  $('nutrition-pet-name').textContent = p.name;
  renderFeeding();
}

function renderFeeding() {
  const p = pet(), now = new Date(), plans = dailyMealsForPet(p.id);
  $('feeding-day').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(now);
  $('feeding-reminders').innerHTML = plans.map(meal => {
    const done = mealIsComplete(meal, now), timing = mealTimeLabel(meal);
    return '<label class="meal-reminder' + (done ? ' is-complete' : '') + '"><input type="checkbox" data-meal-check="' + esc(meal.id) + '"' + (done ? ' checked' : '') + ' aria-label="' + esc('Покормить: ' + meal.food + ', ' + timing) + '"><span class="meal-reminder-copy"><span class="meal-reminder-heading"><strong>' + esc(meal.food) + '</strong><span class="meal-time">' + esc(timing) + '</span></span>' + (meal.notes ? '<span class="meal-note">' + esc(meal.notes) + '</span>' : '') + '<span class="meal-status">' + (done ? 'Выполнено сегодня' : 'Ежедневно') + '</span></span></label>';
  }).join('') || '<p class="empty">Питание ещё не добавлено. Нажмите «+ Добавить питание», чтобы составить ежедневное расписание.</p>';

  $('feeding-reminders').querySelectorAll('[data-meal-check]').forEach(input => input.onchange = async () => {
    const meal = dailyMealsForPet(p.id).find(item => item.id === input.dataset.mealCheck);
    if (!meal) return;
    const stamp = new Date(), day = mealLocalDay(stamp);
    meal.completedOn = input.checked ? day : null;

    if (meal.serverId) {
      apiFetch('/meal-plans/' + meal.serverId + '/toggle?completed_on=' + encodeURIComponent(meal.completedOn || ''), {
        method: 'PATCH',
        body: JSON.stringify({ completed_on: meal.completedOn })
      });
    }

    state.feedingLogs = state.feedingLogs.filter(row => !(row.mealPlanId === meal.id && row.completionDay === day));
    if (input.checked) {
      let serverLogId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/feeding-logs', {
          method: 'POST',
          body: JSON.stringify({
            food: meal.food,
            amount: '',
            notes: meal.notes || '',
            meal_plan_id: meal.serverId || null,
            completion_day: day,
            actor: state.user.name || 'Владелец'
          })
        });
        if (res?.id) serverLogId = res.id;
      }
      state.feedingLogs.unshift({
        id: serverLogId ? 'sfl_' + serverLogId : uid(),
        serverId: serverLogId,
        petId: p.id,
        food: meal.food,
        amount: '',
        at: stamp.toISOString(),
        actor: state.user.name || 'Владелец',
        notes: meal.notes,
        mealPlanId: meal.id,
        completionDay: day
      });
    }
    const label = input.closest('.meal-reminder');
    label.classList.toggle('is-complete', input.checked);
    label.querySelector('.meal-status').textContent = input.checked ? 'Выполнено сегодня' : 'Ежедневно';
    renderMealHistory();
  });
  renderMealHistory();
}

function renderMealHistory() {
  const p = pet();
  const entries = state.feedingLogs.filter(row => isForPet(row, p)).sort((a, b) => mskMoment(b.at) - mskMoment(a.at));
  const localLabel = at => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(mskMoment(at));
  $('feeding-history').innerHTML = entries.slice(0, 20).map(row => '<div class="record"><div class="record-title"><b>' + esc(row.food) + '</b><span class="type">' + (row.mealPlanId || row.reminderId ? 'По расписанию' : 'Запись') + '</span></div><time>' + esc(localLabel(row.at)) + ' · ' + esc(row.actor || 'Владелец') + '</time>' + (row.amount ? '<p>Порция: ' + esc(row.amount) + '</p>' : '') + (row.notes ? '<p>' + esc(row.notes) + '</p>' : '') + '</div>').join('') || '<p class="empty">Отметьте кормление галочкой — оно появится в истории.</p>';
}

// CARE & EVENTS SECTION
function nextReminder(e) {
  const day = e.at.slice(0, 10), clock = e.at.slice(11, 16) || '12:00';
  if (e.intervalDays) return mskShift(day, Number(e.intervalDays)) + 'T' + clock + '+03:00';
  if (e.intervalMonths) {
    const [y, m, d] = day.split('-').map(Number), total = y * 12 + m - 1 + Number(e.intervalMonths), ny = Math.floor(total / 12), nm = total % 12 + 1, days = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return ny + '-' + String(nm).padStart(2, '0') + '-' + String(Math.min(d, days)).padStart(2, '0') + 'T' + clock + '+03:00';
  }
  return null;
}

async function eventAction(id, action) {
  const e = state.events.find(x => x.id === id);
  if (!e || e.status !== 'pending') return;
  if (action === 'move') { openModal('move', id); return; }

  const previous = e.status;
  let actionResult=null;
  e.status = action === 'complete' ? 'completed' : 'skipped';
  e.doneBy = state.user.name || 'Владелец';
  e.completedAt = new Date().toISOString();

  if (e.serverId) {
    actionResult=await apiFetch('/reminders/' + e.serverId + '/action', {
      method: 'PATCH',
      body: JSON.stringify({ status: e.status, done_by: e.doneBy })
    });
  }


  logActivity(e.petId, (action === 'complete' ? 'Выполнил(а): ' : 'Пропустил(а): ') + e.title, action === 'complete' ? '✓' : '↷');
  lastChange = { kind: 'event', token:actionResult?.undo_token, id, previous, at: Date.now() };
  await syncServerData(true);
  render();
  if (typeof scheduleNextExactPush === 'function') scheduleNextExactPush();
  notify(action === 'complete' ? 'Выполнено' : 'Пропущено');
}

function renderCare() {
  const p = pet();
  if (!p) return;
  const categories = [['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['week', 'На неделе'], ['overdue', 'Просрочено'], ['all', 'Все']];
  $('care-filters').innerHTML = categories.map(([key, label]) => '<button class="chip ' + (careFilter === key ? 'active' : '') + '" data-care-filter="' + key + '" type="button">' + label + '</button>').join('');
  document.querySelectorAll('[data-care-filter]').forEach(b => b.onclick = () => { careFilter = b.dataset.careFilter; renderCare(); });

  const active = state.events.filter(e => isForPet(e, p) && e.status === 'pending' && (careFilter === 'all' || reminderStatus(e) === careFilter || (careFilter === 'week' && ['today', 'tomorrow', 'week'].includes(reminderStatus(e))))).sort((a, b) => mskMoment(a.at) - mskMoment(b.at));
  $('care-events').innerHTML = active.map(e => '<div class="event-row ' + (reminderStatus(e) === 'overdue' ? 'overdue' : '') + '"><div><b>' + esc(e.title) + '</b><div class="small">' + esc(mskLabel(e.at)) + ' МСК · ' + esc(e.type || 'Процедура') + (e.intervalDays ? ' · каждые ' + esc(e.intervalDays) + ' дн.' : '') + (e.intervalMonths ? ' · каждые ' + esc(e.intervalMonths) + ' мес.' : '') + '</div></div><div class="event-actions"><button class="btn tiny" type="button" data-care-event="' + esc(e.id) + '" data-do="complete" aria-label="Готово — отметить выполненным: ' + esc(e.title) + '">Готово</button><details class="event-more"><summary aria-label="Ещё: ' + esc(e.title) + '">Ещё</summary><div class="event-more-actions"><button class="btn tiny" type="button" data-care-event="' + esc(e.id) + '" data-do="skip" aria-label="Пропустить: ' + esc(e.title) + '">Пропустить</button><button class="btn tiny" type="button" data-care-event="' + esc(e.id) + '" data-do="move" aria-label="Перенести: ' + esc(e.title) + '">Перенести</button></div></details></div></div>').join('') || '<p class="empty">Событий за выбранный период нет.</p>';
  document.querySelectorAll('[data-care-event]').forEach(b => b.onclick = () => eventAction(b.dataset.careEvent, b.dataset.do));

  const history = state.events.filter(e => isForPet(e, p) && e.status !== 'pending').sort((a, b) => mskMoment(b.completedAt || b.at) - mskMoment(a.completedAt || a.at)), expanded = expandedHistoryPet === p.id;
  $('care-history').innerHTML = (expanded ? history : history.slice(0, 5)).map(e => '<div class="record"><div class="record-title"><b>' + esc(e.title) + '</b><span class="care-tag ' + (e.status === 'completed' ? 'done-tag' : 'overdue-tag') + '">' + (e.status === 'completed' ? 'Выполнено' : 'Пропущено') + '</span></div><p>' + esc(mskLabel(e.at)) + ' МСК · ' + esc(e.doneBy || state.user.name || 'Владелец') + '</p><button class="btn tiny" type="button" data-undo-event="' + esc(e.id) + '">Отменить отметку</button></div>').join('') || '<p class="empty">Истории пока нет.</p>';

  const more = $('care-history-more');
  more.hidden = history.length <= 5;
  more.textContent = expanded ? 'Свернуть' : 'Показать все (' + history.length + ')';
  more.onclick = () => { expandedHistoryPet = expanded ? null : p.id; renderCare(); };

  document.querySelectorAll('[data-undo-event]').forEach(b => b.onclick = () => {
    const e = state.events.find(x => x.id === b.dataset.undoEvent);
    if (e) {
      e.status = 'pending';
      delete e.completedAt;
      delete e.doneBy;
      if (e.serverId) {
        apiFetch('/reminders/' + e.serverId + '/action', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'pending' })
        }).catch(() => {});
      }
      logActivity(e.petId, 'Отменил(а) отметку: ' + e.title, '↶');
      render();
    }
  });

  renderShoppingList();
  renderClinicContact();
}

function shoppingItemText(item) {
  return [String(item.title || '').trim(), String(item.quantity || '').trim()].filter(Boolean).join(', ');
}
function clinicHttpLink(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const link = new URL(raw.startsWith('http') ? raw : ('https://' + raw));
    return ['https:', 'http:'].includes(link.protocol) ? link.href : '';
  } catch { return ''; }
}

function renderShoppingList() {
  const p = pet();
  const items = state.shopping.filter(item => isForPet(item, p));
  $('shopping-list').innerHTML = items.map(item => '<div class="shopping-item' + (item.done ? ' is-bought' : '') + '"><span class="shopping-item-name">' + esc(shoppingItemText(item)) + (item.done && item.by ? ' <small style="color:var(--muted);font-weight:400">(' + esc(item.by) + ')</small>' : '') + '</span><button class="btn tiny shopping-bought" type="button" aria-label="Куплено: ' + esc(shoppingItemText(item)) + '" data-shopping="' + esc(item.id) + '" aria-pressed="' + Boolean(item.done) + '">' + (item.done ? '<span aria-hidden="true">✓</span> ' : '') + 'Куплено</button></div>').join('') || '<p class="empty">Список покупок пуст.</p>';

  $('shopping-list').querySelectorAll('[data-shopping]').forEach(button => button.onclick = () => {
    const item = state.shopping.find(row => row.id === button.dataset.shopping);
    if (!item) return;
    item.done = !item.done;
    item.by = item.done ? (state.user.name || 'Владелец') : null;
    if (item.serverId) {
      apiFetch('/shopping/' + item.serverId + '/toggle', { method: 'PATCH' }).catch(() => {});
    }
    if (item.done) logActivity(item.petId, 'Купил(а): ' + shoppingItemText(item), '🛍', item.by);
    render();
  });
}

function renderClinicContact() {
  const contact = state.contacts[pet().id] || {}, link = clinicHttpLink(contact.clinicUrl);
  $('vet-contact').innerHTML = '<dl class="clinic-contact"><div><dt>Клиника</dt><dd>' + (link ? '<a class="doc-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' + esc(contact.clinicUrl) + '</a>' : (contact.clinicUrl ? esc(contact.clinicUrl) : '<span class="small">Пока не добавлена</span>')) + '</dd></div><div><dt>Лечащий врач</dt><dd>' + (contact.doctor ? esc(contact.doctor) : '<span class="small">Пока не указан</span>') + '</dd></div></dl>';
}

// DOCUMENTS SECTION
$('document-search').oninput = () => renderDocuments();
function renderDocuments() {
  const p = pet();
  if (!p) return;
  $('docs-pet-name').textContent = p.name;
  const categories = [['all', 'Все'], ['passport', 'Паспорт'], ['conclusion', 'Заключения'], ['prescription', 'Назначения'], ['other', 'Другое']];
  $('document-filters').innerHTML = categories.map(([k, l]) => '<button class="chip ' + (documentFilter === k ? 'active' : '') + '" data-doc-filter="' + k + '" type="button">' + l + '</button>').join('');
  document.querySelectorAll('[data-doc-filter]').forEach(b => b.onclick = () => { documentFilter = b.dataset.docFilter; renderDocuments(); });

  const standalone = state.documents.filter(d => isForPet(d, p) && (documentFilter === 'all' || d.type === documentFilter));
  const fromHealth = state.health.filter(h => isForPet(h, p) && h.attachment && (documentFilter === 'all' || documentFilter === 'conclusion')).map(h => ({ id: h.id, title: h.title, type: 'conclusion', date: h.date, file: h.attachment, linked: true }));

  const search = $('document-search').value.trim().toLocaleLowerCase('ru');
  const matches = d => [d.title, d.file?.name, d.date, date(d.date), ({passport:'Паспорт',conclusion:'Заключение',prescription:'Назначение',other:'Другое'})[d.type]].join(' ').toLocaleLowerCase('ru').includes(search);
  $('document-list').innerHTML = [...standalone, ...fromHealth].filter(matches).sort((a, b) => b.date.localeCompare(a.date)).map(d => '<div class="record"><div class="record-title"><b>' + esc(d.title || d.file?.name) + '</b><span class="type">' + esc(({ passport: 'Паспорт', conclusion: 'Заключение', prescription: 'Назначение', other: 'Другое' })[d.type] || 'Документ') + '</span></div><time>' + esc(date(d.date)) + '</time>' + (d.file?.data && d.file.data !== '#' ? '<a class="doc-link" href="' + esc(d.file.data) + '" download="' + esc(d.file.name || 'document') + '">Открыть · ' + esc(d.file.name || 'файл') + '</a>' : '<span class="small" style="display:block;margin:6px 0">' + esc(d.file?.name || '') + '</span>') + (d.linked ? '<button class="btn tiny" type="button" data-linked-health="' + esc(d.id) + '">Открыть медицинскую запись</button>' : '<details class="record-actions"><summary aria-label="Ещё: ' + esc(d.title || d.file?.name || 'Документ') + '">Ещё</summary><button class="btn tiny danger" type="button" data-remove-doc="' + esc(d.id) + '">Удалить</button></details>') + '</div>').join('') || '<p class="empty">Документов не найдено. Измените поиск или категорию, либо добавьте документ.</p>';

  document.querySelectorAll('[data-linked-health]').forEach(b => b.onclick = () => { healthFilter = 'all'; show('health'); const record = [...$('health-records').children].find(el => el.dataset.healthRecord === b.dataset.linkedHealth); if (record) { record.tabIndex = -1; record.scrollIntoView({block:'center'}); record.focus(); } });
  document.querySelectorAll('[data-remove-doc]').forEach(b => b.onclick = async () => {
    const removed=state.documents.find(x=>x.id===b.dataset.removeDoc); if(!removed?.serverId)return;
    try {const result=await apiFetch('/documents/'+removed.serverId,{method:'DELETE'});lastChange={kind:'document',token:result.undo_token,at:Date.now()};await syncServerData(true);render();notify('Документ удалён. Можно отменить в профиле в течение 5 минут.');}catch(err){notify(err.message);}
  });
}

// =====================================================================
// 6B. PET MATCH (ПОИСК ДРУЗЕЙ — СООБЩЕСТВО ПИТОМЦЕВ)
// =====================================================================
let matchTab = 'discover';
let matchInspectProfileId = null;
const matchDataByPet = {};
const matchPromptedForPet = {};

window.copyOwnerContact = function(contact) {
  if (!contact) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(contact).then(() => {
      showCopiedToast('Скопировано');
    }).catch(() => showCopiedToast('Скопировано'));
  } else {
    showCopiedToast('Скопировано');
  }
};

async function loadMatchDataForActivePet(silent = false) {
  if (!FRIENDS_ENABLED) return;
  const p = pet();
  if (!p || !p.serverId) return;
  try {
    const data = await apiFetch('/pets/' + p.serverId + '/match-data');
    if (data) {
      matchDataByPet[p.id] = {
        loaded: true,
        myProfile: data.my_profile || null,
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        incomingLikes: Array.isArray(data.incoming_likes) ? data.incoming_likes : [],
        myLikes: Array.isArray(data.my_likes) ? data.my_likes : [],
        swipedCount: Number(data.swiped_count) || 0
      };
      // При первом заходе от питомца без анкеты сразу открываем заполнение анкеты
      if (!data.my_profile && !matchPromptedForPet[p.id]) {
        matchTab = 'profile';
        matchPromptedForPet[p.id] = true;
      } else if (data.my_profile && !matchPromptedForPet[p.id]) {
        matchTab = 'discover';
        matchPromptedForPet[p.id] = true;
      }
      populateMatchFormFromPet(false);
      if (!silent) renderMatch();
      else updateMatchNavBadge();
    }
  } catch (err) {
    console.warn('loadMatchDataForActivePet notice:', err.message);
  }
}

function getActiveMatchData() {
  const p = pet();
  if (!p) return { loaded: false, myProfile: null, recommendations: [], incomingLikes: [], myLikes: [], swipedCount: 0 };
  if (!matchDataByPet[p.id]) {
    matchDataByPet[p.id] = { loaded: false, myProfile: null, recommendations: [], incomingLikes: [], myLikes: [], swipedCount: 0 };
    loadMatchDataForActivePet(false);
  }
  return matchDataByPet[p.id];
}

function updateMatchNavBadge() {
  const p = pet();
  const badge = $('match-nav-badge');
  if (!badge || !p) {
    if (badge) badge.hidden = true;
    return;
  }
  const m = matchDataByPet[p.id];
  const pendingIncoming = m ? m.incomingLikes.filter(x => !x.is_mutual).length : 0;
  badge.textContent = String(pendingIncoming);
  badge.hidden = pendingIncoming === 0;
}

function setMatchTab(tabName) {
  matchTab = tabName;
  if (tabName !== 'incoming') matchInspectProfileId = null;
  renderMatch();
}

function populateMatchFormFromPet(forceFromPetCard = false) {
  const p = pet();
  const form = $('match-profile-form');
  if (!p || !form) return;
  const m = matchDataByPet[p.id] || {};
  const existing = !forceFromPetCard ? m.myProfile : null;
  const hasVacc = state.health.some(h => isForPet(h, p) && h.type === 'vaccination');

  form.elements.namedItem('name').value = existing?.name || p.name || '';
  form.elements.namedItem('species').value = existing?.species || p.species || '';
  form.elements.namedItem('breed').value = existing?.breed || p.breed || '';
  form.elements.namedItem('birth_date').value = existing?.birth_date || p.birthDate || '';
  form.elements.namedItem('sex').value = existing?.sex || p.sex || 'Неизвестно';
  form.elements.namedItem('vaccinated').value = existing?.vaccinated || (hasVacc ? 'Да, все по возрасту' : 'Не указано');
  form.elements.namedItem('sterilized').value = existing?.sterilized || (p.sterilized === 'Да' ? 'Да' : 'Нет');
  form.elements.namedItem('purpose').value = existing?.purpose || 'Совместные прогулки и игры';
  form.elements.namedItem('city').value = existing?.city || '';
  form.elements.namedItem('owner_name').value = existing?.owner_name || state.user.name || '';
  form.elements.namedItem('owner_contact').value = existing?.owner_contact || '';
  form.elements.namedItem('bio').value = existing?.bio || p.notes || '';
  form.dataset.petId = String(p.id);
}

function renderTinderCardHTML(candidate, mode = 'discover') {
  const hasPhoto = Boolean(candidate.photo);
  const artHtml = hasPhoto
    ? '<img src="' + esc(candidate.photo) + '" alt="' + esc(candidate.name) + '">'
    : petArt({ species: candidate.species }, 'happy');
  const ageText = petProfileAge(candidate.birth_date);
  const reasons = Array.isArray(candidate.match_reasons) && candidate.match_reasons.length
    ? candidate.match_reasons
    : ['Подходящий вид (' + (candidate.species || 'Питомец') + ')', 'Порода: ' + (candidate.breed || 'Метис')];

  return '<article class="match-tinder-card" data-candidate-id="' + esc(candidate.id) + '">' +
    '<div class="match-tinder-visual ' + (hasPhoto ? 'has-photo' : '') + '">' +
      '<span class="match-score-pill">' + esc(candidate.match_score || 92) + '% совпадение</span>' +
      (candidate.liked_me || mode === 'incoming'
        ? '<span class="match-liked-you-pill">' + (candidate.is_mutual ? '♥ Взаимный лайк!' : '♥ Лайкнул(а) вашего питомца!') + '</span>'
        : '') +
      '<div class="match-tinder-art">' + artHtml + '</div>' +
    '</div>' +
    '<div class="match-tinder-body">' +
      '<div class="match-tinder-head">' +
        '<div>' +
          '<h2>' + esc(candidate.name) + ', ' + esc(ageText) + '</h2>' +
          '<p class="small" style="margin:4px 0 0;font-size:14px">' + esc(candidate.species) + ' · <b>' + esc(candidate.breed || 'Метис') + '</b></p>' +
        '</div>' +
        (candidate.city ? '<span class="match-tinder-city">📍 ' + esc(candidate.city) + '</span>' : '') +
      '</div>' +
      '<div class="match-reason-chips">' +
        reasons.map(r => '<span class="match-reason-chip">✓ ' + esc(r) + '</span>').join('') +
      '</div>' +
      '<dl class="match-facts-grid">' +
        '<div class="match-fact-item"><dt>Прививки</dt><dd>' + esc(candidate.vaccinated || 'Не указано') + '</dd></div>' +
        '<div class="match-fact-item"><dt>Пол и стерилизация</dt><dd>' + esc(candidate.sex || 'Неизвестно') + ' · Стерилизация: ' + esc(candidate.sterilized || 'Нет') + '</dd></div>' +
        '<div class="match-fact-item"><dt>Цель поиска</dt><dd>' + esc(candidate.purpose || 'Совместные прогулки и игры') + '</dd></div>' +
        '<div class="match-fact-item"><dt>Хозяин</dt><dd>' + esc(candidate.owner_name || 'Владелец') + '</dd></div>' +
      '</dl>' +
      (candidate.bio ? '<p class="match-tinder-bio">' + esc(candidate.bio) + '</p>' : '') +
      '<div class="match-contact-box">' +
        '<div>' +
          '<strong>Контакты хозяина (' + esc(candidate.owner_name || 'Владелец') + '):</strong>' +
          '<span>' + esc(candidate.owner_contact || 'Не указаны') + '</span>' +
        '</div>' +
        '<button type="button" class="btn tiny primary" data-copy-contact="' + esc(candidate.owner_contact) + '">Скопировать</button>' +
      '</div>' +
      '<div class="match-swipe-actions">' +
        '<button type="button" class="btn-swipe-skip" data-swipe-action="skip" data-profile-id="' + esc(candidate.id) + '">✕ Пропустить</button>' +
        '<button type="button" class="btn-swipe-like" data-swipe-action="like" data-profile-id="' + esc(candidate.id) + '">' + (candidate.liked_me || mode === 'incoming' ? '♥ Ответить взаимностью' : '♥ Нравится') + '</button>' +
      '</div>' +
    '</div>' +
  '</article>';
}

async function handleMatchDecision(profileId, decision) {
  const p = pet();
  if (!p || !p.serverId) return;
  try {
    await apiFetch('/pets/' + p.serverId + '/match-decision', {
      method: 'POST',
      body: JSON.stringify({ target_profile_id: Number(profileId), decision })
    });
    if (matchInspectProfileId && Number(matchInspectProfileId) === Number(profileId) && decision === 'skip') {
      matchInspectProfileId = null;
    }
    await loadMatchDataForActivePet(false);
  } catch (err) {
    console.warn('handleMatchDecision error:', err.message);
  }
}

function wireMatchCardEvents(container) {
  if (!container) return;
  container.querySelectorAll('[data-swipe-action]').forEach(btn => {
    btn.onclick = () => handleMatchDecision(btn.dataset.profileId, btn.dataset.swipeAction);
  });
  container.querySelectorAll('[data-copy-contact]').forEach(btn => {
    btn.onclick = () => window.copyOwnerContact(btn.dataset.copyContact);
  });
}

function renderMatch() {
  if (!FRIENDS_ENABLED) return;
  const p = pet();
  if (!p || !$('match')) return;
  const m = getActiveMatchData();
  updateMatchNavBadge();

  $('match-pet-subtitle').textContent = 'Активный питомец: ' + p.name + ' (' + p.species + ' · ' + (p.breed || 'Метис') + ')';
  $('match-form-heading').textContent = 'Анкета питомца: ' + p.name;

  const hasVacc = state.health.some(h => isForPet(h, p) && h.type === 'vaccination');
  const myProf = m.myProfile;
  $('match-context-bar').innerHTML =
    '<div class="match-context-pet">' +
      '<span class="match-context-avatar">' + petAvatar(p) + '</span>' +
      '<div class="match-context-info">' +
        '<strong>Питомец: ' + esc(p.name) + '</strong>' +
        '<small>' + esc(p.species) + ' · Порода: ' + esc(myProf?.breed || p.breed || 'Метис') + ' · Возраст: ' + esc(petProfileAge(myProf?.birth_date || p.birthDate)) + ' · Прививки: ' + esc(myProf?.vaccinated || (hasVacc ? 'Да, все по возрасту' : 'Не указано')) + '</small>' +
      '</div>' +
    '</div>' +
    '<div class="row">' +
      '<span class="care-tag ' + (myProf ? 'done-tag' : 'overdue-tag') + '">' + (myProf ? 'Анкета опубликована ✓' : 'Анкета ещё не заполнена') + '</span>' +
      '<button type="button" class="btn tiny" id="btn-context-edit-profile">' + (myProf ? 'Редактировать анкету' : 'Заполнить анкету') + '</button>' +
    '</div>';

  if ($('btn-context-edit-profile')) {
    $('btn-context-edit-profile').onclick = () => setMatchTab('profile');
  }
  if ($('btn-open-my-match-form')) {
    $('btn-open-my-match-form').onclick = () => setMatchTab('profile');
  }

  const activeFeed = m.recommendations || [];

  // Update tab counts & active states
  $('match-discover-count').textContent = String(activeFeed.length);
  $('match-incoming-count').textContent = String((m.incomingLikes || []).length);
  $('match-liked-count').textContent = String((m.myLikes || []).length);

  document.querySelectorAll('[data-match-tab]').forEach(btn => {
    const active = btn.dataset.matchTab === matchTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.onclick = () => setMatchTab(btn.dataset.matchTab);
  });

  $('match-pane-discover').hidden = matchTab !== 'discover';
  $('match-pane-incoming').hidden = matchTab !== 'incoming';
  $('match-pane-liked').hidden = matchTab !== 'liked';
  $('match-pane-profile').hidden = matchTab !== 'profile';

  // 1. Render Discover (Tinder Deck with internal recommendation system)
  if (activeFeed.length > 0) {
    const topCandidate = activeFeed[0];
    $('match-deck-container').innerHTML = renderTinderCardHTML(topCandidate, 'discover');
    wireMatchCardEvents($('match-deck-container'));
  } else {
    $('match-deck-container').innerHTML =
      '<div class="panel glass" style="text-align:center;padding:36px 24px">' +
        '<h2>Все доступные анкеты просмотрены</h2>' +
        '<p class="small" style="max-width:460px;margin:8px auto 18px">Новые анкеты появятся, когда другие владельцы опубликуют подходящие профили. Проверьте видимость и настройки своей анкеты. Вы можете посмотреть пропущенные анкеты заново для питомца <b>' + esc(p.name) + '</b> или перейти в раздел «Вас лайкнули».</p>' +
        '<div class="row" style="justify-content:center">' +
          '<button type="button" class="btn primary" id="btn-reset-match-skips">Смотреть анкеты заново</button>' +
          '<button type="button" class="btn" id="btn-goto-incoming">Вас лайкнули (' + (m.incomingLikes || []).length + ')</button>' +
        '</div>' +
      '</div>';
    if ($('btn-reset-match-skips')) {
      $('btn-reset-match-skips').onclick = async () => {
        if (p.serverId) await apiFetch('/pets/' + p.serverId + '/match-reset', { method: 'POST' });
        await loadMatchDataForActivePet(false);
      };
    }
    if ($('btn-goto-incoming')) {
      $('btn-goto-incoming').onclick = () => setMatchTab('incoming');
    }
  }

  // 2. Render Incoming Likes («Вас лайкнули»)
  const incoming = m.incomingLikes || [];
  const inspectBox = $('match-incoming-inspect');
  const inspectedProfile = matchInspectProfileId ? incoming.find(x => Number(x.id) === Number(matchInspectProfileId)) : null;
  if (inspectedProfile) {
    inspectBox.hidden = false;
    inspectBox.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<strong>Анкета питомца, который лайкнул ' + esc(p.name) + ':</strong>' +
        '<button type="button" class="btn tiny" id="btn-close-inspect">Свернуть карточку</button>' +
      '</div>' +
      '<div class="match-deck-layout">' + renderTinderCardHTML(inspectedProfile, 'incoming') + '</div>';
    $('btn-close-inspect').onclick = () => { matchInspectProfileId = null; renderMatch(); };
    wireMatchCardEvents(inspectBox);
  } else {
    inspectBox.hidden = true;
    inspectBox.innerHTML = '';
  }

  $('match-incoming-list').innerHTML = incoming.length
    ? incoming.map(item => {
        const hasPhoto = Boolean(item.photo);
        const art = hasPhoto ? '<img src="' + esc(item.photo) + '" alt="">' : petArt({ species: item.species }, 'happy');
        return '<article class="match-mini-card">' +
          '<div class="match-mini-visual">' +
            '<span class="match-score-pill">' + esc(item.match_score || 94) + '% совпадение</span>' +
            '<span class="match-liked-you-pill">' + (item.is_mutual ? '♥ Взаимный лайк' : '♥ Лайкнул(а) вас') + '</span>' +
            art +
          '</div>' +
          '<div class="match-mini-body">' +
            '<div>' +
              '<h3>' + esc(item.name) + ', ' + esc(petProfileAge(item.birth_date)) + '</h3>' +
              '<p class="small" style="margin:2px 0 0">' + esc(item.species) + ' · <b>' + esc(item.breed || 'Метис') + '</b>' + (item.city ? ' · ' + esc(item.city) : '') + '</p>' +
            '</div>' +
            '<div class="small"><b>Прививки:</b> ' + esc(item.vaccinated || 'Не указано') + '<br><b>Цель:</b> ' + esc(item.purpose || 'Прогулки и игры') + '</div>' +
            (item.bio ? '<p class="small" style="margin:0;color:var(--ink)">' + esc(item.bio) + '</p>' : '') +
            '<div class="match-contact-box" style="margin-bottom:0;padding:12px 14px">' +
              '<div>' +
                '<strong>Контакты хозяина (' + esc(item.owner_name || 'Владелец') + '):</strong>' +
                '<span>' + esc(item.owner_contact || 'Не указаны') + '</span>' +
              '</div>' +
              '<button type="button" class="btn tiny primary" data-copy-contact="' + esc(item.owner_contact) + '">Скопировать</button>' +
            '</div>' +
            '<div class="match-mini-actions">' +
              '<button type="button" class="btn tiny" data-inspect-incoming="' + esc(item.id) + '">Открыть анкету</button>' +
              (!item.is_mutual ? '<button type="button" class="btn tiny primary" data-swipe-action="like" data-profile-id="' + esc(item.id) + '">♥ Ответить лайком</button>' : '') +
              '<button type="button" class="btn tiny danger" data-swipe-action="skip" data-profile-id="' + esc(item.id) + '">Скрыть</button>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('')
    : '<p class="empty">Пока никто не лайкнул анкету питомца ' + esc(p.name) + '.</p>';

  wireMatchCardEvents($('match-incoming-list'));
  $('match-incoming-list').querySelectorAll('[data-inspect-incoming]').forEach(btn => {
    btn.onclick = () => {
      matchInspectProfileId = Number(btn.dataset.inspectIncoming);
      renderMatch();
      $('match-incoming-inspect')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });

  // 3. Render My Likes & Contacts
  const liked = m.myLikes || [];
  $('match-liked-list').innerHTML = liked.length
    ? liked.map(item => {
        const hasPhoto = Boolean(item.photo);
        const art = hasPhoto ? '<img src="' + esc(item.photo) + '" alt="">' : petArt({ species: item.species }, 'happy');
        return '<article class="match-mini-card">' +
          '<div class="match-mini-visual">' +
            '<span class="match-score-pill">' + esc(item.match_score || 92) + '% совпадение</span>' +
            (item.is_mutual ? '<span class="match-liked-you-pill">♥ Взаимный лайк</span>' : '') +
            art +
          '</div>' +
          '<div class="match-mini-body">' +
            '<div>' +
              '<h3>' + esc(item.name) + ', ' + esc(petProfileAge(item.birth_date)) + '</h3>' +
              '<p class="small" style="margin:2px 0 0">' + esc(item.species) + ' · <b>' + esc(item.breed || 'Метис') + '</b>' + (item.city ? ' · ' + esc(item.city) : '') + '</p>' +
            '</div>' +
            '<div class="small"><b>Прививки:</b> ' + esc(item.vaccinated || 'Не указано') + ' · <b>Цель:</b> ' + esc(item.purpose || 'Прогулки и игры') + '</div>' +
            '<div class="match-contact-box" style="margin-bottom:0;padding:12px 14px">' +
              '<div>' +
                '<strong>Контакты хозяина (' + esc(item.owner_name || 'Владелец') + '):</strong>' +
                '<span>' + esc(item.owner_contact || 'Не указаны') + '</span>' +
              '</div>' +
              '<button type="button" class="btn tiny primary" data-copy-contact="' + esc(item.owner_contact) + '">Скопировать</button>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('')
    : '<p class="empty">Вы ещё не отметили ни одной анкеты для питомца ' + esc(p.name) + '.</p>';
  wireMatchCardEvents($('match-liked-list'));

  // 4. Populate Profile Form if pet changed
  const form = $('match-profile-form');
  if (form && form.dataset.petId !== String(p.id)) {
    populateMatchFormFromPet(false);
  }
}

if ($('match-profile-form')) {
  $('match-profile-form').onsubmit = async event => {
    event.preventDefault();
    const p = pet();
    if (!p || !p.serverId) return;
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const photoFile = $('match-photo-input')?.files?.[0];
    let photoData = null;
    if (photoFile) {
      photoData = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(photoFile);
      });
    }

    const submitBtn = $('btn-save-match-profile');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Сохраняем в базу…';
    try {
      await apiFetch('/pets/' + p.serverId + '/match-profile', {
        method: 'POST',
        body: JSON.stringify({
          name: String(raw.name || p.name).trim(),
          species: String(raw.species || p.species).trim(),
          breed: String(raw.breed || p.breed || 'Метис').trim(),
          birth_date: raw.birth_date || p.birthDate || '',
          sex: raw.sex || p.sex || 'Неизвестно',
          vaccinated: raw.vaccinated || 'Не указано',
          sterilized: raw.sterilized || 'Нет',
          purpose: raw.purpose || 'Совместные прогулки и игры',
          city: String(raw.city || '').trim(),
          owner_name: String(raw.owner_name || state.user.name || 'Владелец').trim(),
          owner_contact: String(raw.owner_contact || '').trim(),
          bio: String(raw.bio || '').trim(),
          ...(photoData ? { photo: photoData } : {}),
          is_published: true
        })
      });
      if (photoData) p.photo = photoData;
      logActivity(p.id, 'Опубликовал(а) анкету питомца ' + p.name, '🐾');
      await loadMatchDataForActivePet(false);
      setMatchTab('discover');
    } catch (err) {
      $('match-profile-feedback').textContent = err.message || 'Ошибка сохранения анкеты';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Выложить анкету в базу';
    }
  };
}

// PROFILE & JOINT CARE SECTION
function renderProfile() {
  const u = state.user, p = pet(), set = state.settings;
  $('person-profile').innerHTML = '<div class="profile-data"><strong>' + esc(u.name || 'Владелец') + '</strong><br>' + esc(u.email || 'Почта не указана') + '<br>Часовой пояс: ' + esc(u.timezone || 'Europe/Moscow') + '</div>';

  if (!p) {
    $('family-list').innerHTML = '<p class="empty">Сначала добавьте питомца или подключитесь по коду.</p>';
    $('avatar-preview').innerHTML = '<p class="empty">Сначала добавьте питомца.</p>';
  } else {
    const coOwners = Array.isArray(p.coOwners) ? p.coOwners : [];
    const localMembers = state.members.filter(m => isForPet(m, p));
    const shareCodeHtml = p.shareCode
      ? '<div class="record" style="padding-top:4px"><div class="small" style="margin-bottom:6px">Код совместного ухода за <b>' + esc(p.name) + '</b> (передайте члену семьи):</div><div class="join-input-group"><input type="text" aria-label="Код совместного ухода" readonly value="' + esc(p.shareCode) + '"><button type="button" class="btn tiny" data-copy-pet-code="' + esc(p.shareCode) + '">Скопировать код</button></div></div>'
      : '';
    const joinQuickHtml = '<div class="record"><div class="small" style="margin-bottom:6px">Подключиться к другому питомцу по коду:</div><div class="join-input-group"><input type="text" id="profile-join-code" placeholder="Например: PET-REXX-3F88-P9D1"><button type="button" class="btn tiny primary" id="profile-join-btn">Подключиться</button></div></div>';

    const membersHtml = [
      ...coOwners.map(c => '<div class="record"><div class="record-title"><b>' + esc(c.name) + '</b><span class="type">Со-владелец (Cloud)</span></div><p>' + esc(c.email || 'Подключён по коду совместного ухода') + '</p></div>'),
      ...localMembers.map(m => '<div class="record"><div class="record-title"><b>' + esc(m.name) + '</b><span class="type">' + esc(m.role) + '</span></div><p>' + esc(m.until ? 'Доступ до ' + date(m.until) : 'Без срока') + '</p><button class="btn tiny danger" type="button" data-member-remove="' + esc(m.id) + '">Убрать</button></div>')
    ].join('') || '<p class="small" style="margin-top:10px">Дополнительных участников пока нет.</p>';

    $('family-list').innerHTML = shareCodeHtml + joinQuickHtml + membersHtml;

    const joinBtn = $('profile-join-btn');
    if (joinBtn) {
      joinBtn.onclick = async () => {
        const code = $('profile-join-code')?.value.trim().toUpperCase();
        if (!code) { notify('Введите код совместного ухода'); return; }
        try {
          const res = await apiFetch('/pets/join-by-code', {
            method: 'POST',
            body: JSON.stringify({ invite_code: code })
          });
          if (res?.id) {
            await syncServerData(true);
            state.selected = String(res.id);
            render();
            notify('Питомец ' + (res.name || '') + ' подключён к вашему аккаунту!');
          }
        } catch (err) {
          notify(err.message || 'Ошибка подключения по коду');
        }
      };
    }

    document.querySelectorAll('[data-member-remove]').forEach(b => b.onclick = () => {
      state.members = state.members.filter(m => m.id !== b.dataset.memberRemove);
      render();
    });

    const bg = state.avatar[p.id]?.background || 'lavender', accessory = state.avatar[p.id]?.accessory || 'none', image = p.photo ? '<img src="' + esc(p.photo) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:20px">' : petArt(p, 'neutral');
    const birthday = p.birthDate?.slice(5) === mskDay().slice(5);
    $('avatar-preview').innerHTML = '<div class="row"><div class="avatar" style="background:' + ({ lavender: '#dcd8fb', peach: '#f6dfdc', mint: '#d5eee6' })[bg] + ';width:88px;height:88px;position:relative">' + image + (accessory === 'bow' ? '<span style="position:absolute;top:0;right:4px">🎀</span>' : accessory === 'crown' ? '<span style="position:absolute;top:0;right:4px">👑</span>' : '') + '</div><div><b>' + esc(p.name) + '</b><p class="small">' + (birthday ? 'С днём рождения!' : 'Фон и аксессуар синхронизированы') + '</p></div></div>';
  }

  const pushActive = Boolean(set.pushEnabled);
  $('notification-settings').innerHTML =
    '<div class="profile-data">' +
      'Статус: <strong style="color:' + (pushActive ? 'var(--accent-dark)' : 'var(--muted)') + '">' + (pushActive ? 'Включены 🔔' : 'Выключены') + '</strong><br>' +
      'Часовой пояс: <strong>Europe/Moscow</strong><br>' +
      'Тихие часы: ' + (set.quietEnabled ? esc(set.quietStart) + '–' + esc(set.quietEnd) : 'выключены') + '<br>' +
      'Типы: ' + esc(set.types.join(', ') || 'не выбраны') +
    '</div>';

  updatePushStatusUI();

  $('undo-area').innerHTML = lastChange && Date.now() - lastChange.at < 300000 ? '<div class="panel glass"><h2>Последнее действие</h2><button class="btn tiny" id="undo-last" type="button">Отменить ' + (lastChange.kind === 'document' ? 'удаление документа' : 'отметку события') + '</button></div>' : '';
  if ($('undo-last')) $('undo-last').onclick = async () => {
    try {
    const c = lastChange;
    if (!c) return;
    if (c.kind === 'document') await apiFetch('/actions/'+c.token+'/undo',{method:'POST'});
    if (c.kind === 'event') {
      const e = state.events.find(x => x.id === c.id);
      if(c.token) await apiFetch('/actions/'+c.token+'/undo',{method:'POST'});
    }
    lastChange = null;
    render();
    await syncServerData(true);
    notify('Действие отменено');
    } catch(err){notify(err.message);}
  };
}

// =====================================================================
// 7. MODALS (PET DETAILS, CREATE PET + JOIN BY CODE, HEALTH, CARE, ETC.)
// =====================================================================
function renderDetails() {
  const p = pet();
  const facts = [
    ['Вид', p.species],
    ['Порода', p.breed],
    ['Дата рождения', p.birthDate ? date(p.birthDate) : ''],
    ['Возраст', petProfileAge(p.birthDate)],
    ['Пол', p.sex],
    ['Стерилизация', p.sterilized],
    ['Особенности', p.notes],
    ['Важные отметки', p.marks],
    ['Номер чипа', p.chip]
  ];
  const shareHtml = p.shareCode
    ? '<div class="profile-fact-wide"><dt>Код совместного ухода</dt><dd><button type="button" class="pet-card-code" data-copy-pet-code="' + esc(p.shareCode) + '"><code>' + esc(p.shareCode) + '</code><span class="copy-label">скопировать код</span></button></dd></div>'
    : '';
  $('editor-fields').innerHTML =
    '<div class="pet-card-heading full"><span class="avatar" aria-hidden="true">' + petAvatar(p) + '</span><div><h3>' + esc(p.name) + '</h3><p>' + esc(p.species) + ' · ' + esc(petProfileAge(p.birthDate)) + (p.isShared ? ' · Совместный уход' : '') + '</p></div></div>' +
    '<dl class="pet-profile-facts">' +
      facts.map(([label, value]) => '<div' + (['Особенности', 'Важные отметки', 'Номер чипа'].includes(label) ? ' class="profile-fact-wide"' : '') + '><dt>' + esc(label) + '</dt><dd>' + esc(value || 'Не указано') + '</dd></div>').join('') +
      shareHtml +
    '</dl>' +
    '<div class="row"><button class="btn" type="button" id="edit-pet">Изменить карточку</button></div>' +
    '<div class="pet-card-shortcuts field full"><p class="small">Перейти к записям питомца</p><div class="row">' +
      [['health', 'Здоровье'], ['nutrition', 'Питание'], ['care', 'Уход и события'], ['documents', 'Документы'], ['match', 'Поиск друзей']].filter(([key]) => key !== 'match' || FRIENDS_ENABLED).map(([key, label]) => '<button type="button" class="btn" data-card-page="' + key + '">' + label + '</button>').join('') +
    '</div></div>';

  $('edit-pet').onclick = () => { $('editor').close(); openModal('pet-edit'); };
  $('editor-fields').querySelectorAll('[data-card-page]').forEach(button => button.onclick = () => {
    $('editor').close();
    show(button.dataset.cardPage);
  });
}

function decorateEditor(type) {
  if (type === 'nutrition' || type === 'pet-details') return;
  const root = $('editor-fields');
  const groups = {
    pet: [['О питомце',['name','species','breed','birthDate','sex','sterilized']],['Особенности и фото',['marks','notes','chip','photo']]],
    'pet-edit': [['О питомце',['name','species','breed','birthDate','sex','sterilized']],['Особенности и фото',['marks','notes','chip','photo']]],
    health: [['Запись',['petId','type','title','date']],['Подробности приёма',['product','clinic','doctor','result','notes','attachment']],['Следующая процедура',['nextDate','repeatDays','nextTime']]],
    prescription: [['Назначение врача',['name','dose']],['Курс и приём',['startDate','duration','times','status']]],
    reminder: [['Событие',['petId','title','type']],['Когда напомнить',['at','frequency','interval']]],
    'meal-plan': [['Рацион',['food']],['Расписание',['time','endTime','notes']]],
    document: [['О документе',['title','type','date']],['Файл',['file']]],
    'feeding-log': [['Кормление',['food','amount','at']],['Заметка',['notes']]],
    profile: [['Личные данные',['name','email']],['Время',['timezone']]],
    member: [['Совместный уход',['email','role','until']]],
    avatar: [['Оформление',['background','accessory','photo']]],
    settings: [['Тихие часы',['quietEnabled','quietStart','quietEnd']]],
    shopping: [['Покупка',['title','quantity']]],
    weight: [['Измерение',['date','kg']]],
    move: [['Новое время',['at']]],
    activity: [['Действие',['action','actor','at']]],
    'vet-contact': [['Контакты клиники',['clinicUrl','doctor']]]
  }[type] || [];
  for (const [index, [title, names]] of groups.entries()) {
    const fields = names.map(name => root.querySelector('[name="' + name + '"]')?.closest('.field')).filter(Boolean);
    if (!fields.length) continue;
    const section = document.createElement('section'); section.className = 'editor-section full';
    const heading = document.createElement('h3'); heading.textContent = title;
    heading.id = 'editor-section-' + index; section.setAttribute('aria-labelledby', heading.id);
    const grid = document.createElement('div'); grid.className = 'form-grid';
    // Insert at the first original field to preserve DOM and keyboard order.
    fields[0].before(section); section.append(heading, grid); fields.forEach(field => grid.append(field));
  }
}

function openModal(type, id) {
  $('editor').dataset.mode = type;
  $('editor-form').querySelector('[type=submit]').textContent = type === 'nutrition' ? 'Сохранить корм' : 'Сохранить';
  editorDirty = false;
  clearEditorError();
  closePetAccounts();
  modalType = type;
  const p = pet();
  $('editor').dataset.petId = p?.id || '';
  $('editor').dataset.id = id || '';
  let title = '', html = '';

  if (type === 'pet-details') {
    title = 'Карточка питомца';
    renderDetails();
  } else if (type === 'pet' || type === 'pet-edit') {
    title = type === 'pet' ? 'Новый питомец' : 'Карточка питомца';
    const joinBottomBlock = type === 'pet'
      ? '<div class="join-divider">или подключитесь к существующему питомцу</div>' +
        '<div class="join-pet-bottom-card" id="join-pet-bottom-card">' +
          '<strong>Совместный уход по коду</strong>' +
          '<p>Если другой член семьи уже создал карточку питомца, введите его код доступа (например, PET-REXX-3F88-P9D1):</p>' +
          '<div class="join-input-group">' +
            '<input type="text" id="pet-invite-code" name="inviteCode" placeholder="PET-XXXX-XXXX-XXXX-XXXX" autocomplete="off">' +
            '<button type="button" class="btn primary" id="btn-do-join">Подключиться</button>' +
          '</div>' +
        '</div>'
      : '';
    html = field('name', 'Имя', 'text', { required: true, placeholder: 'Например: Барсик' }) +
      field('species', 'Вид', 'text', { required: true, placeholder: 'Кошка, собака…' }) +
      field('breed', 'Порода', 'text', { placeholder: 'Порода или метис' }) +
      field('birthDate', 'Дата рождения', 'date') +
      field('sex', 'Пол', 'select', { options: [['Неизвестно', 'Неизвестно'], ['Самец', 'Самец'], ['Самка', 'Самка']] }) +
      field('sterilized', 'Стерилизация', 'select', { options: [['Неизвестно', 'Неизвестно'], ['Да', 'Да'], ['Нет', 'Нет']] }) +
      field('marks', 'Важные отметки', 'textarea', { full: true, placeholder: 'Аллергии, хронические состояния' }) +
      field('notes', 'Особенности', 'textarea', { full: true }) +
      field('chip', 'Номер чипа') +
      field('photo', 'Фото питомца до 1 МБ', 'file', { full: true }) +
      joinBottomBlock;
  } else if (type === 'move') {
    title = 'Перенести событие';
    html = field('at', 'Новая дата и время МСК', 'datetime-local', { required: true });
  } else if (type === 'activity') {
    title = 'Записать действие';
    html = field('action', 'Что сделали?', 'text', { required: true, placeholder: 'Например, погулял с питомцем' }) +
      field('actor', 'Кто выполнил?', 'text', { required: true, placeholder: 'Имя' }) +
      field('at', 'Когда', 'datetime-local', { required: true });
  } else if (type === 'health') {
    title = 'Запись о здоровье';
    html = field('petId', 'Питомец', 'select', { options: state.pets.map(x => [x.id, x.name]) }) +
      field('type', 'Тип записи', 'select', { options: Object.entries(healthLabel) }) +
      field('title', 'Название или причина', 'text', { required: true }) +
      f.date('date') +
      field('product', 'Вакцина или средство') +
      field('clinic', 'Клиника') +
      field('doctor', 'Врач') +
      field('result', 'Результат') +
      field('nextDate', 'Следующая процедура', 'date') +
      field('repeatDays', 'Или повтор через N дней', 'number', { min: '1', step: '1' }) +
      field('nextTime', 'Время напоминания МСК', 'time') +
      f.notes() +
      field('attachment', 'Фото или PDF', 'file', { full: true });
  } else if (type === 'prescription') {
    title = 'Назначение препарата';
    html = field('name', 'Препарат', 'text', { required: true }) +
      field('dose', 'Дозировка, как указано врачом', 'text', { required: true }) +
      field('startDate', 'Начало курса', 'date', { required: true }) +
      field('duration', 'Длительность курса', 'text', { required: true, placeholder: 'Например, 7 дней' }) +
      field('times', 'Время приёма', 'text', { placeholder: '09:00, 21:00' }) +
      field('status', 'Статус', 'select', { options: [['Активно', 'Активно'], ['Завершено', 'Завершено'], ['Остановлено', 'Остановлено']] });
  } else if (type === 'weight') {
    title = 'Новое измерение';
    html = f.date('date') + field('kg', 'Вес, кг', 'number', { required: true, min: '.1', max: '150', step: '.1' });
  } else if (type === 'nutrition') {
    title = 'Добавить корм';
    const choice = (name, legend, options, selected = 'unknown') => `<fieldset class="food-choice"><legend>${legend}</legend><div class="food-options">${options.map(([value, text]) => `<label><input type="radio" name="${name}" value="${value}" ${value === selected ? 'checked' : ''}><span>${text}</span></label>`).join('')}</div></fieldset>`;
    html = `<div class="food-form-intro full"><span class="food-form-icon" aria-hidden="true"><svg><use href="#food"/></svg></span><div><strong>Что пробует питомец?</strong><p>Сохраните корм и свои наблюдения. Оценку можно пока не давать.</p></div></div>
      <section class="food-form-section full" aria-labelledby="food-product-heading"><h3 id="food-product-heading">О корме</h3><div class="form-grid">
      ${field('food', 'Название корма *', 'text', {required:true, full:true, placeholder:'Например, индейка с рисом'})}
      ${field('brand', 'Бренд', 'text', {full:true, placeholder:'Например, название с упаковки'})}
      </div>${choice('kind', 'Тип питания', Object.entries(kindLabel), 'food')}</section>
      <section class="food-form-section full" aria-labelledby="food-observation-heading"><h3 id="food-observation-heading">Как отреагировал питомец?</h3>
      ${choice('liked', 'Ест с удовольствием?', [['yes','Да'],['no','Нет'],['unknown','Пока не знаю']])}
      ${choice('tolerated', 'Хорошо переносит?', [['yes','Да'],['no','Нет'],['unknown','Наблюдаю']])}
      ${field('reactions', 'Что заметили?', 'textarea', {full:true,placeholder:'Например, отказался есть или появился зуд. Можно оставить пустым.'})}
      <p class="food-form-hint">Это ваши наблюдения, а не медицинское заключение.</p></section>
      <details class="food-form-details full"><summary>Дата, цена и заметки <span>Необязательно</span></summary><div class="form-grid">
      ${f.date('date')}${field('price', 'Цена упаковки, ₽', 'number', {min:'0',step:'.01',placeholder:'Не указана'})}${f.notes()}
      </div></details>`;
  }

  if (type !== 'pet-details') { $('editor-fields').innerHTML = html; decorateEditor(type); }
  $('editor-title').textContent = title;
  $('editor-context').textContent = type === 'pet' ? 'Создайте карточку питомца или подключитесь по коду совместного доступа.' : ('Кабинет: ' + (p?.name || 'Питомец'));

  const form = $('editor-form');
  form.querySelector('.form-actions').style.display = type === 'pet-details' ? 'none' : 'flex';
  if (type === 'pet-edit' && p) {
    for (const [k, v] of Object.entries(p)) {
      const el = form.elements.namedItem(k);
      if (el && el.type !== 'file') el.value = v ?? '';
    }
  }
  const ps = form.elements.namedItem('petId');
  if (ps && p) ps.value = p.id;
  const d = form.elements.namedItem('date') || form.elements.namedItem('startDate');
  if (d && !d.value) d.value = today();
  const actorEl = form.elements.namedItem('actor');
  if (actorEl && !actorEl.value) actorEl.value = state.user.name || 'Владелец';
  const dt = form.elements.namedItem('at');
  if (dt && !dt.value) dt.value = type === 'move' ? (state.events.find(x => x.id === id)?.at.slice(0, 16) || mskNow()) : mskNow();

  // Hook Join by Code button inside Pet Modal
  if (type === 'pet') {
    const btnJoin = $('btn-do-join');
    if (btnJoin) {
      btnJoin.onclick = async () => {
        const codeInput = $('pet-invite-code');
        const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
        if (!code) { notify('Введите код совместного ухода'); return; }
        try {
          const res = await apiFetch('/pets/join-by-code', {
            method: 'POST',
            body: JSON.stringify({ invite_code: code })
          });
          if (res?.id) {
            $('editor').close();
            await syncServerData(true);
            state.selected = String(res.id);
            show('health');
            notify('Питомец ' + (res.name || '') + ' подключён по коду совместного ухода');
          }
        } catch (err) {
          notify(err.message || 'Ошибка подключения по коду');
        }
      };
    }
  }

  $('editor').showModal();
}

function openExtraModal(type) {
  $('editor').dataset.mode = type;
  $('editor-form').querySelector('[type=submit]').textContent = 'Сохранить';
  editorDirty = false;
  clearEditorError();
  closePetAccounts();
  const p = pet();
  if (!p && !['profile', 'settings', 'member'].includes(type)) {
    notify('Сначала добавьте питомца.');
    return;
  }
  modalType = 'extra-' + type;
  $('editor').dataset.id = '';
  $('editor').dataset.petId = p?.id || '';
  let html = '', title = '';

  if (type === 'meal-plan') {
    title = 'Добавить питание';
    html = field('food', 'Что даёте питомцу?', 'text', { required: true, full: true, placeholder: 'Например, индейка с рисом, 60 г' }) +
      '<fieldset class="meal-schedule-field"><legend>Когда кормить</legend><div class="meal-schedule-options"><label class="meal-schedule-option"><input type="radio" name="schedule" value="exact" checked><span>Точное время</span></label><label class="meal-schedule-option"><input type="radio" name="schedule" value="range"><span>Интервал времени</span></label></div></fieldset>' +
      field('time', 'Время кормления', 'time', { required: true, full: true }) +
      field('endTime', 'До какого времени', 'time') +
      field('notes', 'Заметка', 'textarea', { full: true, placeholder: 'Порция, способ приготовления или другие детали' }) +
      '<p class="hint meal-form-hint"><span class="meal-range-hint" hidden>Интервал задаётся в пределах одного дня. </span>Повторяется ежедневно и синхронизируется с сервером.</p>';
    $('editor-title').textContent = title;
    $('editor-context').textContent = 'Кабинет: ' + p.name;
    $('editor-fields').innerHTML = html; decorateEditor(type);
    const fields = $('editor-fields'), start = fields.querySelector('[name=time]'), end = fields.querySelector('[name=endTime]');
    start.value = '08:30';
    const updateTiming = () => {
      const range = fields.querySelector('[name=schedule]:checked').value === 'range';
      start.closest('.field').classList.toggle('full', !range);
      start.closest('.field').firstChild.textContent = range ? 'С какого времени' : 'Время кормления';
      end.closest('.field').hidden = !range;
      end.disabled = !range; end.required = range;
      fields.querySelector('.meal-range-hint').hidden = !range;
    };
    fields.querySelector('.meal-schedule-field').addEventListener('change', updateTiming);
    updateTiming();
    $('editor-form').querySelector('.form-actions').style.display = 'flex';
    $('editor').showModal();
    return;
  }

  if (type === 'reminder') {
    title = 'Напоминание по Москве';
    html = field('petId', 'Питомец', 'select', { options: state.pets.map(x => [x.id, x.name]) }) +
      field('title', 'Что сделать?', 'text', { required: true, placeholder: 'Дать таблетку, сходить к ветеринару…' }) +
      field('type', 'Тип', 'select', { options: [['Препарат', 'Препарат'], ['Процедура', 'Процедура'], ['Прогулка', 'Прогулка'], ['Ветеринар', 'Ветеринар'], ['Кормление', 'Кормление']] }) +
      field('at', 'Дата и время МСК', 'datetime-local', { required: true }) +
      field('frequency', 'Повтор', 'select', { options: [['once', 'Один раз'], ['days', 'Каждые N дней'], ['months', 'Каждые N месяцев']] }) +
      field('interval', 'Интервал N', 'number', { min: '1', step: '1', placeholder: 'Для повторения' });
  } else if (type === 'feeding-log') {
    title = 'Записать кормление';
    html = field('food', 'Что дали?', 'text', { required: true }) +
      field('amount', 'Порция', 'text', { placeholder: 'Например, 60 г' }) +
      field('at', 'Дата и время МСК', 'datetime-local', { required: true }) +
      field('notes', 'Заметка', 'textarea', { full: true });
  } else if (type === 'document') {
    title = 'Добавить документ';
    html = field('title', 'Название', 'text', { required: true, placeholder: 'Ветпаспорт, анализ крови…' }) +
      field('type', 'Тип', 'select', { options: [['passport', 'Ветеринарный паспорт'], ['conclusion', 'Заключение'], ['prescription', 'Назначение'], ['other', 'Другое']] }) +
      field('date', 'Дата', 'date', { required: true }) +
      field('file', 'Фото или PDF до 2 МБ', 'file', { required: true, full: true });
  } else if (type === 'shopping') {
    title = 'Добавить покупку';
    html = field('title', 'Что купить?', 'text', { required: true }) +
      field('quantity', 'Количество или размер');
  } else if (type === 'vet-contact') {
    title = 'Информация о клинике';
    html = field('clinicUrl', 'Ссылка или название клиники', 'text', { full: true, placeholder: 'https://vet-friend.example.ru' }) +
      field('doctor', 'Имя врача', 'text', { full: true });
  } else if (type === 'profile') {
    title = 'Настройки аккаунта';
    html = field('name', 'Имя', 'text', { required: true }) + field('email', 'Электронная почта (смена через подтверждение ниже)', 'email', { required: true }) + field('timezone', 'Часовой пояс', 'select', { options: [...new Set([state.user.timezone || 'Europe/Moscow', ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Europe/Moscow','UTC','Europe/Kaliningrad','Asia/Yekaterinburg','Asia/Novosibirsk','Asia/Vladivostok'])])].map(zone => [zone, zone]) });
  } else if (type === 'member') {
    title = 'Участник ухода';
    html = field('email', 'Почта зарегистрированного участника', 'email', { required: true }) + field('role', 'Роль', 'select', { options: [['editor', 'Редактор'], ['viewer', 'Просмотр']] }) + field('until', 'Доступ до', 'date');
  } else if (type === 'avatar') {
    title = 'Аватар питомца';
    html = field('background', 'Фон', 'select', { options: [['lavender', 'Лаванда'], ['peach', 'Персик'], ['mint', 'Мята']] }) +
      field('accessory', 'Аксессуар', 'select', { options: [['none', 'Без аксессуара'], ['bow', 'Бант'], ['crown', 'Корона']] }) +
      field('photo', 'Своя фотография (JPG, PNG или WebP до 1 МБ)', 'file', { full: true });
  } else if (type === 'settings') {
    title = 'Уведомления';
    html = field('quietEnabled', 'Тихие часы', 'select', { options: [['no', 'Выключены'], ['yes', 'Включены']] }) +
      field('quietStart', 'Начало', 'time') +
      field('quietEnd', 'Конец', 'time') +
      '<div class="field full">Типы событий</div>' +
      ['Кормление', 'Препарат', 'Процедура', 'Ветеринар', 'Прогулка'].map(t => '<label class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" name="types" value="' + t + '"> ' + t + '</label>').join('');
  }

  $('editor-title').textContent = title;
  $('editor-context').textContent = ['profile', 'settings'].includes(type) ? 'Настройки владельца' : ('Кабинет: ' + (p?.name || 'Питомец'));
  $('editor-fields').innerHTML = html; decorateEditor(type);
  $('editor-form').querySelector('.form-actions').style.display = 'flex';

  const form = $('editor-form');
  const petSelect = form.elements.namedItem('petId');
  if (petSelect && p) petSelect.value = p.id;
  if (['reminder', 'feeding-log'].includes(type)) form.elements.namedItem('at').value = mskNow();
  if (type === 'reminder') {
    const frequency = form.elements.namedItem('frequency'), interval = form.elements.namedItem('interval');
    const updateInterval = () => {
      const repeated = frequency.value !== 'once';
      interval.closest('.field').hidden = !repeated; interval.disabled = !repeated; interval.required = repeated;
      interval.closest('.field').firstChild.textContent = frequency.value === 'months' ? 'Повторять каждые N месяцев' : 'Повторять каждые N дней';
      if (repeated && !interval.value) interval.value = '1';
    };
    frequency.onchange = updateInterval; updateInterval();
    const at = form.elements.namedItem('at'), hint = document.createElement('p');
    hint.className = 'hint full'; hint.setAttribute('role', 'status'); at.closest('.field').after(hint);
    const updateZoneHint = () => {
      const moment = mskMoment(at.value);
      hint.textContent = Number.isNaN(moment.getTime()) ? 'Введите дату и время по Москве.' : 'В вашем часовом поясе (' + (state.user.timezone || 'Europe/Moscow') + '): ' + new Intl.DateTimeFormat('ru-RU', {timeZone:state.user.timezone || 'Europe/Moscow', dateStyle:'medium', timeStyle:'short'}).format(moment);
    };
    at.addEventListener('input', updateZoneHint); at.addEventListener('change', updateZoneHint); updateZoneHint();
  }
  if (type === 'document') form.elements.namedItem('date').value = mskDay();
  if (type === 'vet-contact' && p) {
    const c = state.contacts[p.id] || {};
    if (form.elements.namedItem('clinicUrl')) form.elements.namedItem('clinicUrl').value = c.clinicUrl || '';
    if (form.elements.namedItem('doctor')) form.elements.namedItem('doctor').value = c.doctor || '';
  }
  if (type === 'profile') {
    form.elements.namedItem('timezone').value = state.user.timezone || 'Europe/Moscow';
    form.elements.namedItem('name').value = state.user.name || '';
    form.elements.namedItem('email').value = state.user.email || '';
  }
  if (type === 'avatar' && p) {
    form.elements.namedItem('background').value = state.avatar[p.id]?.background || 'lavender';
    form.elements.namedItem('accessory').value = state.avatar[p.id]?.accessory || 'none';
  }
  if (type === 'settings') {
    const s = state.settings;
    form.elements.namedItem('quietEnabled').value = s.quietEnabled ? 'yes' : 'no';
    form.elements.namedItem('quietStart').value = s.quietStart;
    form.elements.namedItem('quietEnd').value = s.quietEnd;
    form.querySelectorAll('[name=types]').forEach(x => x.checked = s.types.includes(x.value));
  }
  $('editor').showModal();
}

// =====================================================================
// 8. UNIFIED FORM SUBMIT HANDLER (WITH BACKEND PERSISTENCE)
// =====================================================================
$('editor-form').onsubmit = async event => {
  event.preventDefault();
  clearEditorError();
  const form = event.currentTarget;
  for (const input of form.querySelectorAll('input[type=text], textarea')) {
    input.value = input.value.trim();
    if (input.required && !input.value) {
      input.reportValidity();
      return;
    }
  }
  const data = Object.fromEntries(new FormData(form));
  const p = state.pets.find(x => x.id === (data.petId || $('editor').dataset.petId)) || pet();
  const submitButton = form.querySelector('[type=submit]');
  submitButton.disabled = true;
  submitButton.textContent = 'Сохраняем…';

  try {
    if (modalType === 'pet' || modalType === 'pet-edit') {
      if (data.birthDate && data.birthDate > today()) { notify('Дата рождения не может быть в будущем'); return; }
      const photoFile = form.elements.namedItem('photo')?.files?.[0];
      let photoData = null;
      if (photoFile) {
        photoData = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(photoFile); });
      }
      if (modalType === 'pet') {
        let serverId = null, shareCode = '';
        const res = await apiFetch('/pets', {
          method: 'POST',
          body: JSON.stringify({
            name: data.name,
            species: data.species,
            breed: data.breed || 'Метис',
            birth_date: data.birthDate || today(),
            sex: data.sex || 'Неизвестно',
            sterilized: data.sterilized === 'Да',
            microchip_number: data.chip || null,
            notes: data.notes || null,
            marks: data.marks || null,
            photo_file_id: photoData
          })
        });
        if (res?.id) { serverId = res.id; shareCode = res.share_code || ''; }
        const newId = serverId ? String(serverId) : uid();
        state.pets.push({
          id: newId,
          serverId,
          name: data.name,
          species: data.species,
          breed: data.breed || 'Метис',
          birthDate: data.birthDate || today(),
          sex: data.sex || 'Неизвестно',
          sterilized: data.sterilized || 'Нет',
          notes: data.notes || '',
          marks: data.marks || '',
          chip: data.chip || '',
          photo: photoData,
          shareCode,
          isShared: false
        });
        state.selected = newId;
        $('editor').close();
        show('health');
        notify('Питомец ' + data.name + ' создан');
        return;
      } else if (p) {
        Object.assign(p, {
          name: data.name,
          species: data.species,
          breed: data.breed,
          birthDate: data.birthDate,
          sex: data.sex,
          sterilized: data.sterilized,
          marks: data.marks,
          notes: data.notes,
          chip: data.chip,
          ...(photoData ? { photo: photoData } : {})
        });
        if (p.serverId) {
          await apiFetch('/pets/' + p.serverId, {
            method: 'PUT',
            body: JSON.stringify({
              name: p.name,
              species: p.species,
              breed: p.breed,
              birth_date: p.birthDate || today(),
              sex: p.sex,
              sterilized: p.sterilized === 'Да',
              microchip_number: p.chip || null,
              notes: p.notes || null,
              marks: p.marks || null,
              ...(photoData ? { photo_file_id: photoData } : {})
            })
          });
        }
        renderHealthPetProfile(true);
      }
    } else if (modalType === 'move') {
      const row = state.events.find(x => x.id === $('editor').dataset.id);
      if (row) {
        row.at = data.at + '+03:00';
        if (row.serverId) {
          await apiFetch('/reminders/' + row.serverId + '/action', {
            method: 'PATCH',
            body: JSON.stringify({ at: row.at })
          });
        }
        logActivity(row.petId, 'Перенёс(ла): ' + row.title, '↷');
      }
    } else if (modalType === 'activity') {
      logActivity(p.id, data.action, '🐾', data.actor);
      if (data.at && state.activity[0]) state.activity[0].at = data.at + '+03:00';
    } else if (modalType === 'health') {
      if (!data.nextDate && data.repeatDays) {
        const nd = new Date(data.date + 'T12:00:00');
        nd.setDate(nd.getDate() + Number(data.repeatDays));
        data.nextDate = nd.toISOString().slice(0, 10);
      }
      const file = form.elements.namedItem('attachment')?.files?.[0];
      let attachment = null;
      if (file) {
        attachment = { name: file.name, data: await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); }) };
      }
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/health-records', {
          method: 'POST',
          body: JSON.stringify({
            record_type: data.type,
            event_date: data.date,
            title: data.title,
            medicine_name: data.product || null,
            clinic: data.clinic || null,
            doctor: data.doctor || null,
            result: data.result || null,
            comment: data.notes || null,
            next_date: data.nextDate || null,
            file_name: attachment?.name || null,
            file_data: attachment?.data || null
          })
        });
        if (res?.id) serverId = res.id;
      }
      state.health.push({ id: serverId ? 'sh_' + serverId : uid(), serverId, petId: p.id, ...data, attachment });
      logActivity(p.id, 'Добавил(а) запись здоровья: ' + data.title, '🩺');
    } else if (modalType === 'prescription') {
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/prescriptions', {
          method: 'POST',
          body: JSON.stringify({
            name: data.name,
            dose: data.dose,
            start_date: data.startDate,
            duration: data.duration,
            times: data.times || null,
            status: data.status || 'Активно'
          })
        });
        if (res?.id) serverId = res.id;
      }
      state.prescriptions.push({ id: serverId ? 'spr_' + serverId : uid(), serverId, petId: p.id, ...data });
      logActivity(p.id, 'Добавил(а) назначение: ' + data.name, '💊');
    } else if (modalType === 'weight') {
      const kg = Number(data.kg);
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/weights', {
          method: 'POST',
          body: JSON.stringify({ date: data.date, kg })
        });
        if (res?.id) serverId = res.id;
      }
      state.weights.push({ id: serverId ? 'sw_' + serverId : uid(), serverId, petId: p.id, date: data.date, kg });
      logActivity(p.id, 'Измерил(а) вес: ' + kg + ' кг', '⚖️');
    } else if (modalType === 'nutrition') {
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/nutrition', {
          method: 'POST',
          body: JSON.stringify({
            food_name: data.food,
            brand: data.brand || null,
            kind: data.kind || 'food',
            liked: data.liked || 'unknown',
            tolerated: data.tolerated || 'unknown',
            adverse_reactions: data.reactions || null,
            price: data.price ? Number(data.price) : null,
            notes: data.notes || null,
            date: data.date || today()
          })
        });
        if (res?.id) serverId = res.id;
      }
      state.nutrition.push({
        id: serverId ? 'sn_' + serverId : uid(),
        serverId,
        petId: p.id,
        ...data,
        price: data.price ? Number(data.price) : null,
        reactions: data.reactions ? data.reactions.split(',').map(x => x.trim()).filter(Boolean) : []
      });
      logActivity(p.id, 'Добавил(а) оценку корма: ' + data.food, '🍽️');
    } else if (modalType === 'extra-meal-plan') {
      const endTime = data.schedule === 'range' ? data.endTime : '';
      if (data.schedule === 'range' && (!endTime || endTime <= data.time)) {
        notify('Конец интервала должен быть позже начала в пределах одного дня.');
        return;
      }
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/meal-plans', {
          method: 'POST',
          body: JSON.stringify({ food: data.food, time: data.time, end_time: endTime || null, notes: data.notes || '' })
        });
        if (res?.id) serverId = res.id;
      }
      const newMeal = { id: serverId ? 'smp_' + serverId : uid(), serverId, petId: p.id, food: data.food, time: data.time, endTime, notes: data.notes, completedOn: null };
      state.mealPlans.push(newMeal);
      const nowClock = mskNow().slice(11, 16);
      const curDay = mskDay();
      if (newMeal.time && newMeal.time < nowClock) {
        notifiedPushKeys.add('meal_due_' + (newMeal.serverId || newMeal.id) + '_' + curDay + '_' + newMeal.time);
      }
      if (newMeal.endTime && newMeal.endTime < nowClock) {
        notifiedPushKeys.add('meal_end_' + (newMeal.serverId || newMeal.id) + '_' + curDay + '_' + newMeal.endTime);
      }
    } else if (modalType === 'extra-reminder') {
      const atStr = data.at + '+03:00';
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/reminders', {
          method: 'POST',
          body: JSON.stringify({
            title: data.title,
            reminder_type: data.type,
            due_date: data.at.slice(0, 10),
            at: atStr,
            interval_days: data.frequency === 'days' ? Number(data.interval) : null,
            interval_months: data.frequency === 'months' ? Number(data.interval) : null
          })
        });
        if (res?.id) serverId = res.id;
      }
      state.events.push({
        id: serverId ? 'sr_' + serverId : uid(),
        serverId,
        petId: p.id,
        title: data.title,
        type: data.type,
        at: atStr,
        status: 'pending',
        intervalDays: data.frequency === 'days' ? Number(data.interval) : null,
        intervalMonths: data.frequency === 'months' ? Number(data.interval) : null
      });
      logActivity(p.id, 'Запланировал(а): ' + data.title, '🔔');
    } else if (modalType === 'extra-feeding-log') {
      const atStr = data.at + '+03:00';
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/feeding-logs', {
          method: 'POST',
          body: JSON.stringify({
            food: data.food,
            amount: data.amount || '',
            notes: data.notes || '',
            actor: state.user.name || 'Владелец',
            at: new Date(atStr).toISOString()
          })
        });
        if (res?.id) serverId = res.id;
      }
      state.feedingLogs.unshift({
        id: serverId ? 'sfl_' + serverId : uid(),
        serverId,
        petId: p.id,
        food: data.food,
        amount: data.amount,
        at: atStr,
        actor: state.user.name || 'Владелец',
        notes: data.notes
      });
    } else if (modalType === 'extra-document') {
      const file = form.elements.namedItem('file')?.files?.[0];
      let fileData = '';
      if (file) {
        fileData = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
      }
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/documents', {
          method: 'POST',
          body: JSON.stringify({
            title: data.title,
            doc_type: data.type,
            date: data.date,
            file_name: file?.name || data.title,
            file_data: fileData
          })
        });
        if (res?.id) serverId = res.id;
      }
      state.documents.push({ id: serverId ? 'sdoc_' + serverId : uid(), serverId, petId: p.id, title: data.title, type: data.type, date: data.date, file: { name: file?.name || data.title, data: fileData } });
      logActivity(p.id, 'Добавил(а) документ: ' + data.title, '📎');
    } else if (modalType === 'extra-shopping') {
      let serverId = null;
      if (p.serverId) {
        const res = await apiFetch('/pets/' + p.serverId + '/shopping', {
          method: 'POST',
          body: JSON.stringify({ title: data.title, quantity: data.quantity || null })
        });
        if (res?.id) serverId = res.id;
      }
      state.shopping.push({ id: serverId ? 'sshop_' + serverId : uid(), serverId, petId: p.id, title: data.title, quantity: data.quantity, done: false });
    } else if (modalType === 'extra-vet-contact') {
      state.contacts[p.id] = { clinicUrl: data.clinicUrl, doctor: data.doctor };
      if (p.serverId) {
        await apiFetch('/pets/' + p.serverId, {
          method: 'PUT',
          body: JSON.stringify({ clinic_url: data.clinicUrl, doctor_name: data.doctor })
        });
      }
    } else if (modalType === 'extra-profile') {
      if(data.email.trim().toLowerCase() !== state.user.email) throw Error('Для смены почты используйте кнопку «Изменить почту» в безопасности аккаунта.');
      await apiFetch('/auth/user',{method:'PUT',body:JSON.stringify({full_name:data.name,timezone:data.timezone})});
      state.user.name=data.name; state.user.timezone=data.timezone;
      updateAuthStatusUI();
    } else if (modalType === 'extra-member') {
      await apiFetch('/pets/'+p.serverId+'/members',{method:'POST',body:JSON.stringify({email:data.email,role:data.role,expires_at:data.until?data.until+'T23:59:59+03:00':null})});
    } else if (modalType === 'extra-avatar') {
      const photo = form.elements.namedItem('photo')?.files?.[0];
      if (photo) {
        p.photo = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(photo); });
      }
      state.avatar[p.id] = { background: data.background, accessory: data.accessory };
      if (p.serverId) {
        await apiFetch('/pets/' + p.serverId, {
          method: 'PUT',
          body: JSON.stringify({
            avatar_bg: data.background,
            avatar_accessory: data.accessory,
            ...(p.photo ? { photo_file_id: p.photo } : {})
          })
        });
      }
    } else if (modalType === 'extra-settings') {
      state.settings = {
        ...state.settings,
        quietEnabled: data.quietEnabled === 'yes',
        quietStart: data.quietStart || '22:00',
        quietEnd: data.quietEnd || '08:00',
        types: [...form.querySelectorAll('[name=types]:checked')].map(x => x.value)
      };
      await savePushSettings();
    }

    const savedModalType = modalType;
    const savedAt = data.at || '';
    const savedMealTime = data.time || '';
    form.reset();
    $('editor').close();
    if (['extra-reminder', 'move', 'extra-meal-plan'].includes(savedModalType)) {
      if (!state.settings.pushEnabled) {
        state.settings.pushEnabled = true;
        savePushSettings().catch(()=>{});
        requestBrowserNotificationPermission();
      }
      updatePushStatusUI();
    }
    render();
    if ((savedModalType === 'extra-reminder' || savedModalType === 'move') && savedAt) {
      notify('Сохранено · событие запланировано на ' + savedAt.slice(11, 16) + ' МСК');
    } else if (savedModalType === 'extra-meal-plan' && savedMealTime) {
      notify('Сохранено · кормление запланировано на ' + savedMealTime + ' МСК');
    } else {
      notify('Сохранено');
    }
    scheduleNextExactPush();
    setTimeout(checkDuePushNotifications, 350);
  } catch(err) {
    notify(err.message || 'Не удалось сохранить изменения');
    if(authToken) await syncServerData(true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Сохранить';
  }
};

// =====================================================================
// 9. AUTH MODAL & AUTOMATIC SERVER SYNC
// =====================================================================
let authMode = 'login';
function openAuthDialog(mode = 'login') {
  authMode = mode;
  $('auth-password').minLength = mode === 'login' ? 1 : 8;
  $('auth-error').hidden = true;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-register').classList.toggle('active', mode === 'register');
  $('tab-login').setAttribute('aria-selected', String(mode === 'login'));
  $('tab-register').setAttribute('aria-selected', String(mode === 'register'));
  $('auth-name-field').hidden = mode !== 'register';
  $('auth-dialog-title').textContent = mode === 'login' ? 'Вход в PetCare' : 'Регистрация в PetCare';
  $('auth-submit-btn').textContent = mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт';
  $('auth-dialog').showModal();
}

$('tab-login').onclick = () => openAuthDialog('login');
$('tab-register').onclick = () => openAuthDialog('register');
$('close-auth-dialog').onclick = () => $('auth-dialog').close();
if ($('api-open')) $('api-open').onclick = () => openAuthDialog('login');
if ($('btn-open-auth-modal')) $('btn-open-auth-modal').onclick = () => openAuthDialog('login');

$('auth-form').onsubmit = async e => {
  e.preventDefault();
  $('auth-error').hidden = true;
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const fullName = $('auth-name').value.trim() || 'Владелец';

  const submit = $('auth-submit-btn');
  submit.disabled = true; submit.textContent = 'Подождите…';
  $('tab-login').disabled = true; $('tab-register').disabled = true;
  try {
    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
    const payload = authMode === 'login' ? { email, password } : { email, password, full_name: fullName, timezone: 'Europe/Moscow' };
    const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    if (res?.verification_required) { $('auth-dialog').close(); openSecurity('register', res.challenge_id); return; }
    if (res?.access_token) {
      authToken = res.access_token;
      try {
        localStorage.setItem(STORAGE_AUTH_KEY, authToken);
        localStorage.removeItem('petcare-logged-out');
      } catch {}
      if (res.user) {
        state.user = { id: res.user.id, name: res.user.full_name || fullName, email: res.user.email, timezone: res.user.timezone || 'Europe/Moscow' };
      }
      $('auth-dialog').close();
      await syncServerData();
      notify(authMode === 'register' ? 'Аккаунт создан и подключён!' : 'Вход выполнен: ' + state.user.name);
    }
  } catch (err) {
    $('auth-error').textContent = err.message || 'Ошибка авторизации';
    $('auth-error').hidden = false; $('auth-error').focus();
  } finally { submit.disabled = false; submit.textContent = authMode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'; $('tab-login').disabled = false; $('tab-register').disabled = false; }
};

document.querySelectorAll('[data-demo-login]').forEach(btn => {
  btn.onclick = async () => {
    const accId = btn.dataset.demoLogin;
    $('auth-error').hidden = true;
    btn.disabled = true;
    try {
      const res = await apiFetch('/auth/demo-login/' + accId, { method: 'POST' });
      if (res?.access_token) {
        authToken = res.access_token;
        try {
          localStorage.setItem(STORAGE_AUTH_KEY, authToken);
          localStorage.removeItem('petcare-logged-out');
        } catch {}
        if (res.user) {
          state.user = {
            id: res.user.id,
            name: res.user.full_name || (accId === '2' ? 'Анна' : 'Илья'),
            email: res.user.email || ('demo' + accId + '@petcare.app'),
            timezone: res.user.timezone || 'Europe/Moscow'
          };
        }
        state.selected = null;
        $('auth-dialog').close();
        await syncServerData();
      }
    } catch (err) {
      $('auth-error').textContent = err.message || 'Ошибка демо-входа';
      $('auth-error').hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
});

$('api-logout').onclick = async () => {
  try { const reg=await navigator.serviceWorker?.getRegistration(); const sub=await reg?.pushManager.getSubscription(); if(sub){await apiFetch('/notifications/unsubscribe',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})}); await sub.unsubscribe();} await apiFetch('/auth/logout',{method:'POST'}); } catch(err) { notify(err.message); return; }
  authToken = '';
  try {
    localStorage.removeItem(STORAGE_AUTH_KEY);
    localStorage.setItem('petcare-logged-out', '1');
  } catch {}
  state.user = { id: null, name: 'Гость', email: '', timezone: 'Europe/Moscow' };
  state.pets = [];
  updateAuthStatusUI();
  render();
  openAuthDialog('login');
};

// Automatic background sync on window focus / visibility change / interval
function canAutoSync() {
  if (syncPending > 0) return false;
  if (!authToken || document.hidden) return false;
  if ($('editor')?.open || $('auth-dialog')?.open || $('security-dialog')?.open || $('temporal-picker')?.open) return false;
  if ($('health-pet-form')?.dataset.dirty === 'true') return false;
  return true;
}

window.addEventListener('focus', () => {
  if (canAutoSync()) syncServerData(true);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && canAutoSync()) syncServerData(true);
});
setInterval(() => {
  if (canAutoSync()) syncServerData(true);
}, 20000);

// =====================================================================
// 10. AI DOCUMENT RECOGNITION
// =====================================================================
(() => {
  const photoInput = $('document-photo');
  const recognizeButton = $('recognize-button');
  const copyButton = $('copy-recognized');
  const recognizeStatus = $('recognize-status');
  const recognizedText = $('recognized-text');

  function setStatus(msg, isError = false) {
    recognizeStatus.textContent = msg;
    recognizeStatus.classList.toggle('error', isError);
  }

  function updateButtons() {
    copyButton.disabled = !recognizedText.value.trim();
  }

  photoInput.onchange = () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    setStatus('Выбран файл: ' + file.name);
  };

  recognizedText.oninput = updateButtons;

  recognizeButton.onclick = async () => {
    const file = photoInput.files?.[0];
    if (!file) {
      setStatus('Сначала выберите фото документа.', true);
      return;
    }

    if(file.size>10*1024*1024){setStatus('Максимальный размер — 10 МБ.',true);return;}

    try {
      recognizeButton.disabled = true;
      setStatus('Проверяем доступ…');
      const access = await apiFetch('/billing/status');
      if (!access.premium) throw new Error('Распознавание доступно в платной версии. Запросите доступ у администратора.');
      const res = await window.PetCareOCR.recognize(file, {
        rotation: Number($('ocr-rotation').value), progress: message => setStatus(message)
      });
      recognizedText.value = res?.text || '';
      updateButtons();
      setStatus((res.confidence < 65 ? 'Качество распознавания низкое. Лучше переснять документ. ' : 'Текст распознан. ') + 'Проверьте названия, даты и дозировки перед использованием.');
    } catch (err) {
      setStatus(err.message || 'Ошибка сервиса распознавания', true);
    } finally {
      recognizeButton.disabled = false;
    }
  };

  copyButton.onclick = async () => {
    if (!recognizedText.value.trim()) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(recognizedText.value); showCopiedToast('Скопировано');
    } catch { setStatus('Не удалось скопировать. Выделите распознанный текст и скопируйте вручную.', true); }
  };
})();

// =====================================================================
// 11. TEMPORAL DATE/TIME PICKER (FROM NEW DESIGN)
// =====================================================================
(() => {
  const picker = $('temporal-picker');
  const get = id => document.getElementById('picker-' + id);
  const selector = 'input[type="date"],input[type="time"],input[type="datetime-local"]';
  const pad = value => String(value).padStart(2, '0');
  const civil = (year, month, day) => {
    const value = new Date(2000, 0, 1, 12);
    value.setFullYear(year, month, day);
    return value;
  };
  const dayKey = value => String(value.getFullYear()).padStart(4, '0') + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
  const readDay = value => { const [y, m, d] = value.split('-').map(Number); return civil(y, m - 1, d); };
  const fullDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const monthDate = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  get('month').innerHTML = months.map((name, index) => '<option value="' + index + '">' + name + '</option>').join('');
  let source = null, draft = null, viewYear = 0, viewMonth = 0, stage = 'date', moscow = false;
  const currentDay = () => moscow ? mskDay() : dayKey(new Date());
  const relativeDay = offset => { const day = readDay(currentDay()); day.setDate(day.getDate() + offset); return dayKey(day); };
  const isDateAllowed = key => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < '0001-01-01' || key > '9999-12-31') return false;
    const min = source.min?.slice(0, 10), max = source.max?.slice(0, 10);
    return (!min || key >= min) && (!max || key <= max);
  };
  const error = message => { get('error').textContent = message; get('error').hidden = !message; };
  function updatePreview() {
    const clock = pad(draft.hour) + ':' + pad(draft.minute);
    get('direct').value = draft.day.split('-').reverse().join('.');
    get('preview').textContent = source.type === 'time' ? clock : fullDate.format(readDay(draft.day)) + (source.type === 'datetime-local' ? ', ' + clock : '');
  }
  function renderCalendar(focusDay) {
    get('prev').disabled = viewYear === 1 && viewMonth === 0; get('next').disabled = viewYear === 9999 && viewMonth === 11;
    get('month').value = String(viewMonth);
    get('year').value = viewYear;
    get('month-announcement').textContent = monthDate.format(civil(viewYear, viewMonth, 1));
    const first = civil(viewYear, viewMonth, 1), offset = (first.getDay() + 6) % 7;
    const t = currentDay();
    let html = '<div role="row" class="calendar-week">' + ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => '<span role="columnheader">' + day + '</span>').join('') + '</div>';
    const preferred = focusDay || (draft.day.slice(0, 7) === dayKey(first).slice(0, 7) ? draft.day : dayKey(first));
    const weeks = Math.ceil((offset + civil(viewYear, viewMonth + 1, 0).getDate()) / 7);
    const days = Array.from({ length: weeks * 7 }, (_, index) => civil(viewYear, viewMonth, index - offset + 1));
    const focusable = days.find(day => dayKey(day) === preferred && isDateAllowed(dayKey(day))) || days.find(day => day.getMonth() === viewMonth && isDateAllowed(dayKey(day)));
    const tabDay = focusable ? dayKey(focusable) : '';
    for (let row = 0; row < weeks; row++) {
      html += '<div role="row" class="calendar-row">';
      for (const day of days.slice(row * 7, row * 7 + 7)) {
        const key = dayKey(day), allowed = isDateAllowed(key);
        html += '<button type="button" role="gridcell" class="calendar-day' + (day.getMonth() !== viewMonth ? ' outside' : '') + '" data-day="' + key + '" aria-label="' + fullDate.format(day) + '" aria-selected="' + (key === draft.day) + '"' + (key === t ? ' aria-current="date"' : '') + ' tabindex="' + (key === tabDay ? '0' : '-1') + '"' + (allowed ? '' : ' disabled') + '>' + day.getDate() + '</button>';
      }
      html += '</div>';
    }
    get('calendar').innerHTML = html;
    if (focusDay) get('calendar').querySelector('[data-day="' + tabDay + '"]')?.focus();
  }
  const wheelRowHeight = 44;
  function markWheel(part, value, reposition = false) {
    const wheel = get(part + '-wheel');
    const previous = wheel.querySelector('[aria-selected="true"]');
    if (previous) previous.setAttribute('aria-selected', 'false');
    const option = get(part + '-option-' + value);
    option.setAttribute('aria-selected', 'true');
    wheel.setAttribute('aria-activedescendant', option.id);
    if (reposition) wheel.scrollTop = value * wheelRowHeight;
  }
  function syncWheels() {
    for (const part of ['hour','minute']) {
      const input = get(part);
      if (input.value !== '' && input.checkValidity()) markWheel(part, Number(input.value), true);
    }
  }
  function chooseWheel(part, value, reposition = true) {
    const max = part === 'hour' ? 23 : 59;
    value = Math.max(0, Math.min(max, value));
    draft[part] = value; get(part).value = pad(value);
    markWheel(part, value, reposition); updatePreview(); error('');
  }
  for (const part of ['hour','minute']) {
    const wheel = get(part + '-wheel'), count = part === 'hour' ? 24 : 60;
    wheel.innerHTML = Array.from({length:count}, (_, value) => '<div role="option" aria-selected="false" id="picker-' + part + '-option-' + value + '" data-value="' + value + '" class="time-wheel-option">' + pad(value) + '</div>').join('');
    wheel.addEventListener('scroll', () => {
      if (picker.open && stage === 'time') chooseWheel(part, Math.round(wheel.scrollTop / wheelRowHeight), false);
    }, {passive:true});
    wheel.onclick = e => { const option = e.target.closest('[data-value]'); if (option) { wheel.focus({preventScroll:true}); chooseWheel(part, Number(option.dataset.value)); } };
    wheel.onkeydown = e => {
      const value = Number(get(part).value), last = count - 1;
      const next = {ArrowUp:value-1, ArrowDown:value+1, PageUp:value-5, PageDown:value+5, Home:0, End:last}[e.key];
      if (next === undefined) return; e.preventDefault(); chooseWheel(part,next);
    };
  }
  function showStage(next, focus = false) {
    if (picker.open && stage === 'date' && next === 'time' && get('direct').value !== draft.day.split('-').reverse().join('.') && !get('direct').onchange()) return;
    stage = next;
    const combined = source.type === 'datetime-local';
    get('tabs').hidden = !combined;
    get('date-panel').hidden = stage !== 'date';
    get('time-panel').hidden = stage !== 'time';
    get('date-tab').tabIndex = stage === 'date' ? 0 : -1; get('time-tab').tabIndex = stage === 'time' ? 0 : -1;
    get('date-tab').setAttribute('aria-selected', String(stage === 'date'));
    get('time-tab').setAttribute('aria-selected', String(stage === 'time'));
    get('apply').textContent = combined && stage === 'date' ? 'Далее: время' : source.type === 'date' ? 'Выбрать дату' : 'Готово';
    error(''); updatePreview();
    if (stage === 'time') syncWheels();
    if (focus) {
      if (stage === 'date') get('calendar').querySelector('[tabindex="0"]')?.focus();
      else get('hour-wheel').focus();
    }
  }
  function open(input) {
    if (picker.open || input.disabled || input.readOnly) return;
    source = input; get('manual-time').open = false;
    const label = [...(input.labels || [])].map(node => node.firstChild?.textContent.trim()).filter(Boolean).join(' ') || 'Дата и время';
    moscow = /МСК|Москв/i.test(label);
    const initial = input.value;
    let day = input.type === 'time' ? currentDay() : initial.slice(0, 10) || currentDay();
    const clock = input.type === 'time' ? initial : initial.slice(11, 16);
    const [hour, minute] = (clock || '09:00').split(':').map(Number);
    draft = { day, hour, minute };
    const d = readDay(day); viewYear = d.getFullYear(); viewMonth = d.getMonth();
    get('hour').value = pad(hour); get('minute').value = pad(minute);
    get('context').textContent = label;
    get('title').textContent = input.type === 'time' ? 'Выбрать время' : input.type === 'date' ? 'Выбрать дату' : 'Дата и время';
    get('clear').hidden = input.required;
    picker.querySelectorAll('[data-relative-day]').forEach(button => button.disabled = !isDateAllowed(relativeDay(Number(button.dataset.relativeDay))));
    renderCalendar(); showStage(input.type === 'time' ? 'time' : 'date');
    picker.showModal(); showStage(stage, true);
  }
  function close() { picker.close(); source?.focus({preventScroll:true}); }
  get('close').onclick = close; get('cancel').onclick = close;
  function commit(value) {
    const check = source.cloneNode(); check.value = value;
    if (check.value !== value || !check.checkValidity()) { error('Выберите допустимые дату и время: проверьте ограничения поля.'); return; }
    source.value = value;
    source.dispatchEvent(new Event('input', { bubbles: true }));
    source.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }
  get('clear').onclick = () => commit('');
  get('apply').onclick = () => {
    if (stage === 'date' && (!get('year').checkValidity() || !get('year').value)) { error('Год должен быть от 1 до 9999.'); return; }
    if (stage === 'date' && get('direct').value !== draft.day.split('-').reverse().join('.') && !get('direct').onchange()) return;
    if (stage === 'date' && source.type === 'datetime-local') { showStage('time', true); return; }
    if (source.type !== 'date' && (!get('hour').checkValidity() || !get('minute').checkValidity() || get('hour').value === '' || get('minute').value === '')) { error('Укажите часы от 0 до 23 и минуты от 0 до 59.'); return; }
    draft.hour = Number(get('hour').value) || 0;
    draft.minute = Number(get('minute').value) || 0;
    const clock = pad(draft.hour) + ':' + pad(draft.minute);
    commit(source.type === 'date' ? draft.day : source.type === 'time' ? clock : draft.day + 'T' + clock);
  };
  picker.querySelectorAll('[data-preset-time]').forEach(button => button.onclick = () => {
    const [hour, minute] = button.dataset.presetTime.split(':').map(Number);
    draft.hour = hour; draft.minute = minute;
    get('hour').value = pad(hour); get('minute').value = pad(minute); updatePreview(); syncWheels();
  });
  get('calendar').onclick = event => {
    const button = event.target.closest('[data-day]');
    if (button && !button.disabled) {
      draft.day = button.dataset.day;
      const d = readDay(draft.day); viewYear = d.getFullYear(); viewMonth = d.getMonth();
      renderCalendar(draft.day); updatePreview();
      if (source.type === 'datetime-local') showStage('time', true);
    }
  };
  picker.querySelectorAll('[data-relative-day]').forEach(button => button.onclick = () => {
    if (!isDateAllowed(relativeDay(Number(button.dataset.relativeDay)))) return;
    draft.day = relativeDay(Number(button.dataset.relativeDay));
    const d = readDay(draft.day); viewYear = d.getFullYear(); viewMonth = d.getMonth();
    renderCalendar(draft.day); updatePreview();
  });
  get('direct').onchange = () => {
    const match = get('direct').value.trim().match(/^(\d{2})[.\/](\d{2})[.\/](\d{4})$/);
    const key = match ? match[3] + '-' + match[2] + '-' + match[1] : '';
    if (!match || !isDateAllowed(key) || dayKey(readDay(key)) !== key) { error('Введите существующую дату в формате ДД.ММ.ГГГГ.'); return false; }
    if (draft.day === key) { error(''); return true; }
    draft.day = key; const d = readDay(key); viewYear = d.getFullYear(); viewMonth = d.getMonth(); renderCalendar(); updatePreview(); error(''); return true;
  };
  get('direct').oninput = () => { if (get('direct').value.trim().length === 10) get('direct').onchange(); };
  get('direct').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); get('direct').onchange(); } };
  for (const part of ['hour','minute']) get(part).oninput = () => {
    if (get('hour').checkValidity() && get('minute').checkValidity()) {
      draft.hour = Number(get('hour').value); draft.minute = Number(get('minute').value); updatePreview(); syncWheels(); error('');
    }
  };
  get('calendar').onkeydown = e => {
    const cell = e.target.closest('[data-day]'); if (!cell) return;
    const delta = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7}[e.key];
    if (delta === undefined) return; e.preventDefault();
    const day = readDay(cell.dataset.day); day.setDate(day.getDate() + delta); const key = dayKey(day);
    if (!isDateAllowed(key)) return; viewYear = day.getFullYear(); viewMonth = day.getMonth(); renderCalendar(key);
  };
  get('tabs').onkeydown = e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); showStage(stage === 'date' ? 'time' : 'date'); get(stage + '-tab').focus(); };
  get('prev').onclick = () => { const t = civil(viewYear, viewMonth - 1, 1); viewYear = t.getFullYear(); viewMonth = t.getMonth(); renderCalendar(); };
  get('next').onclick = () => { const t = civil(viewYear, viewMonth + 1, 1); viewYear = t.getFullYear(); viewMonth = t.getMonth(); renderCalendar(); };
  get('month').onchange = () => { viewMonth = Number(get('month').value); renderCalendar(); };
  get('year').onchange = () => { if (!get('year').checkValidity() || !get('year').value) { error('Год должен быть от 1 до 9999.'); return; } viewYear = Number(get('year').value); renderCalendar(); error(''); };
  get('date-tab').onclick = () => showStage('date');
  get('time-tab').onclick = () => showStage('time');

  function enhance(root) {
    const inputs = root.matches?.(selector) ? [root] : [...(root.querySelectorAll?.(selector) || [])];
    for (const input of inputs) input.dataset.temporal = '';
  }
  enhance(document);
  new MutationObserver(changes => {
    for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === 1) enhance(node);
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', event => { if (event.target.matches(selector) && ['Enter',' '].includes(event.key)) { event.preventDefault(); open(event.target); } });
  document.addEventListener('pointerdown', event => {
    if (event.button === 0 && event.target.matches(selector) && !event.target.disabled && !event.target.readOnly) {
      event.preventDefault(); open(event.target);
    }
  });
  document.addEventListener('click', event => {
    if (event.target.matches(selector) && !event.target.disabled && !event.target.readOnly) {
      event.preventDefault(); open(event.target);
    }
  });
})();

// =====================================================================
// 12. EVENT LISTENERS & INITIALIZATION
// =====================================================================
setupPetAccountSwitcher();
document.querySelectorAll('[data-route]').forEach(b => b.onclick = () => show(b.dataset.route));
document.querySelectorAll('.nav [data-page]').forEach(b => b.onclick = e => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); if (b.getAttribute('aria-disabled') !== 'true') show(b.dataset.page); });
document.querySelectorAll('[data-modal]').forEach(b => b.onclick = () => openModal(b.dataset.modal));
document.querySelectorAll('[data-extra-modal]').forEach(b => b.onclick = () => openExtraModal(b.dataset.extraModal));
$('profile-paw').onclick = () => show('profile');
let editorDirty = false;
$('editor-form').addEventListener('input', () => { editorDirty = true; });
$('editor-form').addEventListener('change', () => { editorDirty = true; });
const mayCloseEditor = () => !editorDirty || confirm('Закрыть форму без сохранения изменений?');
$('editor').addEventListener('cancel', e => { if (!mayCloseEditor()) e.preventDefault(); });
$('editor').addEventListener('close', () => { editorDirty = false; });
$('cancel-editor').onclick = $('close-editor').onclick = () => { if (mayCloseEditor()) $('editor').close(); };
window.addEventListener('beforeunload', e => { if ((editorDirty && $('editor').open) || $('health-pet-form').dataset.dirty === 'true') { e.preventDefault(); e.returnValue = ''; } });

document.querySelectorAll('dialog').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d && (d.id !== 'editor' || mayCloseEditor())) d.close(); });
});

// =====================================================================
// 12. PUSH NOTIFICATIONS ENGINE & EXACT-TIME SCHEDULER
// =====================================================================
const notifiedPushKeys = new Set();
let initialPushSeedDone = false;
let exactPushTimerId = null;
let pushAudioCtx = null;

// Pre-unlock Web Audio API on first user interaction so scheduled chimes play reliably
function unlockPushAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!pushAudioCtx) pushAudioCtx = new AudioCtx();
    if (pushAudioCtx.state === 'suspended') pushAudioCtx.resume();
  } catch {}
}
document.addEventListener('pointerdown', unlockPushAudio, { passive: true });
document.addEventListener('keydown', unlockPushAudio, { passive: true });

const PUSH_ICON_DATA_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="18" fill="#286247"/>' +
  '<g fill="#fffefa">' +
  '<ellipse cx="20" cy="22" rx="4.5" ry="6.5" transform="rotate(-22 20 22)"/>' +
  '<ellipse cx="32" cy="18" rx="4.5" ry="6.5"/>' +
  '<ellipse cx="44" cy="22" rx="4.5" ry="6.5" transform="rotate(22 44 22)"/>' +
  '<path d="M21 40c4-11 18-11 22 0 3 6 2 11-4 11-4 0-4-2-7-2s-3 2-7 2c-6 0-7-5-4-11Z"/>' +
  '</g></svg>'
);

function isQuietHoursActive() {
  const s = state.settings;
  if (!s?.quietEnabled) return false;
  const nowClock = mskNow().slice(11, 16);
  const start = s.quietStart || '22:00';
  const end = s.quietEnd || '08:00';
  if (start <= end) return nowClock >= start && nowClock <= end;
  return nowClock >= start || nowClock <= end;
}

function playPushChime() {
  if (isQuietHoursActive()) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!pushAudioCtx) pushAudioCtx = new AudioCtx();
    if (pushAudioCtx.state === 'suspended') pushAudioCtx.resume();
    const now = pushAudioCtx.currentTime;
    const playTone = (freq, startOffset, duration) => {
      const osc = pushAudioCtx.createOscillator();
      const gain = pushAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.11, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(pushAudioCtx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.01);
    };
    playTone(587.33, 0, 0.18);    // D5
    playTone(880.00, 0.14, 0.28); // A5
  } catch {}
}

async function snoozeReminderFromPush(eventId, minutes = 10) {
  const ev = state.events.find(x => x.id === eventId);
  if (!ev || ev.status !== 'pending') return;
  const targetDate = new Date(Date.now() + minutes * 60000);
  const parts = mskDateParts(targetDate);
  const newAt = parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + '+03:00';
  ev.at = newAt;
  if (ev.serverId) {
    apiFetch('/reminders/' + ev.serverId + '/action', {
      method: 'PATCH',
      body: JSON.stringify({ at: newAt })
    });
  }
  render();
  scheduleNextExactPush();
  showCopiedToast('Отложено на ' + minutes + ' мин (' + parts.hour + ':' + parts.minute + ' МСК)');
}

async function completeMealFromPush(mealId) {
  const meal = state.mealPlans.find(m => m.id === mealId);
  if (!meal) return;
  const stamp = new Date(), day = mskDay(stamp);
  meal.completedOn = day;
  if (meal.serverId) {
    apiFetch('/meal-plans/' + meal.serverId + '/toggle?completed_on=' + encodeURIComponent(day), {
      method: 'PATCH',
      body: JSON.stringify({ completed_on: day })
    }).catch(() => {});
  }
  const targetPet = state.pets.find(x => String(x.id) === String(meal.petId));
  if (targetPet) {
    let serverLogId = null;
    if (targetPet.serverId) {
      const res = await apiFetch('/pets/' + targetPet.serverId + '/feeding-logs', {
        method: 'POST',
        body: JSON.stringify({
          food: meal.food,
          amount: '',
          notes: meal.notes || '',
          meal_plan_id: meal.serverId || null,
          completion_day: day,
          actor: state.user.name || 'Владелец'
        })
      });
      if (res?.id) serverLogId = res.id;
    }
    state.feedingLogs.unshift({
      id: serverLogId ? 'sfl_' + serverLogId : uid(),
      serverId: serverLogId,
      petId: targetPet.id,
      food: meal.food,
      amount: '',
      at: stamp.toISOString(),
      actor: state.user.name || 'Владелец',
      notes: meal.notes,
      mealPlanId: meal.id,
      completionDay: day
    });
  }
  render();
  showCopiedToast('Кормление отмечено: ' + meal.food);
}

function showPushBanner(title, body, opts = {}) {
  const stack = $('push-banner-stack');
  if (!stack) return;

  // Avoid duplicate banner with same tag
  if (opts.tag) {
    const existing = stack.querySelector('[data-push-tag="' + CSS.escape(opts.tag) + '"]');
    if (existing) existing.remove();
  }

  const targetPet = opts.petId ? state.pets.find(x => String(x.id) === String(opts.petId)) : pet();
  const avatarHtml = targetPet
    ? '<div class="push-banner-avatar" aria-hidden="true">' + petAvatar(targetPet) + '</div>'
    : '<div class="push-banner-avatar is-icon" aria-hidden="true"><svg><use href="#paw"/></svg></div>';

  const badgeText = opts.badge || (opts.mealId ? 'Питание по расписанию' : opts.eventId ? 'Время события' : 'Уведомление PetCare');
  const timeClock = opts.timeLabel || (mskNow().slice(11, 16) + ' МСК');
  const durationMs = opts.duration || (opts.eventId || opts.mealId ? 24000 : 9000);
  const targetPage = opts.page || 'care';

  let actionsHtml = '';
  if (opts.eventId) {
    actionsHtml =
      '<button type="button" class="push-banner-btn primary" data-push-complete>✓ Выполнено</button>' +
      '<button type="button" class="push-banner-btn" data-push-snooze>⏰ +10 мин</button>' +
      '<button type="button" class="push-banner-btn ghost" data-push-open>К расписанию</button>';
  } else if (opts.mealId) {
    actionsHtml =
      '<button type="button" class="push-banner-btn primary" data-push-meal-done>✓ Покормили</button>' +
      '<button type="button" class="push-banner-btn" data-push-open>Открыть питание</button>';
  } else {
    actionsHtml =
      '<button type="button" class="push-banner-btn primary" data-push-open>' + esc(opts.actionLabel || 'Открыть расписание') + '</button>' +
      '<button type="button" class="push-banner-btn ghost" data-push-dismiss>Понятно</button>';
  }

  const card = document.createElement('div');
  card.className = 'push-banner';
  if (opts.tag) card.dataset.pushTag = opts.tag;
  card.innerHTML =
    avatarHtml +
    '<div class="push-banner-body">' +
      '<div class="push-banner-meta">' +
        '<span class="push-banner-pill">' + esc(badgeText) + '</span>' +
        '<span class="push-banner-time">' + esc(timeClock) + '</span>' +
      '</div>' +
      '<strong class="push-banner-title">' + esc(title) + '</strong>' +
      '<p class="push-banner-text">' + esc(body) + '</p>' +
      '<div class="push-banner-actions">' + actionsHtml + '</div>' +
    '</div>' +
    '<button type="button" class="push-banner-close" aria-label="Закрыть уведомление">×</button>' +
    '<div class="push-banner-progress"><span style="animation-duration:' + durationMs + 'ms"></span></div>';

  let timerId = null;
  const removeCard = () => {
    clearTimeout(timerId);
    if (card.parentNode) card.parentNode.removeChild(card);
  };
  let remaining = durationMs;
  let startedAt = Date.now();
  const startTimer = () => {
    startedAt = Date.now();
    clearTimeout(timerId);
    timerId = setTimeout(removeCard, remaining);
  };
  card.addEventListener('mouseenter', () => {
    clearTimeout(timerId);
    remaining = Math.max(2500, remaining - (Date.now() - startedAt));
  });
  card.addEventListener('mouseleave', startTimer);

  card.querySelector('.push-banner-close').onclick = removeCard;
  const dismissBtn = card.querySelector('[data-push-dismiss]');
  if (dismissBtn) dismissBtn.onclick = removeCard;

  const openBtn = card.querySelector('[data-push-open]');
  if (openBtn) {
    openBtn.onclick = () => {
      if (targetPet) setPetContext(targetPet.id);
      show(targetPage);
      removeCard();
    };
  }

  const completeBtn = card.querySelector('[data-push-complete]');
  if (completeBtn) {
    completeBtn.onclick = async () => {
      completeBtn.disabled = true;
      await eventAction(opts.eventId, 'complete');
      removeCard();
    };
  }

  const snoozeBtn = card.querySelector('[data-push-snooze]');
  if (snoozeBtn) {
    snoozeBtn.onclick = async () => {
      snoozeBtn.disabled = true;
      await snoozeReminderFromPush(opts.eventId, 10);
      removeCard();
    };
  }

  const mealDoneBtn = card.querySelector('[data-push-meal-done]');
  if (mealDoneBtn) {
    mealDoneBtn.onclick = async () => {
      mealDoneBtn.disabled = true;
      await completeMealFromPush(opts.mealId);
      removeCard();
    };
  }

  stack.prepend(card);
  while (stack.children.length > 3) {
    stack.lastElementChild.remove();
  }
  startTimer();
}

async function dispatchPushNotification(title, body, opts = {}) {
  playPushChime();
  showPushBanner(title, body, opts);

  if (document.hidden) {
    const origTitle = 'PetCare — забота о питомцах';
    document.title = '🔔 ' + title + ' — PetCare';
    const restoreTitle = () => {
      if (!document.hidden) {
        document.title = origTitle;
        document.removeEventListener('visibilitychange', restoreTitle);
      }
    };
    document.addEventListener('visibilitychange', restoreTitle);
  }

  if (!window.petcareServerPush && 'Notification' in window && Notification.permission === 'granted') {
    const notifOptions = {
      body,
      icon: PUSH_ICON_DATA_URI,
      badge: PUSH_ICON_DATA_URI,
      tag: opts.tag || ('petcare-' + Date.now()),
      requireInteraction: Boolean(opts.eventId || opts.mealId),
      silent: isQuietHoursActive()
    };
    let sentNative = false;
    try {
      const n = new Notification(title, notifOptions);
      sentNative = true;
      n.onclick = () => {
        window.focus();
        if (opts.petId) setPetContext(opts.petId);
        if (opts.page) show(opts.page);
        n.close();
      };
    } catch {}
    if (!sentNative) {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg?.showNotification) {
          await reg.showNotification(title, notifOptions);
        }
      } catch {}
    }
  }
}

function updatePushStatusUI() {
  const active = Boolean(state.settings.pushEnabled);
  const btn = $('enable-alerts');
  const badge = $('push-status-badge');
  if (btn) {
    btn.textContent = active ? 'Отключить пуш-уведомления' : '🔔 Включить пуш-уведомления';
    btn.classList.toggle('primary', !active);
  }
  if (badge) {
    badge.textContent = active ? '🔔 Пуш-уведомления активны' : 'Уведомления выключены';
    badge.classList.toggle('off', !active);
  }
}

async function requestBrowserNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    const res = Notification.requestPermission();
    if (res && typeof res.then === 'function') return await res;
    return Notification.permission;
  } catch {
    return Notification.permission || 'default';
  }
}

async function togglePushNotifications() {
  unlockPushAudio();
  if (state.settings.pushEnabled) {
    state.settings.pushEnabled = false;
    savePushSettings().catch(()=>{});
    updatePushStatusUI();
    renderProfile();
    showCopiedToast('Пуш-уведомления отключены');
    return;
  }

  await requestBrowserNotificationPermission();
  state.settings.pushEnabled = true;
  savePushSettings().catch(()=>{});
  updatePushStatusUI();
  renderProfile();
  scheduleNextExactPush();

  const p = pet();
  const nowMs = Date.now();
  const nextEv = p
    ? state.events.filter(e => isForPet(e, p) && e.status === 'pending' && mskMoment(e.at).getTime() >= nowMs - 60000).sort((a, b) => mskMoment(a.at) - mskMoment(b.at))[0]
    : null;
  const subText = nextEv
    ? (p.name + ' · следующее напоминание «' + nextEv.title + '» придёт точно в ' + mskLabel(nextEv.at) + ' МСК')
    : ('Уведомления придут ровно в назначенное время процедур и кормлений' + (p ? ' для ' + p.name : '') + '.');

  await dispatchPushNotification(
    'Пуш-уведомления включены',
    subText,
    { badge: '🔔 Канал уведомлений активен', page: 'care', actionLabel: 'К расписанию', petId: p?.id, duration: 7000 }
  );
}

async function triggerTestPushNotification() {
  unlockPushAudio();
  if (!state.settings.pushEnabled) {
    await togglePushNotifications();
    return;
  }
  await requestBrowserNotificationPermission();
  const p = pet();
  const nowMs = Date.now();
  const upcomingEvents = p
    ? state.events.filter(e => isForPet(e, p) && e.status === 'pending').sort((a, b) => Math.abs(mskMoment(a.at) - nowMs) - Math.abs(mskMoment(b.at) - nowMs))
    : [];
  const plans = p ? dailyMealsForPet(p.id) : [];

  if (upcomingEvents.length > 0) {
    const ev = upcomingEvents[0];
    await dispatchPushNotification(
      ev.title,
      (p ? p.name + ' · ' : '') + (ev.type || 'Процедура') + ' · назначено на ' + mskLabel(ev.at) + ' МСК',
      {
        badge: '🔔 Тест пуш-уведомления',
        timeLabel: mskLabel(ev.at) + ' МСК',
        page: 'care',
        petId: p?.id,
        eventId: ev.id,
        tag: 'test_push_' + Date.now()
      }
    );
    return;
  }

  if (plans.length > 0) {
    const meal = plans[0];
    await dispatchPushNotification(
      meal.food,
      (p ? p.name + ' · ' : '') + 'Ежедневное кормление в ' + mealTimeLabel(meal),
      {
        badge: '🔔 Тест пуш-уведомления',
        timeLabel: mealTimeLabel(meal) + ' МСК',
        page: 'nutrition',
        petId: p?.id,
        mealId: meal.id,
        tag: 'test_push_' + Date.now()
      }
    );
    return;
  }

  await dispatchPushNotification(
    'Проверка пуш-уведомлений',
    (p ? 'Кабинет ' + p.name + ': ' : '') + 'Уведомления работают и придут ровно в назначенное время.',
    {
      badge: '🔔 Тест пуш-уведомления',
      page: 'care',
      actionLabel: 'К расписанию',
      petId: p?.id,
      tag: 'test_push_' + Date.now()
    }
  );
}

// Seed already-past events on initial load so historical demo items don't fire or block new ones
function seedInitialPastNotifications() {
  if (initialPushSeedDone) return;
  initialPushSeedDone = true;
  const nowMs = Date.now();
  const currentMskDay = mskDay();
  const currentClock = mskNow().slice(11, 16);

  for (const ev of state.events) {
    if (ev.status !== 'pending') continue;
    const targetMs = mskMoment(ev.at).getTime();
    // If scheduled before the current minute, mark as already past before session started
    if (targetMs < nowMs - 59000) {
      notifiedPushKeys.add('rem_due_' + (ev.serverId || ev.id) + '_' + ev.at);
    }
  }
  for (const meal of state.mealPlans) {
    if (meal.time && meal.time < currentClock) {
      notifiedPushKeys.add('meal_due_' + (meal.serverId || meal.id) + '_' + currentMskDay + '_' + meal.time);
    }
    if (meal.endTime && meal.endTime < currentClock) {
      notifiedPushKeys.add('meal_end_' + (meal.serverId || meal.id) + '_' + currentMskDay + '_' + meal.endTime);
    }
  }
}

function checkDuePushNotifications() {
  if (!state.settings.pushEnabled || isQuietHoursActive()) return;
  const now = new Date();
  const nowMs = now.getTime();
  const allowedTypes = state.settings.types || [];
  const currentMskDay = mskDay(now);
  const currentClock = mskNow(now).slice(11, 16);

  // 1. Fire reminders strictly when their scheduled time arrives (nowMs >= targetMs)
  for (const ev of state.events) {
    if (ev.status !== 'pending') continue;
    if (allowedTypes.length && !allowedTypes.includes(ev.type || 'Процедура')) continue;
    const targetMs = mskMoment(ev.at).getTime();
    const diffMs = nowMs - targetMs;
    // Trigger as soon as the scheduled time has arrived (within a 30-minute window after due time)
    if (diffMs >= 0 && diffMs <= 30 * 60 * 1000) {
      const key = 'rem_due_' + (ev.serverId || ev.id) + '_' + ev.at;
      if (notifiedPushKeys.has(key)) continue;
      notifiedPushKeys.add(key);
      const targetPet = state.pets.find(x => String(x.id) === String(ev.petId));
      const clockStr = (ev.at.slice(11, 16) || currentClock) + ' МСК';
      dispatchPushNotification(
        ev.title,
        (targetPet ? targetPet.name + ' · ' : '') + (ev.type || 'Процедура') + ' по расписанию (' + mskLabel(ev.at) + ' МСК)',
        {
          badge: '⏰ Время события',
          timeLabel: clockStr,
          page: 'care',
          petId: targetPet?.id,
          eventId: ev.id,
          tag: key
        }
      );
    }
  }

  // 2. Fire daily meal plans at exact time (or at both start & end of interval if still not fed)
  if (!allowedTypes.length || allowedTypes.includes('Кормление')) {
    for (const meal of state.mealPlans) {
      if (meal.completedOn === currentMskDay) continue;
      if (!meal.time) continue;
      const targetPet = state.pets.find(x => String(x.id) === String(meal.petId));

      // 2a. Start of meal time / start of interval
      if (currentClock >= meal.time) {
        const key = 'meal_due_' + (meal.serverId || meal.id) + '_' + currentMskDay + '_' + meal.time;
        if (!notifiedPushKeys.has(key)) {
          notifiedPushKeys.add(key);
          const isRange = Boolean(meal.endTime);
          dispatchPushNotification(
            meal.food,
            (targetPet ? targetPet.name + ' · ' : '') +
              (isRange
                ? 'Начался интервал кормления (' + mealTimeLabel(meal) + ' МСК)'
                : 'Пора покормить питомца (' + mealTimeLabel(meal) + ' МСК)') +
              (meal.notes ? ' · ' + meal.notes : ''),
            {
              badge: isRange ? '🍽️ Начало интервала' : '🍽️ Время кормления',
              timeLabel: mealTimeLabel(meal) + ' МСК',
              page: 'nutrition',
              petId: targetPet?.id,
              mealId: meal.id,
              tag: key
            }
          );
        }
      }

      // 2b. End of interval reminder (only if meal has endTime and is still not marked completed)
      if (meal.endTime && currentClock >= meal.endTime) {
        const endKey = 'meal_end_' + (meal.serverId || meal.id) + '_' + currentMskDay + '_' + meal.endTime;
        if (!notifiedPushKeys.has(endKey)) {
          notifiedPushKeys.add(endKey);
          dispatchPushNotification(
            meal.food,
            (targetPet ? targetPet.name + ' · ' : '') +
              'Завершается интервал кормления (' + mealTimeLabel(meal) + ' МСК) — не забудьте покормить питомца' +
              (meal.notes ? ' · ' + meal.notes : ''),
            {
              badge: '⏰ Конец интервала кормления',
              timeLabel: meal.endTime + ' МСК',
              page: 'nutrition',
              petId: targetPet?.id,
              mealId: meal.id,
              tag: endKey
            }
          );
        }
      }
    }
  }
}

function scheduleNextExactPush() {
  clearTimeout(exactPushTimerId);
  if (!state.settings.pushEnabled) return;
  const nowMs = Date.now();
  let nearestDelayMs = Infinity;

  // Check upcoming reminders
  for (const ev of state.events) {
    if (ev.status !== 'pending') continue;
    const key = 'rem_due_' + (ev.serverId || ev.id) + '_' + ev.at;
    if (notifiedPushKeys.has(key)) continue;
    const targetMs = mskMoment(ev.at).getTime();
    const delay = targetMs - nowMs;
    if (delay <= 0 && delay >= -60000) {
      nearestDelayMs = 50;
      break;
    }
    if (delay > 0 && delay < nearestDelayMs) {
      nearestDelayMs = delay;
    }
  }

  // Check upcoming daily meals today (both start time and end of interval)
  const currentMskDay = mskDay();
  for (const meal of state.mealPlans) {
    if (meal.completedOn === currentMskDay || !meal.time) continue;
    const startKey = 'meal_due_' + (meal.serverId || meal.id) + '_' + currentMskDay + '_' + meal.time;
    if (!notifiedPushKeys.has(startKey)) {
      const mealTargetMs = mskMoment(currentMskDay + 'T' + meal.time + ':00+03:00').getTime();
      const delay = mealTargetMs - nowMs;
      if (delay <= 0 && delay >= -60000) {
        nearestDelayMs = 50;
        break;
      }
      if (delay > 0 && delay < nearestDelayMs) {
        nearestDelayMs = delay;
      }
    }
    if (meal.endTime) {
      const endKey = 'meal_end_' + (meal.serverId || meal.id) + '_' + currentMskDay + '_' + meal.endTime;
      if (!notifiedPushKeys.has(endKey)) {
        const endTargetMs = mskMoment(currentMskDay + 'T' + meal.endTime + ':00+03:00').getTime();
        const delay = endTargetMs - nowMs;
        if (delay <= 0 && delay >= -60000) {
          nearestDelayMs = 50;
          break;
        }
        if (delay > 0 && delay < nearestDelayMs) {
          nearestDelayMs = delay;
        }
      }
    }
  }

  if (nearestDelayMs < Infinity && nearestDelayMs <= 2147483000) {
    exactPushTimerId = setTimeout(() => {
      checkDuePushNotifications();
      scheduleNextExactPush();
    }, Math.max(50, nearestDelayMs + 120));
  }
}

// Start a lightweight Web Worker ticker so background tab throttling never delays due notifications
try {
  const workerBlob = new Blob([
    'setInterval(function(){ postMessage("tick"); }, 1000);'
  ], { type: 'application/javascript' });
  const pushWorker = new Worker(URL.createObjectURL(workerBlob));
  pushWorker.onmessage = () => checkDuePushNotifications();
} catch {
  setInterval(checkDuePushNotifications, 2000);
}

$('enable-alerts').onclick = () => togglePushNotifications();
if ($('test-push-btn')) $('test-push-btn').onclick = () => triggerTestPushNotification();
updatePushStatusUI();

function restoreRoute() {
  let parts;
  try { parts = location.hash.slice(1).split('/').filter(Boolean).map(decodeURIComponent); }
  catch { show('pets'); return; }
  if (parts[0] === 'pet' && state.pets.some(p => p.id === parts[1])) {
    if (state.selected !== parts[1] && !mayDiscardPetEdits()) { history.replaceState(null, '', routeHash(page)); return; }
    state.selected = parts[1];
    show(parts[2] || 'health', false);
  } else {
    show(parts[0] === 'profile' ? 'profile' : 'pets', false);
  }
}
window.addEventListener('hashchange', restoreRoute);

// Initial render + full backend sync
restoreRoute();
syncServerData().then(() => {
  seedInitialPastNotifications();
  updatePushStatusUI();
  scheduleNextExactPush();
});

// Transitional account/PWA handlers share the legacy session until their React migration.
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

if (window.__PETCARE_TEST__ === true) {
  Object.assign(window, { show, pet, renderNutrition, renderDocuments, syncServerData, openModal, openExtraModal });
  Object.defineProperties(window, {
    state: { get: () => state },
    careFilter: { get: () => careFilter, set: value => { careFilter = value; } },
    installPrompt: { get: () => installPrompt, set: value => { installPrompt = value; } },
  });
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-copy-pet-code]');
  if (button) window.copyPetCode(button.dataset.copyPetCode);
});
