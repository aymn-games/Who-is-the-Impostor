/* =====================================================================
   من الأمبوستر؟  —  منطق اللعبة
   =====================================================================
   المزامنة بين الأجهزة تعمل عبر Firebase Realtime Database (Modular SDK
   v12.15.0). لا يوجد خادم خاص باللعبة: "المرجع" الوحيد هو بيانات الغرفة
   في Firebase (rooms/{code}). كل مرحلة تُحفظ مع طوابع زمنية (مثل
   turnEndsAt) بتوقيت خادم Firebase، وكل الأجهزة تعرض العدّادات منها.
   عند انتهاء أي وقت، ينقل أي جهاز المرحلة التالية عبر transaction تتحقق
   من الشرط نفسه، فلا يتكرر الانتقال ولا تتوقف اللعبة لو خرج المضيف.

   بدون اتصال Firebase تعمل اللعبة في "وضع تجريبي محلي" على نفس المتصفح
   (localStorage + BroadcastChannel) — مفيد للتجربة فقط.
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, onValue, runTransaction, onDisconnect
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAQX0L9bi9uXyJ3Ys97L22DRtTkzQhr0yY",
  authDomain: "who-is-the-impostor-816c8.firebaseapp.com",
  databaseURL: "https://who-is-the-impostor-816c8-default-rtdb.firebaseio.com",
  projectId: "who-is-the-impostor-816c8",
  storageBucket: "who-is-the-impostor-816c8.firebasestorage.app",
  messagingSenderId: "976033887666",
  appId: "1:976033887666:web:a6f4910ff5014447c520ab",
  measurementId: "G-KWTW65DT6B"
};

/* ---------------------------------------------------------------------
   0) شاشة الدخول السينمائية — تأثير بصري بحت لمدة 3 ثوانٍ.
--------------------------------------------------------------------- */
(function runIntroSplash(){
  const introEl = document.getElementById("intro-splash");
  if(!introEl) return;
  setTimeout(() => {
    introEl.classList.add("intro-fade-out");
    setTimeout(() => { introEl.remove(); }, 900);
  }, 3000);
})();

let db = null;
let usingFirebase = false;

function initFirebase(){
  try{
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    return true;
  } catch(err){
    console.warn("تعذّر تهيئة Firebase، سيتم استخدام الوضع المحلي:", err);
    return false;
  }
}

usingFirebase = initFirebase();

/* توقيت موحّد لكل الأجهزة: نستخدم فرق التوقيت الذي يرسله Firebase حتى
   تتطابق العدّادات حتى لو كانت ساعة أحد الأجهزة غير مضبوطة. */
let serverOffset = 0;
if(usingFirebase){
  try{
    onValue(ref(db, ".info/serverTimeOffset"), (snap) => { serverOffset = Number(snap.val()) || 0; });
  } catch(e){ /* نكتفي بساعة الجهاز */ }
}
const now = () => Date.now() + serverOffset;

(function showSetupBannerIfNeeded(){
  const banner = document.getElementById("setup-banner");
  const guide = document.getElementById("setup-guide");
  if(!usingFirebase){
    if(banner) banner.classList.remove("hidden");
    if(guide) guide.setAttribute("open", "");
  }
})();

/* ---------------------------------------------------------------------
   1.ب) الوضع المحلي: تخزين/مزامنة عبر localStorage + BroadcastChannel
--------------------------------------------------------------------- */
const LOCAL_PREFIX = "imp_room_";
const localListeners = {}; // code -> [callback, ...]
const localChannel = ("BroadcastChannel" in window) ? new BroadcastChannel("impostor_local_sync") : null;

