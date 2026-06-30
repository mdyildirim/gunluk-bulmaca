import { buildWords, normalizeSolution, validate, isoToUrlDate, reconcileImport, normAnswer, slotCatalogFromSolution, normalizeSlotId } from "./shared/engine.js";

const BASE = "/oyun/gunluk-kare-bulmaca";
const $=id=>document.getElementById(id);
let clues={across:{},down:{}};
const PROVIDER_LABELS={gemini:"Gemini 3.5 Flash",openai:"OpenAI gpt-5.5"};
const THINKING_OPTIONS={
  gemini:["low","medium","high"],
  openai:["low","medium","high","xhigh"]
};
const THINKING_DEFAULTS={
  gemini:{grid:"low",clue:"low"},
  openai:{grid:"high",clue:"high"}
};

$("date").value=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Istanbul"}).format(new Date());

function readGrid(){
  return $("grid").value.split("\n").map(l=>l.replace(/\s+$/,"")).filter((l,i,a)=>!(i===a.length-1&&l===""));
}
function model(){
  const solution=readGrid();
  const {rows,cols,sol}=normalizeSolution(solution);
  const {words,numberAt,isBlack}=buildWords(sol,rows,cols);
  return {solution,rows,cols,sol,words,numberAt,isBlack};
}
function importSlotsForGrid(grid){
  return slotCatalogFromSolution(grid).map(s => ({
    id: s.id,
    dir: s.dir,
    answer: s.answer
  }));
}
function renderPreview(){
  const {rows,cols,sol,numberAt,isBlack}=model();
  const g=$("previewGrid");g.innerHTML="";g.style.gridTemplateColumns=`repeat(${cols},26px)`;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const d=document.createElement("div");
    if(isBlack(r,c))d.className="pc b";
    else{d.className="pc";const n=numberAt[r+","+c];
      if(n){const s=document.createElement("span");s.className="n";s.textContent=n;d.appendChild(s);}
      d.appendChild(document.createTextNode(sol[r][c]));}
    g.appendChild(d);
  }
}
function genClues(){
  const m=model();
  const a=$("acrossClues"),d=$("downClues");a.innerHTML="";d.innerHTML="";
  const mk=w=>{
    const ans=w.cells.map(c=>m.sol[c.r][c.c]).join("");
    const row=document.createElement("div");row.className="clue-row";
    row.innerHTML=`<span class="lbl">${w.num} <small>${ans}</small></span>`;
    const inp=document.createElement("input");inp.type="text";
    inp.value=(clues[w.dir]&&clues[w.dir][w.num])||"";inp.placeholder="İpucu…";
    inp.addEventListener("input",()=>{clues[w.dir][w.num]=inp.value;});
    row.appendChild(inp);return row;
  };
  m.words.filter(w=>w.dir==="across").sort((x,y)=>x.num-y.num).forEach(w=>a.appendChild(mk(w)));
  m.words.filter(w=>w.dir==="down").sort((x,y)=>x.num-y.num).forEach(w=>d.appendChild(mk(w)));
  renderPreview();
  $("openPlayer").href=`${BASE}/${isoToUrlDate($("date").value)||""}`;
}
function payload(){
  return {date:$("date").value,no:$("no").value,title:$("title").value,solution:readGrid(),clues};
}
function showReport(v){
  let h="";
  if(v.ok)h+=`<div class="ok">✓ Geçerli — ${v.wordCount} kelime, ${v.rows}×${v.cols}.</div>`;
  v.errors.forEach(e=>h+=`<div class="e">✗ ${e}</div>`);
  v.warnings.forEach(w=>h+=`<div class="w">⚠ ${w}</div>`);
  $("report").innerHTML=h||'<div class="ok">✓ Sorun yok.</div>';
}
async function save(status){
  const v=validate(payload());showReport(v);
  if(!v.ok){alert("Doğrulama hatası var, önce düzeltin.");return;}
  try{
    const res=await fetch(`${BASE}/api/admin/puzzles`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...payload(),status})});
    if(res.ok){alert(status==="scheduled"?"Yayına zamanlandı.":"Taslak kaydedildi.");loadList();}
    else{const e=await res.json().catch(()=>({}));alert("Kaydetme hatası: "+JSON.stringify(e.errors||e.error||res.status));}
  }catch(e){alert("API'ye ulaşılamadı (yerel statik önizleme?). 'JSON indir' ile dışa aktarabilirsiniz.");}
}
async function loadList(){
  try{
    const res=await fetch(`${BASE}/api/admin/puzzles`);if(!res.ok)throw 0;
    const {puzzles}=await res.json();
    const tb=$("list").querySelector("tbody");tb.innerHTML="";
    if(!puzzles||!puzzles.length){tb.innerHTML='<tr><td class="sub">Kayıt yok.</td></tr>';return;}
    puzzles.forEach(p=>{const tr=document.createElement("tr");
      tr.innerHTML=`<td><a href="${BASE}/${isoToUrlDate(p.puzzle_date)}" target="_blank">${p.puzzle_date}</a></td><td>${p.no||""}</td><td><span class="pill ${p.status}">${p.status}</span></td>`;
      tb.appendChild(tr);});
  }catch(e){$("list").querySelector("tbody").innerHTML='<tr><td class="sub">API yok (yerel statik önizleme).</td></tr>';}
}

