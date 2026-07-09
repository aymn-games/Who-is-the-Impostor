/* =====================================================================
   من الأمبوستر؟  —  منطق اللعبة
   =====================================================================
   المزامنة بين الأجهزة تعمل الآن عبر Firebase Realtime Database
   (Modular SDK v12.15.0)، وبيانات المشروع مضبوطة بالفعل بالأسفل — لا
   حاجة لأي إعداد إضافي على مستوى الكود.

   يبقى شرط واحد لكي يلعب أصدقاؤك من أجهزتهم: يجب أن تُفتح الملفات
   الثلاثة عبر رابط ويب حقيقي، وليس بفتح index.html مباشرة من جهازك
   بصيغة file://‎ (فتح الملف محليًا يعمل فقط على متصفحك، حتى لو كانت
   قاعدة البيانات نفسها متصلة وتعمل).

   انشر المجلد بأي من هذه الطرق:
   • اسحب مجلد المشروع كاملًا إلى https://app.netlify.com/drop
     (لا يتطلب حسابًا) وستحصل فورًا على رابط تشاركه مع اللاعبين.
   • أو ارفع الملفات إلى مستودع GitHub وفعّل GitHub Pages من إعدادات
     المستودع.
   • أو للتجربة السريعة على نفس شبكة الواي فاي: افتح Terminal داخل مجلد
     المشروع ونفّذ: python -m http.server 8000
     ثم شارك الرابط: http://[عنوان-IP-المحلي-لجهازك]:8000 مع من هم على
     نفس الشبكة.

   ملاحظة: بما أن Firebase يُستورد الآن كوحدة ES module (import)، يجب أن
   يبقى وسم <script> في index.html من نوع type="module" (وهو كذلك
   بالفعل)، والملفات يجب أن تُخدَّم عبر http(s):// حتى تعمل وحدات ES —
   وهذا محقَّق تلقائيًا بمجرد نشر المجلد بأي من الطرق أعلاه.
   ===================================================================== */


/* ---------------------------------------------------------------------
   بيانات مشروعك على Firebase (Realtime Database) — تم ضبطها بالفعل.
   يتم استيراد Firebase هنا كوحدة (ES module) مباشرة من gstatic، لذلك
   لا حاجة لأي وسم <script> إضافي في index.html غير
   <script type="module" src="script.js"></script>
   ولا حاجة لأي وسم <script> آخر أو كود Firebase مكرر داخل index.html —
   هذا الملف هو المصدر الوحيد لتهيئة Firebase في كامل المشروع.
--------------------------------------------------------------------- */
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
   0) شاشة الدخول السينمائية (تغبيش + عنوان) — تأثير بصري بحت، لا علاقة
      له بمنطق اللعبة أو Firebase. تُعرض 3 ثوانٍ بالضبط ثم تتلاشى.
--------------------------------------------------------------------- */
(function runIntroSplash(){
  const introEl = document.getElementById("intro-splash");
  if(!introEl) return;
  const INTRO_DURATION_MS = 3000;
  const FADE_OUT_MS = 900; // يطابق مدة الانتقال في CSS
  setTimeout(() => {
    introEl.classList.add("intro-fade-out");
    setTimeout(() => { introEl.remove(); }, FADE_OUT_MS);
  }, INTRO_DURATION_MS);
})();

let db = null;
let usingFirebase = false;

function initFirebase(){
  try{
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    return true;
  } catch(err){
    // فشل نادر (مثلًا لا يوجد اتصال إنترنت عند التحميل الأول) — نعود
    // للوضع المحلي حتى لا تتجمد الواجهة، لكن هذا لن يحدث في الاستخدام
    // الطبيعي بما أن بيانات المشروع أعلاه صحيحة وحقيقية.
    console.warn("تعذّر تهيئة Firebase، سيتم استخدام الوضع المحلي:", err);
    return false;
  }
}

usingFirebase = initFirebase();

// أظهر تحذيرًا دائمًا على الشاشة الرئيسية إن لم يتم ربط Firebase بعد،
// وافتح دليل الإعداد تلقائيًا حتى لا يفوت المضيف الخطوات المطلوبة.
// (لا حاجة لانتظار DOMContentLoaded: هذا السكربت مُحمّل في نهاية <body>
// بعد أن يكون كل عنصر HTML قد تم تحليله بالفعل)
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
  }
};

