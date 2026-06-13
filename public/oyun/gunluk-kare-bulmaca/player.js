import { buildPuzzle, isLetter, TR_UP, isUrlDate, urlDateToIso, isoToUrlDate } from "./shared/engine.js";

/* Mount tabanı — Cumhuriyet proxy'si bu yolu bu projeye yönlendirir. */
const BASE = "/oyun/gunluk-kare-bulmaca";
const ISO = /(\d{4}-\d{2}-\d{2})/;
const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const DAYS = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];

function trDate(iso){
  const m = ISO.exec(iso || ""); if(!m) return iso || "";
  const d = new Date(m[1] + "T00:00:00");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${DAYS[d.getDay()]}`;
}
function shiftDate(iso, days){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m-1, d+days)).toISOString().slice(0,10);
}

/* Çevrimdışı / API yokken örnek bulmaca */
const FALLBACK = {
  date:"2026-06-13", no:"13",
  solution:["TAM#","E#AY","KASA","#KAR"],
  clues:{ across:{"1":"Eksiksiz, bütün.","3":"Gökyüzünün gece ışığı; takvim dilimi.","5":"Mağazada ödemenin yapıldığı yer.","7":"Kışın yağan beyaz örtü."},
          down:{"1":"Yalnız, bir tane.","2":"Üstünde yemek yenen mobilya.","4":"Sevgili; uçurum kenarı.","6":"Beyaz, temiz."} }
};
function fillerPuzzle(n){
  const sol=[]; for(let r=0;r<n;r++){let row="";for(let c=0;c<n;c++){row+=((r%2&&c%2))?"#":"A";}sol.push(row);}
  return {date:"Yerleşim testi "+n+"×"+n,no:"demo",solution:sol,clues:{across:{},down:{}}};
}

let P, sel={r:null,c:null,dir:"across"}, entries={}, instant=true, STORAGE="", activeDate=null;
const $=id=>document.getElementById(id);

function dateFromUrl(){
  // Yol Türkçe biçimde: /oyun/gunluk-kare-bulmaca/13-06-2026 → dahili ISO'ya çevir.
  const m = /(\d{2}-\d{2}-\d{4})/.exec(location.pathname);
  if(m && isUrlDate(m[1])) return urlDateToIso(m[1]);
  const q = new URLSearchParams(location.search).get("date");
  return q && ISO.test(q) ? q : null;
}

// Sonuç durumları: ok (gerçek bulmaca), empty (o gün yok / 404),
// error (beklenmeyen hata), demo (API'ye hiç ulaşılamadı → yerel önizleme).
async function loadPuzzle(){
  const params=new URLSearchParams(location.search);
  // ?demo → gerçekçi örnek bulmaca (API'siz önizleme); ?demo=21 → NxN yerleşim testi.
  if(params.has("demo")){
    const n=parseInt(params.get("demo"));
    return {state:"ok", puzzle: n ? fillerPuzzle(n) : FALLBACK};
  }
  const date=dateFromUrl();
  activeDate=date;
  try{
    const res=await fetch(date ? `${BASE}/api/puzzle/${date}` : `${BASE}/api/today`);
    if(res.ok){
      const d=await res.json();
      if(d&&d.solution){ activeDate=d.date||date; return {state:"ok", puzzle:d}; }
      return {state:"error", date};
    }
    if(res.status===404) return {state:"empty", date};
    return {state:"error", date};
  }catch(e){
    // API'ye hiç ulaşılamadı (ör. `npm run preview` ile statik önizleme) →
    // açıkça "demo" etiketiyle örnek bulmacayı göster, hatayı gizleme.
    return {state:"demo", puzzle:FALLBACK, date};
  }
}

function init(raw){
  P=buildPuzzle(raw);
  STORAGE="cumhuriyet-bulmaca-"+(P.date||P.no);
  try{const s=JSON.parse(localStorage.getItem(STORAGE));if(s&&s.entries)entries=s.entries;}catch(e){}
  $("dateText").textContent=trDate(P.date);
  $("puzzleNo").textContent=P.no||"—";
  document.title=`${trDate(P.date)} Kare Bulmaca — Cumhuriyet`;

  const board=$("board");
  board.style.gridTemplateColumns=`repeat(${P.cols},var(--cell))`;
  const avail=Math.min(window.innerWidth-40,460);
  const cell=Math.max(30,Math.min(52,Math.floor(avail/P.cols)));
  document.documentElement.style.setProperty("--cell",cell+"px");

  window.cellEls={};
  for(let r=0;r<P.rows;r++)for(let c=0;c<P.cols;c++){
    const el=document.createElement("div");
    el.className="cell"+(P.isBlack(r,c)?" black":"");
    if(!P.isBlack(r,c)){
      const n=P.numberAt[r+","+c];
      if(n){const ns=document.createElement("span");ns.className="num";ns.textContent=n;el.appendChild(ns);}
      const ch=document.createElement("span");ch.className="ch";el.appendChild(ch);
      el.addEventListener("click",()=>onCellClick(r,c));
      window.cellEls[r+","+c]=el;
    }
    board.appendChild(el);
  }
  buildClueLists();
  setArchiveNav(ISO.exec(activeDate||P.date||"")?.[1]||null);
  const first=[...P.words].sort((a,b)=>a.num-b.num)[0];
  if(first)sel={r:first.cells[0].r,c:first.cells[0].c,dir:first.dir};
  render(); checkComplete();
}

function setArchiveNav(iso){
  $("todayLink").href=`${BASE}/`;
  if(iso){
    $("prevDay").href=`${BASE}/${isoToUrlDate(shiftDate(iso,-1))}`;
    $("nextDay").href=`${BASE}/${isoToUrlDate(shiftDate(iso, 1))}`;
  }else{
    $("prevDay").classList.add("disabled");
    $("nextDay").classList.add("disabled");
  }
}

// API "bugün/bu tarih için bulmaca yok" (404) ya da hata döndürdüğünde:
// demo bulmacayla maskelemek yerine dürüst bir bilgi ekranı göster.
function showNotice(state, date){
  const iso = ISO.exec(date||"")?.[1];
  $("dateText").textContent = iso ? trDate(iso) : "—";
  $("puzzleNo").textContent = "—";
  if(iso) document.title = `${trDate(iso)} Kare Bulmaca — Cumhuriyet`;
  document.querySelector(".cluebar").style.display="none";
  document.querySelector(".layout").style.display="none";
  const m = state==="empty"
    ? {h:"Bu güne ait bulmaca yok", p:"Bu tarih için bulmaca henüz yayımlanmamış olabilir. Bugünün bulmacasını ya da diğer günleri deneyebilirsiniz."}
    : {h:"Bulmaca yüklenemedi", p:"Beklenmeyen bir sorun oluştu. Lütfen biraz sonra tekrar deneyin."};
  $("notice").innerHTML =
    `<div class="notice-h">${m.h}</div><div class="notice-p">${m.p}</div>`+
    `<a class="notice-btn" href="${BASE}/">Bugünün bulmacası</a>`;
  $("notice").style.display="block";
  setArchiveNav(iso||null);
}

function activeWord(){const k=sel.r+","+sel.c;if(sel.r===null||!P.cellWords[k])return null;
  return P.cellWords[k][sel.dir]||P.cellWords[k].across||P.cellWords[k].down||null;}

function render(){
  for(const k in window.cellEls){const el=window.cellEls[k];el.className="cell";
    el.querySelector(".ch").textContent=entries[k]||"";}
  const w=activeWord();
  if(w)w.cells.forEach(({r,c})=>window.cellEls[r+","+c].classList.add("hl"));
  if(sel.r!==null)window.cellEls[sel.r+","+sel.c].classList.add("active");
  if(instant)for(const k in window.cellEls){const[r,c]=k.split(",").map(Number);
    if(entries[k])window.cellEls[k].classList.add(entries[k]===P.sol[r][c]?"correct":"wrong");}
  $("clueTag").textContent=w?`${w.num} ${w.dir==="across"?"Soldan Sağa":"Yukarıdan Aşağıya"}`:"—";
  $("clueText").textContent=w?w.clue:"—";
  document.querySelectorAll(".cluelist li").forEach(li=>li.classList.remove("sel"));
  if(w){const li=document.querySelector(`.cluelist li[data-key="${w.key}"]`);if(li)li.classList.add("sel");}
  try{localStorage.setItem(STORAGE,JSON.stringify({entries}));}catch(e){}
}

function buildClueLists(){
  const a=$("acrossList"),d=$("downList");a.innerHTML="";d.innerHTML="";
  const mk=w=>{const li=document.createElement("li");li.dataset.key=w.key;
    li.innerHTML=`<span class="n">${w.num}</span><span>${w.clue}</span>`;
    li.addEventListener("click",()=>{sel={r:w.cells[0].r,c:w.cells[0].c,dir:w.dir};focusInput();render();});return li;};
  P.words.filter(w=>w.dir==="across").sort((x,y)=>x.num-y.num).forEach(w=>a.appendChild(mk(w)));
  P.words.filter(w=>w.dir==="down").sort((x,y)=>x.num-y.num).forEach(w=>d.appendChild(mk(w)));
}

function onCellClick(r,c){
  const k=r+","+c,has=P.cellWords[k]||{};
  if(sel.r===r&&sel.c===c){if(has.across&&has.down)sel.dir=sel.dir==="across"?"down":"across";}
  else{sel.r=r;sel.c=c;if(!has[sel.dir])sel.dir=has.across?"across":"down";}
  focusInput();render();
}
function focusInput(){$("hiddenInput").focus({preventScroll:true});}

function nextInWord(){const w=activeWord();if(!w)return;
  const i=w.cells.findIndex(c=>c.r===sel.r&&c.c===sel.c);
  for(let j=i+1;j<w.cells.length;j++)if(!entries[w.cells[j].r+","+w.cells[j].c]){sel.r=w.cells[j].r;sel.c=w.cells[j].c;return;}
  if(i+1<w.cells.length){sel.r=w.cells[i+1].r;sel.c=w.cells[i+1].c;}}
function prevInWord(){const w=activeWord();if(!w)return;
  const i=w.cells.findIndex(c=>c.r===sel.r&&c.c===sel.c);if(i>0){sel.r=w.cells[i-1].r;sel.c=w.cells[i-1].c;}}
function placeLetter(ch){if(sel.r===null)return;entries[sel.r+","+sel.c]=TR_UP(ch);nextInWord();render();checkComplete();}

const hidden=$("hiddenInput");
hidden.addEventListener("input",e=>{const d=e.data;hidden.value="";if(d&&isLetter(d))placeLetter(d);});
hidden.addEventListener("keydown",e=>{
  if(e.key==="Backspace"){e.preventDefault();const k=sel.r+","+sel.c;
    if(entries[k]){entries[k]="";}else{prevInWord();entries[sel.r+","+sel.c]="";}render();return;}
  if(e.key==="ArrowRight"){e.preventDefault();step(0,1);}
  else if(e.key==="ArrowLeft"){e.preventDefault();step(0,-1);}
  else if(e.key==="ArrowDown"){e.preventDefault();step(1,0);}
  else if(e.key==="ArrowUp"){e.preventDefault();step(-1,0);}
  else if(e.key===" "){e.preventDefault();const has=P.cellWords[sel.r+","+sel.c]||{};if(has.across&&has.down){sel.dir=sel.dir==="across"?"down":"across";render();}}
  else if(e.key==="Tab"){e.preventDefault();jumpWord(e.shiftKey?-1:1);}
});
function step(dr,dc){if(sel.r===null)return;let r=sel.r+dr,c=sel.c+dc;
  while(r>=0&&c>=0&&r<P.rows&&c<P.cols&&P.isBlack(r,c)){r+=dr;c+=dc;}
  if(r<0||c<0||r>=P.rows||c>=P.cols||P.isBlack(r,c))return;
  sel.r=r;sel.c=c;sel.dir=dc!==0?"across":"down";
  const has=P.cellWords[r+","+c]||{};if(!has[sel.dir])sel.dir=has.across?"across":"down";render();}
function jumpWord(dir){const ord=[...P.words].sort((a,b)=>a.num-b.num||(a.dir==="across"?-1:1));
  let i=ord.indexOf(activeWord());i=(i+dir+ord.length)%ord.length;const w=ord[i];
  sel={r:w.cells[0].r,c:w.cells[0].c,dir:w.dir};focusInput();render();}

$("prevClue").onclick=()=>jumpWord(-1);
$("nextClue").onclick=()=>jumpWord(1);
$("instant").onchange=e=>{instant=e.target.checked;render();};
$("zoomIn").onclick=()=>bumpZoom(6);
$("zoomOut").onclick=()=>bumpZoom(-6);
function bumpZoom(d){const cur=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--cell"));
  document.documentElement.style.setProperty("--cell",Math.max(22,Math.min(80,cur+d))+"px");}

function flash(cells){cells.forEach(({r,c})=>{const k=r+","+c,el=window.cellEls[k];if(!el)return;
  if(entries[k])el.classList.add(entries[k]===P.sol[r][c]?"fl-good":"fl-bad");});setTimeout(render,1100);}
$("btnCheckWord").onclick=()=>{const w=activeWord();if(w)flash(w.cells);};
$("btnReveal").onclick=()=>{if(!confirm("Tüm çözümü göstermek istiyor musunuz?"))return;
  for(const k in window.cellEls){const[r,c]=k.split(",").map(Number);entries[k]=P.sol[r][c];}render();checkComplete();};
$("btnClear").onclick=()=>{if(!confirm("Tüm girişleri silmek istiyor musunuz?"))return;
  entries={};$("banner").classList.remove("show");render();};

function checkComplete(){for(const k in window.cellEls){const[r,c]=k.split(",").map(Number);
  if(entries[k]!==P.sol[r][c]){$("banner").classList.remove("show");return;}}
  $("banner").classList.add("show");}

document.body.addEventListener("click",()=>{if(sel.r!==null)focusInput();});

loadPuzzle().then(r=>{
  if(r.state==="ok"){ init(r.puzzle); }
  else if(r.state==="demo"){ init(r.puzzle); $("demoBadge").style.display="block"; }
  else { showNotice(r.state, r.date); }
});