function readLocalRoom(code){
  try{
    const raw = localStorage.getItem(LOCAL_PREFIX + code);
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}

function writeLocalRoom(code, data){
  try{
    if(data === null){
      localStorage.removeItem(LOCAL_PREFIX + code);
    } else {
      localStorage.setItem(LOCAL_PREFIX + code, JSON.stringify(data));
    }
  } catch(e){ console.warn("تعذر الكتابة إلى التخزين المحلي", e); }
  notifyLocalListeners(code);
  if(localChannel) localChannel.postMessage({ code });
}

function notifyLocalListeners(code){
  (localListeners[code] || []).forEach(cb => cb(readLocalRoom(code)));
}

if(localChannel){
  localChannel.onmessage = (e) => {
    if(e.data && e.data.code) notifyLocalListeners(e.data.code);
  };
}
window.addEventListener("storage", (e) => {
  if(e.key && e.key.startsWith(LOCAL_PREFIX)){
    notifyLocalListeners(e.key.slice(LOCAL_PREFIX.length));
  }
});

/* ---------------------------------------------------------------------
   1.ج) طبقة "Backend" موحّدة: نفس الواجهة سواء استخدمنا Firebase أو المحلي
--------------------------------------------------------------------- */
const Backend = {
  async getRoom(code){
    if(usingFirebase){
      const snap = await get(ref(db, `rooms/${code}`));
      return snap.exists() ? snap.val() : null;
    }
    return readLocalRoom(code);
  },

  async createRoom(code, data){
    if(usingFirebase) return set(ref(db, `rooms/${code}`), data);
    writeLocalRoom(code, data);
  },

  async setPlayer(code, playerId, data){
    if(usingFirebase) return set(ref(db, `rooms/${code}/players/${playerId}`), data);
    const cur = readLocalRoom(code);
    if(!cur) return;
    cur.players = cur.players || {};
    cur.players[playerId] = data;
    writeLocalRoom(code, cur);
  },

  async updateRoom(code, patch){
    if(usingFirebase) return update(ref(db, `rooms/${code}`), patch);
    const cur = readLocalRoom(code) || {};
    writeLocalRoom(code, Object.assign({}, cur, patch));
  },

  async setVote(code, playerId, targetId){
    if(usingFirebase) return set(ref(db, `rooms/${code}/votes/${playerId}`), targetId);
    const cur = readLocalRoom(code);
    if(!cur) return;
    cur.votes = cur.votes || {};
    cur.votes[playerId] = targetId;
    writeLocalRoom(code, cur);
  },

  /** استمع لأي تغيير في الغرفة. يعيد دالة لإلغاء الاشتراك. */
  subscribe(code, callback){
    if(usingFirebase){
      const roomRef = ref(db, `rooms/${code}`);
      const unsubscribe = onValue(roomRef, (snap) => callback(snap.exists() ? snap.val() : null));
      return unsubscribe; // onValue في الحزمة المعيارية تعيد دالة إلغاء الاشتراك مباشرة
    }
    localListeners[code] = localListeners[code] || [];
    localListeners[code].push(callback);
    callback(readLocalRoom(code));
    return () => {
      localListeners[code] = (localListeners[code] || []).filter(cb => cb !== callback);
    };
  },

  /** تحديث ذرّي آمن (يمنع تعارض تعديلين متزامنين على نفس الغرفة). */
  async transaction(code, updateFn){
    if(usingFirebase){
      return runTransaction(ref(db, `rooms/${code}`), updateFn);
    }
    const cur = readLocalRoom(code);
    const copy = cur ? JSON.parse(JSON.stringify(cur)) : cur;
    const result = updateFn(copy);
    if(result === undefined) return; // ألغِ العملية (سلوك مطابق لمعاملات Firebase)
    writeLocalRoom(code, result);
  },

  /** إشارة الحضور: تعليم اللاعب "غير متصل" تلقائيًا عند إغلاق التبويب. */
  setupPresence(code, playerId){
    if(usingFirebase){
      onDisconnect(ref(db, `rooms/${code}/players/${playerId}/connected`)).set(false);
      return;
    }
    const markOffline = () => {
      const cur = readLocalRoom(code);
      if(cur && cur.players && cur.players[playerId]){
        cur.players[playerId].connected = false;
        writeLocalRoom(code, cur);
      }
    };
    window.addEventListener("pagehide", markOffline);
    window.addEventListener("beforeunload", markOffline);
  },

  async setConnected(code, playerId, value){
    if(usingFirebase) return set(ref(db, `rooms/${code}/players/${playerId}/connected`), value).catch(() => {});
    const cur = readLocalRoom(code);
    if(cur && cur.players && cur.players[playerId]){
      cur.players[playerId].connected = value;
      writeLocalRoom(code, cur);
    }
  },

  /* -------------------------------------------------------------
     وضع "شاشة عرض للبث" (مشاهد): نفس فكرة setPlayer/setupPresence
     لكن تحت مسار rooms/{code}/spectators بدل players، حتى لا يُحتسب
     المشاهد ضمن اللاعبين (لا يشارك في التصويت أو يحصل على دور).
  ------------------------------------------------------------- */
  async setSpectator(code, spectatorId, data){
    if(usingFirebase) return set(ref(db, `rooms/${code}/spectators/${spectatorId}`), data);
    const cur = readLocalRoom(code);
    if(!cur) return;
    cur.spectators = cur.spectators || {};
    cur.spectators[spectatorId] = data;
    writeLocalRoom(code, cur);
  },

  setupSpectatorPresence(code, spectatorId){
    if(usingFirebase){
      onDisconnect(ref(db, `rooms/${code}/spectators/${spectatorId}/connected`)).set(false);
      return;
    }
    const markOffline = () => {
      const cur = readLocalRoom(code);
      if(cur && cur.spectators && cur.spectators[spectatorId]){
        cur.spectators[spectatorId].connected = false;
        writeLocalRoom(code, cur);
      }
    };
    window.addEventListener("pagehide", markOffline);
    window.addEventListener("beforeunload", markOffline);
  },

  async setSpectatorConnected(code, spectatorId, value){
    if(usingFirebase) return set(ref(db, `rooms/${code}/spectators/${spectatorId}/connected`), value).catch(() => {});
    const cur = readLocalRoom(code);
    if(cur && cur.spectators && cur.spectators[spectatorId]){
      cur.spectators[spectatorId].connected = value;
      writeLocalRoom(code, cur);
    }
  }
};

/* ---------------------------------------------------------------------
   2) حالة الجلسة الحالية (متصفح/تبويب واحد = لاعب واحد)
--------------------------------------------------------------------- */
const state = {
  roomCode: sessionStorage.getItem("imp_roomCode") || null,
  playerId: sessionStorage.getItem("imp_playerId") || null,
  playerName: sessionStorage.getItem("imp_playerName") || null,
  isHost: false,
  isSpectator: sessionStorage.getItem("imp_isSpectator") === "1",
  unsubscribe: null,
  roomData: null
};

function persistSession(){
  sessionStorage.setItem("imp_roomCode", state.roomCode || "");
  sessionStorage.setItem("imp_playerId", state.playerId || "");
  sessionStorage.setItem("imp_playerName", state.playerName || "");
  sessionStorage.setItem("imp_isSpectator", state.isSpectator ? "1" : "");
}

function ensurePlayerId(){
  if(!state.playerId){
    state.playerId = "p_" + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
  }
  return state.playerId;
}

/* ---------------------------------------------------------------------
   3) أدوات مساعدة عامة
--------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function showScreen(id){
  $all(".screen").forEach(s => s.classList.toggle("active", s.id === id));
}

function toast(msg, ms = 2600){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

function escapeHtml(str){
  return String(str == null ? "" : str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

/** يولّد رمز غرفة عشوائيًا من 5 أرقام، مثل 57392 */
function randomRoomCode(){
  return String(Math.floor(10000 + Math.random() * 90000));
}

/* إعدادات الغرفة (تُحفظ في room.settings) */
const DEFAULT_SETTINGS = { hintRounds: 3, hintTime: 15, gameRounds: 5 };

function getRoomSettings(room){
  return Object.assign({}, DEFAULT_SETTINGS, (room && room.settings) || {});
}

function hintsLabel(hintRounds){
  return hintRounds === 2 ? "تلميحان" : "3 تلميحات";
}

function shuffleArray(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function pickOne(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

function initialsOf(name){
  return (name || "؟").trim().slice(0,1).toUpperCase();
}

/** توحيد النص العربي للمقارنة: حذف التشكيل والتطويل، أإآ→ا، ة→ه، ى→ي،
 *  وحذف "ال" في البداية. */
function normalizeArabic(t){
  return String(t || "").trim()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/^ال/, "").replace(/\s+/g, " ");
}

/** النقاط قد تكون أنصافًا: نعرض رقمًا عشريًا واحدًا فقط عند الحاجة */
function fmtPts(n){
  n = Number(n) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const AVATAR_COLORS = ["#7c5cff", "#2dd4bf", "#f0c048", "#e879c9", "#5b8cff", "#f97373"];

function playerColor(room, id){
  const p = (room && room.players && room.players[id]) || {};
  if(Number.isInteger(p.colorIdx)) return AVATAR_COLORS[p.colorIdx % AVATAR_COLORS.length];
  let h = 0;
  for(const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function playerName(room, id){
  const p = room && room.players && room.players[id];
  if(p) return p.name;
  const g = room && room.g;
  return (g && g.names && g.names[id]) || "؟";
}

/** اسم اللاعب كما يظهر في المباراة: "(أنت)" بجانب اسم المستخدم الحالي */
function playerLabel(room, id){
  const n = playerName(room, id);
  return id === state.playerId ? `${n} (أنت)` : n;
}

function avatarHtml(room, id, cls = ""){
  return `<div class="avatar ${cls}" style="background:${playerColor(room, id)}">${escapeHtml(initialsOf(playerName(room, id)))}</div>`;
}

/** لاعبو الغرفة مرتّبون حسب وقت الانضمام */
function sortedPlayerIds(room){
  const players = (room && room.players) || {};
  return Object.keys(players).sort((a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0));
}

/* ---------------------------------------------------------------------
   4) الأصوات — مولَّدة بالكامل عبر Web Audio API (بدون ملفات صوتية)،
   نفس sfx() في ملف التصميم. يُفعَّل الصوت عند أول لمسة/نقرة (سياسة
   المتصفحات)، وخيار الكتم محفوظ على الجهاز.
--------------------------------------------------------------------- */
const Sound = {
  ac: null,
  muted: (() => { try{ return localStorage.getItem("imp_muted") === "1"; } catch(e){ return false; } })(),
  audio(){
    if(!this.ac){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      this.ac = new AC();
    }
    if(this.ac.state === "suspended") this.ac.resume();
    return this.ac;
  },
  setMuted(v){
    this.muted = v;
    try{ localStorage.setItem("imp_muted", v ? "1" : "0"); } catch(e){}
  },
  tone(freq, dur, o = {}){
    if(this.muted) return;
    const ac = this.audio(); if(!ac) return;
    const t = ac.currentTime + (o.delay || 0), osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || "sine"; osc.frequency.setValueAtTime(freq, t);
    if(o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || .12, t + .015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ac.destination); osc.start(t); osc.stop(t + dur + .05);
  },
  noise(dur, o = {}){
    if(this.muted) return;
    const ac = this.audio(); if(!ac) return;
    const t = ac.currentTime + (o.delay || 0), len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = "bandpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(o.from || 400, t); f.frequency.exponentialRampToValueAtTime(o.to || 3000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || .15, t + dur * .35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ac.destination); src.start(t); src.stop(t + dur);
  },
  sfx(n){
    if(this.muted) return;
    const T = (f, d, o) => this.tone(f, d, o);
    const fx = {
      whoosh: () => this.noise(.8, { from: 250, to: 3200, vol: .2 }),
      tick: () => { T(660, .12, { type: "triangle", vol: .14 }); T(1320, .06, { type: "sine", vol: .05 }); },
      go: () => [523, 659, 784, 1047].forEach((f, i) => T(f, .6, { type: "triangle", vol: .12, delay: i * .07 })),
      flip: () => this.noise(.35, { from: 2400, to: 500, vol: .16 }),
      citizen: () => [659, 831, 988, 1319].forEach((f, i) => T(f, 1, { vol: .1, delay: i * .11 })),
      impostor: () => { T(98, 1.6, { type: "sawtooth", vol: .07, slide: 73 }); T(233, 1.3, { type: "triangle", vol: .08, delay: .12, slide: 196 }); T(147, 1.3, { type: "sine", vol: .1, delay: .12 }); },
      turn: () => { T(784, .18, { type: "triangle", vol: .1 }); T(1047, .32, { type: "triangle", vol: .1, delay: .12 }); },
      myTurn: () => [784, 988, 1319].forEach((f, i) => T(f, .35, { type: "triangle", vol: .14, delay: i * .1 })),
      warn: () => T(1250, .07, { type: "square", vol: .035 }),
      send: () => T(520, .18, { vol: .16, slide: 1400 }),
      skip: () => T(320, .4, { type: "sawtooth", vol: .06, slide: 140 }),
      final: () => { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => T(f, .7, { type: "triangle", vol: .12, delay: i * .09 })); [523, 659, 784].forEach(f => T(f, 1.8, { vol: .07, delay: .6 })); },
      vote: () => T(700, .08, { type: "triangle", vol: .08 }),
      drum: () => { this.noise(.07, { from: 120, to: 300, vol: .35 }); T(80, .08, { vol: .12 }); },
      caught: () => [523, 659, 784, 1047, 1319].forEach((f, i) => T(f, .5, { type: "triangle", vol: .13, delay: i * .08 })),
      escaped: () => { T(110, 1.6, { type: "sawtooth", vol: .07, slide: 65 }); T(165, 1.4, { vol: .1, delay: .1 }); this.noise(1.2, { from: 3000, to: 200, vol: .08 }); },
      impWin: () => { T(147, 1.2, { type: "sawtooth", vol: .07, slide: 294 }); [587, 740, 880].forEach((f, i) => T(f, .6, { type: "triangle", vol: .1, delay: .3 + i * .1 })); },
      citWin: () => [659, 784, 988, 1319].forEach((f, i) => T(f, .5, { type: "triangle", vol: .12, delay: i * .09 })),
      end: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => T(f, .45, { type: "triangle", vol: .12, delay: i * .12 }))
    };
    try{ fx[n] && fx[n](); } catch(e){ /* الصوت ليس ضروريًا للعب */ }
  }
};

// فتح سياق الصوت عند أول تفاعل من المستخدم
["pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, () => { if(!Sound.muted) Sound.audio(); }, { once: true, passive: true }));

/* ---------------------------------------------------------------------
   5) النوافذ المنبثقة: حبس التركيز داخل النافذة، Esc يغلقها، الضغط
   خارجها يغلقها، ويعود التركيز للزر الذي فتحها.
--------------------------------------------------------------------- */
const Modal = {
  stack: [],
  open(el, trigger){
    if(!el || !el.classList.contains("hidden")) return;
    el.classList.remove("hidden");
    this.stack.push({ el, trigger: trigger || document.activeElement });
    document.body.classList.add("modal-open");
    const first = el.querySelector("[data-autofocus]") || this.focusables(el)[0];
    if(first) first.focus();
  },
  close(el){
    const i = this.stack.findIndex(m => m.el === el);
    if(i === -1) return;
    const [{ trigger }] = this.stack.splice(i, 1);
    el.classList.add("hidden");
    if(!this.stack.length) document.body.classList.remove("modal-open");
    if(trigger && document.contains(trigger) && typeof trigger.focus === "function") trigger.focus();
  },
  top(){ return this.stack.length ? this.stack[this.stack.length - 1].el : null; },
  focusables(el){
    return Array.from(el.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])"))
      .filter(x => !x.disabled && x.offsetParent !== null);
  }
};

document.addEventListener("keydown", (e) => {
  const top = Modal.top();
  if(!top) return;
  if(e.key === "Escape"){ e.preventDefault(); Modal.close(top); return; }
  if(e.key === "Tab"){
    const f = Modal.focusables(top);
    if(!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    else if(!top.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
  }
});

function setupModal(modalSel){
  const el = $(modalSel);
  el.addEventListener("click", (e) => {
    if(e.target === el || e.target.closest("[data-close]")) Modal.close(el);
  });
  return el;
}

const rulesModal = setupModal("#rules-modal");
$("#btn-rules").addEventListener("click", (e) => Modal.open(rulesModal, e.currentTarget));

/* ---------------------------------------------------------------------
   6) الشاشة الرئيسية: إنشاء / انضمام / شارك كلاعب / شاشة عرض للبث
--------------------------------------------------------------------- */
(function prefillJoinFromURL(){
  const roomParam = new URLSearchParams(location.search).get("room");
  if(!roomParam) return;
  const joinCodeInput = $("#join-code");
  if(joinCodeInput) joinCodeInput.value = roomParam.replace(/\D/g, "").slice(0, 5);
})();

function updateShareHint(){
  const code = $("#join-code").value;
  $("#share-hint").textContent = code
    ? `ستنضم مباشرة إلى الغرفة ${code}`
    : "اختصار سريع: يُنشئ غرفة جديدة إن تُرك رمز الغرفة فارغًا، أو ينضم مباشرة إن كُتب رمز غرفة قائمة";
}
$("#join-code").addEventListener("input", (e) => {
  const clean = e.target.value.replace(/\D/g, "").slice(0, 5);
  if(e.target.value !== clean) e.target.value = clean;
  updateShareHint();
});
updateShareHint();

function requireHomeName(){
  const name = $("#home-name").value.trim();
  if(!name){ $("#home-error").textContent = "الرجاء إدخال اسمك"; $("#home-name").focus(); return null; }
  return name;
}

function readJoinCode(){
  return $("#join-code").value.trim().replace(/\D/g, "");
}

/** إنشاء غرفة جديدة والانضمام إليها كلاعب فعلي (مضيف). */
async function createRoomAsPlayer(name, settings = DEFAULT_SETTINGS){
  let code, existing, attempts = 0;
  do{
    code = randomRoomCode();
    existing = await Backend.getRoom(code);
    attempts++;
  } while(existing && attempts < 20);

  ensurePlayerId();
  state.playerName = name;
  state.roomCode = code;
  state.isHost = true;
  state.isSpectator = false;
  persistSession();

  await Backend.createRoom(code, {
    hostId: state.playerId,
    status: "lobby",
    createdAt: now(),
    settings: Object.assign({}, DEFAULT_SETTINGS, settings),
    players: {
      [state.playerId]: { name, connected: true, joinedAt: now(), colorIdx: 0 }
    }
  });

  Backend.setupPresence(code, state.playerId);
  attachRoomListener();
}

/** الانضمام إلى غرفة قائمة كلاعب فعلي عبر رمز الغرفة. */
async function joinRoomAsPlayer(name, code){
  const room = await Backend.getRoom(code);
  if(!room){
    $("#home-error").textContent = usingFirebase
      ? "لا توجد غرفة بهذا الرمز. تأكد من الرمز مع المضيف."
      : "لا توجد غرفة بهذا الرمز على هذا الجهاز. في الوضع التجريبي المحلي (بدون Firebase)، يجب فتح الغرفة من نفس المتصفح الذي أنشأها المضيف. راجع دليل الإعداد أعلى الصفحة لتفعيل اللعب بين أجهزة مختلفة.";
    return false;
  }
  ensurePlayerId();
  if(room.kicked && room.kicked[state.playerId]){
    $("#home-error").textContent = "تمت إزالتك من هذه الغرفة";
    return false;
  }
  const alreadyIn = !!(room.players && room.players[state.playerId]);
  if(room.status !== "lobby" && !alreadyIn){
    $("#home-error").textContent = "اللعبة بدأت بالفعل في هذه الغرفة";
    return false;
  }

  state.playerName = name;
  state.roomCode = code;
  state.isHost = (room.hostId === state.playerId);
  state.isSpectator = false;
  persistSession();

  const existing = (room.players && room.players[state.playerId]) || {};
  await Backend.setPlayer(code, state.playerId, {
    name, connected: true,
    joinedAt: existing.joinedAt || now(),
    colorIdx: Number.isInteger(existing.colorIdx) ? existing.colorIdx : Object.keys(room.players || {}).length
  });

  Backend.setupPresence(code, state.playerId);
  attachRoomListener();
  return true;
}

/** الدخول إلى غرفة قائمة كمشاهد فقط ("شاشة عرض للبث"). */
async function joinRoomAsSpectator(name, code){
  const room = await Backend.getRoom(code);
  if(!room){
    $("#home-error").textContent = usingFirebase
      ? "لا توجد غرفة بهذا الرمز. تأكد من الرمز مع المضيف."
      : "لا توجد غرفة بهذا الرمز على هذا الجهاز. في الوضع التجريبي المحلي (بدون Firebase)، يجب فتح الغرفة من نفس المتصفح الذي أنشأها المضيف.";
    return false;
  }

  ensurePlayerId();
  state.playerName = name;
  state.roomCode = code;
  state.isHost = false;
  state.isSpectator = true;
  persistSession();

  await Backend.setSpectator(code, state.playerId, { name, connected: true, joinedAt: now() });
  Backend.setupSpectatorPresence(code, state.playerId);
  attachRoomListener();
  return true;
}

async function withBusy(btn, fn, errMsg){
  btn.disabled = true;
  $("#home-error").textContent = "";
  try{ await fn(); }
  catch(err){ console.error(err); $("#home-error").textContent = errMsg; }
  finally{ btn.disabled = false; }
}

/** "إنشاء غرفة" يفتح نافذة إعدادات الغرفة أولًا */
$("#btn-create-room").addEventListener("click", () => {
  const name = requireHomeName();
  if(!name) return;
  $("#home-error").textContent = "";
  openRoomSettings("create", DEFAULT_SETTINGS, $("#btn-create-room"));
});

$("#btn-join-room").addEventListener("click", () => {
  const name = requireHomeName();
  if(!name) return;
  const code = readJoinCode();
  if(code.length !== 5){ $("#home-error").textContent = "الرجاء إدخال رمز الغرفة المكوّن من 5 أرقام"; $("#join-code").focus(); return; }
  withBusy($("#btn-join-room"), () => joinRoomAsPlayer(name, code), "تعذّر الانضمام إلى الغرفة");
});

/** "شارك كلاعب": يُنشئ غرفة إن كان الرمز فارغًا، أو ينضم مباشرة إن كُتب رمز */
$("#btn-share-player").addEventListener("click", () => {
  const name = requireHomeName();
  if(!name) return;
  const code = readJoinCode();
  withBusy($("#btn-share-player"), () => code ? joinRoomAsPlayer(name, code) : createRoomAsPlayer(name), "حدث خطأ غير متوقع. حاول مرة أخرى.");
});

$("#btn-broadcast-view").addEventListener("click", () => {
  const name = requireHomeName();
  if(!name) return;
  const code = readJoinCode();
  if(!code){ $("#home-error").textContent = "الرجاء إدخال رمز الغرفة للمشاهدة"; $("#join-code").focus(); return; }
  withBusy($("#btn-broadcast-view"), () => joinRoomAsSpectator(name, code), "تعذّر الدخول كمشاهد");
});

/* ---------------------------------------------------------------------
   7) نافذة إعدادات الغرفة — "create" قبل إنشاء غرفة، و"edit" للمضيف
   لتعديل إعدادات نفس الغرفة من غرفة الانتظار.
--------------------------------------------------------------------- */
const roomSettingsUI = { mode: "create", values: { ...DEFAULT_SETTINGS } };
const settingsModal = setupModal("#room-settings-modal");

function wordBankStats(){
  const W = window.AYMN_WORDS && window.AYMN_WORDS.categories;
  if(!W) return { words: 0, cats: 0 };
  const keys = Object.keys(W);
  return { words: keys.reduce((n, k) => n + W[k].words.length, 0), cats: keys.length };
}

function renderRoomSettingsUI(){
  const v = roomSettingsUI.values;
  $all("#room-settings-modal .rs-seg").forEach(group => {
    const key = group.dataset.setting;
    group.querySelectorAll("button[role=radio]").forEach(btn => {
      const checked = Number(btn.dataset.value) === v[key];
      btn.setAttribute("aria-checked", String(checked));
      btn.tabIndex = checked ? 0 : -1;
    });
  });
  $("#rs-summary").textContent =
    `${v.gameRounds} جولات · ${hintsLabel(v.hintRounds)} لكل لاعب · ${v.hintTime} ثانية للتلميح`;
  const bank = wordBankStats();
  $("#rs-bank").textContent = bank.words
    ? `بنك الكلمات: ${bank.words} كلمة في ${bank.cats} فئة · كلمات جديدة وأمبوستر مختلف كل جولة`
    : "";
}

function openRoomSettings(mode, values, trigger){
  roomSettingsUI.mode = mode;
  roomSettingsUI.values = { ...DEFAULT_SETTINGS, ...values };
  $("#rs-eyebrow").textContent = mode === "edit" ? "غرفة الانتظار" : "غرفة جديدة";
  $("#rs-confirm").textContent = mode === "edit" ? "حفظ الإعدادات" : "إنشاء الغرفة";
  $("#rs-confirm").disabled = false;
  renderRoomSettingsUI();
  Modal.open(settingsModal, trigger);
  const first = $("#room-settings-modal .rs-seg button[aria-checked=true]");
  if(first) first.focus();
}

(function setupRoomSettingsModal(){
  $all("#room-settings-modal .rs-seg").forEach(group => {
    const key = group.dataset.setting;
    const buttons = Array.from(group.querySelectorAll("button[role=radio]"));
    buttons.forEach((btn, i) => {
      btn.addEventListener("click", () => {
        roomSettingsUI.values[key] = Number(btn.dataset.value);
        renderRoomSettingsUI();
      });
      // الأسهم تنقل الاختيار داخل المجموعة (RTL: السهم الأيسر = التالي)
      btn.addEventListener("keydown", (e) => {
        let next = null;
        if(e.key === "ArrowLeft" || e.key === "ArrowDown") next = buttons[(i + 1) % buttons.length];
        if(e.key === "ArrowRight" || e.key === "ArrowUp") next = buttons[(i - 1 + buttons.length) % buttons.length];
        if(!next) return;
        e.preventDefault();
        roomSettingsUI.values[key] = Number(next.dataset.value);
        renderRoomSettingsUI();
        next.focus();
      });
    });
  });

  $("#rs-close").addEventListener("click", () => Modal.close(settingsModal));
  $("#rs-cancel").addEventListener("click", () => Modal.close(settingsModal));

  $("#rs-confirm").addEventListener("click", async () => {
    const btn = $("#rs-confirm");
    const settings = { ...roomSettingsUI.values };
    btn.disabled = true;
    try{
      if(roomSettingsUI.mode === "edit"){
        if(state.roomCode) await Backend.updateRoom(state.roomCode, { settings });
        Modal.close(settingsModal);
      } else {
        const name = requireHomeName();
        Modal.close(settingsModal);
        if(!name) return;
        $("#home-error").textContent = "";
        await createRoomAsPlayer(name, settings);
      }
    } catch(err){
      console.error(err);
      Modal.close(settingsModal);
      if(roomSettingsUI.mode === "edit") $("#lobby-error").textContent = "تعذّر حفظ الإعدادات. حاول مرة أخرى.";
      else $("#home-error").textContent = "حدث خطأ غير متوقع أثناء إنشاء الغرفة. حاول مرة أخرى.";
    } finally {
      btn.disabled = false;
    }
  });
})();

/* ---------------------------------------------------------------------
   8) الاستماع لحالة الغرفة (مصدر الحقيقة الوحيد لكل الشاشات)
--------------------------------------------------------------------- */
function attachRoomListener(){
  if(state.unsubscribe) state.unsubscribe();

  if(!usingFirebase){
    toast("وضع تجريبي محلي — اللعبة تعمل الآن على هذا المتصفح بدون خادم خارجي", 4200);
  }

  state.unsubscribe = Backend.subscribe(state.roomCode, (room) => {
    if(!state.roomCode) return;
    if(!room){
      resetToHome();
      toast("تم إغلاق الغرفة");
      return;
    }
    state.roomData = room;
    state.isHost = room.hostId === state.playerId;
    renderRoom(room);
  });
}

function resetToHome(){
  sessionStorage.removeItem("imp_roomCode");
  sessionStorage.removeItem("imp_isSpectator");
  if(state.unsubscribe) state.unsubscribe();
  Object.assign(state, { roomCode: null, isHost: false, isSpectator: false, unsubscribe: null, roomData: null });
  hideGameLayers();
  closeSpectatorResultsModal();
  [settingsModal, exitModal].forEach(m => Modal.close(m));
  lobbyUI.lastCount = 0;
  lobbyUI.kickAsk = null;
  showScreen("screen-home");
  $("#join-code").value = "";
  updateShareHint();
  $("#home-error").textContent = "";
  updateRoomChip();
}

function updateRoomChip(){
  const chip = $("#global-room-chip");
  chip.classList.toggle("hidden", !state.roomCode);
  $("#global-room-chip-value").textContent = state.roomCode || "-----";
}

/** توزيع الشاشات حسب حالة الغرفة */
function renderRoom(room){
  updateRoomChip();

  if(state.isSpectator){
    hideGameLayers();
    renderSpectatorFlow(room);
    return;
  }

  // تمت إزالة اللاعب من الغرفة (حذف من المضيف أو مغادرة)
  if(!room.players || !room.players[state.playerId]){
    const kicked = !!(room.kicked && room.kicked[state.playerId]);
    resetToHome();
    toast(kicked ? "تمت إزالتك من الغرفة" : "لم تعد ضمن هذه الغرفة");
    return;
  }

  if((room.status === "game" && room.g) || room.status === "final"){
    showScreen("screen-game");
    renderGame(room);
  } else {
    hideGameLayers();
    renderLobby(room);
  }
}

/* ---------------------------------------------------------------------
   9) غرفة الانتظار
--------------------------------------------------------------------- */
const lobbyUI = { lastCount: 0, kickAsk: null };

function roomJoinUrl(){
  return `${location.origin}${location.pathname}?room=${state.roomCode}`;
}

function renderLobby(room){
  showScreen("screen-lobby");
  $("#lobby-room-code").textContent = state.roomCode;

  const settings = getRoomSettings(room);
  $("#wr-chip-rounds").textContent = `${settings.gameRounds} جولات`;
  $("#wr-chip-hints").textContent = `${hintsLabel(settings.hintRounds)} لكل لاعب`;
  $("#wr-chip-time").textContent = `${settings.hintTime} ثانية للتلميح`;

  const players = room.players || {};
  const ids = sortedPlayerIds(room);
  $("#lobby-player-count").textContent = String(ids.length);
  if(lobbyUI.kickAsk && !players[lobbyUI.kickAsk]) lobbyUI.kickAsk = null;

  const list = $("#lobby-player-list");
  list.innerHTML = ids.map(id => {
    const p = players[id];
    const isHostRow = id === room.hostId;
    let kick = "";
    if(state.isHost && !isHostRow){
      kick = lobbyUI.kickAsk === id
        ? `<div class="wr-kick-ask"><button type="button" class="wr-kick-yes" data-kick-yes="${id}">حذف</button><button type="button" class="wr-kick-no" data-kick-no>إلغاء</button></div>`
        : `<button type="button" class="wr-kick" data-kick="${id}" aria-label="حذف ${escapeHtml(p.name)}" title="حذف ${escapeHtml(p.name)}">×</button>`;
    }
    return `<li class="wr-player">
      ${avatarHtml(room, id, "wr-avatar")}
      <span class="wr-name">${escapeHtml(p.name)}${id === state.playerId ? ' <span class="tag-you">(أنت)</span>' : ""}</span>
      ${isHostRow ? '<span class="wr-host">المضيف</span>' : ""}
      ${kick}
    </li>`;
  }).join("") + '<li class="wr-waiting">بانتظار انضمام اللاعبين…</li>';

  if(ids.length > lobbyUI.lastCount && lobbyUI.lastCount > 0) list.scrollTop = list.scrollHeight;
  lobbyUI.lastCount = ids.length;

  const ready = ids.length >= 3;
  const startBtn = $("#btn-start-game");
  const backBtn = $("#btn-back-settings");
  const hint = $("#lobby-hint");
  if(state.isSpectator){
    startBtn.classList.add("hidden");
    backBtn.classList.add("hidden");
    hint.textContent = "أنت في وضع شاشة عرض للبث — بانتظار بدء المباراة...";
  } else if(state.isHost){
    startBtn.classList.remove("hidden");
    backBtn.classList.remove("hidden");
    startBtn.setAttribute("aria-disabled", String(!ready));
    hint.textContent = ready ? "سيدخل جميع اللاعبين المباراة معك" : "تحتاج 3 لاعبين على الأقل للبدء";
  } else {
    startBtn.classList.add("hidden");
    backBtn.classList.add("hidden");
    hint.textContent = "بانتظار المضيف لبدء المباراة...";
  }

  renderRoomQrCode();
}

function renderRoomQrCode(){
  const box = $("#qr-box");
  const canvasEl = $("#qr-canvas");
  if(typeof QRCode === "undefined"){ box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  if(canvasEl.dataset.room === state.roomCode) return;
  canvasEl.innerHTML = "";
  canvasEl.dataset.room = state.roomCode;
  try{
    new QRCode(canvasEl, { text: roomJoinUrl(), width: 400, height: 400, colorDark: "#12101c", colorLight: "#ffffff" });
  } catch(e){
    console.warn("تعذّر توليد رمز QR", e);
    box.classList.add("hidden");
  }
}

function copyToClipboard(text, btn, label){
  const done = () => {
    btn.textContent = "تم النسخ ✓";
    clearTimeout(btn._copyT);
    btn._copyT = setTimeout(() => { btn.textContent = label; }, 1500);
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(() => toast("تعذّر النسخ"));
  } else {
    toast("تعذّر النسخ");
  }
}

$("#btn-copy-code").addEventListener("click", (e) => copyToClipboard(state.roomCode || "", e.currentTarget, "نسخ الرقم"));
$("#btn-copy-link").addEventListener("click", (e) => copyToClipboard(roomJoinUrl(), e.currentTarget, "نسخ الرابط"));

$("#btn-back-settings").addEventListener("click", (e) => {
  if(!state.isHost || !state.roomData) return;
  $("#lobby-error").textContent = "";
  openRoomSettings("edit", getRoomSettings(state.roomData), e.currentTarget);
});

$("#btn-start-game").addEventListener("click", () => {
  if($("#btn-start-game").getAttribute("aria-disabled") === "true") return;
  startMatch();
});

/* حذف لاعب (المضيف فقط): زر × ثم تأكيد "حذف" داخل نفس الصف */
$("#lobby-player-list").addEventListener("click", (e) => {
  const ask = e.target.closest("[data-kick]");
  const yes = e.target.closest("[data-kick-yes]");
  const no = e.target.closest("[data-kick-no]");
  if(!state.isHost || !state.roomData) return;
  if(ask){ lobbyUI.kickAsk = ask.dataset.kick; renderLobby(state.roomData); const y = $("[data-kick-yes]"); if(y) y.focus(); }
  else if(no){ lobbyUI.kickAsk = null; renderLobby(state.roomData); }
  else if(yes){ lobbyUI.kickAsk = null; kickPlayer(yes.dataset.kickYes); Sound.sfx("skip"); }
});

async function kickPlayer(id){
  await Backend.transaction(state.roomCode, room => {
    if(!room || room.hostId !== state.playerId || !room.players || !room.players[id]) return room;
    delete room.players[id];
    room.kicked = room.kicked || {};
    room.kicked[id] = true;
    return room;
  });
}

/* =====================================================================
   10) محرّك المباراة
   =====================================================================
   بيانات الغرفة أثناء المباراة:
     status: "game" | "final" | "lobby"
     match:  { round, totals{id:pts}, impHist[], lastImp, done }
     usedWords: [] كلمات استُخدمت في هذه الغرفة (لا تتكرر حتى ينفد البنك)
     g (الجولة الحالية):
       phase: "pre" (مقدمة + بطاقة الدور) → "hints" → "voting" → "reveal"
       t0 / cardAt / cardEndsAt: توقيتات المقدمة والبطاقة
       order[]، impId، words{c,i,cat}، names{id:name}
       turn، hintRound، turnEndsAt، turnSent، nextTurnAt، hints[]
       votes{voter:target}، revealAt، guessEndsAt، guess، points
   كل الأوقات بتوقيت خادم Firebase (now()).
--------------------------------------------------------------------- */
const T = {
  INTRO: 5000,          // مدة المقدمة (3-2-1-ابدأ!)
  CARD_SEC: 10,         // مدة بقاء البطاقة مفتوحة
  CARD_OPEN: 1300,      // البطاقة تنقلب لتظهر الوجه
  CARD_COUNT: 2300,     // بدء عدّاد البطاقة
  FLIP: 800,            // مدة القلب/الإغلاق
  CARD_OUT: 1600,       // إغلاق + خروج البطاقة
  TURN_LEAD: 500,       // مهلة قبل أول دور
  TURN_GAP: 1200,       // مهلة بعد إرسال التلميح قبل الدور التالي
  REVEAL_DELAY: 900,    // بعد آخر صوت
  REVEAL_NAME: 2700,    // ظهور اسم الأمبوستر
  REVEAL_FADE: 5800,    // بدء تلاشي طبقة الكشف
  REVEAL_OFF: 6600,     // انتهاء الكشف وفتح التخمين
  GUESS_TIMEOUT: 60000, // حد أقصى للتخمين (لو خرج الأمبوستر أو تأخر كثيرًا)
  FOLLOWER_DELAY: 1500  // الأجهزة غير المضيفة تنتظر قليلًا قبل نقل المرحلة
};

const hintsAt = (g) => g.cardEndsAt + T.CARD_OUT;

function wordBank(){
  const W = window.AYMN_WORDS && window.AYMN_WORDS.categories;
  return W ? Object.keys(W).flatMap(k => W[k].words.map(w => ({ cat: k, w }))) : [];
}

/** كلمة المواطنين من فئة، وكلمة الأمبوستر من فئة مختلفة، بدون تكرار كلمة
 *  في نفس الغرفة حتى يقترب البنك من النفاد (أقل من 12 كلمة متبقية). */
function pickPair(usedWords){
  const all = wordBank();
  if(!all.length) return { words: { c: "قهوة", i: "طائرة", cat: "" }, used: usedWords || [] };
  let used = (usedWords || []).slice();
  let pool = all.filter(x => !used.includes(x.w));
  if(pool.length < 12){ used = []; pool = all; }
  const a = pickOne(pool);
  let ip = pool.filter(x => x.cat !== a.cat && normalizeArabic(x.w) !== normalizeArabic(a.w));
  if(!ip.length) ip = all.filter(x => x.cat !== a.cat);
  const b = pickOne(ip);
  used.push(a.w, b.w);
  return { words: { c: a.w, i: b.w, cat: a.cat }, used };
}

/** الأمبوستر يتغيّر كل جولة: من لم يكن أمبوستر بعد في المباراة، وليس
 *  أمبوستر الجولة السابقة. عندما يأخذ الجميع دورهم يبدأ السجل من جديد. */
function pickImpostor(ids, match){
  let hist = (match.impHist || []).filter(id => ids.includes(id));
  let cand = ids.filter(id => !hist.includes(id) && id !== match.lastImp);
  if(!cand.length){ hist = []; cand = ids.filter(id => id !== match.lastImp); }
  if(!cand.length) cand = ids;
  const impId = pickOne(cand);
  hist.push(impId);
  return { impId, impHist: hist };
}

/** يبني جولة جديدة داخل transaction. newMatch=true يصفّر النقاط والجولات. */
function buildRound(room, newMatch){
  const ids = sortedPlayerIds(room);
  const prev = room.match || {};
  const match = newMatch
    ? { round: 1, totals: {}, impHist: [], lastImp: null, done: 0 }
    : { round: (prev.round || 0) + 1, totals: prev.totals || {}, impHist: prev.impHist || [], lastImp: prev.lastImp || null, done: prev.done || 0 };
  const { impId, impHist } = pickImpostor(ids, match);
  match.impHist = impHist;
  match.lastImp = impId;
  const { words, used } = pickPair(room.usedWords);
  const t0 = now() + 300;
  const names = {};
  ids.forEach(id => { names[id] = room.players[id].name; });
  room.match = match;
  room.usedWords = used;
  room.status = "game";
  room.finalAt = null;
  room.g = {
    id: Math.random().toString(36).slice(2, 10),
    phase: "pre",
    t0, cardAt: t0 + T.INTRO, cardEndsAt: t0 + T.INTRO + T.CARD_COUNT + T.CARD_SEC * 1000,
    rerolls: 0, rerollAt: 0, prevWords: null,
    order: shuffleArray(ids), impId, words, names,
    turn: 0, hintRound: 1, turnEndsAt: 0, turnSent: false, nextTurnAt: 0,
    hints: [], votes: {}, revealAt: 0, guessEndsAt: 0, guess: null, points: null, voided: false
  };
  return room;
}

function isPresent(room, id){ return !!(room.players && room.players[id]); }

/** من يحق لهم التصويت: لاعبو الجولة الموجودون في الغرفة والمتصلون */
function eligibleVoters(room){
  const g = room.g;
  return (g.order || []).filter(id => isPresent(room, id) && room.players[id].connected !== false);
}

/** ينتقل للدور التالي، متخطيًا من غادر الغرفة. بعد آخر دور ← التصويت. */
function seekTurn(room, turn, round, t){
  const g = room.g;
  const settings = getRoomSettings(room);
  const n = (g.order || []).length;
  for(let guard = 0; guard <= n * (settings.hintRounds + 1); guard++){
    if(turn >= n){ turn = 0; round++; }
    if(round > settings.hintRounds){
      g.phase = "voting";
      g.votes = {};
      g.turnSent = false;
      return;
    }
    if(isPresent(room, g.order[turn])){
      g.turn = turn;
      g.hintRound = round;
      g.turnEndsAt = t + settings.hintTime * 1000;
      g.turnSent = false;
      g.nextTurnAt = 0;
      return;
    }
    turn++;
  }
  g.phase = "voting";
  g.votes = {};
}

function voteCounts(votes){
  const c = {};
  Object.values(votes || {}).forEach(tid => { c[tid] = (c[tid] || 0) + 1; });
  return c;
}

/** كُشف الأمبوستر فقط إذا حصل وحده على أعلى عدد أصوات */
function isCaught(g){
  const c = voteCounts(g.votes), vals = Object.values(c);
  const mx = Math.max(0, ...vals);
  return mx > 0 && c[g.impId] === mx && vals.filter(v => v === mx).length === 1;
}

/** نقاط الجولة (نفس computePoints في ملف التصميم) */
function computePoints(room, correct){
  const g = room.g, imp = g.impId, P = {};
  const ids = (g.order || []).filter(id => isPresent(room, id));
  let escaped = 0;
  ids.forEach(id => { P[id] = { pts: 0, items: [] }; });
  ids.forEach(id => {
    if(id === imp) return;
    if((g.votes || {})[id] === imp){ P[id].pts += 1; P[id].items.push({ t: "صوّت صح · +1", k: "good" }); }
    else { escaped++; P[id].items.push({ t: "صوّت خطأ · 0", k: "bad" }); }
  });
  if(!P[imp]) return P;
  if(escaped){ P[imp].pts += escaped * .5; P[imp].items.push({ t: `لم يصوّت عليه ${escaped} · +${fmtPts(escaped * .5)}`, k: "imp" }); }
  else P[imp].items.push({ t: "صوّت عليه الجميع · 0", k: "bad" });
  if(correct){ P[imp].pts += 2; P[imp].items.push({ t: "خمّن الكلمة · +2", k: "imp" }); }
  else {
    P[imp].items.push({ t: "تخمين خاطئ · 0", k: "bad" });
    ids.forEach(id => { if(id !== imp){ P[id].pts += 1; P[id].items.push({ t: "أخطأ الأمبوستر · +1", k: "good" }); } });
  }
  return P;
}

function applyGuess(room, text, timeout){
  const g = room.g;
  const correct = !timeout && normalizeArabic(text) === normalizeArabic(g.words.c);
  const P = computePoints(room, correct);
  room.match.totals = room.match.totals || {};
  Object.entries(P).forEach(([id, v]) => { room.match.totals[id] = (room.match.totals[id] || 0) + v.pts; });
  room.match.done = (room.match.done || 0) + 1;
  g.guess = { text: text || "", correct, timeout: !!timeout };
  g.points = P;
}

/** ينقل المباراة للمرحلة التالية إن حان وقتها. تعيد الغرفة بعد التعديل،
 *  أو undefined إن لم يتغيّر شيء. تُستدعى داخل transaction. */
function advanceRoom(room, t){
  if(!room || room.status !== "game" || !room.g) return undefined;
  const g = room.g;
  g.hints = g.hints || [];
  g.votes = g.votes || {};

  // خروج الأمبوستر قبل انتهاء الجولة يُلغي الجولة
  if(!g.points && !isPresent(room, g.impId)){
    g.voided = true;
    g.points = {};
    g.phase = "reveal";
    return room;
  }
  if(g.phase === "pre" && t >= hintsAt(g)){
    g.phase = "hints";
    seekTurn(room, 0, 1, t + T.TURN_LEAD);
    return room;
  }
  if(g.phase === "hints"){
    const curId = g.order[g.turn];
    if(!g.turnSent && !isPresent(room, curId)){
      seekTurn(room, g.turn + 1, g.hintRound, t);
      return room;
    }
    if(!g.turnSent && t >= g.turnEndsAt){
      g.hints.push({ pid: curId, text: "", round: g.hintRound, skipped: true });
      g.turnSent = true;
      g.nextTurnAt = t + T.TURN_GAP;
      return room;
    }
    if(g.turnSent && t >= g.nextTurnAt){
      seekTurn(room, g.turn + 1, g.hintRound, t);
      return room;
    }
    return undefined;
  }
  if(g.phase === "voting"){
    const voters = eligibleVoters(room);
    if(voters.length && voters.every(id => g.votes[id])){
      g.phase = "reveal";
      g.revealAt = t + T.REVEAL_DELAY;
      g.guessEndsAt = g.revealAt + T.REVEAL_OFF + T.GUESS_TIMEOUT;
      return room;
    }
    return undefined;
  }
  if(g.phase === "reveal" && !g.points && t >= g.guessEndsAt){
    applyGuess(room, "", true);
    return room;
  }
  return undefined;
}

/* ---------- إجراءات اللاعبين (كلها transactions على الغرفة) ---------- */
function roomTx(fn){
  if(!state.roomCode) return Promise.resolve();
  return Backend.transaction(state.roomCode, room => {
    if(!room) return room;
    return fn(room);
  }).catch(err => { console.error(err); toast("تعذّر الاتصال، حاول مرة أخرى"); });
}

function startMatch(){
  return roomTx(room => {
    if(room.hostId !== state.playerId) return undefined;
    if(sortedPlayerIds(room).length < 3){ toast("تحتاج 3 لاعبين على الأقل للبدء"); return undefined; }
    return buildRound(room, true);
  });
}

function nextRound(){
  return roomTx(room => {
    if(room.hostId !== state.playerId || room.status !== "game" || !room.g || !room.g.points) return undefined;
    if(sortedPlayerIds(room).length < 3){ toast("تحتاج 3 لاعبين على الأقل للمتابعة"); return undefined; }
    return buildRound(room, false);
  });
}

function showFinal(){
  return roomTx(room => {
    if(room.hostId !== state.playerId) return undefined;
    room.status = "final";
    room.finalAt = now();
    return room;
  });
}

function backToRoom(){
  return roomTx(room => {
    if(room.hostId !== state.playerId) return undefined;
    room.status = "lobby";
    room.g = null;
    room.finalAt = null;
    return room;
  });
}

async function leaveMatch(){
  const code = state.roomCode, me = state.playerId;
  resetToHome();
  if(!code) return;
  await Backend.transaction(code, room => {
    if(!room || !room.players || !room.players[me]) return room;
    delete room.players[me];
    return room;
  }).catch(() => {});
}

function submitHint(text){
  text = (text || "").trim().slice(0, 30);
  if(!text) return;
  const me = state.playerId;
  return roomTx(room => {
    const g = room.g;
    if(room.status !== "game" || !g || g.phase !== "hints" || g.turnSent || g.order[g.turn] !== me) return undefined;
    g.hints = g.hints || [];
    g.hints.push({ pid: me, text, round: g.hintRound, skipped: false });
    g.turnSent = true;
    g.nextTurnAt = now() + T.TURN_GAP;
    return room;
  });
}

function castVote(target){
  const me = state.playerId;
  return roomTx(room => {
    const g = room.g;
    if(room.status !== "game" || !g || g.phase !== "voting") return undefined;
    g.votes = g.votes || {};
    if(g.votes[me] || target === me || !(g.order || []).includes(me) || !isPresent(room, target)) return undefined;
    g.votes[me] = target;
    return room;
  });
}

function submitGuess(text){
  text = (text || "").trim().slice(0, 30);
  if(!text) return;
  const me = state.playerId;
  return roomTx(room => {
    const g = room.g;
    if(room.status !== "game" || !g || g.phase !== "reveal" || g.points || g.impId !== me) return undefined;
    applyGuess(room, text, false);
    return room;
  });
}

/** "كلمة جديدة" (المضيف فقط، والبطاقة مفتوحة): نفس الأمبوستر وكلمات جديدة */
function rerollWord(){
  return roomTx(room => {
    const g = room.g, t = now();
    if(room.hostId !== state.playerId || room.status !== "game" || !g || g.phase !== "pre") return undefined;
    if(cardInfo(g, t).stage !== "open") return undefined;
    const { words, used } = pickPair(room.usedWords);
    g.prevWords = g.words;
    g.words = words;
    room.usedWords = used;
    g.rerolls = (g.rerolls || 0) + 1;
    g.rerollAt = t;
    g.cardEndsAt = t + T.FLIP * 2 + 200 + T.CARD_SEC * 1000;
    return room;
  });
}

/* ---------- حالة البطاقة لحظيًا (من الطوابع الزمنية) ---------- */
function cardInfo(g, t){
  const openAt = g.cardAt + T.CARD_OPEN;
  const rerolls = g.rerolls || 0;
  const inReroll = rerolls > 0 && t >= g.rerollAt && t < g.rerollAt + T.FLIP;
  let stage;
  if(t < g.cardAt + 60) stage = "pre";
  else if(t < openAt) stage = "enter";
  else if(inReroll) stage = "close";
  else if(t < g.cardEndsAt) stage = "open";
  else if(t < g.cardEndsAt + T.FLIP) stage = "close";
  else stage = "exit";
  let flip = 0;
  if(t >= openAt) flip = (inReroll ? 2 * rerolls : 2 * rerolls + 1) + (t >= g.cardEndsAt ? 1 : 0);
  const countFrom = rerolls ? g.rerollAt + T.FLIP * 2 + 200 : g.cardAt + T.CARD_COUNT;
  const left = t < countFrom ? T.CARD_SEC : Math.max(0, Math.min(T.CARD_SEC, (g.cardEndsAt - t) / 1000));
  const words = inReroll && g.prevWords ? g.prevWords : g.words;
  return { stage, flip, left, words, openAt };
}

/* =====================================================================
   11) عرض المباراة
   ===================================================================== */
const ui = {
  gid: null, wordShown: false, reviewTab: "all", reviewDone: false, selected: null,
  scoreShown: false, sig: {}, fired: new Set(), lastHints: 0, lastVotes: 0,
  lastTurnKey: "", lastView: "", finalKey: "", guessDoneKey: "", cardStage: "",
  advKey: "", advAt: 0
};

function resetRoundUI(gid){
  Object.assign(ui, { gid, wordShown: false, reviewTab: "all", reviewDone: false, selected: null, scoreShown: false, sig: {}, lastHints: 0, lastVotes: 0, myVoteSeen: false, lastTurnKey: "", cardStage: "" });
  $("#hint-input").value = "";
  $("#guess-input").value = "";
  $("#btn-send-hint").disabled = true;
  $("#btn-guess").disabled = true;
}

/** يعيد بناء عنصر فقط إن تغيّر محتواه (حتى لا تتكرر الحركات بلا داعٍ) */
function setHtml(el, key, html){
  if(ui.sig[key] === html) return false;
  ui.sig[key] = html;
  el.innerHTML = html;
  return true;
}

function myRole(g){ return g.impId === state.playerId ? "impostor" : "citizen"; }
function myWord(g, words){ words = words || g.words; return myRole(g) === "impostor" ? words.i : words.c; }

/** تشغيل صوت مرة واحدة عند مرور وقته (ولا يُشغَّل إن فات بأكثر من 1.5ث) */
function sfxAt(key, at, name, t){
  if(ui.fired.has(key) || t < at) return;
  ui.fired.add(key);
  if(t - at < 1500) Sound.sfx(name);
}

function hideGameLayers(){
  ["#ov-intro", "#ov-card", "#ov-reveal", "#confetti"].forEach(s => { const el = $(s); el.classList.add("hidden"); el.classList.remove("is-in"); });
  Modal.close(exitModal);
}

function currentView(room, t){
  const g = room.g;
  if(room.status === "final") return "final";
  if(!g) return "hints";
  if(g.voided) return "score";
  if(g.phase === "pre" || g.phase === "hints") return "hints";
  if(g.phase === "voting") return (ui.reviewDone || (g.votes && g.votes[state.playerId])) ? "vote" : "review";
  if(g.phase === "reveal"){
    if(t < g.revealAt) return "vote";
    return (g.points && ui.scoreShown) ? "score" : "reveal";
  }
  return "hints";
}

function renderGame(room){
  const t = now();
  const g = room.g;
  if(g && g.id !== ui.gid) resetRoundUI(g.id);
  const settings = getRoomSettings(room);
  const match = room.match || { round: 1, totals: {} };
  const view = currentView(room, t);
  const inRound = g && g.order && g.order.includes(state.playerId);

  // الشريط العلوي
  $("#gm-round").textContent = `الجولة ${match.round || 1} من ${settings.gameRounds}`;
  const phaseLabels = { review: "مراجعة التلميحات", vote: "التصويت", reveal: "كشف الأمبوستر", score: "النقاط", final: "النتيجة النهائية" };
  $("#gm-phase").textContent = view === "hints"
    ? `التلميح ${Math.min((g && g.hintRound) || 1, settings.hintRounds)} من ${settings.hintRounds}`
    : phaseLabels[view];
  $("#btn-exit").classList.toggle("hidden", view === "final");
  const wordBtn = $("#btn-word");
  wordBtn.classList.toggle("hidden", !(g && inRound) || view === "final");
  if(g && inRound) $("#gm-word").textContent = myWord(g, cardInfo(g, t).words);
  wordBtn.setAttribute("aria-pressed", String(ui.wordShown));
  $("#btn-mute").classList.toggle("is-muted", Sound.muted);
  $("#btn-mute").setAttribute("aria-label", Sound.muted ? "تشغيل الصوت" : "كتم الصوت");
  $("#btn-mute").title = Sound.muted ? "تشغيل الصوت" : "كتم الصوت";

  // تبديل العرض
  ["hints", "review", "vote", "reveal", "score", "final"].forEach(v => $("#gv-" + v).classList.toggle("active", v === view));
  if(view !== ui.lastView){
    if(ui.lastView && view !== "hints") Sound.sfx(view === "score" && room.status === "game" && (match.round || 1) >= settings.gameRounds ? "end" : "whoosh");
    ui.lastView = view;
  }

  if(view === "final"){ renderFinal(room, t); }
  else { $("#confetti").classList.add("hidden"); ui.finalKey = ""; }
  if(!g) return;
  if(view === "hints") renderHints(room, t, settings);
  if(view === "review") renderReview(room, settings);
  if(view === "vote") renderVote(room);
  if(view === "reveal") renderRevealView(room, t);
  if(view === "score") renderScore(room, settings);
  renderOverlays(room, t, settings);
  gameSounds(room, t, settings);
}

/* ----- مرحلة التلميحات ----- */
function renderHints(room, t, settings){
  const g = room.g;
  const hinting = g.phase === "hints";
  $("#gv-hints").classList.toggle("is-waiting", g.phase === "pre" && t < hintsAt(g));
  const order = (g.order || []).filter(id => isPresent(room, id) || (g.hints || []).some(h => h.pid === id));
  const curId = hinting ? g.order[g.turn] : null;
  const mine = hinting && curId === state.playerId;

  // شريط ترتيب الأدوار — يرى الجميع دور من الآن
  const curIdx = hinting ? g.turn : -1;
  const chips = order.map(id => {
    const idx = g.order.indexOf(id);
    const isCur = idx === curIdx;
    const done = hinting && (idx < curIdx || (isCur && g.turnSent));
    const status = isCur ? (g.turnSent ? "✓" : (id === state.playerId ? "دورك" : "يكتب…")) : (done ? "✓" : "");
    return `<div class="order-chip${isCur ? " is-cur" : ""}${done && !isCur ? " is-done" : ""}">
      ${avatarHtml(room, id)}
      <span class="order-chip-name">${escapeHtml(playerLabel(room, id))}</span>
      <span class="order-chip-status">${status}</span>
    </div>`;
  }).join("");
  if(setHtml($("#order-strip"), "order", chips)){
    // تمرير الشريط أفقيًا فقط ليتوسّط صاحب الدور (بدون تحريك الصفحة)
    const strip = $("#order-strip"), cur = $("#order-strip .is-cur");
    if(cur){
      const a = cur.getBoundingClientRect(), b = strip.getBoundingClientRect();
      strip.scrollBy({ left: (a.left + a.width / 2) - (b.left + b.width / 2), behavior: "smooth" });
    }
  }

  // لوحة الدور
  const panel = $("#turn-panel");
  panel.classList.toggle("is-mine", mine);
  $("#turn-eyebrow").textContent = !hinting ? "استعدوا…" : mine ? "دورك الآن!" : "الدور الآن عند";
  $("#turn-title").textContent = !hinting ? "التلميحات تبدأ" : mine ? "اكتب تلميحك" : playerName(room, curId);
  $("#turn-sub").textContent = !hinting ? "" : g.turnSent
    ? (mine ? "تم إرسال تلميحك ✓" : "تم إرسال التلميح ✓")
    : mine ? "كلمة أو عبارة قصيرة تتعلق بكلمتك دون كشفها" : "يكتب تلميحه الآن…";
  const av = $("#turn-avatar");
  av.style.background = curId ? playerColor(room, curId) : "#2a2552";
  av.textContent = curId ? initialsOf(playerName(room, curId)) : "";

  const total = settings.hintTime;
  const left = hinting ? Math.max(0, Math.min(total, (g.turnEndsAt - t) / 1000)) : total;
  const ringColor = !hinting ? "var(--teal)" : left <= 3 ? "var(--red)" : left <= 5 ? "var(--yellow)" : "var(--teal)";
  $(".turn-ring").style.setProperty("--ring", ringColor);
  $("#ring-fg").style.strokeDashoffset = String(339.29 * (1 - (hinting && !g.turnSent ? left / total : (hinting ? 0 : 1))));
  $("#turn-secs").textContent = hinting ? String(Math.ceil(g.turnSent ? 0 : left)) : "—";

  const canWrite = mine && !g.turnSent;
  const box = $("#turn-input");
  if(canWrite && box.classList.contains("hidden")){
    box.classList.remove("hidden");
    const inp = $("#hint-input");
    inp.value = "";
    $("#btn-send-hint").disabled = true;
    inp.focus({ preventScroll: true });
  } else if(!canWrite && !box.classList.contains("hidden")){
    box.classList.add("hidden");
  }

  // سجل التلميحات
  const hints = g.hints || [];
  $("#feed-count").textContent = String(hints.length);
  $("#feed-empty").classList.toggle("hidden", hints.length > 0);
  const feed = $("#feed");
  if(setHtml(feed, "feed", hints.map(h => `<li class="${h.pid === state.playerId ? "is-mine" : ""}">
      ${avatarHtml(room, h.pid)}
      <div class="feed-body">
        <span class="feed-meta">${escapeHtml(h.pid === state.playerId ? "أنت" : playerName(room, h.pid))} · التلميح ${h.round}</span>
        <span class="feed-text${h.skipped ? " is-skip" : ""}">${escapeHtml(h.skipped ? "تخطّى" : h.text)}</span>
      </div>
    </li>`).join(""))){
    feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  }
}

$("#hint-input").addEventListener("input", (e) => { $("#btn-send-hint").disabled = !e.target.value.trim(); });
$("#hint-input").addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); sendMyHint(); } });
$("#btn-send-hint").addEventListener("click", sendMyHint);
function sendMyHint(){
  const v = $("#hint-input").value.trim();
  if(!v) return;
  $("#btn-send-hint").disabled = true;
  submitHint(v);
}

/* ----- مراجعة التلميحات ----- */
function hintCountText(n){ return n === 1 ? "تلميح واحد" : n === 2 ? "تلميحان" : `${n} تلميحات`; }

function renderReview(room, settings){
  const g = room.g, tab = ui.reviewTab;
  const tabs = [["all", "الكل"], ...Array.from({ length: settings.hintRounds }, (_, i) => [i + 1, `التلميح ${i + 1}`])];
  setHtml($("#review-tabs"), "rtabs", tabs.map(([v, l]) =>
    `<button type="button" role="tab" aria-selected="${tab === v}" data-tab="${v}">${l}</button>`).join(""));
  const order = (g.order || []).filter(id => isPresent(room, id));
  setHtml($("#review-grid"), "rgrid", order.map(id => {
    const all = (g.hints || []).filter(h => h.pid === id);
    const hs = all.filter(h => tab === "all" || h.round === tab);
    const list = hs.length ? hs : [{ round: "–", text: "لا يوجد", skipped: true }];
    return `<div class="review-card${id === state.playerId ? " is-mine" : ""}">
      <div class="review-card-head">
        ${avatarHtml(room, id)}
        <div class="review-card-name"><b>${escapeHtml(playerLabel(room, id))}</b><span>${tab === "all" ? hintCountText(all.filter(h => !h.skipped).length) : `التلميح ${tab}`}</span></div>
      </div>
      <div class="hint-chips">${list.map(h => `<span class="hint-chip${h.skipped ? " is-skip" : ""}"><span class="hint-chip-n">${h.round}</span><span>${escapeHtml(h.skipped && h.text !== "لا يوجد" ? "تخطّى" : h.text)}</span></span>`).join("")}</div>
    </div>`;
  }).join(""));
}

$("#review-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if(!b) return;
  ui.reviewTab = b.dataset.tab === "all" ? "all" : Number(b.dataset.tab);
  if(state.roomData) renderGame(state.roomData);
});
$("#btn-go-vote").addEventListener("click", () => {
  ui.reviewDone = true;
  if(state.roomData) renderGame(state.roomData);
});

/* ----- التصويت ----- */
function renderVote(room){
  const g = room.g, votes = g.votes || {};
  const voters = eligibleVoters(room);
  const voted = voters.filter(id => votes[id]).length, N = voters.length || 1;
  $("#vote-progress-text").textContent = `${voted} من ${voters.length}`;
  $("#vote-progress-bar").style.width = `${voted / N * 100}%`;
  const myV = votes[state.playerId];
  const order = (g.order || []).filter(id => isPresent(room, id));
  if(ui.selected && !order.includes(ui.selected)) ui.selected = null;
  setHtml($("#vote-grid"), "vgrid", order.map(id => {
    const self = id === state.playerId, sel = (myV || ui.selected) === id;
    const preview = (g.hints || []).filter(h => h.pid === id && !h.skipped).map(h => h.text).join(" · ") || "—";
    return `<button type="button" role="radio" class="vote-card${self ? " is-self" : ""}${votes[id] ? " has-voted" : ""}" aria-checked="${sel}" data-vote="${id}" ${self || myV ? "disabled" : ""}>
      <span class="voted-badge">صوّت ✓</span>
      ${avatarHtml(room, id)}
      <span class="vote-card-name">${escapeHtml(playerLabel(room, id))}</span>
      <span class="vote-card-hints">${escapeHtml(preview)}</span>
    </button>`;
  }).join(""));
  const btn = $("#btn-cast-vote");
  btn.textContent = myV ? "تم التصويت ✓" : "تصويت";
  btn.disabled = !!myV || !ui.selected;
  $("#vote-hint").textContent = myV
    ? `بانتظار تصويت البقية… (${voted} من ${voters.length})`
    : ui.selected ? `ستصوّت على ${playerName(room, ui.selected)}` : "لا يمكنك التصويت على نفسك";
}

$("#vote-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-vote]");
  if(!b || b.disabled) return;
  ui.selected = b.dataset.vote;
  Sound.sfx("vote");
  if(state.roomData) renderGame(state.roomData);
});
$("#vote-grid").addEventListener("keydown", (e) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  if(!keys.includes(e.key)) return;
  const cards = $all("#vote-grid .vote-card:not(:disabled)");
  if(!cards.length) return;
  e.preventDefault();
  let i = cards.indexOf(document.activeElement);
  i = (e.key === "ArrowLeft" || e.key === "ArrowDown") ? (i + 1) % cards.length : (i - 1 + cards.length) % cards.length;
  ui.selected = cards[i].dataset.vote;
  if(state.roomData) renderGame(state.roomData);
  const again = $(`#vote-grid [data-vote="${ui.selected}"]`);
  if(again) again.focus();
});
$("#btn-cast-vote").addEventListener("click", () => {
  if(!ui.selected) return;
  $("#btn-cast-vote").disabled = true;
  castVote(ui.selected);
});

