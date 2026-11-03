
function aktualizujZegar() {
  const teraz = new Date();
  const czasStr = teraz.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dataStr = teraz.toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const elClock = document.getElementById('headerClock');
  const elDate = document.getElementById('headerDate');
  if (elClock) elClock.innerText = czasStr;
  if (elDate) elDate.innerText = dataStr;
}
setInterval(aktualizujZegar, 1000);
aktualizujZegar();

const węzłyStatus = {
  1: { lastSeen: null, elementText: 'lastSeenNode1', elementDot: 'dotNode1' },
  2: { lastSeen: null, elementText: 'lastSeenNode2', elementDot: 'dotNode2' },
  3: { lastSeen: null, elementText: 'lastSeenNode3', elementDot: 'dotNode3' }
};

function oznaczAktywnoscWezla(nrWezla) {
  if (!węzłyStatus[nrWezla]) return;
  węzłyStatus[nrWezla].lastSeen = Date.now();
  const dot = document.getElementById(węzłyStatus[nrWezla].elementDot);
  if (dot) dot.classList.add('live');
}

function przeliczLastSeen() {
  const teraz = Date.now();
  for (let nr in węzłyStatus) {
    const w = węzłyStatus[nr];
    const elText = document.getElementById(w.elementText);
    const elDot = document.getElementById(w.elementDot);
    if (!elText || !elDot) continue;

    if (!w.lastSeen) {
      elText.innerText = "Brak odczytu";
      elDot.classList.remove('live');
      continue;
    }

    const diffSec = Math.floor((teraz - w.lastSeen) / 1000);
    if (diffSec < 2) {
      elText.innerText = "Teraz (aktywny)";
      elDot.classList.add('live');
    } else if (diffSec < 60) {
      elText.innerText = `${diffSec}s temu`;
      if (diffSec > 10) elDot.classList.remove('live');
    } else {
      const diffMin = Math.floor(diffSec / 60);
      elText.innerText = `${diffMin}m temu (offline?)`;
      elDot.classList.remove('live');
    }
  }
}
setInterval(przeliczLastSeen, 1000);

const AUTH_USERS = {
  "admin": "1234",
  "marek": "inzynier2026",
  "dyspozytor": "parking1"
};

function sprawdzZalogowanie() {
  const sesja = localStorage.getItem("sp_user_session");
  const fireBtns = document.querySelectorAll('.fire-admin-btn');
  const badgeRole = document.getElementById('userBadge');
  
  if (sesja) {
    document.getElementById('authOverlay').style.display = "none";
    if (badgeRole) badgeRole.style.display = "flex";
    document.getElementById('userNameDisplay').innerText = sesja + (sesja === 'admin' ? ' (Admin)' : ' (Operator)');
    
    fireBtns.forEach(btn => {
      if (sesja === 'admin') {
        btn.style.opacity = "1";
        btn.title = "Uprawnienia administratora aktywne";
      } else {
        btn.style.opacity = "0.7";
        btn.title = "Wymagane uprawnienia administratora (admin)";
      }
    });
  } else {
    document.getElementById('authOverlay').style.display = "flex";
    if (badgeRole) badgeRole.style.display = "none";
  }
}

function wykonajLogowanie() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value.trim();
  const err = document.getElementById('loginError');

  if (AUTH_USERS[user] && AUTH_USERS[user] === pass) {
    localStorage.setItem("sp_user_session", user);
    err.style.display = "none";
    document.getElementById('authOverlay').style.display = "none";
    document.getElementById('userBadge').style.display = "flex";
    document.getElementById('userNameDisplay').innerText = user;
    sprawdzZalogowanie();
    zapiszLogDoBazy("SYSTEM", "AUTH", `Użytkownik [${user}] zalogował się`);
  } else {
    err.style.display = "block";
  }
}

function wyloguj() {
  const user = localStorage.getItem("sp_user_session");
  zapiszLogDoBazy("SYSTEM", "AUTH", `Użytkownik [${user}] wylogował się`);
  localStorage.removeItem("sp_user_session");
  sprawdzZalogowanie();
}

let dbInstance = null;
const DB_NAME = "SmartParkingDB";
const DB_VERSION = 1;
const STORE_NAME = "event_logs";
let pamiecLogow = [];

function initDatabase() {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      store.createIndex("timestamp", "timestamp", { unique: false });
      store.createIndex("node", "node", { unique: false });
    }
  };
  req.onsuccess = (e) => {
    dbInstance = e.target.result;
    wczytajLogiZBazy();
  };
  req.onerror = (e) => console.error("Błąd IndexedDB:", e);
}