// --- Görselden içe aktar (LLM) ---
function selectedProvider(){
  const p=($("importProvider")&&$("importProvider").value)||"gemini";
  return THINKING_OPTIONS[p]?p:"gemini";
}
function setThinkingOptions(select,provider,value){
  if(!select)return;
  const opts=THINKING_OPTIONS[provider]||THINKING_OPTIONS.gemini;
  select.innerHTML=opts.map(v=>`<option value="${v}">${v}</option>`).join("");
  select.value=opts.includes(value)?value:opts[0];
}
function applyProviderDefaults(){
  const provider=selectedProvider();
  const d=THINKING_DEFAULTS[provider]||THINKING_DEFAULTS.gemini;
  setThinkingOptions($("gridThinking"),provider,d.grid);
  setThinkingOptions($("clueThinking"),provider,d.clue);
}
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>{const s=String(fr.result);resolve(s.slice(s.indexOf(",")+1));};
    fr.onerror=()=>reject(fr.error);
    fr.readAsDataURL(file);
  });
}
function renderIssues(targetId,issues){
  const el=$(targetId);if(!el)return;el.innerHTML="";
  if(!issues||!issues.length){el.innerHTML='<div class="i-ok">✓ Sorun bulunamadı.</div>';return;}
  const rank={error:0,warn:1,info:2};
  issues.slice().sort((a,b)=>(rank[a.level]??9)-(rank[b.level]??9)).forEach(it=>{
    const d=document.createElement("div");d.className="i-"+(it.level||"info");
    const icon=it.level==="error"?"✗":it.level==="warn"?"⚠":"•";
    d.textContent=`${icon} ${it.msg}`;el.appendChild(d);
  });
}
function renderImportIssues(issues){renderIssues("importIssues",issues);}
function renderCsvIssues(issues){renderIssues("csvIssues",issues);}