/* ----- نتيجة التصويت + التخمين ----- */
function renderRevealView(room, t){
  const g = room.g, votes = g.votes || {};
  const caught = isCaught(g), meImp = g.impId === state.playerId;
  const verdict = meImp ? (caught ? "تم كشفك!" : "نجوت من الكشف!") : (caught ? "كشفتموه!" : "نجا من الكشف!");
  const vp = $("#verdict-pill");
  vp.textContent = verdict;
  vp.className = "verdict-pill " + (caught ? "is-caught" : "is-escaped");

  const c = voteCounts(votes), N = Math.max(1, Object.keys(votes).length);
  const barsOn = t >= g.revealAt + T.REVEAL_OFF;
  const order = (g.order || []).filter(id => isPresent(room, id) || id === g.impId);
  const rows = order.slice().sort((a, b) => (c[b] || 0) - (c[a] || 0));
  setHtml($("#tally"), "tally", rows.map(id => {
    const n = c[id] || 0, isImp = id === g.impId;
    const vs = Object.keys(votes).filter(v => votes[v] === id);
    return `<li class="${isImp ? "is-imp" : ""}">
      <div class="tally-row">
        ${avatarHtml(room, id)}
        <span class="tally-name">${escapeHtml(playerLabel(room, id))}</span>
        ${isImp ? '<span class="badge-imp">الأمبوستر</span>' : ""}
        <span class="tally-count">${n}</span>
      </div>
      <div class="bar"><div class="bar-fill" data-w="${n / N * 100}%"></div></div>
      <span class="tally-voters">${vs.length ? `صوّت له: ${vs.map(v => escapeHtml(v === state.playerId ? "أنت" : playerName(room, v))).join("، ")}` : "لم يصوّت له أحد"}</span>
    </li>`;
  }).join(""));
  $all("#tally .bar-fill").forEach(b => { b.style.width = barsOn ? b.dataset.w : "0%"; });

  // التخمين
  const gs = g.points ? "done" : (barsOn ? "wait" : "pending");
  const impName = playerName(room, g.impId);
  const card = $("#guess-card");
  card.classList.toggle("is-correct", gs === "done" && !!(g.guess && g.guess.correct));
  card.classList.toggle("is-wrong", gs === "done" && !(g.guess && g.guess.correct));
  $("#guess-title").textContent = gs === "done"
    ? (g.guess && g.guess.correct ? "خمّن الكلمة صح!" : "تخمين خاطئ")
    : meImp ? "خمّن كلمتهم" : `${impName} يخمّن كلمتكم`;
  $("#guess-sub").textContent = gs === "done" ? ""
    : meImp ? "اكتب الكلمة التي تظن أن باقي اللاعبين حصلوا عليها. التخمين الصحيح يمنحك نقطتين إضافيتين."
    : "إن خمّنها صح يكسب نقطتين إضافيتين، وإن أخطأ يأخذ كل لاعب نقطة.";
  const form = $("#guess-form");
  const canGuess = meImp && gs === "wait";
  if(canGuess && form.classList.contains("hidden")){
    form.classList.remove("hidden");
    $("#guess-input").focus({ preventScroll: true });
  } else if(!canGuess) form.classList.add("hidden");
  $("#guess-wait").classList.toggle("hidden", !(!meImp && gs === "wait"));
  $("#guess-done").classList.toggle("hidden", gs !== "done");
  if(gs === "done" && g.guess){
    $("#guess-word").textContent = g.guess.timeout ? "لم يُرسل تخمين" : g.guess.text;
    $("#guess-verdict").textContent = g.guess.correct ? "+2 نقطة للأمبوستر" : "+1 نقطة لكل لاعب آخر";
    $("#guess-line").textContent = `الكلمة الصحيحة: ${g.words.c}`;
  }
}