function zapiszLogDoBazy(node, topic, message) {
  if (!dbInstance) return;
  const now = new Date();
  const wpis = {
    timestamp: now.toISOString(),
    rawTime: now.getTime(),
    displayTime: now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    node: node,
    topic: topic,
    message: message
  };

  const tx = dbInstance.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).add(wpis);
  tx.oncomplete = () => {
    pamiecLogow.push(wpis);
    przeliczStatystykiLogow();
    filtrujLogiUI();
    aktualizujLicznikLogow();
  };
}

function wczytajLogiZBazy() {
  if (!dbInstance) return;
  const tx = dbInstance.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const req = store.getAll();
  req.onsuccess = (e) => {
    pamiecLogow = e.target.result || [];
    przeliczStatystykiLogow();
    filtrujLogiUI();
    aktualizujLicznikLogow(pamiecLogow.length);
  };
}

function przeliczStatystykiLogow() {
  const teraz = Date.now();
  const godzinaTemu = teraz - (60 * 60 * 1000);

  let gates1h = 0;
  let totalAlarms = 0;
  let totalTraffic = 0;

  pamiecLogow.forEach(l => {
    const lTime = l.rawTime || new Date(l.timestamp).getTime();
    if (lTime >= godzinaTemu && (l.message.includes("OTWARTA") || l.topic.includes("/garage/"))) {
      gates1h++;
    }
    if (l.node === "ALARM" || l.message.includes("ALARM")) {
      totalAlarms++;
    }
    if (l.node === "WĘZEŁ 2" && l.topic.includes("traffic")) {
      totalTraffic++;
    }
  });

  const elG = document.getElementById('statGatesCount');
  const elA = document.getElementById('statAlarmsCount');
  const elT = document.getElementById('statTrafficCount');
  const elTot = document.getElementById('statTotalLogs');

  if (elG) elG.innerText = gates1h;
  if (elA) elA.innerText = totalAlarms;
  if (elT) elT.innerText = totalTraffic;
  if (elTot) elTot.innerText = pamiecLogow.length;
}

function filtrujLogiUI() {
  const filterNode = document.getElementById('filterNode').value;
  const filterTime = document.getElementById('filterTime').value;
  const searchPhrase = document.getElementById('filterSearch').value.toLowerCase().trim();

  const teraz = Date.now();
  let czasGraniczny = 0;
  if (filterTime === "1H") czasGraniczny = teraz - (3600 * 1000);
  else if (filterTime === "24H") czasGraniczny = teraz - (24 * 3600 * 1000);

  const przefiltrowane = pamiecLogow.filter(l => {
    if (filterNode !== "ALL" && l.node !== filterNode) return false;
    const lTime = l.rawTime || new Date(l.timestamp).getTime();
    if (czasGraniczny > 0 && lTime < czasGraniczny) return false;
    if (searchPhrase) {
      const fullTxt = `${l.node} ${l.topic} ${l.message}`.toLowerCase();
      if (!fullTxt.includes(searchPhrase)) return false;
    }
    return true;
  });

  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;
  tbody.innerHTML = "";

  przefiltrowane.slice(-100).reverse().forEach(log => {
    const tr = document.createElement('tr');
    let tagClass = "tag-source";
    if (log.node === "WĘZEŁ 1") tagClass += " tag-w1";
    else if (log.node === "WĘZEŁ 2") tagClass += " tag-w2";
    else if (log.node === "WĘZEŁ 3") tagClass += " tag-w3";
    else if (log.node === "ALARM") tagClass += " tag-alarm";
    else tagClass += " tag-w1";

    tr.innerHTML = `
      <td>${log.displayTime || log.timestamp.substr(11, 8)}</td>
      <td><span class="${tagClass}">${log.node}</span></td>
      <td style="color: var(--accent);">${log.topic}</td>
      <td>${log.message}</td>
    `;
    tbody.appendChild(tr);
  });
}

function aktualizujLicznikLogow(ilosc) {
  const b = document.getElementById('logCountBadge');
  if (b) b.innerText = (ilosc !== undefined) ? ilosc : pamiecLogow.length;
}

function wyczyscBazeLogow() {
  if (!confirm("Czy na pewno chcesz usunąć historię logów?")) return;
  if (!dbInstance) return;
  const tx = dbInstance.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  tx.oncomplete = () => {
    pamiecLogow = [];
    przeliczStatystykiLogow();
    filtrujLogiUI();
    aktualizujLicznikLogow(0);
  };
}

