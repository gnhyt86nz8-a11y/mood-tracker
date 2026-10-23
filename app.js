(() => {
  "use strict";
  const DB_NAME = "mood-urge-tracker";
  const DB_VERSION = 1;
  const STORE = "daily-records";
  const $ = (id) => document.getElementById(id);
  const fields = {
    morningMood: { type: "mood", period: "morning", prop: "mood" },
    morningUrge: { type: "urge", period: "morning", prop: "urge" },
    eveningMood: { type: "mood", period: "evening", prop: "mood" },
    eveningUrge: { type: "urge", period: "evening", prop: "urge" }
  };
  let db;
  let selectedDate = dateKey(new Date());
  let weekOffset = 0;
  let draft = blankRecord(selectedDate);
  let saveTimer = null;

  function dateKey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function fromKey(key) { const [y,m,d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12); }
  function shiftDate(key, amount) { const d = fromKey(key); d.setDate(d.getDate() + amount); return dateKey(d); }
  function fmt(key, options = { month: "numeric", day: "numeric", weekday: "short" }) { return fromKey(key).toLocaleDateString("ja-JP", options); }
  function blankRecord(date) {
    return { date, morning: { mood: null, urge: null }, evening: { mood: null, urge: null }, comment: "", updatedAt: null };
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("このブラウザでは端末内保存が利用できません。"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "date" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("保存領域を開けませんでした。"));
    });
  }
  function getRecord(date) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(date);
      req.onsuccess = () => resolve(req.result || blankRecord(date));
      req.onerror = () => reject(req.error);
    });
  }
  function getAllRecords() {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function putRecord(record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("保存に失敗しました。"));
      tx.onabort = () => reject(tx.error || new Error("保存が中断されました。"));
    });
  }
  function deleteRecord(date) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(date);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  function valueLabel(value, type) {
    if (value === null || value === undefined || value === "") return "—";
    return type === "mood" && Number(value) > 0 ? `+${value}` : String(value);
  }
  function setField(period, type, value) {
    const prop = type === "mood" ? "mood" : "urge";
    draft[period][prop] = value;
    renderInputs();
    scheduleSave();
  }
  function renderScale(id, type, period) {
    const container = $(id);
    container.replaceChildren();
    const values = type === "mood" ? [-3,-2,-1,0,1,2,3] : [0,1,2,3];
    values.forEach(v => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = v > 0 && type === "mood" ? `+${v}` : String(v);
      b.setAttribute("aria-pressed", String(draft[period][type] === v));
      if (type === "mood" && v < 0) b.classList.add("negative");
      if (type === "mood" && v > 0) b.classList.add("positive");
      b.addEventListener("click", () => setField(period, type, v));
      container.appendChild(b);
    });
  }
  function renderInputs() {
    renderScale("morningMoodChoices", "mood", "morning");
    renderScale("morningUrgeChoices", "urge", "morning");
    renderScale("eveningMoodChoices", "mood", "evening");
    renderScale("eveningUrgeChoices", "urge", "evening");
    $("morningMoodOutput").textContent = valueLabel(draft.morning.mood, "mood");
    $("morningUrgeOutput").textContent = valueLabel(draft.morning.urge, "urge");
    $("eveningMoodOutput").textContent = valueLabel(draft.evening.mood, "mood");
    $("eveningUrgeOutput").textContent = valueLabel(draft.evening.urge, "urge");
    $("dailyComment").value = draft.comment || "";
    $("commentCount").textContent = `${(draft.comment || "").length} / 500`;
    $("dateHeading").textContent = selectedDate === dateKey(new Date()) ? "今日の記録" : fmt(selectedDate, { year:"numeric", month:"long", day:"numeric" });
    $("recordDate").value = selectedDate;
    $("morningSaved").textContent = hasPeriodData(draft.morning) ? "記録あり" : "未記録";
    $("eveningSaved").textContent = hasPeriodData(draft.evening) ? "記録あり" : "未記録";
    $("morningSaved").classList.toggle("done", hasPeriodData(draft.morning));
    $("eveningSaved").classList.toggle("done", hasPeriodData(draft.evening));
  }
  function hasPeriodData(p) { return p.mood !== null || p.urge !== null; }
  async function loadDate(key) {
    await flushSave();
    selectedDate = key;
    draft = await getRecord(key);
    draft.morning ||= { mood:null, urge:null };
    draft.evening ||= { mood:null, urge:null };
    draft.comment ||= "";
    renderInputs();
    $("saveStatus").textContent = "記録はこのiPhone内に保存されます。";
  }
  function scheduleSave() {
    $("saveStatus").textContent = "変更を保存中…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraft(false), 350);
  }
  async function saveDraft(showMessage = true) {
    clearTimeout(saveTimer);
    saveTimer = null;
    draft.comment = $("dailyComment").value.slice(0, 500);
    const empty = !hasPeriodData(draft.morning) && !hasPeriodData(draft.evening) && !draft.comment.trim();
    try {
      if (empty) {
        await deleteRecord(selectedDate);
        draft.updatedAt = null;
      } else {
        draft.updatedAt = new Date().toISOString();
        await putRecord(structuredClone(draft));
      }
      $("saveStatus").textContent = showMessage ? "保存しました。" : "変更を保存しました。";
      await renderWeek();
      renderInputs();
    } catch (e) {
      $("saveStatus").textContent = "保存できませんでした。CSV書き出しやブラウザ設定を確認してください。";
      console.error(e);
    }
  }
  async function flushSave() { if (saveTimer) await saveDraft(false); }
  function dayCell(v, type) {
    return v === null || v === undefined ? "—" : valueLabel(v, type);
  }
  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  }
