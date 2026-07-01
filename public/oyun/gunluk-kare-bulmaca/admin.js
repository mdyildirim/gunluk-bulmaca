import { buildWords, normalizeSolution, validate, isoToUrlDate, reconcileImport, normAnswer } from "./shared/engine.js";

const BASE = "/oyun/gunluk-kare-bulmaca";
const IMPORT_PROVIDER = "openai";
const PREVIEW_KEY = "cumhuriyet-bulmaca-admin-preview";
const $=id=>document.getElementById(id);
let clues={across:{},down:{}};
let answerEdits={across:{},down:{}};

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
function gridAnswerSet(m){
  return new Set(m.words.map(w=>normAnswer(w.cells.map(c=>m.sol[c.r][c.c]).join(""))));
}
function checkAnswerInput(row,input,answers){
  const ok=answers.has(normAnswer(input.value));
  row.classList.toggle("answer-missing",!ok);
  input.title=ok?"Izgarada var":"Izgarada bu cevap yok";
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
  const answers=gridAnswerSet(m);
  const a=$("acrossClues"),d=$("downClues");a.innerHTML="";d.innerHTML="";
  const mk=w=>{
    const ans=w.cells.map(c=>m.sol[c.r][c.c]).join("");
    const row=document.createElement("div");row.className="clue-row";
    const lbl=document.createElement("span");lbl.className="lbl";lbl.textContent=w.num;
    const ansInp=document.createElement("input");ansInp.type="text";ansInp.className="ans-input";
    ansInp.value=(answerEdits[w.dir]&&answerEdits[w.dir][w.num])||ans;ansInp.placeholder="Cevap";
    ansInp.addEventListener("input",()=>{
      answerEdits[w.dir][w.num]=ansInp.value;
      checkAnswerInput(row,ansInp,answers);
    });
    const inp=document.createElement("input");inp.type="text";
    inp.className="clue-input";
    inp.value=(clues[w.dir]&&clues[w.dir][w.num])||"";inp.placeholder="İpucu…";
    inp.addEventListener("input",()=>{clues[w.dir][w.num]=inp.value;});
    row.appendChild(lbl);row.appendChild(ansInp);
    row.appendChild(inp);checkAnswerInput(row,ansInp,answers);return row;
  };
  m.words.filter(w=>w.dir==="across").sort((x,y)=>x.num-y.num).forEach(w=>a.appendChild(mk(w)));
  m.words.filter(w=>w.dir==="down").sort((x,y)=>x.num-y.num).forEach(w=>d.appendChild(mk(w)));
  renderPreview();
  updatePlayerPreviewHref();
}
function payload(){
  return {date:$("date").value,no:$("no").value,title:$("title").value,solution:readGrid(),clues};
}
function updatePlayerPreviewHref(){
  $("openPlayer").href=`${BASE}/play.html?preview=admin`;
}
function preparePlayerPreview(e){
  const data=payload();
  if(!data.solution.length||!data.solution.join("").replace(/#/g,"").trim()){
    e.preventDefault();alert("Önizleme için ızgara gerekli.");return;
  }
  showReport(validate(data));
  try{
    localStorage.setItem(PREVIEW_KEY,JSON.stringify({createdAt:Date.now(),puzzle:data}));
    $("openPlayer").href=`${BASE}/play.html?preview=admin&v=${Date.now()}`;
  }catch(err){
    e.preventDefault();alert("Önizleme hazırlanamadı.");
  }
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
  }catch(e){alert("API'ye ulaşılamadı.");}
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
function setImportProgress(active,label=""){
  const box=$("importProgress"),txt=$("importProgressText"),st=$("importStatus");
  if(box)box.classList.toggle("active",!!active);
  if(txt)txt.textContent=label||"Analiz sürüyor";
  if(st)st.textContent=label;
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
  let grid;
  const btn=$("importBtn"),old=btn.textContent;
  btn.disabled=true;btn.textContent="Analiz ediliyor...";
  setImportProgress(true,"Analiz ediliyor");
  $("importIssues").innerHTML="";
  try{
    const imageBase64=await fileToBase64(fs);
    const res=await fetch(`${BASE}/api/admin/import`,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({provider:IMPORT_PROVIDER,imageBase64,mimeType:fs.type,withGrid:true})});
    const isStream=(res.headers.get("content-type")||"").includes("application/x-ndjson");
    const data = isStream
      ? await readImportStream(res,m=>{
          if(m.phase==="words") setImportProgress(true,"İpuçları işleniyor");
          else if(m.t==="grid") setImportProgress(true,"Izgara hazır");
          else setImportProgress(true,"Analiz ediliyor");
        })
      : await res.json().catch(()=>({}));
    if(!res.ok||!data.ok){setImportProgress(false,"");alert("Analiz hatası: "+(data.error||res.status)+(data.detail?("\n"+data.detail):""));return;}
    if(!Array.isArray(data.grid)||!data.grid.length){
      setImportProgress(false,"");alert("Izgara okunamadı"+(data.gridError?": "+data.gridError:"."));return;
    }
    if(!Array.isArray(data.words)||!data.words.length){
      setImportProgress(false,"");alert("İpuçları okunamadı.");return;
    }
    {
      $("grid").value=data.grid.join("\n");
      $("grid").dispatchEvent(new Event("input"));
      grid=readGrid();
    }
    const rec=reconcileImport({grid,clues:data.words});
    clues=rec.clues;
    genClues();
    showReport(validate(payload()));
    renderImportIssues(rec.issues);
    const filled=Object.keys(rec.clues.across).length+Object.keys(rec.clues.down).length;
    const miss=rec.issues.filter(i=>i.level==="info").length;
    const warn=rec.issues.filter(i=>i.level==="warn").length;
    setImportProgress(false,`${data.words.length} ipucu · ${filled} eşleşti · ${miss} eksik`+(warn?` · ${warn} uyarı`:""));
  }catch(e){setImportProgress(false,"");alert("İçe aktarma başarısız: "+((e&&e.message)||e));}
  finally{btn.disabled=false;btn.textContent=old;}
}

$("importBtn").onclick=runImport;
$("grid").addEventListener("input",renderPreview);
$("genClues").onclick=genClues;
$("validate").onclick=()=>showReport(validate(payload()));
$("saveDraft").onclick=()=>save("draft");
$("schedule").onclick=()=>save("scheduled");
$("openPlayer").addEventListener("click",preparePlayerPreview);
genClues();loadList();