/* ---------------------------------------------------------------------
   2) بنك الكلمات: كل فئة (domain) مقسّمة إلى مجموعات (clusters) تُستخدم
      فقط لاختيار كلمة الأبرياء (حتى تبقى كل كلماتهم ضمن نفس الفئة
      متقاربة الطابع). أما كلمة الأمبوستر فلم تعد تُسحب من نفس الفئة
      إطلاقًا: يتم اختيار فئة أخرى مختلفة تمامًا بشكل عشوائي، بحيث تكون
      كلمة الأمبوستر من عالم/مجال مختلف جذريًا (مثال: لو حصل الأبرياء
      على "شاورما" من فئة "وجبات سريعة"، فقد يحصل الأمبوستر على "طائرة"
      من فئة "مواصلات" أو "مستشفى" من فئة "أماكن") — بلا أي تداخل بين
      الفئتين إطلاقًا.
--------------------------------------------------------------------- */
const WORD_BANK = {
  "فواكه": [["تفاح","كمثرى"],["برتقال","يوسفي","ليمون"],["موز","عنب"],["فراولة","توت"],["بطيخ","شمام"]],
  "حيوانات": [["قطة","كلب"],["أسد","نمر"],["حصان","حمار"],["دجاجة","بطة"],["ذئب","ثعلب"]],
  "مهن": [["طبيب","ممرض"],["معلم","مدير مدرسة"],["شرطي","جندي"],["طباخ","نادل"],["مهندس","فني"]],
  "أماكن": [["مدرسة","جامعة"],["مستشفى","صيدلية"],["مطعم","مقهى"],["شاطئ","مسبح"],["حديقة","غابة"]],
  "رياضة": [["كرة قدم","كرة سلة"],["سباحة","غطس"],["تنس","بادمنتون"],["جري","مشي"],["ملاكمة","مصارعة"]],
  "أدوات منزلية": [["ملعقة","شوكة"],["ثلاجة","فرن"],["مكنسة","ممسحة"],["وسادة","بطانية"],["مرآة","ساعة حائط"]],
  "مواصلات": [["سيارة","دراجة"],["طائرة","قطار"],["حافلة","تاكسي"],["سفينة","قارب"],["مترو","ترام"]],
  "طبيعة": [["شمس","قمر"],["مطر","ثلج"],["بحر","نهر"],["جبل","تلة"],["صحراء","واحة"]],
  "مشروبات": [["شاي","قهوة"],["عصير","ماء"],["كولا","سبرايت"],["حليب","لبن"],["عصير برتقال","عصير تفاح"]],
  "أدوات مدرسية": [["كتاب","دفتر"],["قلم","ممحاة"],["سبورة","طاولة"],["معلم","طالب"],["اختبار","واجب"]],
  "وجبات سريعة": [["بيتزا","برجر"],["شاورما","فلافل"],["بطاطا مقلية","حلقات بصل"],["ناجتس","سمبوسة"]],
  "حبوب ونشويات": [["أرز","معكرونة"],["خبز","توست"],["فريكة","برغل"]]
};

/** يختار فئة عشوائية للأبرياء، ثم مجموعة (cluster) داخلها، ثم كلمة
 *  واحدة منها لهم جميعًا. بعدها يختار فئة أخرى مختلفة تمامًا (مستبعدًا
 *  فئة الأبرياء بالكامل) ويسحب منها كلمة الأمبوستر — ما يضمن اختلافًا
 *  جذريًا وكاملًا بين الكلمتين، دون أي انتماء لنفس الفئة أو المجال. */
function pickCategoryAndWords(){
  const categories = Object.keys(WORD_BANK);

  // فئة وكلمة الأبرياء
  const category = categories[Math.floor(Math.random() * categories.length)];
  const clusters = WORD_BANK[category];
  const cluster = clusters[Math.floor(Math.random() * clusters.length)];
  const innocentWord = pickRandom(cluster, 1)[0];

  // فئة الأمبوستر: أي فئة أخرى غير فئة الأبرياء إطلاقًا (اختلاف جذري)
  const otherCategories = categories.filter(c => c !== category);
  const impostorCategory = otherCategories[Math.floor(Math.random() * otherCategories.length)];
  const impostorClusters = WORD_BANK[impostorCategory];
  const impostorCluster = impostorClusters[Math.floor(Math.random() * impostorClusters.length)];
  const impostorWord = pickRandom(impostorCluster, 1)[0];

  return { category, innocentWord, impostorWord, impostorCategory };
}

/* ---------------------------------------------------------------------
   3) حالة محلية للجلسة الحالية (متصفح/تبويب واحد = لاعب واحد)
--------------------------------------------------------------------- */
const state = {
  roomCode: sessionStorage.getItem("imp_roomCode") || null,
  playerId: sessionStorage.getItem("imp_playerId") || null,
  playerName: sessionStorage.getItem("imp_playerName") || null,
  isHost: false,
  unsubscribe: null,
  roomData: null
};