$("#guess-input").addEventListener("input", (e) => { $("#btn-guess").disabled = !e.target.value.trim(); });
$("#guess-input").addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); sendMyGuess(); } });
$("#btn-guess").addEventListener("click", sendMyGuess);
function sendMyGuess(){
  const v = $("#guess-input").value.trim();
  if(!v) return;
  $("#btn-guess").disabled = true;
  submitGuess(v);
}
$("#btn-show-score").addEventListener("click", () => {
  ui.scoreShown = true;
  if(state.roomData) renderGame(state.roomData);
});

/* ----- لوحة النقاط ----- */
function renderScore(room, settings){
  const g = room.g, match = room.match || {}, totals = match.totals || {}, P = g.points || {};
  const isFinalRound = (match.round || 1) >= settings.gameRounds;
  $("#score-eyebrow").textContent = `نقاط الجولة ${match.round || 1} من ${settings.gameRounds}`;
  const note = $("#score-note");
  note.classList.toggle("hidden", !g.voided);
  note.textContent = g.voided ? "انتهت الجولة بخروج الأمبوستر — لا نقاط في هذه الجولة" : "";
  const rows = sortedPlayerIds(room).sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
  setHtml($("#score-list"), "score", rows.map((id, i) => {
    const pts = (P[id] || {}).pts || 0;
    const items = ((P[id] || {}).items || []).map(it => `<span class="pts-chip k-${it.k}">${escapeHtml(it.t)}</span>`).join("");
    return `<li class="${i === 0 ? "is-first" : ""}${id === state.playerId ? " is-mine" : ""}" style="animation-delay:${i * 80}ms">
      <span class="score-rank">${i + 1}</span>
      ${avatarHtml(room, id)}
      <div class="score-main">
        <div class="score-name-row"><b>${escapeHtml(playerLabel(room, id))}</b>${id === g.impId ? '<span class="badge-imp">الأمبوستر</span>' : ""}</div>
        ${items ? `<div class="pts-chips">${items}</div>` : ""}
      </div>
      <div class="score-side">
        <span class="score-gain${pts > 0 ? " is-pos" : ""}">+${fmtPts(pts)}</span>
        <span class="score-total">المجموع ${fmtPts(totals[id] || 0)}</span>
      </div>
    </li>`;
  }).join(""));
  $("#btn-next-round").textContent = isFinalRound ? "عرض الفائز" : `الجولة التالية (${(match.round || 1) + 1} من ${settings.gameRounds})`;
  $("#score-actions").classList.toggle("hidden", !state.isHost);
  $("#score-wait").classList.toggle("hidden", state.isHost);
}

