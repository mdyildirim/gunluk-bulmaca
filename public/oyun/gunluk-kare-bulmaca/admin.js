import { buildWords, normalizeSolution, validate, isoToUrlDate, reconcileImport, normAnswer } from "./shared/engine.js";

const BASE = "/oyun/gunluk-kare-bulmaca";
const IMPORT_PROVIDER = "openai";
const PREVIEW_KEY = "cumhuriyet-bulmaca-admin-preview";
const $=id=>document.getElementById(id);
let clues={across:{},down:{}};
let answerEdits={across:{},down:{}};
let media=[];
let mediaPlacementMode="auto";

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
const intVal=(id,def=1)=>{const n=Math.trunc(Number($(id).value));return Number.isFinite(n)&&n>0?n:def;};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const hasMediaPlacement=m=>Number.isFinite(Number(m.row))&&Number.isFinite(Number(m.col))&&
  Number.isFinite(Number(m.rows))&&Number.isFinite(Number(m.cols));
function mediaForGrid(rows,cols){
  return media.filter(m=>m&&m.src&&hasMediaPlacement(m)).map(m=>{
    const row=clamp(Math.trunc(Number(m.row)||1),1,Math.max(1,rows));
    const col=clamp(Math.trunc(Number(m.col)||1),1,Math.max(1,cols));
    const rs=clamp(Math.trunc(Number(m.rows)||1),1,Math.max(1,rows-row+1));
    const cs=clamp(Math.trunc(Number(m.cols)||1),1,Math.max(1,cols-col+1));
    return {type:"image",src:m.src,row,col,rows:rs,cols:cs};
  });
}
function syncMediaControls(){
  const m=media[0]||{};
  $("mediaRow").value=m.row||"";
  $("mediaCol").value=m.col||"";
  $("mediaRows").value=m.rows||"";
  $("mediaCols").value=m.cols||"";
  $("mediaStatus").textContent=m.src?(hasMediaPlacement(m)?"Görsel yerleştirildi.":"Görsel hazır."):"";
}
function cleanMediaForPayload(){
  const {rows,cols}=model();
  return mediaForGrid(rows,cols);
}
function updateMediaFromControls(){
  if(!media[0]||!media[0].src)return;
  mediaPlacementMode="manual";
  media[0]={...media[0],
    row:intVal("mediaRow",media[0].row||1),
    col:intVal("mediaCol",media[0].col||1),
    rows:intVal("mediaRows",media[0].rows||1),
    cols:intVal("mediaCols",media[0].cols||1)};
  renderPreview();
}
function nudgeMedia(dr,dc){
  if(!media[0]||!media[0].src){$("mediaStatus").textContent="Önce görsel seçin.";return;}
  if(!hasMediaPlacement(media[0])&&!autoPlaceMedia({quiet:true}))return;
  const {rows,cols}=model();
  const current=mediaForGrid(rows,cols)[0];
  if(!current)return;
  mediaPlacementMode="manual";
  media[0]={...media[0],
    row:clamp(current.row+dr,1,Math.max(1,rows-current.rows+1)),
    col:clamp(current.col+dc,1,Math.max(1,cols-current.cols+1)),
    rows:current.rows,
    cols:current.cols};
  syncMediaControls();
  renderPreview();
}
function largestBlackRect(){
  const {rows,cols,isBlack}=model();
  const heights=Array(cols).fill(0);
  let best={row:1,col:1,rows:1,cols:1,area:0};
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++)heights[c]=isBlack(r,c)?heights[c]+1:0;
    const stack=[];
    for(let c=0;c<=cols;c++){
      const h=c<cols?heights[c]:0;
      while(stack.length&&heights[stack[stack.length-1]]>h){
        const idx=stack.pop(),height=heights[idx];
        const left=stack.length?stack[stack.length-1]+1:0;
        const width=c-left,area=height*width;
        if(area>best.area)best={row:r-height+2,col:left+1,rows:height,cols:width,area};
      }
      stack.push(c);
    }
  }
  return best.area?best:null;
}
function autoPlaceMedia({quiet=false}={}){
  if(!media[0]||!media[0].src){if(!quiet)$("mediaStatus").textContent="Önce görsel seçin.";return false;}
  const rect=largestBlackRect();
  if(!rect){
    delete media[0].row;delete media[0].col;delete media[0].rows;delete media[0].cols;
    syncMediaControls();renderPreview();
    $("mediaStatus").textContent=quiet?"Görsel hazır.":"Siyah alan bulunamadı.";
    return false;
  }
  mediaPlacementMode="auto";
  media[0]={...media[0],row:rect.row,col:rect.col,rows:rect.rows,cols:rect.cols};
  syncMediaControls();
  renderPreview();
  return true;
}
function handleGridInput(){
  if(media[0]&&media[0].src&&mediaPlacementMode==="auto"){
    autoPlaceMedia({quiet:true});
    return;
  }
  renderPreview();
}
function renderPreviewMedia(g,rows,cols){
  for(const m of mediaForGrid(rows,cols)){
    const box=document.createElement("div");
    box.className="preview-media";
    box.style.gridRow=`${m.row} / span ${m.rows}`;
    box.style.gridColumn=`${m.col} / span ${m.cols}`;
    const img=document.createElement("img");
    img.src=m.src;
    img.alt="";
    box.appendChild(img);
    g.appendChild(box);
  }
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
    d.style.gridRow=String(r+1);
    d.style.gridColumn=String(c+1);
    if(isBlack(r,c))d.className="pc b";
    else{d.className="pc";const n=numberAt[r+","+c];
      if(n){const s=document.createElement("span");s.className="n";s.textContent=n;d.appendChild(s);}
      d.appendChild(document.createTextNode(sol[r][c]));}
    g.appendChild(d);
  }
  renderPreviewMedia(g,rows,cols);
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
  return {date:$("date").value,no:$("no").value,title:$("title").value,solution:readGrid(),clues,media:cleanMediaForPayload()};
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
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(String(fr.result));
    fr.onerror=()=>reject(fr.error);
    fr.readAsDataURL(file);
  });
}
async function imageFileToDataUrl(file){
  const src=await fileToDataUrl(file);
  const img=await new Promise((resolve,reject)=>{
    const im=new Image();
    im.onload=()=>resolve(im);
    im.onerror=()=>reject(new Error("Görsel okunamadı."));
    im.src=src;
  });
  const maxSide=900,scale=Math.min(1,maxSide/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
  const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
  const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
  const canvas=document.createElement("canvas");
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");
  ctx.drawImage(img,0,0,w,h);
  const out=canvas.toDataURL("image/jpeg",0.82);
  if(out.length>1200000)throw new Error("Görsel çok büyük.");
  return out;
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
    if(media[0]&&media[0].src&&mediaPlacementMode==="auto")autoPlaceMedia({quiet:true});
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
$("grid").addEventListener("input",handleGridInput);
$("genClues").onclick=genClues;
$("validate").onclick=()=>showReport(validate(payload()));
$("saveDraft").onclick=()=>save("draft");
$("schedule").onclick=()=>save("scheduled");
$("openPlayer").addEventListener("click",preparePlayerPreview);
$("mediaImage").addEventListener("change",async e=>{
  const file=e.target.files&&e.target.files[0];
  if(!file)return;
  try{
    mediaPlacementMode="auto";
    media=[{type:"image",src:await imageFileToDataUrl(file)}];
    autoPlaceMedia({quiet:true});
  }catch(err){
    media=[];mediaPlacementMode="auto";syncMediaControls();renderPreview();alert((err&&err.message)||"Görsel yüklenemedi.");
  }
});
["mediaRow","mediaCol","mediaRows","mediaCols"].forEach(id=>$(id).addEventListener("input",updateMediaFromControls));
$("mediaUp").onclick=()=>nudgeMedia(-1,0);
$("mediaDown").onclick=()=>nudgeMedia(1,0);
$("mediaLeft").onclick=()=>nudgeMedia(0,-1);
$("mediaRight").onclick=()=>nudgeMedia(0,1);
$("mediaAuto").onclick=autoPlaceMedia;
$("mediaClear").onclick=()=>{media=[];mediaPlacementMode="auto";$("mediaImage").value="";syncMediaControls();renderPreview();};
genClues();loadList();