function eksportujLogiCSV() {
  if (!pamiecLogow.length) return alert("Baza danych jest pusta!");
  
  let csv = "ID,Timestamp,Wezel,Topic,Wiadomosc\n";
  pamiecLogow.forEach((l, idx) => {
    const czystaWiadomosc = String(l.message || '').replace(/"/g, '""');
    csv += `${idx + 1},"${l.timestamp}","${l.node}","${l.topic}","${czystaWiadomosc}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smart_parking_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function pokazZakladke(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
  if (btn) btn.classList.add('active');
}

let audioCtx = null;
let oscylator = null;
let interwalSyreny = null;

function odblokujAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function startDzwiekAlarmu() {
  odblokujAudio();
  if (oscylator) return;
  oscylator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  oscylator.type = 'sawtooth';
  oscylator.frequency.setValueAtTime(700, audioCtx.currentTime);
  gainNode.gain.setValueAtTime(0.25, audioCtx.currentTime);
  oscylator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscylator.start();

  let toggle = false;
  interwalSyreny = setInterval(() => {
    if (!oscylator || !audioCtx) return;
    toggle = !toggle;
    oscylator.frequency.setTargetAtTime(toggle ? 950 : 650, audioCtx.currentTime, 0.05);
  }, 350);
}

function stopDzwiekAlarmu() {
  if (interwalSyreny) { clearInterval(interwalSyreny); interwalSyreny = null; }
  if (oscylator) {
    try { oscylator.stop(); oscylator.disconnect(); } catch (e) {}
    oscylator = null;
  }
}

const brokerUrl = "wss://broker.hivemq.com:8884/mqtt";
const clientId = "SP_WebClient_" + Math.random().toString(16).substr(2, 8);

const client = mqtt.connect(brokerUrl, {
  clientId: clientId,
  keepalive: 15,
  reconnectPeriod: 3000,
  connectTimeout: 5000
});

const netStatus = document.getElementById('netStatus');
const netText = document.getElementById('netText');

function updateStatus(state) {
  if (!netStatus || !netText) return;
  netStatus.className = "status-badge";
  if (state === 'online') {
    netStatus.classList.add('online');
    netText.innerText = "ONLINE";
  } else if (state === 'connecting') {
    netStatus.classList.add('connecting');
    netText.innerText = "ŁĄCZENIE...";
  } else {
    netText.innerText = "ROZŁĄCZONO";
  }
}

client.on('connect', () => {
  updateStatus('online');
  client.subscribe("parking/#");
  zapiszLogDoBazy("SYSTEM", "MQTT", "Połączono z brokerem broker.hivemq.com");
});

client.on('reconnect', () => updateStatus('connecting'));
client.on('close', () => updateStatus('offline'));
client.on('offline', () => updateStatus('offline'));
client.on('error', (err) => {
  console.error("MQTT Error:", err);
  updateStatus('offline');
});

let trybAlarmuAktywny = false;
let ostatniStanHarmonogramu = null;
let ostatnieSwiatla = 'OFF';
let stanyBram = { 1: false, 2: false, 3: false };
let stanSmietnika = false;

function ustawPigułkę(elementId, czyOtwarte) {
  const badge = document.getElementById(elementId);
  if (!badge) return;
  if (czyOtwarte) {
    badge.className = "badge badge-open";
    badge.innerText = "OTWARTY";
  } else {
    badge.className = "badge badge-closed";
    badge.innerText = "ZAMKNIĘTY";
  }
}

function aktualizujGarazSVG(gNum, czyOtwarte) {
  stanyBram[gNum] = czyOtwarte;
  const box = document.getElementById(`svgG${gNum}Box`);
  const door = document.getElementById(`svgG${gNum}Door`);
  const lbl = document.getElementById(`svgG${gNum}Label`);
  
  if (box) {
    box.setAttribute('stroke', czyOtwarte ? '#10b981' : '#334155');
    box.setAttribute('fill', czyOtwarte ? '#064e3b' : '#1e293b');
  }
  if (door) {
    door.setAttribute('fill', czyOtwarte ? '#10b981' : '#334155');
    door.setAttribute('stroke', czyOtwarte ? '#34d399' : '#64748b');
    door.setAttribute('height', czyOtwarte ? '8' : '15');
  }
  if (lbl) {
    lbl.textContent = czyOtwarte ? "OTWARTY" : "ZAMKNIĘTY";
    lbl.innerHTML = czyOtwarte ? "OTWARTY" : "ZAMKNIĘTY";
    lbl.setAttribute('fill', czyOtwarte ? '#34d399' : '#94a3b8');
  }
}

function aktualizujSmietnikUI(czyOtwarty) {
  stanSmietnika = czyOtwarty;
  const b = document.getElementById('trashBadge');
  if (b) {
    b.className = czyOtwarty ? "badge badge-open" : "badge badge-closed";
    b.innerText = czyOtwarty ? "OTWARTA" : "ZAMKNIĘTA";
  }

  const tTxt = document.getElementById('svgTrashTxt');
  const tLid = document.getElementById('svgTrashLid');
  const tBox = document.getElementById('svgTrashBox');

  if (tTxt) {
    tTxt.textContent = czyOtwarty ? "OTWARTA" : "ZAMKNIĘTA";
    tTxt.innerHTML = czyOtwarty ? "OTWARTA" : "ZAMKNIĘTA";
    tTxt.setAttribute('fill', czyOtwarty ? '#34d399' : '#94a3b8');
  }
  if (tLid) {
    tLid.setAttribute('opacity', czyOtwarty ? '0.9' : '0.3');
    tLid.setAttribute('fill', czyOtwarty ? '#34d399' : '#10b981');
  }
  if (tBox) {
    tBox.setAttribute('stroke', czyOtwarty ? '#34d399' : '#10b981');
    tBox.setAttribute('fill', czyOtwarty ? '#065f46' : '#064e3b');
  }
}

function toggleTrashFromSvg() {
  odblokujAudio();
  const nowyStan = !stanSmietnika;
  const cmd = nowyStan ? "OPEN" : "CLOSED";
  aktualizujSmietnikUI(nowyStan);
  if (client && client.connected) {
    client.publish("parking/status/trash", cmd);
    client.publish("parking/trash/set", cmd);
  }
  zapiszLogDoBazy("WĘZEŁ 2", "parking/status/trash", `Klapa śmietnika przełączona: ${cmd}`);
}

function aktualizujSwiatlaSVG(stan) {
  ostatnieSwiatla = stan;
  const on = (stan === 'ON' || stan === '1');
  const g1 = document.getElementById('svgGlow1');
  const g2 = document.getElementById('svgGlow2');
  const g3 = document.getElementById('svgGlow3');
  const d1 = document.getElementById('svgLampDot1');
  const d2 = document.getElementById('svgLampDot2');
  const d3 = document.getElementById('svgLampDot3');
  if (g1) g1.setAttribute('opacity', on ? '1' : '0');
  if (g2) g2.setAttribute('opacity', on ? '1' : '0');
  if (g3) g3.setAttribute('opacity', on ? '1' : '0');
  if (d1) d1.setAttribute('fill', on ? '#fde047' : '#64748b');
  if (d2) d2.setAttribute('fill', on ? '#fde047' : '#64748b');
  if (d3) d3.setAttribute('fill', on ? '#fde047' : '#64748b');
}

function toggleGarageFromSvg(gNum) {
  odblokujAudio();
  if (trybAlarmuAktywny) return;
  const akcja = stanyBram[gNum] ? 'CLOSE' : 'OPEN';
  controlGarage(gNum, akcja);
}

client.on('message', (topic, payload) => {
  const msg = payload.toString();

  if (topic === "parking/traffic") {
    oznaczAktywnoscWezla(2);
    try {
      const data = JSON.parse(msg);
      if (data.slots !== undefined) {
        const elS = document.getElementById('slotsVal');
        if (elS) {
          elS.innerText = data.slots + " / 3";
          elS.style.color = data.slots > 0 ? "var(--green)" : "var(--red)";
        }
        zapiszLogDoBazy("WĘZEŁ 2", topic, `Wolne miejsca: ${data.slots}/3`);
      }
    } catch (e) {}
  }

  if (topic === "parking/status/trash") {
    oznaczAktywnoscWezla(2);
    const otw = (msg === "OPEN");
    aktualizujSmietnikUI(otw);
    zapiszLogDoBazy("WĘZEŁ 2", topic, `Klapa śmietnika: ${otw ? "OTWARTA" : "ZAMKNIĘTA"}`);
  }

  if (topic === "parking/status/lights" || topic === "parking/lights") {
    oznaczAktywnoscWezla(2);
    const lb = document.getElementById('lightBadge');
    const on = (msg === "ON" || msg === "1");
    if (lb) {
      lb.className = on ? "badge badge-open" : "badge badge-closed";
      lb.innerText = on ? "WŁĄCZONE" : "WYŁĄCZONE";
      lb.style.borderColor = on ? "var(--yellow)" : "transparent";
      lb.style.color = on ? "var(--yellow)" : "var(--text-muted)";
    }
    aktualizujSwiatlaSVG(on ? 'ON' : 'OFF');
    zapiszLogDoBazy("WĘZEŁ 2", topic, `Oświetlenie: ${on ? "WŁĄCZONE" : "WYŁĄCZONE"}`);
  }

  if (!trybAlarmuAktywny && topic.startsWith("parking/garage/")) {
    oznaczAktywnoscWezla(1);
    const gNum = topic.split("/")[2];
    const isOpen = (msg === "OPEN");
    ustawPigułkę("g" + gNum + "Badge", isOpen);
    aktualizujGarazSVG(gNum, isOpen);
    zapiszLogDoBazy("WĘZEŁ 1", topic, `Brama G${gNum}: ${isOpen ? "OTWARTA" : "ZAMKNIĘTA"}`);
  }

  if (topic === "parking/environment") {
    oznaczAktywnoscWezla(3);
    try {
      const env = JSON.parse(msg);
      if (env.temp !== undefined && env.hum !== undefined) {
        const elT = document.getElementById('tempVal');
        const elH = document.getElementById('humVal');
        if (elT) elT.innerText = env.temp.toFixed(1) + " °C";
        if (elH) elH.innerText = Math.round(env.hum) + " %";

        const svgTh = document.getElementById('svgTempHum');
        if (svgTh) svgTh.innerText = `${env.temp.toFixed(1)}°C | ${Math.round(env.hum)}%`;

        const tStr = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (window.envChart) {
          envChart.data.labels.push(tStr);
          envChart.data.datasets[0].data.push(env.temp);
          envChart.data.datasets[1].data.push(env.hum);

          if (envChart.data.labels.length > 20) {
            envChart.data.labels.shift();
            envChart.data.datasets[0].data.shift();
            envChart.data.datasets[1].data.shift();
          }
          envChart.update();
        }
      }
    } catch (e) {}
  }

  if (topic === "parking/alerts/fire") {
    oznaczAktywnoscWezla(3);
    const banner = document.getElementById('alarmBanner');
    const statusLbl = document.getElementById('alarmStatusLabel');
    const smk1 = document.getElementById('svgSmoke1');
    const smk2 = document.getElementById('svgSmoke2');
    const smk3 = document.getElementById('svgSmoke3');

    if (msg === "ALARM") {
      trybAlarmuAktywny = true;
      if (banner) banner.style.display = "block";
      if (statusLbl) {
        statusLbl.innerText = "EWAKUACJA! WYKRYTO ZAGROŻENIE";
        statusLbl.style.color = "var(--red)";
      }
      
      ustawPigułkę("g1Badge", true);
      ustawPigułkę("g2Badge", true);
      ustawPigułkę("g3Badge", true);
      aktualizujGarazSVG(1, true);
      aktualizujGarazSVG(2, true);
      aktualizujGarazSVG(3, true);

      if (smk1) smk1.style.display = "block";
      if (smk2) smk2.style.display = "block";
      if (smk3) smk3.style.display = "block";

      document.querySelectorAll('.gate-ctrl').forEach(b => b.disabled = true);
      startDzwiekAlarmu();
      zapiszLogDoBazy("ALARM", topic, "WYWOŁANIE ALARMU PPOŻ - OTWARCIE BRAM");
    } else if (msg === "CLEAR") {
      trybAlarmuAktywny = false;
      if (banner) banner.style.display = "none";
      if (statusLbl) {
        statusLbl.innerText = "BEZPIECZNIE (BRAK ZAGROŻENIA)";
        statusLbl.style.color = "var(--green)";
      }

      document.querySelectorAll('.gate-ctrl').forEach(b => b.disabled = false);
      ustawPigułkę("g1Badge", false);
      ustawPigułkę("g2Badge", false);
      ustawPigułkę("g3Badge", false);
      aktualizujGarazSVG(1, false);
      aktualizujGarazSVG(2, false);
      aktualizujGarazSVG(3, false);

      if (smk1) smk1.style.display = "none";
      if (smk2) smk2.style.display = "none";
      if (smk3) smk3.style.display = "none";

      stopDzwiekAlarmu();
      zapiszLogDoBazy("ALARM", topic, "ODWOŁANIE ALARMU PPOŻ - POWRÓT DO NORMY");
    }
  }
});

function setLights(state) {
  if (client.connected) {
    client.publish("parking/lights/set", state);
    client.publish("parking/status/lights", state);
  }
}

function setLightsManual(state) {
  odblokujAudio();
  const schedBox = document.getElementById('schedEnable');
  if (schedBox && schedBox.checked) {
    schedBox.checked = false;
    toggleSchedule();
  }
  setLights(state);
}

function controlGarage(gateNum, action) {
  odblokujAudio();
  if (trybAlarmuAktywny) return;
  const isOpen = (action === 'OPEN');
  ustawPigułkę("g" + gateNum + "Badge", isOpen);
  aktualizujGarazSVG(gateNum, isOpen);

  if (client && client.connected) {
    client.publish("parking/control/gates", JSON.stringify({ gate: gateNum, action: action }));
    client.publish("parking/garage/" + gateNum + "/set", action);
  }
  zapiszLogDoBazy("WĘZEŁ 1", "parking/garage/" + gateNum, `Brama G${gateNum}: ${isOpen ? "OTWARTA" : "ZAMKNIĘTA"}`);
}

function sendFireAlarm(state) {
  odblokujAudio();
  const zalogowanyUzytkownik = localStorage.getItem("sp_user_session");
  
  if (zalogowanyUzytkownik !== "admin") {
    alert("⚠️ ODMOWA DOSTĘPU!\n\nTylko administrator (konto 'admin') posiada uprawnienia do wyzwalania i odwoływania procedury alarmowej PPOŻ.");
    zapiszLogDoBazy("SYSTEM", "SECURITY", `Nieautoryzowana próba zmiany alarmu [${state}] przez użytkownika: ${zalogowanyUzytkownik}`);
    return;
  }

  if (client && client.connected) {
    client.publish("parking/alerts/fire", state, { qos: 1 });
    zapiszLogDoBazy("ADMIN", "parking/alerts/fire", `Administrator wymusił stan alarmu: ${state}`);
  } else {
    alert("Brak połączenia z brokerem MQTT! Sprawdź status sieci.");
  }
}

function toggleSchedule() {
  odblokujAudio();
  const isEnabled = document.getElementById('schedEnable').checked;
  const statusText = document.getElementById('schedStatusText');
  if (isEnabled) {
    statusText.innerText = "Status: Aktywny (Auto)";
    statusText.style.color = "var(--green)";
    ostatniStanHarmonogramu = null;
    checkScheduleNow();
  } else {
    statusText.innerText = "Status: Nieaktywny";
    statusText.style.color = "var(--text-muted)";
    ostatniStanHarmonogramu = null;
  }
}

function checkScheduleNow() {
  const schedEl = document.getElementById('schedEnable');
  if (!schedEl || !schedEl.checked) return;

  const now = new Date();
  const curTime = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0');
  const tOn = document.getElementById('timeOn').value;
  const tOff = document.getElementById('timeOff').value;

  let powinnoSwiecic = (tOn < tOff) ? (curTime >= tOn && curTime < tOff) : (curTime >= tOn || curTime < tOff);

  if (powinnoSwiecic !== ostatniStanHarmonogramu) {
    ostatniStanHarmonogramu = powinnoSwiecic;
    setLights(powinnoSwiecic ? "ON" : "OFF");
  }
}
setInterval(checkScheduleNow, 2000);

let envChart = null;

window.addEventListener('DOMContentLoaded', () => {
  const chartCanvas = document.getElementById('envChart');
  if (chartCanvas) {
    const ctx = chartCanvas.getContext('2d');
    envChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temperatura (°C)',
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            data: [],
            yAxisID: 'yTemp'
          },
          {
            label: 'Wilgotność (%)',
            borderColor: '#38bdf8',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 4],
            tension: 0.35,
            pointRadius: 2,
            data: [],
            yAxisID: 'yHum'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
          yTemp: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#10b981', font: { size: 11 } }, suggestedMin: 15, suggestedMax: 35 },
          yHum: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#38bdf8', font: { size: 11 } }, suggestedMin: 20, suggestedMax: 90 }
        },
        plugins: { legend: { labels: { color: '#f8fafc', font: { size: 12 } } } }
      }
    });
  }

  sprawdzZalogowanie();
  initDatabase();
});