$("#btn-next-round").addEventListener("click", () => {
  const room = state.roomData;
  if(!room) return;
  const settings = getRoomSettings(room);
  if(((room.match || {}).round || 1) >= settings.gameRounds) showFinal();
  else nextRound();
});
$("#btn-score-room").addEventListener("click", backToRoom);

/* ----- النتيجة النهائية ----- */
function renderFinal(room, t){
  const match = room.match || {}, totals = match.totals || {};
  const rows = sortedPlayerIds(room).sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
  const top = rows[0], topPts = totals[top] || 0;
  const tied = rows.filter(id => (totals[id] || 0) === topPts);
  const noWinner = topPts === 0, isTie = !noWinner && tied.length > 1;
  const rn = match.done || 0;
  const roundsTxt = rn === 1 ? "جولة واحدة" : rn === 2 ? "جولتين" : rn <= 10 ? `${rn} جولات` : `${rn} جولة`;
  const ptsTxt = id => `${fmtPts(totals[id] || 0)} نقطة`;
  const rankOf = id => rows.findIndex(q => (totals[q] || 0) === (totals[id] || 0)) + 1;

  $("#final-title").textContent = noWinner ? "انتهت المباراة بدون فائز"
    : isTie ? "تعادل!"
    : top === state.playerId ? "مبروك! فزت بالمباراة" : `${playerName(room, top)} فاز بالمباراة!`;
  $("#final-line").textContent = noWinner ? `لم يسجّل أي لاعب نقاطًا بعد ${roundsTxt}`
    : isTie ? `${tied.map(id => playerLabel(room, id)).join(" و")} بمجموع ${ptsTxt(top)} بعد ${roundsTxt}`
    : `بمجموع ${ptsTxt(top)} بعد ${roundsTxt}`;

  const delays = ["1s", ".55s", ".2s"];
  const podium = [1, 0, 2].filter(i => rows[i]).map(i => {
    const id = rows[i], first = i === 0 && !noWinner && !isTie;
    const h = ["clamp(7.5rem,18vw,10.625rem)", "clamp(5.5rem,13vw,7.5rem)", "clamp(3.875rem,9vw,5.375rem)"][i];
    return `<div class="pod${first ? " is-first" : ""}" style="animation-delay:${delays[i]}">
      ${first ? '<svg class="pod-crown" width="40" height="32" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16h20l-1.6-11-5.2 4.6L12 1 8.8 9.6 3.6 5z" fill="#f0c048"></path></svg>' : ""}
      ${avatarHtml(room, id)}
      <div class="pod-info"><span class="pod-name">${escapeHtml(playerLabel(room, id))}</span><span class="pod-pts">${ptsTxt(id)}</span></div>
      <div class="pod-base" style="height:${h}">${rankOf(id)}</div>
    </div>`;
  }).join("");
  const key = String(room.finalAt || "");
  if(ui.finalKey !== key){
    ui.finalKey = key;
    ui.sig.podium = null; ui.sig.rest = null;
    buildConfetti();
  }
  setHtml($("#podium"), "podium", podium);
  setHtml($("#final-rest"), "rest", rows.slice(3).map((id, i) => `<li style="animation-delay:${1.5 + i * .08}s">
      <span class="final-rest-rank">${rankOf(id)}</span>
      ${avatarHtml(room, id)}
      <span class="final-rest-name">${escapeHtml(playerLabel(room, id))}</span>
      <span class="final-rest-pts">${ptsTxt(id)}</span>
    </li>`).join(""));
  $("#final-actions").classList.toggle("hidden", !state.isHost);
  $("#final-wait").classList.toggle("hidden", state.isHost);

  const fa = room.finalAt || 0;
  let d = 200;
  for(let i = 0; i < 10; i++){ sfxAt(`final:${fa}:d${i}`, fa + d, "drum", t); d += Math.max(60, 140 - i * 9); }
  sfxAt(`final:${fa}:f`, fa + 1000, "final", t);
}

