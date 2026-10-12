/**
 * JetMach · Validación y anexo de documentación — backend en Google Apps Script
 *
 * INSTALACIÓN
 * 1. Entra a script.google.com > Nuevo proyecto y pega este archivo.
 * 2. Configuración del proyecto > Propiedades del script > agrega CLAVE = (una clave larga que inventes).
 * 3. Implementar > Nueva implementación > Aplicación web:
 *      Ejecutar como: Yo
 *      Quién tiene acceso: Cualquier usuario   (la clave protege el acceso)
 * 4. Autoriza los permisos de Drive y copia la URL que termina en /exec.
 * 5. En la pestaña "Validación y anexo" pega la URL y la clave en "Conexión con Google Drive".
 * Si cambias este código, crea una nueva versión de la implementación.
 */
const CARPETA_RAIZ = 'Expedientes AFAC'; // carpeta de Drive donde se guardan los expedientes

const MIMES_IMG = ['image/jpeg','image/png','image/gif','image/bmp'];
const MIMES_GOOGLE = ['application/vnd.google-apps.document','application/vnd.google-apps.spreadsheet','application/vnd.google-apps.presentation'];

function doGet(){ return json_({ok:true}); }

function doPost(e){
  try{
    const req = JSON.parse(e.postData.contents);
    const clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
    if(!clave || req.key !== clave) return json_({error:'Clave incorrecta'});
    if(req.action === 'list') return json_(listar_(req.folder));
    if(req.action === 'get')  return json_(obtener_(req.id));
    if(req.action === 'save') return json_(guardar_(req));
    return json_({error:'Acción desconocida'});
  }catch(err){
    return json_({error:String(err && err.message || err)});
  }
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function soportado_(mime){
  return mime === 'application/pdf' || MIMES_IMG.indexOf(mime) >= 0 || MIMES_GOOGLE.indexOf(mime) >= 0;
}

function extraerId_(txt){
  txt = String(txt || '');
  const m = txt.match(/\/folders\/([-\w]{10,})/) || txt.match(/[?&]id=([-\w]{10,})/) || txt.match(/^([-\w]{20,})$/);
  if(!m) throw new Error('No se reconoce el enlace de la carpeta');
  return m[1];
}

function listar_(url){
  const carpeta = DriveApp.getFolderById(extraerId_(url));
  const files = [];
  recorrer_(carpeta, '', 0, files);
  return {carpeta: carpeta.getName(), files: files};
}

function recorrer_(carpeta, ruta, nivel, out){
  const it = carpeta.getFiles();
  while(it.hasNext()){
    const f = it.next(), m = f.getMimeType();
    out.push({id:f.getId(), name:f.getName(), mime:m, soportado:soportado_(m), carpeta:ruta});
  }
  if(nivel < 2){
    const sub = carpeta.getFolders();
    while(sub.hasNext()){
      const s = sub.next();
      recorrer_(s, ruta ? ruta+'/'+s.getName() : s.getName(), nivel+1, out);
    }
  }
}

function obtener_(id){
  const f = DriveApp.getFileById(id), m = f.getMimeType();
  if(!soportado_(m)) throw new Error('Tipo no soportado: '+m);
  const blob = (m === 'application/pdf') ? f.getBlob() : f.getAs('application/pdf');
  return {name: f.getName(), data: Utilities.base64Encode(blob.getBytes())};
}

function guardar_(req){
  const limpio = s => String(s || '').replace(/[\\\/]/g,'-');
  const raiz = carpeta_(DriveApp.getRootFolder(), CARPETA_RAIZ);
  const sub  = carpeta_(raiz, limpio(req.subfolder) || 'Sin clasificar');
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), 'application/pdf', limpio(req.name) || 'Expediente.pdf');
  const f = sub.createFile(blob);
  return {url: f.getUrl(), id: f.getId(), folderUrl: sub.getUrl()};
}

function carpeta_(padre, nombre){
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}