async function renderWeek() {
  // 週間一覧は水曜日から火曜日まで
  const today = fromKey(dateKey(new Date()));
  const daysSinceTuesday = (today.getDay() - 2 + 7) % 7;
  const end = dateKey(new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - daysSinceTuesday + weekOffset * 7,
    12
  ));
  const start = shiftDate(end, -6);
    $("weekRange").textContent = `${fmt(start)} 〜 ${fmt(end)}（水〜火）`;
    const all = await getAllRecords();
    const map = new Map(all.map(r => [r.date, r]));
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const key = shiftDate(start, i);
      const r = map.get(key) || blankRecord(key);
      const todayClass = key === dateKey(new Date()) ? "today-row" : "";
      rows.push(`<tr class="${todayClass}"><td><button class="date-link" data-date="${key}" type="button">${escapeHTML(fmt(key))}</button></td><td>${dayCell(r.morning?.mood, "mood")} / ${dayCell(r.morning?.urge, "urge")}</td><td>${dayCell(r.evening?.mood, "mood")} / ${dayCell(r.evening?.urge, "urge")}</td><td class="note-cell">${escapeHTML(r.comment || "")}</td></tr>`);
    }
    $("weekTable").innerHTML = rows.join("");
    $("weekTable").querySelectorAll("[data-date]").forEach(b => b.addEventListener("click", () => loadDate(b.dataset.date)));
    drawChart("moodChart", Array.from({length:7},(_,i)=>map.get(shiftDate(start,i)) || blankRecord(shiftDate(start,i))), "mood");
    drawChart("urgeChart", Array.from({length:7},(_,i)=>map.get(shiftDate(start,i)) || blankRecord(shiftDate(start,i))), "urge");
  }
  function drawChart(canvasId, records, type) {
    const canvas = $(canvasId);
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssHeight = canvasId === "moodChart" ? 180 : 160;
    canvas.width = Math.max(280, Math.round(rect.width * dpr));
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const w = canvas.width / dpr, h = cssHeight;
    const left = 28, right = 12, top = 16, bottom = 28;
    const plotW = w - left - right, plotH = h - top - bottom;
    const min = type === "mood" ? -3 : 0, max = type === "mood" ? 3 : 3;
    const y = v => top + (max - v) / (max - min) * plotH;
    const x = i => left + (records.length === 1 ? plotW/2 : i * plotW/(records.length-1));
    ctx.clearRect(0,0,w,h);
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let v=min; v<=max; v++) {
      const yy=y(v);
      ctx.strokeStyle = v === 0 ? "#c4cbc5" : "#e9ebe7";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left,yy); ctx.lineTo(w-right,yy); ctx.stroke();
      ctx.fillStyle = "#737a76"; ctx.fillText(type === "mood" && v > 0 ? `+${v}` : `${v}`, left-8, yy);
    }
    const series = [
      { key:"morning", color:"#477d72" },
      { key:"evening", color:"#b77b58" }
    ];
    series.forEach(s => {
      ctx.strokeStyle=s.color; ctx.fillStyle=s.color; ctx.lineWidth=2; ctx.lineJoin="round";
      let started=false;
      records.forEach((r,i) => {
        const val = r[s.key]?.[type];
        if (val === null || val === undefined) { started=false; return; }
        if (!started) { ctx.beginPath(); ctx.moveTo(x(i),y(val)); started=true; }
        else ctx.lineTo(x(i),y(val));
      });
      ctx.stroke();
      records.forEach((r,i) => {
        const val = r[s.key]?.[type];
        if (val === null || val === undefined) return;
        ctx.beginPath(); ctx.arc(x(i),y(val),3.5,0,Math.PI*2); ctx.fill();
      });
    });
    ctx.textAlign="center"; ctx.textBaseline="top"; ctx.fillStyle="#737a76";
    records.forEach((r,i) => ctx.fillText(fmt(r.date,{month:"numeric",day:"numeric"}), x(i), h-bottom+8));
    ctx.textAlign="left";
    ctx.fillStyle="#477d72"; ctx.fillRect(left,3,8,8); ctx.fillStyle="#505653"; ctx.fillText("午前",left+12,2);
    ctx.fillStyle="#b77b58"; ctx.fillRect(left+43,3,8,8); ctx.fillStyle="#505653"; ctx.fillText("午後",left+55,2);
  }
  function csvEscape(value) {
    const s = String(value ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }
  async function exportCSV() {
    await flushSave();
    const records = (await getAllRecords()).sort((a,b)=>a.date.localeCompare(b.date));
    const header = ["date","morning_mood","morning_urge","evening_mood","evening_urge","comment","updated_at"];
    const lines = [header.map(csvEscape).join(",")];
    records.forEach(r => lines.push([
      r.date, r.morning?.mood ?? "", r.morning?.urge ?? "",
      r.evening?.mood ?? "", r.evening?.urge ?? "", r.comment ?? "", r.updatedAt ?? ""
    ].map(csvEscape).join(",")));
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mood-urge-records-${dateKey(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    $("dataStatus").textContent = `${records.length}日分のCSVを書き出しました。`;
  }
  function parseCSV(text) {
    const rows=[]; let row=[], cell="", quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c === '"' && text[i+1] === '"'){cell+='"';i++;}
        else if(c === '"') quoted=false;
        else cell+=c;
      } else {
        if(c === '"' && cell === "") quoted=true;
        else if(c === ","){row.push(cell);cell="";}
        else if(c === "\n"){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}
        else cell+=c;
      }
    }
    if(cell.length || row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}
    return rows;
  }
  async function importCSV(file) {
    const text = (await file.text()).replace(/^\uFEFF/,"");
    const rows = parseCSV(text);
    if(rows.length < 2) throw new Error("CSVに読み込める記録がありません。");
    const headers = rows[0].map(s=>s.trim());
    const required = ["date","morning_mood","morning_urge","evening_mood","evening_urge","comment"];
    if(!required.every(h=>headers.includes(h))) throw new Error("CSVの列名が想定と異なります。アプリから書き出したCSVを選んでください。");
    const index = Object.fromEntries(headers.map((h,i)=>[h,i]));
    let count=0;
    for(const row of rows.slice(1)){
      if(!row[index.date] || !/^\d{4}-\d{2}-\d{2}$/.test(row[index.date])) continue;
      const numberOrNull = (s,min,max) => {
        if(s === "" || s === undefined) return null;
        const n=Number(s); return Number.isInteger(n) && n>=min && n<=max ? n : null;
      };
      const r = {
        date:row[index.date],
        morning:{mood:numberOrNull(row[index.morning_mood],-3,3),urge:numberOrNull(row[index.morning_urge],0,3)},
        evening:{mood:numberOrNull(row[index.evening_mood],-3,3),urge:numberOrNull(row[index.evening_urge],0,3)},
        comment:row[index.comment] || "",
        updatedAt: row[index.updated_at] || new Date().toISOString()
      };
      await putRecord(r); count++;
    }
    $("dataStatus").textContent = `${count}日分を読み込みました。同じ日付の記録はCSVの内容で上書きされます。`;
    await loadDate(selectedDate); await renderWeek();
  }
  function setupEvents() {
    $("recordDate").addEventListener("change", e => e.target.value && loadDate(e.target.value));
    $("prevDay").addEventListener("click", () => loadDate(shiftDate(selectedDate,-1)));
    $("nextDay").addEventListener("click", () => loadDate(shiftDate(selectedDate,1)));
    $("todayBtn").addEventListener("click", () => { weekOffset=0; loadDate(dateKey(new Date())); renderWeek(); });
    $("dailyComment").addEventListener("input", () => { $("commentCount").textContent = `${$("dailyComment").value.length} / 500`; scheduleSave(); });
    $("saveBtn").addEventListener("click", () => saveDraft(true));
    $("weekPrev").addEventListener("click", async () => { weekOffset--; await renderWeek(); });
$("weekNext").addEventListener("click", async () => { weekOffset++; await renderWeek(); });
    $("exportBtn").addEventListener("click", exportCSV);
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", async e => {
      const file=e.target.files?.[0]; if(!file) return;
      try { await importCSV(file); } catch(err) { $("dataStatus").textContent = err.message || "読み込みに失敗しました。"; }
      e.target.value="";
    });
    window.addEventListener("resize", () => renderWeek());
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden") flushSave(); });
  }
  async function main() {
    setupEvents();
    try {
      db = await openDB();
      await loadDate(selectedDate);
      await renderWeek();
      if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
        navigator.serviceWorker.register("./service-worker.js")
          .then(() => { $("offlineStatus").textContent = "オフライン機能：キャッシュを準備しています。初回はオンラインで開いたままお待ちください。"; })
          .catch(() => { $("offlineStatus").textContent = "オフライン機能の準備に失敗しました。オンラインで再読み込みしてください。"; });
      } else {
        $("offlineStatus").textContent = "オフライン機能を利用するにはHTTPSで開いてください。";
      }
    } catch (e) {
      $("saveStatus").textContent = e.message || "アプリを初期化できませんでした。";
      $("offlineStatus").textContent = "保存機能を利用できません。Safariのプライベートブラウズを避けてください。";
    }
  }
  main();
})();