function buildConfetti(){
  const box = $("#confetti");
  const pal = ["#2dd4bf", "#f0c048", "#e879c9", "#7c5cff", "#5b8cff", "#ffffff"];
  box.innerHTML = Array.from({ length: 70 }, (_, i) => {
    const w = (6 + Math.random() * 6).toFixed(0), h = (10 + Math.random() * 10).toFixed(0);
    return `<span style="left:${(Math.random() * 100).toFixed(1)}%;width:${w}px;height:${h}px;background:${pal[i % pal.length]};border-radius:${Math.random() > .5 ? "2px" : "50%"};animation-delay:${(Math.random() * 2.5 + .8).toFixed(2)}s;animation-duration:${(3 + Math.random() * 2.5).toFixed(2)}s"></span>`;
  }).join("");
  box.classList.remove("hidden");
}

$("#btn-final-room").addEventListener("click", backToRoom);
$("#btn-new-match").addEventListener("click", startMatch);

/* ----- الطبقات: المقدمة، البطاقة، الكشف ----- */
function showLayer(el, on){
  if(on){
    if(el.classList.contains("hidden")){ el.classList.remove("hidden"); void el.offsetWidth; }
  } else {
    el.classList.add("hidden");
    el.classList.remove("is-in");
  }
}

function renderOverlays(room, t, settings){
  const g = room.g;
  const match = room.match || {};
  const inRound = (g.order || []).includes(state.playerId);
  const active = room.status === "game";

  // المقدمة
  const intro = $("#ov-intro");
  const showIntro = active && g.phase === "pre" && t < g.cardAt;
  showLayer(intro, showIntro);
  if(showIntro){
    intro.classList.toggle("is-in", t >= g.t0 + 40 && t < g.t0 + 4400);
    $("#intro-round").textContent = `الجولة ${match.round || 1} من ${settings.gameRounds}`;
    const e = t - g.t0;
    const count = e < 900 ? null : e < 1800 ? 3 : e < 2700 ? 2 : e < 3600 ? 1 : 0;
    const html = count === null ? "" : `<div class="cd${count ? "" : " is-go"}"><div class="cd-ring"></div><div class="cd-num">${count ? count : "ابدأ!"}</div></div>`;
    setHtml($("#intro-count"), "count", html);
  }

  // بطاقة الدور
  const cardOv = $("#ov-card");
  const showCard = active && inRound && g.phase === "pre" && t >= g.cardAt && t < hintsAt(g);
  showLayer(cardOv, showCard);
  if(showCard){
    const ci = cardInfo(g, t);
    const imp = myRole(g) === "impostor";
    cardOv.classList.toggle("is-imp", imp);
    cardOv.classList.toggle("is-in", ci.stage !== "pre" && ci.stage !== "exit");
    $("#role-card-outer").dataset.stage = ci.stage;
    $("#role-card").style.transform = `rotateY(${ci.flip * 180}deg)`;
    $("#role-front").classList.toggle("is-imp", imp);
    $("#role-label").textContent = imp ? "الأمبوستر" : "مواطن";
    $("#role-word").textContent = myWord(g, ci.words);
    $("#role-desc").textContent = imp
      ? "كلمتك مختلفة عن الجميع. اندمج بتلميحاتك ولا تنكشف."
      : "أعطِ تلميحات تثبت أنك تعرف الكلمة دون أن تكشفها للأمبوستر.";
    $("#role-bar").style.width = `${Math.max(0, ci.left / T.CARD_SEC * 100)}%`;
    $("#role-secs").textContent = `تختفي البطاقة خلال ${Math.ceil(ci.left)} ث`;
    $("#btn-reroll").classList.toggle("hidden", !(state.isHost && ci.stage === "open"));
    const rr = g.rerolls || 0;
    $("#reroll-note").classList.toggle("hidden", !rr);
    $("#reroll-note").textContent = `غيّر المضيف الكلمة${rr > 1 ? ` (${rr} مرات)` : ""} · تم تحديث بطاقات الجميع`;
  }

  // كشف الأمبوستر
  const rv = $("#ov-reveal");
  const showRv = active && g.phase === "reveal" && !g.voided && t >= g.revealAt && t < g.revealAt + T.REVEAL_OFF;
  showLayer(rv, showRv);
  if(showRv){
    rv.classList.toggle("is-in", t >= g.revealAt + 40 && t < g.revealAt + T.REVEAL_FADE);
    const named = t >= g.revealAt + T.REVEAL_NAME;
    $("#rv-suspense").classList.toggle("hidden", named);
    $("#rv-name").classList.toggle("hidden", !named);
    if(named){
      const caught = isCaught(g), meImp = g.impId === state.playerId;
      const avatar = $("#rv-avatar");
      avatar.style.background = playerColor(room, g.impId);
      avatar.textContent = initialsOf(playerName(room, g.impId));
      $("#rv-imp-name").textContent = meImp ? "أنت" : playerName(room, g.impId);
      const v = $("#rv-verdict");
      v.textContent = meImp ? (caught ? "تم كشفك!" : "نجوت من الكشف!") : (caught ? "كشفتموه!" : "نجا من الكشف!");
      v.className = "rv-verdict " + (caught ? "is-caught" : "is-escaped");
    }
  }
}

