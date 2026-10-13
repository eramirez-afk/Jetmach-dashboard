/* JetMach · Pestaña "Validación y anexo de documentación"
 * Flujo: enlace de carpeta de Drive -> revisión por checklist -> unir en un PDF -> guardar en Drive -> borrador de correo.
 * Necesita el backend de Google Apps Script (apps-script/Code.gs). */
(function(){
'use strict';

const PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

/* Checklist por régimen. Edita aquí los documentos y las palabras clave
 * que se buscan en el NOMBRE de cada archivo (sin acentos, en minúsculas). */
const CHECK_BASE = [
  {nombre:'Certificado de matrícula',           claves:['matricula','registro','registration','reg']},
  {nombre:'Certificado de aeronavegabilidad',   claves:['aeronavegabilidad','airworthiness','aw']},
  {nombre:'Póliza de seguro',                   claves:['seguro','poliza','insurance']},
  {nombre:'Licencias de tripulación',           claves:['licencia','license','lic']},
  {nombre:'Certificados médicos',               claves:['medico','medical','med']},
  {nombre:'General Declaration de entrada',     claves:['arr gendec','gendec in','gendecs in']},
  {nombre:'General Declaration de salida',      claves:['dep gendec','gendec out','gendecs out']}
];
const CHECK_135 = [
  {nombre:'Certificado de operador (AOC)',      claves:['aoc','certificado de operador']},
  {nombre:'Especificaciones de operación',      claves:['especificaciones','opspecs','ops specs']},
  {nombre:'Peso y balance',                     claves:['peso y balance','peso balance','weight']},
  {nombre:'Autorización de ruta',               claves:['autorizacion de ruta','autorizacion ruta','permiso de ruta']}
];

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[_\-.]+/g,' ');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const matches = (name, claves) => { const n = norm(name); return claves.some(k => new RegExp('(^|\\W)'+reEsc(k)).test(n)); };
const byName = (a,b) => a.name.localeCompare(b.name,'es');

function fmtFecha(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');
  return m ? (+m[3])+' de '+MESES[+m[2]-1]+' de '+m[1] : (iso||'');
}
function fmtFechas(a,b){ return (b && b!==a) ? 'del '+fmtFecha(a)+' al '+fmtFecha(b) : fmtFecha(a); }

function b64ToBytes(b){ const bin=atob(b), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
function bytesToB64(u){ let s=''; const c=0x8000; for(let i=0;i<u.length;i+=c) s+=String.fromCharCode.apply(null,u.subarray(i,i+c)); return btoa(s); }

function lsGet(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

let reg = '91';
let state = null;
let locales = [];   // archivos elegidos desde la computadora

function tipoLocal(f){
  const n = f.name.toLowerCase();
  if(n.endsWith('.pdf')) return 'pdf';
  if(n.endsWith('.png')) return 'png';
  if(n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'jpg';
  return '';
}
function detectaMatricula(nombres){
  const re = /(^|[^A-Z0-9])(N\d{1,5}[A-Z]{0,2}|X[ABC]-?[A-Z]{3})(?![A-Z0-9])/;
  for(const n of nombres){ const m = re.exec(n.toUpperCase()); if(m) return m[2]; }
  return '';
}
function agregarLocales(lista){
  for(const f of lista){ if(!locales.some(x => x.name===f.name && x.size===f.size)) locales.push(f); }
  const c = $('valCount');
  c.innerHTML = locales.length ? esc(locales.length+' archivo(s) cargado(s)')+' · <a href="#" id="valLimpiar">Quitar todos</a>' : '';
  if(locales.length){
    $('valLimpiar').addEventListener('click', e => { e.preventDefault(); locales = []; $('valInput').value=''; agregarLocales([]); });
    if(!$('valMat').value.trim()){ const m = detectaMatricula(locales.map(f=>f.name)); if(m) $('valMat').value = m; }
  }
}

function setStatus(msg, err){ const s=$('valStatus'); s.className = 'modal-note'+(err?' val-err':''); s.textContent = msg||''; }

async function api(payload){
  const url = $('valUrl').value.trim(), key = $('valKey').value.trim();
  if(!url || !key) throw new Error('Falta la URL del script o la clave (sección "Conexión con Google Drive").');
  const r = await fetch(url, {method:'POST', body: JSON.stringify(Object.assign({key}, payload))});
  if(!r.ok) throw new Error('El script respondió '+r.status);
  const j = await r.json();
  if(j.error) throw new Error(j.error);
  return j;
}

function cargarPdfLib(){
  return new Promise((ok,ko)=>{
    if(window.PDFLib) return ok();
    const s = document.createElement('script');
    s.src = PDFLIB_URL; s.onload = ok; s.onerror = () => ko(new Error('No se pudo cargar pdf-lib.'));
    document.head.appendChild(s);
  });
}

/* ---------- Paso 1: revisar ---------- */
async function revisar(){
  const datos = {
    mat: $('valMat').value.trim().toUpperCase(),
    ruta: $('valRuta').value.trim(),
    f1: $('valF1').value, f2: $('valF2').value,
    link: $('valLink').value.trim()
  };
  if(!datos.mat || !datos.ruta || !datos.f1){
    setStatus('Completa matrícula, ruta y fecha de salida.', true); return;
  }
  if(!locales.length && !datos.link){
    setStatus('Sube los documentos del vuelo (o pega un enlace de carpeta de Drive).', true); return;
  }
  const btn = $('valRevisar'); btn.disabled = true;
  $('valSalida').innerHTML = '';
  try{
    if(locales.length){
      const files = locales.map((f,i) => { const t = tipoLocal(f);
        return {id:'L'+i, name:f.name, mime:f.type, soportado:!!t, carpeta:'', file:f, tipo:t}; });
      state = {reg, datos, carpeta:'Archivos cargados', files};
    }else{
      setStatus('Leyendo la carpeta de Drive…');
      const res = await api({action:'list', folder:datos.link});
      state = {reg, datos, carpeta:res.carpeta, files:res.files};
    }
    renderRevision();
    setStatus('Revisión lista. Marca los archivos que quieres incluir y une el expediente.');
  }catch(e){ setStatus(e.message, true); }
  btn.disabled = false;
}

function renderRevision(){
  const s = state;
  const lista = CHECK_BASE.concat(s.reg==='135' ? CHECK_135 : []);
  const items = lista.map(it => ({nombre:it.nombre, files:s.files.filter(f => matches(f.name,it.claves))}));
  const faltan = items.filter(i => !i.files.length).length;

  const vistos = new Set(), orden = [];
  items.forEach(i => i.files.forEach(f => { if(!vistos.has(f.id)){ vistos.add(f.id); orden.push(f); } }));
  s.files.slice().sort(byName).forEach(f => { if(!vistos.has(f.id)){ vistos.add(f.id); orden.push(f); } });
  s.orden = orden;

  let h = '<div class="panel"><h2>Revisión de documentos <small>Part '+esc(s.reg)+' · '+esc(s.carpeta)+'</small></h2><div class="val-list">';
  items.forEach(i => {
    h += '<div class="val-row"><span>'+esc(i.nombre)+(i.files.length ? '<br><span class="val-sub">'+esc(i.files.map(f=>f.name).join(' · '))+'</span>' : '')+'</span>'+
         '<span class="val-tag '+(i.files.length?'ok':'no')+'">'+(i.files.length?'Encontrado':'Falta')+'</span></div>';
  });
  h += '</div><p class="modal-note">La revisión compara el nombre de cada archivo con el checklist; no lee el contenido ni las vigencias. Revisa fechas de vencimiento antes de enviar.</p>';
  if(faltan) h += '<p class="modal-note val-err">Faltan '+faltan+' documento(s) del checklist.</p>';
  h += '</div>';

  h += '<div class="panel"><h2>Archivos a unir <small>en este orden</small></h2><div class="val-list" id="valFiles">';
  orden.forEach(f => {
    h += '<label class="val-row"><input type="checkbox" data-id="'+esc(f.id)+'"'+(f.soportado?' checked':' disabled')+'>'+
         '<span>'+esc(f.name)+(f.carpeta?' <span class="val-sub">'+esc(f.carpeta)+'</span>':'')+'</span>'+
         (f.soportado?'':'<span class="val-tag skip">No se puede unir</span>')+'</label>';
  });
  if(!orden.length) h += '<p class="modal-note">La carpeta no tiene archivos.</p>';
  h += '</div><div class="val-actions"><button class="btn primary" id="valUnir">Unir en un PDF</button></div></div>';
  $('valRevision').innerHTML = h;
  $('valUnir').addEventListener('click', unir);
}

/* ---------- Paso 2: unir y guardar ---------- */
async function agregaImagen(merged, bytes, tipo){
  const img = tipo==='png' ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
  const hor = img.width > img.height;
  const W = hor ? 792 : 612, H = hor ? 612 : 792;
  const sc = Math.min((W-72)/img.width, (H-72)/img.height, 1);
  const w = img.width*sc, h = img.height*sc;
  merged.addPage([W,H]).drawImage(img, {x:(W-w)/2, y:(H-h)/2, width:w, height:h});
}

async function unir(){
  const s = state, btn = $('valUnir');
  const marcados = new Set([...$('valFiles').querySelectorAll('input:checked')].map(i => i.dataset.id));
  const sel = s.orden.filter(f => f.soportado && marcados.has(f.id));
  if(!sel.length){ setStatus('Marca al menos un archivo.', true); return; }
  btn.disabled = true; $('valSalida').innerHTML = '';
  try{
    await cargarPdfLib();
    const merged = await PDFLib.PDFDocument.create();
    const unidos = [], omitidos = [];
    for(let i=0;i<sel.length;i++){
      const f = sel[i];
      setStatus('Procesando '+(i+1)+' de '+sel.length+': '+f.name+'…');
      try{
        if(f.file){
          const bytes = new Uint8Array(await f.file.arrayBuffer());
          if(f.tipo==='pdf'){
            const src = await PDFLib.PDFDocument.load(bytes, {ignoreEncryption:true});
            (await merged.copyPages(src, src.getPageIndices())).forEach(p => merged.addPage(p));
          }else{
            await agregaImagen(merged, bytes, f.tipo);
          }
        }else{
          const r = await api({action:'get', id:f.id});
          const src = await PDFLib.PDFDocument.load(b64ToBytes(r.data), {ignoreEncryption:true});
          (await merged.copyPages(src, src.getPageIndices())).forEach(p => merged.addPage(p));
        }
        unidos.push(f.name);
      }catch(e){ omitidos.push(f.name+' ('+e.message+')'); }
    }
    if(!merged.getPageCount()) throw new Error('No se pudo unir ningún archivo.');
    const bytes = await merged.save();
    const d = s.datos;
    const nombre = d.mat+'_'+d.f1+'_Part'+s.reg+'_Expediente.pdf';
    const blobUrl = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    let g = null, nota = '';
    if($('valUrl').value.trim() && $('valKey').value.trim()){
      try{
        setStatus('Guardando en Drive…');
        g = await api({action:'save', name:nombre, subfolder:d.mat+'_'+d.f1, data:bytesToB64(bytes)});
      }catch(e){ nota = 'No se pudo guardar en Drive: '+e.message; }
    }else{
      nota = 'Sin conexión a Drive: el PDF solo se descarga. Puedes configurarla en "Conexión con Google Drive".';
    }
    renderSalida({nombre, paginas:merged.getPageCount(), unidos, omitidos, g, nota, blobUrl});
    setStatus(g ? 'Expediente guardado en Drive.' : 'Expediente listo.');
  }catch(e){ setStatus(e.message, true); }
  btn.disabled = false;
}

/* ---------- Paso 3: resultado y borrador ---------- */
function borrador(d, conHtml){
  const v = t => conHtml ? '<span class="val-var">'+esc(t)+'</span>' : t;
  const fechas = fmtFechas(d.f1, d.f2);
  const t = x => conHtml ? esc(x) : x;
  return t('Asunto: Documentación de vuelo ')+v(d.mat)+t(' – ')+v(fechas)+t('\n\nEstimados Sres. de AFAC:\n\nPor medio del presente, remitimos la documentación del vuelo de la aeronave ')+
         v(d.mat)+t(', ruta ')+v(d.ruta)+t(', programado '+((d.f2 && d.f2!==d.f1) ? '' : 'para el '))+v(fechas)+
         t('.\n\nSe adjunta el expediente en PDF.\n\nQuedamos atentos a sus comentarios.\n\nAtentamente,\nEdson Ramirez\nCoordinación de Operaciones');
}

function renderSalida(r){
  const d = state.datos;
  let h = '<div class="panel"><h2>Expediente <small>'+r.paginas+' páginas · '+r.unidos.length+' archivos</small></h2>';
  h += '<div class="val-list"><div class="val-row"><span>'+esc(r.nombre)+'</span></div></div>';
  if(r.omitidos.length) h += '<p class="modal-note val-err">Omitidos: '+esc(r.omitidos.join('; '))+'</p>';
  if(r.nota) h += '<p class="modal-note">'+esc(r.nota)+'</p>';
  h += '<div class="val-actions"><a class="btn primary" href="'+esc(r.blobUrl)+'" download="'+esc(r.nombre)+'">Descargar PDF</a>'+
       (r.g ? '<a class="btn" href="'+esc(r.g.url)+'" target="_blank" rel="noopener">Abrir en Drive</a>' : '')+'</div></div>';
  h += '<div class="panel"><h2>Borrador para AFAC <small>solo cambian los campos resaltados</small></h2>'+
       '<p class="val-mail">'+borrador(d,true)+'</p>'+
       '<div class="val-actions" style="margin-top:0"><button class="btn primary" id="valCopiar">Copiar borrador</button>'+
       '<a class="btn" id="valMailto">Abrir en correo</a></div>'+
       '<p class="modal-note">El PDF se adjunta a mano desde la descarga. El envío lo haces tú.</p></div>';
  $('valSalida').innerHTML = h;
  const txt = borrador(d,false), asunto = txt.split('\n')[0].replace('Asunto: ',''), cuerpo = txt.split('\n').slice(2).join('\n');
  $('valMailto').href = 'mailto:?subject='+encodeURIComponent(asunto)+'&body='+encodeURIComponent(cuerpo);
  $('valCopiar').addEventListener('click', async function(){
    try{ await navigator.clipboard.writeText(txt); this.textContent = 'Copiado'; }
    catch(e){ this.textContent = 'No se pudo copiar'; }
  });
}

/* ---------- Arranque ---------- */
function init(){
  $('valUrl').value = lsGet('jm_val_url'); $('valKey').value = lsGet('jm_val_key');
  $('valUrl').addEventListener('change', e => lsSet('jm_val_url', e.target.value.trim()));
  $('valKey').addEventListener('change', e => lsSet('jm_val_key', e.target.value.trim()));
  $('valReg').addEventListener('click', e => {
    const b = e.target.closest('button[data-reg]'); if(!b) return;
    reg = b.dataset.reg;
    $('valReg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x===b));
  });
  $('valPick').addEventListener('click', () => $('valInput').click());
  $('valInput').addEventListener('change', e => agregarLocales([...e.target.files]));
  const dz = $('valDrop');
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => agregarLocales([...(e.dataTransfer ? e.dataTransfer.files : [])]));
  $('valRevisar').addEventListener('click', revisar);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
