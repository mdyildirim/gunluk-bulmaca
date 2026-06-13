import { buildWords, normalizeSolution, validate } from "./shared/engine.js";

const BASE = "/oyun/gunluk-kare-bulmaca";
const $=id=>document.getElementById(id);
let clues={across:{},down:{}};

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
  $("openPlayer").href=`${BASE}/${$("date").value}`;
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
      tr.innerHTML=`<td><a href="${BASE}/${p.puzzle_date}" target="_blank">${p.puzzle_date}</a></td><td>${p.no||""}</td><td><span class="pill ${p.status}">${p.status}</span></td>`;
      tb.appendChild(tr);});
  }catch(e){$("list").querySelector("tbody").innerHTML='<tr><td class="sub">API yok (yerel statik önizleme).</td></tr>';}
}

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
genClues();loadList();