/* ----- الأصوات المرتبطة بمراحل المباراة ----- */
function gameSounds(room, t, settings){
  const g = room.g, id = g.id;
  if(room.status !== "game") return;
  if(g.phase === "pre"){
    sfxAt(`${id}:intro`, g.t0, "whoosh", t);
    [3, 2, 1].forEach((n, i) => sfxAt(`${id}:c${n}`, g.t0 + 900 + i * 900, "tick", t));
    sfxAt(`${id}:go`, g.t0 + 3600, "go", t);
    if((g.order || []).includes(state.playerId)){
      const ci = cardInfo(g, t), role = myRole(g);
      sfxAt(`${id}:card`, g.cardAt, "whoosh", t);
      sfxAt(`${id}:open`, ci.openAt, "flip", t);
      sfxAt(`${id}:role`, ci.openAt + 380, role, t);
      const rr = g.rerolls || 0;
      if(rr){
        sfxAt(`${id}:rr${rr}a`, g.rerollAt, "flip", t);
        sfxAt(`${id}:rr${rr}b`, g.rerollAt + T.FLIP, "flip", t);
        sfxAt(`${id}:rr${rr}c`, g.rerollAt + T.FLIP + 380, role, t);
      }
      if(ci.stage === "open" && ci.left > 0 && ci.left <= 3) sfxAt(`${id}:cw${rr}:${Math.ceil(ci.left)}`, t, "warn", t);
      sfxAt(`${id}:close${g.cardEndsAt}`, g.cardEndsAt, "flip", t);
      sfxAt(`${id}:exit${g.cardEndsAt}`, g.cardEndsAt + T.FLIP, "whoosh", t);
    }
  }
  if(g.phase === "hints"){
    const key = `${id}:${g.hintRound}:${g.turn}`;
    if(ui.lastTurnKey !== key){
      ui.lastTurnKey = key;
      const mine = g.order[g.turn] === state.playerId;
      Sound.sfx(mine ? "myTurn" : "turn");
      if(mine && navigator.vibrate) try{ navigator.vibrate(180); } catch(e){}
    }
    const left = (g.turnEndsAt - t) / 1000;
    if(!g.turnSent && left > 0 && left <= 5) sfxAt(`${key}:w${Math.ceil(left)}`, t, "warn", t);
  }
  const hints = (g.hints || []).length;
  if(hints > ui.lastHints){
    if(ui.lastHints || hints === 1) Sound.sfx(g.hints[hints - 1].skipped ? "skip" : "send");
    ui.lastHints = hints;
  }
  if(g.phase === "voting" || g.phase === "reveal") sfxAt(`${id}:hintsdone`, t, "end", t);
  const nv = Object.keys(g.votes || {}).length;
  const myVoted = !!(g.votes || {})[state.playerId];
  if(nv > ui.lastVotes){
    if(ui.lastVotes || nv === 1) Sound.sfx(myVoted && !ui.myVoteSeen ? "send" : "vote");
    ui.lastVotes = nv;
  }
  ui.myVoteSeen = myVoted;
  if(g.phase === "reveal" && !g.voided){
    let d = 250;
    for(let i = 0; i < 16; i++){ sfxAt(`${id}:drum${i}`, g.revealAt + d, "drum", t); d += Math.max(55, 170 - i * 9); }
    sfxAt(`${id}:verdict`, g.revealAt + T.REVEAL_NAME, isCaught(g) ? "caught" : "escaped", t);
    if(g.points && g.guess && ui.guessDoneKey !== id){
      ui.guessDoneKey = id;
      if(t - g.revealAt < T.REVEAL_OFF + T.GUESS_TIMEOUT + 2000) Sound.sfx(g.guess.correct ? "impWin" : "citWin");
    }
  }
}