// --- CSV'den ipucu içe aktar ---
function csvDelimiter(line){
  const delims=[",",";","\t"];let best=",",bestCount=-1;
  for(const d of delims){
    let q=false,c=0;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){if(q&&line[i+1]==='"')i++;else q=!q;}
      else if(!q&&ch===d)c++;
    }
    if(c>bestCount){best=d;bestCount=c;}
  }
  return best;
}
function parseCsv(text){
  const clean=String(text||"").replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");
  const first=(clean.split("\n").find(l=>l.trim())||"");
  const delim=csvDelimiter(first);
  const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<clean.length;i++){
    const ch=clean[i];
    if(ch==='"'){
      if(q&&clean[i+1]==='"'){cell+='"';i++;}
      else q=!q;
    }else if(!q&&ch===delim){row.push(cell);cell="";}
    else if(!q&&ch==="\n"){row.push(cell);rows.push(row);row=[];cell="";}
    else cell+=ch;
  }
  row.push(cell);rows.push(row);
  return rows.map(r=>r.map(c=>String(c||"").trim())).filter(r=>r.some(Boolean));
}
function csvKey(s){
  return String(s||"").trim().toLocaleLowerCase("tr-TR")
    .replace(/[ıİI]/g,"i").replace(/[ğĞ]/g,"g").replace(/[üÜ]/g,"u")
    .replace(/[şŞ]/g,"s").replace(/[öÖ]/g,"o").replace(/[çÇ]/g,"c")
    .replace(/[^a-z0-9]/g,"");
}
function csvHeaderMap(row){
  const aliases={
    answer:new Set(["answer","cevap","yanit","kelime","word"]),
    clue:new Set(["clue","ipucu","hint","soru","tanim","definition"]),
    dir:new Set(["dir","direction","yon","yol","dogrultu"]),
    slot:new Set(["slot","slotid","id","no","numara"])
  };
  const map={};
  row.forEach((h,i)=>{
    const k=csvKey(h);
    for(const [name,set] of Object.entries(aliases))if(set.has(k)&&map[name]==null)map[name]=i;
  });
  return Object.keys(map).length?map:null;
}
function csvDir(raw){
  const s=csvKey(raw);
  if(!s)return "";
  if(s.includes("asag")||s.includes("yukar")||s.includes("dikey")||s==="d"||s==="down"||s==="vertical"||String(raw).includes("↓"))return "down";
  if(s.includes("soldan")||s.includes("saga")||s.includes("yatay")||s==="a"||s==="across"||s==="horizontal"||String(raw).includes("→"))return "across";
  return "";
}
function answerLike(v){
  const raw=String(v||"").trim();
  const a=normAnswer(raw);
  return !!a&&a.length<=32&&raw.replace(/\s+/g,"").length<=a.length+2&&!/[.,;:!?]/.test(raw);
}
function csvEntryFromRow(row,map,idx,issues,answerSet){
  let answer="",dir="",clue="",slot="";
  if(map){
    answer=row[map.answer]||"";
    dir=csvDir(row[map.dir]||"");
    clue=row[map.clue]||"";
    slot=normalizeSlotId(row[map.slot]||"");
  }else if(row.length===2){
    const a0=answerLike(row[0]),a1=answerLike(row[1]);
    const m0=answerSet&&answerSet.has(normAnswer(row[0]));
    const m1=answerSet&&answerSet.has(normAnswer(row[1]));
    if(/^(A\d+|D\d+)$/i.test(normalizeSlotId(row[0]))){slot=normalizeSlotId(row[0]);clue=row[1];}
    else if(m1&&!m0){clue=row[0];answer=row[1];}
    else if(m0&&!m1){answer=row[0];clue=row[1];}
    else if(a1&&!a0){clue=row[0];answer=row[1];}
    else{answer=row[0];clue=row[1];if(a0&&a1)issues.push({level:"info",msg:`CSV ${idx}. satır başlıksız ve belirsiz; ilk sütun cevap varsayıldı.`});}
  }else{
    const d1=csvDir(row[1]||""),d2=csvDir(row[2]||"");
    if(answerLike(row[1])&&d2){clue=row[0];answer=row[1];dir=d2;}
    else{answer=row[0]||"";dir=d1;clue=row.slice(2).join(" ").trim();}
  }
  if(!clue.trim()){issues.push({level:"warn",msg:`CSV ${idx}. satır atlandı: ipucu boş.`});return null;}
  if(slot&&slot!=="?"&&!/^[AD]\d+$/.test(slot)){issues.push({level:"warn",msg:`CSV ${idx}. satır: geçersiz slot "${slot}".`});slot="";}
  if(!slot&&!normAnswer(answer)){issues.push({level:"warn",msg:`CSV ${idx}. satır atlandı: cevap/slot yok.`});return null;}
  return {answer,dir:dir||undefined,clue,slot:slot||undefined,_csvRow:idx};
}
function inferCsvSlots(entries,grid,issues){
  const byAns=new Map();
  slotCatalogFromSolution(grid).forEach(s=>{
    const a=normAnswer(s.answer);
    if(!byAns.has(a))byAns.set(a,[]);
    byAns.get(a).push(s);
  });
  return entries.filter(e=>{
    if(e.slot||e.dir)return true;
    const a=normAnswer(e.answer);
    const matches=byAns.get(a)||[];
    if(matches.length===1){
      e.slot=matches[0].id;e.dir=matches[0].dir;e.answer=matches[0].answer;
      return true;
    }
    if(matches.length>1)issues.push({level:"warn",msg:`CSV ${e._csvRow}. satır: "${e.answer}" birden fazla yerde var; yön veya slot ekleyin.`});
    else issues.push({level:"warn",msg:`CSV ${e._csvRow}. satır: "${e.answer}" ızgarada bulunamadı.`});
    return false;
  }).map(({_csvRow,...e})=>e);
}
function parseClueCsv(text,grid){
  const issues=[];
  const rows=parseCsv(text);
  if(!rows.length)return {entries:[],issues:[{level:"error",msg:"CSV boş."}]};
  const map=csvHeaderMap(rows[0]);
  const dataRows=map?rows.slice(1):rows;
  const answerSet=new Set(slotCatalogFromSolution(grid).map(s=>normAnswer(s.answer)));
  if(map&&!((map.clue!=null)&&((map.answer!=null)||(map.slot!=null))))
    return {entries:[],issues:[{level:"error",msg:"CSV başlığında ipucu + cevap veya ipucu + slot bulunmalı."}]};
  if(!map)issues.push({level:"info",msg:"Başlık yok; 2 sütunda ızgaraya göre cevap/ipucu tahmini, 3 sütunda cevap/yön/ipucu varsayıldı."});
  const entries=dataRows.map((r,i)=>csvEntryFromRow(r,map,i+(map?2:1),issues,answerSet)).filter(Boolean);
  return {entries:inferCsvSlots(entries,grid,issues),issues};
}
function mergeClues(base,incoming){
  return {
    across:{...(base&&base.across||{}),...(incoming&&incoming.across||{})},
    down:{...(base&&base.down||{}),...(incoming&&incoming.down||{})}
  };
}
async function runCsvImport(){
  const fs=$("csvClues").files&&$("csvClues").files[0];
  const st=$("csvStatus");renderCsvIssues([]);
  if(!fs){alert("CSV dosyası seçin.");return;}
  const grid=readGrid();
  if(!grid.length||!grid.join("").replace(/#/g,"").trim()){alert("CSV eşleştirmek için önce ızgarayı yazın.");return;}
  try{
    const text=await fs.text();
    const parsed=parseClueCsv(text,grid);
    if(!parsed.entries.length){st.textContent="";renderCsvIssues(parsed.issues);alert("CSV'den eşleşebilir ipucu çıkmadı.");return;}
    const rec=reconcileImport({grid,clues:parsed.entries});
    clues=mergeClues(clues,rec.clues);
    genClues();
    showReport(validate(payload()));
    const filled=Object.keys(rec.clues.across).length+Object.keys(rec.clues.down).length;
    const issues=[...parsed.issues,...rec.issues];
    renderCsvIssues(issues);
    st.textContent=`${parsed.entries.length} CSV satırı okundu · ${filled} ipucu ızgaraya işlendi.`;
  }catch(e){st.textContent="";alert("CSV içe aktarma başarısız: "+((e&&e.message)||e));}
}
// LLM'in HAM yanıtlarını + eşleştirme hedefini ekrana dök (hata ayıklama).
// gridUsed = eşleştirmede kullanılan ızgara satırları (LLM taslağı ya da elle yazılan).
function renderImportDebug(data,gridUsed){
  const wrap=$("importDebugWrap"),pre=$("importDebug");if(!wrap||!pre)return;
  const arr=d=>d==="down"?"↓":"→";const pad=(s,n)=>String(s).padStart(n);
  const u=data.usage||{},c=data.cost||{};
  // GERÇEK token sayısı (varsayım yok). Dolar yalnızca import.js'te oran girilmişse.
  const tok=x=>x?`girdi ${x.promptTokenCount||0} · çıktı ${x.candidatesTokenCount||0} · düşünce ${x.thoughtsTokenCount||0} · TOPLAM ${x.totalTokenCount||0} token`:"(veri yok)";
  const dollar=x=>(typeof x==="number"&&isFinite(x))?`  ≈ $${x.toFixed(5)}`:"";
  const L=[];
  if(data.provider||data.model) L.push(`model: ${data.provider||"-"} · ${data.model||"-"}`);
  if(data.thinking) L.push(`thinking: grid=${data.thinking.grid||"-"} · ipucu=${data.thinking.clues||"-"}`);
  // 1) İPUÇ-SLOT EŞLEŞMELERİ
  const ws=data.words||[];
  L.push(`══ 1) İPUÇ-SLOT EŞLEŞMELERİ — ${ws.length} adet (slot·cevap·yön·ipucu) ══`);
  ws.forEach((w,i)=>L.push(`${pad(i+1,2)}. ${w.slot?`${w.slot} `:""}${arr(w.dir)} ${w.answer||"?"}  —  ${w.clue}`));
  // 2) İPUÇ ÜRETİM MALİYETİ
  L.push("");L.push(`══ 2) İPUÇ ÜRETİM MALİYETİ${dollar(c.words)} ══`);
  L.push(tok(u.words));
  // 3) IZGARA (LLM'in ürettiği taslak)
  L.push("");L.push(`══ 3) IZGARA ══`);
  if(data.grid&&data.grid.length){
    data.grid.forEach((row,i)=>{const len=(row||"").length;L.push(`${pad(i+1,2)}|${pad(len,2)}| ${row}`);});
  }else if(data.gridError){L.push(`⚠ Izgara üretilemedi: ${data.gridError}`);}
  else{L.push("(Izgara LLM'den istenmedi — “Izgarayı da doldur” işaretli değil.)");}
  // 4) IZGARA ÜRETİM MALİYETİ
  L.push("");L.push(`══ 4) IZGARA ÜRETİM MALİYETİ${dollar(c.grid)} ══`);
  L.push(u.grid?tok(u.grid):"(Izgara üretilmedi — maliyet yok.)");
  // 5+6) eşleştirme tanısı: kullanılan ızgaradan türetilen kelimeler + eşleşmeyenler
  try{
    const g=gridUsed||[];
    const {rows,cols,sol}=normalizeSolution(g);
    const {words}=buildWords(sol,rows,cols);
    const derived=words.map(w=>({num:w.num,slot:(w.dir==="down"?"D":"A")+w.num,dir:w.dir,ans:w.cells.map(cc=>sol[cc.r][cc.c]).join("")}));
    L.push("");L.push(`══ 5) EŞLEŞTİRME HEDEFİ — kullanılan ızgaradan ${derived.length} kelime (${(data.grid&&data.grid.length)?"LLM":"elle yazılan"}) ══`);
    derived.forEach(d=>L.push(`${pad(d.num,2)} ${d.slot} ${arr(d.dir)} ${d.ans}`));
    const have=new Set(derived.map(d=>d.dir+"|"+d.ans));
    const haveSlot=new Set(derived.map(d=>d.slot));
    const miss=ws.filter(w=>w.slot?!haveSlot.has(String(w.slot).toUpperCase()):!have.has(w.dir+"|"+normAnswer(w.answer)));
    L.push("");L.push(`══ 6) EŞLEŞMEYEN — ${miss.length}/${ws.length} ══`);
    miss.forEach(w=>{
      if(w.slot){L.push(`${w.slot} ${arr(w.dir)} ${w.answer||"?"} → slot ızgarada yok`);return;}
      const a=normAnswer(w.answer);
      const other=derived.find(d=>d.ans===a&&d.dir!==w.dir);
      const within=derived.find(d=>d.dir===w.dir&&d.ans!==a&&d.ans.includes(a));
      let why=" → ızgarada yok (harf hatası?)";
      if(other)why=` → ızgarada ${arr(other.dir)} olarak var (yön mü ters?)`;
      else if(within)why=` → türetilen "${within.ans}" İÇİNDE (ızgarada # sınırı eksik?)`;
      L.push(`${arr(w.dir)} ${w.answer}${why}`);
    });
  }catch(e){L.push("(türetme hatası: "+((e&&e.message)||e)+")");}
  pre.textContent=L.join("\n");wrap.style.display="";wrap.open=true;
}
// Izgara isteğinde sunucu NDJSON akışı döndürür (her satır bir JSON nesnesi):
//   {t:"progress",sec,think} canlı tutar · {t:"result",...} sonuç · {t:"error",error}.
// Akan "progress" satırları bağlantıyı canlı tutar (524 olmaz). Son sonucu döndürür.
async function readImportStream(res,onProgress){
  const reader=res.body.getReader();const dec=new TextDecoder();
  let buf="",final=null,early=null,err=null;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      let nl;
      while((nl=buf.indexOf("\n"))>=0){
        const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);
        if(!line)continue;
        let m;try{m=JSON.parse(line);}catch{continue;}
        if(m.t==="progress")onProgress&&onProgress(m);
        else if(m.t==="grid")onProgress&&onProgress(m);
        else if(m.t==="words")early=m;                       // ipuçları erken geldi
        else if(m.t==="result")final=m;
        else if(m.t==="error")err=m.error||"bilinmeyen akış hatası";
      }
    }
  }catch(e){
    const msg=(e&&e.message)||e||"network error";
    if(early)return {ok:true,words:early.words,grid:null,gridError:"Akış bağlantısı kesildi: "+msg,partial:true};
    return {ok:false,error:"Akış bağlantısı kesildi.",detail:String(msg).slice(0,200)};
  }
  if(final)return final;                                   // tam sonuç (ipuçları + ızgara)
  // Tam sonuç gelmedi: en azından erken gelen ipuçlarını kurtar (worker ızgarada kesilmiş olabilir).
  if(early)return {ok:true,words:early.words,grid:null,
    gridError:(err?("Izgara: "+err):"Izgara akışı tamamlanmadı (worker süre sınırında kesilmiş olabilir)."),partial:true};
  if(err)return {ok:false,error:err};
  return {ok:false,error:"Akış bir sonuç döndürmedi."};
}
async function runImport(){
  const fs=$("imgSolved").files&&$("imgSolved").files[0];
  if(!fs){alert("Çözülmüş fotoğrafı seçin.");return;}
  const wantGrid=$("wantGrid")&&$("wantGrid").checked;
  const provider=selectedProvider();
  const providerLabel=PROVIDER_LABELS[provider]||provider;
  let grid=readGrid();
  if(!wantGrid && (!grid.length||!grid.join("").replace(/#/g,"").trim())){
    alert("Önce “2 · Izgara” bölümüne çözümü yazın — ya da “Izgarayı da doldur”u işaretleyin.");return;}
  const rows=parseInt(($("gridRows")&&$("gridRows").value)||"",10);
  const cols=parseInt(($("gridCols")&&$("gridCols").value)||"",10);
  const gridThinking=($("gridThinking")&&$("gridThinking").value)||"low";
  const clueThinking=($("clueThinking")&&$("clueThinking").value)||"low";
  if(wantGrid && (!rows||!cols) &&
     !confirm("Izgara boyutu (satır/sütun) girilmedi; sabit genişlik dayatılmaz ve hizalama daha sık kayar. Yine de devam edilsin mi?")) return;
  const btn=$("importBtn"),st=$("importStatus"),old=btn.textContent;
  btn.disabled=true;btn.textContent="İşleniyor… (~1 dk)";
  st.textContent=wantGrid?`${providerLabel}: fotoğraftan ızgara + ipuçları okunuyor (grid:${gridThinking}, ipucu:${clueThinking})…`:`${providerLabel}: fotoğraftan ipuçları okunuyor (ipucu:${clueThinking})…`;
  $("importIssues").innerHTML="";
  try{
    const imageBase64=await fileToBase64(fs);
    const slots=!wantGrid?importSlotsForGrid(grid):[];
    const res=await fetch(`${BASE}/api/admin/import`,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({provider,imageBase64,mimeType:fs.type,withGrid:!!wantGrid,
        rows:rows||undefined,cols:cols||undefined,slots,gridThinking,clueThinking})});
    // Izgara isteğinde yanıt AKIŞTIR (NDJSON); değilse düz JSON.
    const isStream=(res.headers.get("content-type")||"").includes("application/x-ndjson");
    const data = isStream
      ? await readImportStream(res,m=>{
          const pl=PROVIDER_LABELS[m.provider]||providerLabel;
          if(m.phase==="words") st.textContent=`${pl}: ipuçları grid slotlarına bağlanıyor… ${m.count||0} slot`+(m.sec?` · ${m.sec} sn`:"");
          else if(m.t==="grid") st.textContent=`Izgara taslağı alındı · ${m.count||0} slot bulundu`;
          else st.textContent=`${pl}: ızgara üretiliyor… ${m.sec||0} sn · düşünce ${(m.think||0).toLocaleString("tr-TR")} token (akış — 524 yok)`;
        })
      : await res.json().catch(()=>({}));
    console.log("[import] HAM YANIT →",data);                 // konsol yedeği
    if(!res.ok||!data.ok){st.textContent="";renderImportDebug(data||{},grid);alert("LLM hatası: "+(data.error||res.status)+(data.detail?("\n"+data.detail):""));return;}
    if(wantGrid && Array.isArray(data.grid) && data.grid.length){   // ızgara taslağını editöre koy
      $("grid").value=data.grid.join("\n");
      $("grid").dispatchEvent(new Event("input"));
      grid=readGrid();
    }
    const rec=reconcileImport({grid,clues:data.words});   // ipuçlarını ızgaradaki kelimelere cevaba göre eşle
    clues=rec.clues;
    genClues();
    showReport(validate(payload()));
    renderImportIssues(rec.issues);
    renderImportDebug(data,grid);
    const filled=Object.keys(rec.clues.across).length+Object.keys(rec.clues.down).length;
    const miss=rec.issues.filter(i=>i.level==="info").length;
    const warn=rec.issues.filter(i=>i.level==="warn").length;
    const gridNote=wantGrid?(data.grid&&data.grid.length?"Izgara taslağı kondu · ":(data.gridError?"Izgara okunamadı · ":"")):"";
    st.textContent=`[${data.model||providerLabel}] `+gridNote+`${(data.words||[]).length} ipucu okundu · ${filled} eşleşti · ${miss} eksik`+(warn?` · ${warn} uyarı`:"")+
      `. ${wantGrid?"Izgarayı fotoğrafla karşılaştırıp düzeltin, ":""}eksikleri yazıp kaydedin.`;
  }catch(e){st.textContent="";alert("İçe aktarma başarısız: "+((e&&e.message)||e));}
  finally{btn.disabled=false;btn.textContent=old;}
}

$("importBtn").onclick=runImport;
$("importProvider").addEventListener("change",applyProviderDefaults);
$("csvImportBtn").onclick=runCsvImport;
$("grid").addEventListener("input",renderPreview);
$("genClues").onclick=genClues;
$("validate").onclick=()=>showReport(validate(payload()));
$("saveDraft").onclick=()=>save("draft");
$("schedule").onclick=()=>save("scheduled");
$("exportJson").onclick=()=>{
  const blob=new Blob([JSON.stringify(payload(),null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download=`bulmaca-${$("date").value||"taslak"}.json`;a.click();
};
applyProviderDefaults();genClues();loadList();