function persistSession(){
  sessionStorage.setItem("imp_roomCode", state.roomCode || "");
  sessionStorage.setItem("imp_playerId", state.playerId || "");
  sessionStorage.setItem("imp_playerName", state.playerName || "");
}

function ensurePlayerId(){
  if(!state.playerId){
    state.playerId = "p_" + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
  }
  return state.playerId;
}

/* ---------------------------------------------------------------------
   4) أدوات مساعدة عامة
--------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function showScreen(id){
  $all(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if(el) el.classList.add("active");
}

function toast(msg, ms = 2600){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

/** يولّد رمز غرفة عشوائيًا من 5 أرقام، مثل 57392 */
function randomRoomCode(){
  return String(Math.floor(10000 + Math.random() * 90000));
}

function shuffleArray(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function pickRandom(arr, n){
  return shuffleArray(arr).slice(0, n);
}

function initialsOf(name){
  return (name || "؟").trim().slice(0,1).toUpperCase();
}

/* ---------------------------------------------------------------------
   4.ب) زر ونافذة "قوانين اللعبة" — طبقة عرض بحتة، لا تلمس حالة اللعبة
   ولا توقفها؛ يمكن فتحها/إغلاقها في أي وقت من أي شاشة.
--------------------------------------------------------------------- */
(function setupRulesModal(){
  const openBtn = $("#btn-rules");
  const modal = $("#rules-modal");
  const closeBtn = $("#rules-close");
  if(!openBtn || !modal || !closeBtn) return;

  const open = () => modal.classList.remove("hidden");
  const close = () => modal.classList.add("hidden");

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if(e.target === modal) close(); });
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape" && !modal.classList.contains("hidden")) close();
  });
})();

/* ---------------------------------------------------------------------
   4.ج) تعبئة رمز الغرفة تلقائيًا عند فتح رابط QR (?room=CODE): يفتح
   تبويب "الانضمام" مباشرة ويملأ الحقل، دون أي تأثير على منطق اللعبة.
--------------------------------------------------------------------- */
(function prefillJoinFromURL(){
  const roomParam = new URLSearchParams(location.search).get("room");
  if(!roomParam) return;
  $all(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "join"));
  $all(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-join"));
  const joinCodeInput = $("#join-code");
  if(joinCodeInput) joinCodeInput.value = roomParam.replace(/\D/g, "");
})();

/* ---------------------------------------------------------------------
   5) شاشة البداية: التبويبات + إنشاء/انضمام
--------------------------------------------------------------------- */
$all(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $all(".tab-btn").forEach(b => b.classList.remove("active"));
    $all(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    $("#home-error").textContent = "";
  });
});

$("#btn-create-room").addEventListener("click", async () => {
  const name = $("#host-name").value.trim();
  if(!name){ $("#home-error").textContent = "الرجاء إدخال اسمك"; return; }

  const btn = $("#btn-create-room");
  btn.disabled = true;
  $("#home-error").textContent = "";

  try{
    // يولّد رمزًا من 5 أرقام ويتأكد أنه غير مستخدم حاليًا (لن يتجمد أبدًا:
    // في الوضع المحلي القراءة فورية، وفي وضع Firebase هي قراءة واحدة سريعة)
    let code, existing;
    let attempts = 0;
    do{
      code = randomRoomCode();
      existing = await Backend.getRoom(code);
      attempts++;
    } while(existing && attempts < 20);

    ensurePlayerId();
    state.playerName = name;
    state.roomCode = code;
    state.isHost = true;
    persistSession();

    await Backend.createRoom(code, {
      hostId: state.playerId,
      status: "lobby",
      createdAt: Date.now(),
      gameVersion: 0,
      players: {
        [state.playerId]: { name, score: 0, connected: true, joinedAt: Date.now() }
      }
    });

    Backend.setupPresence(code, state.playerId);
    attachRoomListener();
  } catch(err){
    console.error(err);
    $("#home-error").textContent = "حدث خطأ غير متوقع أثناء إنشاء الغرفة. حاول مرة أخرى.";
  } finally {
    btn.disabled = false;
  }
});