/* ----- أزرار الشريط العلوي ----- */
$("#btn-word").addEventListener("click", () => {
  ui.wordShown = !ui.wordShown;
  $("#btn-word").setAttribute("aria-pressed", String(ui.wordShown));
});
$("#btn-mute").addEventListener("click", () => {
  Sound.setMuted(!Sound.muted);
  if(!Sound.muted) Sound.audio();
  if(state.roomData) renderGame(state.roomData);
});
$("#btn-reroll").addEventListener("click", rerollWord);

/* ----- نافذة الخروج ----- */
const exitModal = setupModal("#exit-modal");
$("#btn-exit").addEventListener("click", (e) => {
  const guest = !state.isHost;
  $(".dlg-exit").classList.toggle("is-guest", guest);
  $("#exit-sub").textContent = guest
    ? "يمكنك متابعة اللعب أو مغادرة المباراة. مغادرتك لا تؤثر على باقي اللاعبين."
    : "اختر ما تريد فعله. هذا الإجراء يطبّق على جميع اللاعبين في الغرفة.";
  Modal.open(exitModal, e.currentTarget);
});
$("#btn-exit-room").addEventListener("click", () => { Modal.close(exitModal); backToRoom(); });
$("#btn-exit-end").addEventListener("click", () => { Modal.close(exitModal); showFinal(); });
$("#btn-exit-leave").addEventListener("click", () => { Modal.close(exitModal); leaveMatch(); });

/* ----- حلقة التحديث: العدّادات + نقل المراحل عند انتهاء الوقت ----- */
function maybeAdvance(room){
  if(!room || room.status !== "game" || !room.g || state.isSpectator) return;
  // المضيف يبادر فورًا؛ بقية الأجهزة تبادر فقط إن تأخر المضيف (خرج مثلًا)
  const t = now() - (state.isHost ? 0 : T.FOLLOWER_DELAY);
  let probe;
  try{ probe = advanceRoom(JSON.parse(JSON.stringify(room)), t); } catch(e){ return; }
  if(!probe) return;
  const g = probe.g;
  const key = `${g.id}:${g.phase}:${g.hintRound}:${g.turn}:${g.turnSent}:${(g.hints || []).length}:${!!g.points}`;
  if(ui.advKey === key && Date.now() - ui.advAt < 1500) return;
  ui.advKey = key;
  ui.advAt = Date.now();
  Backend.transaction(state.roomCode, r => advanceRoom(r, now() - (state.isHost ? 0 : T.FOLLOWER_DELAY)))
    .catch(err => console.warn("advance", err));
}

setInterval(() => {
  const room = state.roomData;
  if(!room || !state.roomCode) return;
  if(state.isSpectator){ renderSpectatorFlow(room); return; }
  if(room.status === "game" || room.status === "final"){
    if(room.players && room.players[state.playerId]) renderGame(room);
    maybeAdvance(room);
  }
}, 100);

/* ---------------------------------------------------------------------
   12) شاشة عرض للبث (لوحة المشاهد) — عرض فقط، بلا تصويت أو لعب.
   أثناء الانتظار تُعرض غرفة الانتظار العادية، وأثناء المباراة: شبكة
   اللاعبين، شات التلميحات، والتصويت. بعد انتهاء الجولة تُفتح نافذة
   كشف الأدوار مرة واحدة لكل جولة.
--------------------------------------------------------------------- */
const specUI = { sig: {}, revealedFor: null };

function specSet(el, key, html){
  if(specUI.sig[key] === html) return;
  specUI.sig[key] = html;
  el.innerHTML = html;
}

function renderSpectatorFlow(room){
  const g = room.g;
  if(room.status === "lobby" || !g){
    closeSpectatorResultsModal();
    if(!$("#screen-lobby").classList.contains("active") || specUI.sig.lobbyAt !== room) {
      specUI.sig.lobbyAt = room;
      renderLobby(room);
    }
    return;
  }

  showScreen("screen-spectator");
  const players = room.players || {};
  const curId = g.phase === "hints" ? (g.order || [])[g.turn] : null;
  const order = (g.order || []).filter(id => players[id]);

  specSet($("#spec-players-grid"), "grid", order.length
    ? order.map(id => `<div class="spec-player-box${id === curId ? " is-turn" : ""}"><span class="spec-player-name">${escapeHtml(players[id].name)}</span></div>`).join("")
    : '<div class="spec-hints-empty">لا يوجد لاعبون بعد</div>');

  const hints = (g.hints || []).slice().reverse();
  specSet($("#spec-hints-log"), "hints", hints.length
    ? hints.map(h => `<li><strong>${escapeHtml(playerName(room, h.pid))}</strong> — التلميح ${h.round}: «${escapeHtml(h.skipped ? "تخطّى" : h.text)}»</li>`).join("")
    : '<li class="spec-hints-empty">لا توجد تلميحات بعد... بانتظار بدء الجولة</li>');

  let votesHtml;
  if(g.phase !== "voting" && g.phase !== "reveal"){
    votesHtml = '<li class="spec-vote-empty">لم يبدأ التصويت بعد</li>';
  } else {
    const c = voteCounts(g.votes);
    votesHtml = order.map(id => `<li><span>${escapeHtml(players[id].name)}</span><span class="spec-vote-count">${c[id] || 0}</span></li>`).join("");
  }
  specSet($("#spec-vote-list"), "votes", votesHtml);

  if(room.status === "game" && g.points && !g.voided && specUI.revealedFor !== g.id){
    specUI.revealedFor = g.id;
    openSpectatorResultsModal(room);
  }
  if(room.status === "game" && !g.points) closeSpectatorResultsModal();
}

/** نافذة كشف الأدوار (للمشاهد فقط) */
function openSpectatorResultsModal(room){
  const modal = $("#spectator-results-modal");
  const list = $("#spec-reveal-list");
  const g = room.g, players = room.players || {};
  const caught = isCaught(g);
  const impName = playerName(room, g.impId);
  const imp = `<li class="is-impostor"><span>${escapeHtml(impName)}</span><span>الأمبوستر ${caught ? "— انكشف" : "— نجا"}</span></li>`;
  const others = (g.order || []).filter(id => id !== g.impId && players[id])
    .map(id => `<li><span>${escapeHtml(players[id].name)}</span><span>مواطن</span></li>`).join("");
  list.innerHTML = caught ? others + imp : imp + others;
  if(modal.classList.contains("hidden")) Modal.open(modal);
}

function closeSpectatorResultsModal(){
  Modal.close($("#spectator-results-modal"));
}

(function setupSpectatorResultsModal(){
  const modal = $("#spectator-results-modal");
  modal.addEventListener("click", (e) => { if(e.target === modal) closeSpectatorResultsModal(); });
  $("#spectator-results-close").addEventListener("click", closeSpectatorResultsModal);
})();

/* ---------------------------------------------------------------------
   13) إعادة الاتصال التلقائي إذا كان اللاعب داخل غرفة (تحديث الصفحة)
--------------------------------------------------------------------- */
(async function autoRejoin(){
  if(state.roomCode && state.playerId){
    try{
      const room = await Backend.getRoom(state.roomCode);
      if(room){
        if(state.isSpectator){
          await Backend.setSpectatorConnected(state.roomCode, state.playerId, true);
          Backend.setupSpectatorPresence(state.roomCode, state.playerId);
          attachRoomListener();
          return;
        }
        if(room.players && room.players[state.playerId]){
          await Backend.setConnected(state.roomCode, state.playerId, true);
          Backend.setupPresence(state.roomCode, state.playerId);
          attachRoomListener();
          return;
        }
      }
    } catch(e){ /* نبدأ من الشاشة الرئيسية */ }
  }
  resetToHome();
})();

/* =====================================================================
   16) خلفية الفضاء المتحركة: نجوم متلألئة + غبار كوني + شهب/نيازك
   =====================================================================
   يُرسم كل شيء عبر canvas واحد بحلقة requestAnimationFrame اقتصادية:
   - عدد الجسيمات مُحدَّد بحد أقصى ويُحسب حسب مساحة الشاشة (أخف على الجوال)
   - نسبة البكسل محدودة بـ 1.5x لتفادي إبطاء الأجهزة الضعيفة
   - يتوقف الرسم تمامًا عندما يكون التبويب غير ظاهر (توفير للبطارية)
   - يحترم إعداد "تقليل الحركة" في نظام المستخدم
   - تأثير تفاعلي خفيف: انزياح الخلفية بلطف مع حركة المؤشر/اللمس
--------------------------------------------------------------------- */
function initSpaceBackground(){
  const canvas = document.getElementById("space-canvas");
  if(!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0, h = 0, dpr = 1;
  let stars = [], dust = [], meteors = [];
  let lastMeteorAt = 0;
  let rafId = null;

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed(){
    const area = w * h;
    const starCount = Math.max(40, Math.min(130, Math.round(area / 9000)));
    const dustCount = Math.max(10, Math.min(36, Math.round(area / 30000)));

    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.3,
      baseAlpha: Math.random() * 0.5 + 0.35,
      speed: Math.random() * 0.02 + 0.006,
      phase: Math.random() * Math.PI * 2
    }));

    dust = Array.from({ length: dustCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.8 + 0.5,
      vx: (Math.random() - 0.5) * 0.05,
      vy: (Math.random() - 0.5) * 0.05,
      alpha: Math.random() * 0.22 + 0.05
    }));

    meteors = [];
  }

  function spawnMeteor(){
    const startX = Math.random() * w * 0.7 + w * 0.15;
    const colorIsRed = Math.random() < 0.3; // لمسة من هوية اللعبة: تيل للأبرياء، أحمر نادر للأمبوستر
    meteors.push({
      x: startX,
      y: -30,
      len: Math.random() * 90 + 70,
      speed: Math.random() * 6 + 5,
      angle: Math.PI / 3.3 + (Math.random() * 0.2 - 0.1),
      alpha: 1,
      color: colorIsRed ? "255,77,103" : "47,214,192"
    });
  }

  function draw(ts){
    ctx.clearRect(0, 0, w, h);

    // غبار كوني عائم ببطء
    dust.forEach(d => {
      d.x += d.vx; d.y += d.vy;
      if(d.x < -5) d.x = w + 5; if(d.x > w + 5) d.x = -5;
      if(d.y < -5) d.y = h + 5; if(d.y > h + 5) d.y = -5;
      ctx.beginPath();
      ctx.fillStyle = `rgba(200,190,255,${d.alpha})`;
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // نجوم متلألئة
    stars.forEach(s => {
      s.phase += s.speed;
      const alpha = Math.max(0, s.baseAlpha + Math.sin(s.phase) * 0.25);
      ctx.beginPath();
      ctx.fillStyle = `rgba(241,238,252,${alpha})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // شهب/نيازك عرضية
    if(!reduceMotion && ts - lastMeteorAt > (Math.random() * 2600 + 2200)){
      spawnMeteor();
      lastMeteorAt = ts;
    }
    meteors.forEach(m => {
      m.x += Math.cos(m.angle) * m.speed;
      m.y += Math.sin(m.angle) * m.speed;
      m.alpha -= 0.012;
      const tailX = m.x - Math.cos(m.angle) * m.len;
      const tailY = m.y - Math.sin(m.angle) * m.len;
      const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
      grad.addColorStop(0, `rgba(${m.color},${Math.max(0, m.alpha)})`);
      grad.addColorStop(1, `rgba(${m.color},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    });
    meteors = meteors.filter(m => m.alpha > 0 && m.y < h + 60 && m.x < w + 60);

    if(!document.hidden){
      rafId = requestAnimationFrame(draw);
    }
  }

  // تفاعل لطيف: انزياح خفيف للخلفية مع حركة المؤشر/اللمس (CSS transform فقط، رخيص الأداء)
  function handlePointer(clientX, clientY){
    if(reduceMotion) return;
    const relX = (clientX / w - 0.5) * 8;
    const relY = (clientY / h - 0.5) * 8;
    canvas.style.transform = `translate(${relX}px, ${relY}px)`;
  }
  window.addEventListener("pointermove", (e) => handlePointer(e.clientX, e.clientY), { passive: true });
  window.addEventListener("touchmove", (e) => {
    if(e.touches && e.touches[0]) handlePointer(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && rafId === null){
      lastMeteorAt = performance.now();
      requestAnimationFrame(draw);
    }
  });

  resize();
  if(reduceMotion){
    draw(performance.now()); // ارسم إطارًا ثابتًا واحدًا فقط، بلا حلقة حركة
  } else {
    requestAnimationFrame(draw);
  }
}

initSpaceBackground();