$("#btn-join-room").addEventListener("click", async () => {
  const name = $("#join-name").value.trim();
  const code = $("#join-code").value.trim().replace(/\D/g, "");
  if(!name){ $("#home-error").textContent = "الرجاء إدخال اسمك"; return; }
  if(!code){ $("#home-error").textContent = "الرجاء إدخال رمز الغرفة"; return; }

  const btn = $("#btn-join-room");
  btn.disabled = true;
  $("#home-error").textContent = "";

  try{
    const room = await Backend.getRoom(code);
    if(!room){
      $("#home-error").textContent = usingFirebase
        ? "لا توجد غرفة بهذا الرمز. تأكد من الرمز مع المضيف."
        : "لا توجد غرفة بهذا الرمز على هذا الجهاز. في الوضع التجريبي المحلي (بدون Firebase)، يجب فتح الغرفة من نفس المتصفح الذي أنشأها المضيف. راجع دليل الإعداد أعلى الصفحة لتفعيل اللعب بين أجهزة مختلفة.";
      return;
    }
    if(room.status !== "lobby"){
      $("#home-error").textContent = "اللعبة بدأت بالفعل في هذه الغرفة";
      return;
    }

    ensurePlayerId();
    state.playerName = name;
    state.roomCode = code;
    state.isHost = (room.hostId === state.playerId);
    persistSession();

    await Backend.setPlayer(code, state.playerId, {
      name, score: 0, connected: true, joinedAt: Date.now()
    });

    Backend.setupPresence(code, state.playerId);
    attachRoomListener();
  } catch(err){
    console.error(err);
    $("#home-error").textContent = "تعذّر الانضمام إلى الغرفة";
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------------
   6) الاستماع لحالة الغرفة (مصدر الحقيقة الوحيد لكل الشاشات)
--------------------------------------------------------------------- */
function attachRoomListener(){
  if(state.unsubscribe) state.unsubscribe();

  if(!usingFirebase){
    toast("🔌 وضع تجريبي محلي — اللعبة تعمل الآن على هذا المتصفح بدون خادم خارجي", 4200);
  }

  state.unsubscribe = Backend.subscribe(state.roomCode, (room) => {
    if(!room){
      toast("تم إغلاق الغرفة");
      resetToHome();
      return;
    }
    state.roomData = room;
    state.isHost = room.hostId === state.playerId;
    renderRoom(room);
  });
}

function resetToHome(){
  sessionStorage.clear();
  if(state.unsubscribe) state.unsubscribe();
  stopTurnTimer();
  hidePersistentHint();
  Object.assign(state, {
    roomCode:null, playerId:null, playerName:null, isHost:false,
    unsubscribe:null, roomData:null
  });
  showScreen("screen-home");
  renderLeaderboard(null);
  updateRoomChip();
}

/* ---------------------------------------------------------------------
   7) توزيع الشاشات حسب حالة الغرفة (status)
--------------------------------------------------------------------- */
function renderRoom(room){
  renderLeaderboard(room);
  updateRoomChip();

  switch(room.status){
    case "lobby":
      stopTurnTimer();
      hidePersistentHint();
      renderLobby(room);
      break;
    case "clue": {
      const version = room.gameVersion || 0;
      const seenKey = `imp_wordSeen_${state.roomCode}_${version}`;
      if(!sessionStorage.getItem(seenKey)){
        stopTurnTimer();
        renderWordScreen(room, seenKey);
      } else {
        updatePersistentHint(room);
        renderClueScreen(room);
      }
      break;
    }
    case "voting":
      stopTurnTimer();
      updatePersistentHint(room);
      renderVotingScreen(room);
      break;
    case "results":
      stopTurnTimer();
      hidePersistentHint();
      renderResultsScreen(room);
      break;
    default:
      stopTurnTimer();
      hidePersistentHint();
      renderLobby(room);
  }
}

/* ---------------------------------------------------------------------
   7.ب) لوحة المتصدرين الحيّة (عنصر ثابت خارج شاشات .screen، يبقى ظاهرًا
   عبر كل الشاشات طالما اللاعب داخل غرفة) + شارة رمز الغرفة الدائمة
--------------------------------------------------------------------- */
function renderLeaderboard(room){
  const panel = $("#leaderboard-panel");
  if(!panel) return;
  if(!room){
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const players = room.players || {};
  const sortedIds = Object.keys(players)
    .sort((a, b) => (players[b].score || 0) - (players[a].score || 0));

  const list = $("#leaderboard-list");
  list.innerHTML = "";
  sortedIds.forEach((id, idx) => {
    const p = players[id];
    const li = document.createElement("li");
    if(id === state.playerId) li.classList.add("is-you");
    li.innerHTML = `
      <span class="lb-rank">${idx + 1}</span>
      <span class="lb-name">${escapeHtml(p.name)}${id === state.playerId ? ' <span class="tag-you">(أنت)</span>' : ""}</span>
      <span class="lb-score">${p.score || 0}</span>
    `;
    list.appendChild(li);
  });

  if(sortedIds.length === 0){
    const li = document.createElement("li");
    li.className = "lb-empty";
    li.textContent = "لا يوجد لاعبون بعد";
    list.appendChild(li);
  }
}

/** شارة صغيرة وثابتة تُبقي رمز الغرفة مرئيًا في كل شاشات اللعب (وليس
 *  فقط شاشة اللوبي)، حتى يتمكن المضيف من مشاركته مع لاعبين جدد في أي
 *  وقت — خصوصًا أثناء فترة الانتظار بين الجولات. */
function updateRoomChip(){
  const chip = $("#global-room-chip");
  if(!chip) return;
  if(state.roomCode){
    chip.classList.remove("hidden");
    $("#global-room-chip-value").textContent = state.roomCode;
  } else {
    chip.classList.add("hidden");
  }
}

/* ---------------------------------------------------------------------
   7.ج) تلميحك السري الدائم: يبقى ظاهرًا طوال مرحلتَي التلميحات والتصويت
   ويختفي فقط عند اللوبي أو النتائج (نهاية الجولة رسميًا). يُحسب دائمًا
   محليًا حسب state.playerId فقط — كل لاعب يرى كلمته هو حصرًا.
--------------------------------------------------------------------- */
function updatePersistentHint(room){
  const el = $("#persistent-hint");
  if(!el || !room || !room.words) return;
  const isImpostor = (room.impostors || []).includes(state.playerId);
  const myWord = isImpostor ? room.words.impostor : room.words.innocent;
  el.classList.toggle("is-impostor", isImpostor);
  $("#ph-label").textContent = isImpostor ? "أنت الأمبوستر" : "كلمتك";
  $("#ph-word").textContent = myWord;
  el.classList.remove("hidden");
}

function hidePersistentHint(){
  const el = $("#persistent-hint");
  if(el) el.classList.add("hidden");
}

/* ---------------------------------------------------------------------
   8) شاشة اللوبي
--------------------------------------------------------------------- */
function renderLobby(room){
  showScreen("screen-lobby");
  $("#lobby-room-code").textContent = state.roomCode;

  const players = room.players || {};
  const ids = Object.keys(players);
  const list = $("#lobby-player-list");
  list.innerHTML = "";
  ids.forEach(id => {
    const p = players[id];
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${escapeHtml(p.name)} ${id === state.playerId ? '<span class="tag-you">(أنت)</span>' : ""}</span>
      ${id === room.hostId ? '<span class="tag-host">المضيف</span>' : ""}
    `;
    list.appendChild(li);
  });

  const isNextRound = (room.gameVersion || 0) > 0;
  const startBtn = $("#btn-start-game");
  const hint = $("#lobby-hint");
  if(state.isHost){
    startBtn.classList.remove("hidden");
    startBtn.textContent = isNextRound ? "ابدأ الجولة التالية" : "ابدأ اللعبة";
    hint.textContent = ids.length < 3
      ? "تحتاج 3 لاعبين على الأقل لبدء اللعبة"
      : (isNextRound ? "يمكن لأي لاعب جديد الانضمام الآن برمز الغرفة قبل أن تبدأ" : "كل شيء جاهز — اضغط ابدأ اللعبة");
    startBtn.disabled = ids.length < 3;
  } else {
    startBtn.classList.add("hidden");
    hint.textContent = isNextRound
      ? "بانتظار المضيف لبدء الجولة التالية... يمكن لأصدقائك الانضمام الآن بنفس رمز الغرفة"
      : "بانتظار المضيف لبدء اللعبة...";
  }

  renderHostQrCode();
}

/** يعرض رمز QR للمضيف فقط، يحتوي رابط انضمام مباشر (?room=CODE) يفتح
 *  التطبيق ويملأ رمز الغرفة تلقائيًا في تبويب "الانضمام". */
function renderHostQrCode(){
  const box = $("#qr-box");
  const canvasEl = $("#qr-canvas");
  if(!box || !canvasEl) return;

  if(!state.isHost || typeof QRCode === "undefined"){
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  canvasEl.innerHTML = "";
  const joinUrl = `${location.origin}${location.pathname}?room=${state.roomCode}`;
  try{
    new QRCode(canvasEl, {
      text: joinUrl,
      width: 150,
      height: 150,
      colorDark: "#12101c",
      colorLight: "#ffffff"
    });
  } catch(e){
    console.warn("تعذّر توليد رمز QR", e);
    box.classList.add("hidden");
  }
}

$("#btn-start-game").addEventListener("click", () => startGame());

async function startGame(){
  const room = state.roomData;
  if(!room) return;
  const players = room.players || {};
  const ids = Object.keys(players);
  if(ids.length < 3) return;

  const { category, innocentWord, impostorWord } = pickCategoryAndWords();

  const numImpostors = ids.length > 8 ? 2 : 1;
  const impostors = pickRandom(ids, numImpostors);
  const turnOrder = shuffleArray(ids);

  await Backend.updateRoom(state.roomCode, {
    status: "clue",
    category,
    words: { innocent: innocentWord, impostor: impostorWord },
    impostors,
    turnOrder,
    round: 1,
    turnIndex: 0,
    turnStartedAt: Date.now(),
    cluesLog: [],
    votes: {},
    results: null,
    gameVersion: (room.gameVersion || 0) + 1
  });
}

/* ---------------------------------------------------------------------
   9) شاشة كشف الكلمة السرية (بطاقة قابلة للقلب)
--------------------------------------------------------------------- */
function renderWordScreen(room, seenKey){
  showScreen("screen-word");
  $("#word-category-label").textContent = `الفئة: ${room.category}`;

  const isImpostor = (room.impostors || []).includes(state.playerId);
  const myWord = isImpostor ? room.words.impostor : room.words.innocent;

  const flip = $("#flip-card");
  flip.classList.remove("flipped", "is-impostor");
  $("#btn-word-continue").classList.add("hidden");

  $("#secret-role-label").textContent = isImpostor ? "أنت الأمبوستر! كلمتك السرية" : "كلمتك";
  $("#secret-word-value").textContent = myWord;
  if(isImpostor) flip.classList.add("is-impostor");

  const flipHandler = () => {
    flip.classList.add("flipped");
    $("#btn-word-continue").classList.remove("hidden");
    flip.removeEventListener("click", flipHandler);
  };
  flip.addEventListener("click", flipHandler);

  $("#btn-word-continue").onclick = () => {
    sessionStorage.setItem(seenKey, "1");
    updatePersistentHint(room);
    renderClueScreen(state.roomData);
  };
}

/* ---------------------------------------------------------------------
   10) شاشة التلميحات (دور بدور، 3 جولات)
--------------------------------------------------------------------- */
function renderClueScreen(room){
  showScreen("screen-clue");
  $("#clue-round-num").textContent = room.round;

  const players = room.players || {};
  const currentTurnId = (room.turnOrder || [])[room.turnIndex || 0];
  const currentPlayer = players[currentTurnId];

  // بث اسم اللاعب صاحب الدور الحالي لكل من في الغرفة
  $("#turn-player-name").textContent = currentPlayer ? currentPlayer.name : "-";
  $("#turn-avatar").textContent = currentPlayer ? initialsOf(currentPlayer.name) : "؟";

  const isMyTurn = currentTurnId === state.playerId;
  $("#clue-input-row").classList.toggle("hidden", !isMyTurn);
  $("#clue-wait-hint").classList.toggle("hidden", isMyTurn);

  const log = $("#clue-log");
  log.innerHTML = "";
  (room.cluesLog || []).slice().reverse().forEach(entry => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(entry.name)}: ${escapeHtml(entry.text)}</span><span class="clue-round-tag">جولة ${entry.round}</span>`;
    log.appendChild(li);
  });

  startTurnTimer(room);
}

$("#btn-send-clue").addEventListener("click", () => sendClue(false));
$("#clue-input").addEventListener("keydown", (e) => { if(e.key === "Enter") sendClue(false); });

/** يرسل تلميح اللاعب صاحب الدور الحالي. isAuto=true يعني أن الوقت (15
 *  ثانية) انتهى، فيُسجَّل الدور تلقائيًا كـ"تخطّى" وينتقل الدور مباشرة. */
async function sendClue(isAuto){
  const input = $("#clue-input");
  const text = isAuto ? "" : input.value.trim();
  if(!isAuto && !text) return;
  input.value = "";

  await Backend.transaction(state.roomCode, room => {
    if(!room) return room;
    if(room.status !== "clue") return room;
    const currentTurnId = (room.turnOrder || [])[room.turnIndex || 0];
    if(currentTurnId !== state.playerId) return room; // ليس دورك، لا تُعدّل شيئًا

    room.cluesLog = room.cluesLog || [];
    room.cluesLog.push({
      playerId: state.playerId,
      name: (room.players[state.playerId] || {}).name || state.playerName,
      round: room.round,
      text: text || "(تخطّى)"
    });

    room.turnIndex = (room.turnIndex || 0) + 1;
    if(room.turnIndex >= (room.turnOrder || []).length){
      room.turnIndex = 0;
      room.round = (room.round || 1) + 1;
      if(room.round > 3){
        room.status = "voting";
        room.votes = {};
      }
    }
    room.turnStartedAt = Date.now(); // بداية موحّدة للدور التالي
    return room;
  });
}

/* ---------------------------------------------------------------------
   10.ب) عدّاد 15 ثانية للدور — مُزامَن عبر room.turnStartedAt، ويُنفَّذ
   الإرسال التلقائي (تخطّي) فقط من جهاز اللاعب صاحب الدور نفسه.
--------------------------------------------------------------------- */
let turnTimerInterval = null;
const TURN_SECONDS = 15;
const TURN_TIMER_CIRC = 2 * Math.PI * 17; // محيط الدائرة r=17 في الـ SVG

function startTurnTimer(room){
  clearInterval(turnTimerInterval);
  const timerEl = $("#turn-timer");
  const barEl = $("#tt-bar");
  const secondsEl = $("#tt-seconds");
  if(!timerEl || !barEl || !secondsEl) return;

  const startedAt = room.turnStartedAt || Date.now();
  const currentTurnId = (room.turnOrder || [])[room.turnIndex || 0];
  const isMyTurn = currentTurnId === state.playerId;
  const roundAtStart = room.round;
  const turnIndexAtStart = room.turnIndex || 0;
  timerEl.classList.remove("hidden", "urgent");
  let autoFired = false;

  function tick(){
    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = Math.max(0, TURN_SECONDS - elapsed);
    secondsEl.textContent = Math.ceil(remaining);
    barEl.style.strokeDashoffset = String(TURN_TIMER_CIRC * (1 - remaining / TURN_SECONDS));
    timerEl.classList.toggle("urgent", remaining <= 5);

    if(remaining <= 0){
      clearInterval(turnTimerInterval);
      // لا نُطلق التخطّي التلقائي إلا إذا كان الدور ما زال لنفس اللاعب/الجولة
      // (يحمي من إطلاقه بعد أن يكون الدور قد تغيّر بالفعل من مصدر آخر)
      const stillSameTurn = state.roomData
        && state.roomData.round === roundAtStart
        && (state.roomData.turnIndex || 0) === turnIndexAtStart;
      if(isMyTurn && !autoFired && stillSameTurn){
        autoFired = true;
        sendClue(true);
      }
    }
  }

  tick();
  turnTimerInterval = setInterval(tick, 250);
}

function stopTurnTimer(){
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  const timerEl = $("#turn-timer");
  if(timerEl) timerEl.classList.add("hidden");
}

/* ---------------------------------------------------------------------
   11) شاشة التصويت
--------------------------------------------------------------------- */
function renderVotingScreen(room){
  showScreen("screen-voting");
  const players = room.players || {};
  const votes = room.votes || {};
  const totalPlayers = Object.keys(players).length;
  const votedCount = Object.keys(votes).length;

  const myVote = votes[state.playerId];
  const list = $("#vote-list");
  list.innerHTML = "";

  Object.keys(players).forEach(id => {
    if(id === state.playerId) return; // لا يمكن التصويت لنفسك
    const p = players[id];
    const li = document.createElement("li");
    li.textContent = p.name;
    if(myVote){
      li.classList.add("disabled");
      if(myVote === id) li.classList.add("selected");
    } else {
      li.addEventListener("click", () => castVote(id));
    }
    list.appendChild(li);
  });

  $("#vote-status-text").textContent = myVote
    ? `تم تسجيل صوتك. بانتظار باقي اللاعبين (${votedCount}/${totalPlayers})`
    : `اختر لاعبًا للتصويت عليه (${votedCount}/${totalPlayers} صوّتوا حتى الآن)`;

  // جدول مرجعي بكل التلميحات المُرسَلة هذه الجولة، مرئي للجميع أثناء التصويت
  const tbody = $("#voting-clue-tbody");
  if(tbody){
    tbody.innerHTML = "";
    (room.cluesLog || []).forEach(entry => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.text || "—")}</td><td>${entry.round}</td>`;
      tbody.appendChild(tr);
    });
  }

  // المضيف فقط يقوم باحتساب النتائج بمجرد اكتمال كل الأصوات
  if(state.isHost && votedCount === totalPlayers && totalPlayers > 0){
    computeResults();
  }
}

async function castVote(targetId){
  await Backend.setVote(state.roomCode, state.playerId, targetId);
}

/* ---------------------------------------------------------------------
   12) احتساب النتائج (يُنفَّذ مرة واحدة فقط عبر transaction على status)
--------------------------------------------------------------------- */
async function computeResults(){
  await Backend.transaction(state.roomCode, room => {
    if(!room) return room;
    if(room.status !== "voting") return room; // تم احتسابها بالفعل من جهاز آخر

    const players = room.players || {};
    const votes = room.votes || {};
    const impostors = room.impostors || [];
    const playerIds = Object.keys(players);

    // تجميع الأصوات
    const voteCounts = {};
    Object.values(votes).forEach(targetId => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });
    let eliminated = null, maxVotes = -1;
    Object.keys(voteCounts).forEach(id => {
      if(voteCounts[id] > maxVotes){ maxVotes = voteCounts[id]; eliminated = id; }
    });

    const scoreDelta = {};

    // نقاط الأمبوستر: +1 عن كل لاعب لم يصوّت له
    impostors.forEach(impId => {
      let count = 0;
      playerIds.forEach(pid => {
        if(pid === impId) return;
        if(votes[pid] !== impId) count++;
      });
      scoreDelta[impId] = (scoreDelta[impId] || 0) + count;
    });

    // نقاط الأبرياء: +5 لكل تصويت صحيح على أمبوستر حقيقي
    playerIds.forEach(pid => {
      if(impostors.includes(pid)) return;
      if(impostors.includes(votes[pid])){
        scoreDelta[pid] = (scoreDelta[pid] || 0) + 5;
      }
    });

    // تطبيق النقاط على السجل
    playerIds.forEach(pid => {
      const delta = scoreDelta[pid] || 0;
      players[pid].score = (players[pid].score || 0) + delta;
    });

    room.players = players;
    room.results = {
      voteCounts, eliminated, impostors,
      innocentWord: room.words.innocent,
      impostorWord: room.words.impostor,
      scoreDelta
    };
    room.status = "results";
    return room;
  });
}

/* ---------------------------------------------------------------------
   13) شاشة النتائج
--------------------------------------------------------------------- */
function renderResultsScreen(room){
  showScreen("screen-results");
  const results = room.results;
  if(!results) return;
  const players = room.players || {};

  $("#result-eliminated-name").textContent = results.eliminated
    ? (players[results.eliminated] || {}).name || "-"
    : "لا أحد";

  const impostorNames = (results.impostors || [])
    .map(id => (players[id] || {}).name || "؟")
    .join("، ");
  $("#result-impostor-names").textContent = impostorNames || "-";
  $("#result-real-word").textContent = results.innocentWord;
  $("#result-impostor-word").textContent = results.impostorWord;

  const scoreList = $("#score-list");
  scoreList.innerHTML = "";
  Object.keys(players)
    .sort((a,b) => (players[b].score||0) - (players[a].score||0))
    .forEach(id => {
      const p = players[id];
      const delta = (results.scoreDelta || {})[id] || 0;
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${escapeHtml(p.name)}${id === state.playerId ? ' <span class="tag-you">(أنت)</span>' : ""}</span>
        <span class="score-points">${p.score || 0}<span class="score-delta">${delta ? " +" + delta : ""}</span></span>
      `;
      scoreList.appendChild(li);
    });

  const playAgainBtn = $("#btn-play-again");
  const waitHint = $("#results-wait-hint");
  if(state.isHost){
    playAgainBtn.classList.remove("hidden");
    waitHint.classList.add("hidden");
  } else {
    playAgainBtn.classList.add("hidden");
    waitHint.classList.remove("hidden");
  }
}

$("#btn-play-again").addEventListener("click", () => returnToLobbyForNextRound());

/** بعد النتائج، نعيد الغرفة إلى حالة "lobby" بدل بدء الجولة مباشرة —
 *  هذا يفتح نافذة زمنية يستطيع خلالها لاعبون جدد الانضمام بنفس رمز
 *  الغرفة (نفس شرط "room.status === 'lobby'" المستخدم أصلًا عند
 *  الانضمام)، مع الحفاظ الكامل على النقاط المتراكمة لكل لاعب. */
async function returnToLobbyForNextRound(){
  await Backend.updateRoom(state.roomCode, { status: "lobby" });
}

/* ---------------------------------------------------------------------
   14) أدوات أمان بسيطة لعرض النصوص
--------------------------------------------------------------------- */
function escapeHtml(str){
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

/* ---------------------------------------------------------------------
   15) إعادة الاتصال التلقائي إذا كان اللاعب داخل غرفة مسبقًا (تحديث الصفحة)
--------------------------------------------------------------------- */
(async function autoRejoin(){
  if(state.roomCode && state.playerId){
    try{
      const room = await Backend.getRoom(state.roomCode);
      if(room){
        await Backend.setConnected(state.roomCode, state.playerId, true);
        Backend.setupPresence(state.roomCode, state.playerId);
        attachRoomListener();
        return;
      }
    } catch(e){ /* تجاهل وابدأ من الشاشة الرئيسية */ }
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
