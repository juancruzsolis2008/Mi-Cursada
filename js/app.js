// ============================================================
// CURSADA — lógica de la app
// Vanilla JS, sin build step. Firebase compat SDK (Auth + Firestore).
// ============================================================

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];  // dia: 1..7
const DIAS_LARGO = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const COLORES = ['#2F6F5E','#B8622E','#3D5A80','#A9821F','#7A5C61','#5B7553','#8A4F7D','#4A6FA5'];
const CAL_START_HOUR = 8;
const CAL_END_HOUR = 22;

let currentUser = null;
let unsubscribers = [];
let state = { materias: [], pendientes: [], plan: [], carrera: {} };
let calMode = 'semana';
let mesActual = new Date();
let diaSeleccionadoMes = null;
let horarioRowSeq = 0;
let docRowSeq = 0;

// ---------------- utilidades ----------------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const todayStr = () => new Date().toISOString().slice(0,10);
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
};
const fmtFecha = (dateStr) => {
  if(!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
};
function jsDowToDia(jsDow){ return jsDow === 0 ? 7 : jsDow; } // domingo -> 7 (sin uso en grilla)

// ---------------- AUTH ----------------
$('#google-signin-btn').addEventListener('click', () => {
  auth.signInWithPopup(googleProvider).catch(err => alert('No se pudo iniciar sesión: ' + err.message));
});
$('#signout-btn').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(user => {
  unsubscribers.forEach(u => u());
  unsubscribers = [];

  if(user){
    currentUser = user;
    $('#login-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    $('#user-name').textContent = user.displayName || user.email;
    $('#user-photo').src = user.photoURL || '';
    attachListeners(user.uid);
  } else {
    currentUser = null;
    state = { materias: [], pendientes: [], plan: [], carrera: {} };
    $('#app-shell').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $$('dialog[open]').forEach(d => d.close());
  }
});

function userDoc(uid){ return db.collection('users').doc(uid); }

function attachListeners(uid){
  unsubscribers.push(
    userDoc(uid).onSnapshot(doc => {
      state.carrera = doc.exists ? (doc.data().carrera || {}) : {};
      renderProgresoHeader();
    })
  );
  unsubscribers.push(
    userDoc(uid).collection('materias').orderBy('nombre').onSnapshot(snap => {
      state.materias = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderMaterias();
      renderMateriaSelects();
      renderInicio();
      renderCalendario();
    })
  );
  unsubscribers.push(
    userDoc(uid).collection('pendientes').onSnapshot(snap => {
      state.pendientes = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderPendientes();
      renderInicio();
      if(calMode === 'mes') renderMesGrid();
    })
  );
  unsubscribers.push(
    userDoc(uid).collection('plan').onSnapshot(snap => {
      state.plan = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderProgreso();
    })
  );
}

// ---------------- NAV ----------------
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    $$('.view').forEach(v => v.classList.remove('is-active'));
    $('#view-' + btn.dataset.view).classList.add('is-active');
  });
});

$$('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => $('#' + btn.dataset.close).close());
});

// ============================================================
// INICIO
// ============================================================
function renderInicio(){
  const now = new Date();
  $('#today-date').textContent = `${DIAS_LARGO[now.getDay()===0?6:now.getDay()-1]}, ${now.getDate()} de ${MESES[now.getMonth()]}`;

  const hoy = todayStr();
  const manana = addDays(hoy, 1);
  const diaHoy = jsDowToDia(now.getDay());
  const diaManana = jsDowToDia(new Date(manana + 'T00:00:00').getDay());

  renderClasesDia('#hoy-clases', diaHoy);
  renderClasesDia('#manana-clases', diaManana);
  renderPendientesDia('#hoy-pendientes', hoy);
  renderPendientesDia('#manana-pendientes', manana);

  // próximos eventos de pendientes con fecha en 2-7 días (parciales/entregas cercanas)
  const proximos = state.pendientes
    .filter(p => !p.completado && p.fecha && p.fecha > manana && p.fecha <= addDays(hoy, 7))
    .sort((a,b) => a.fecha.localeCompare(b.fecha));
  const card = $('#proximo-card');
  if(proximos.length){
    card.style.display = '';
    $('#proximo-list').innerHTML = proximos.map(p => miniItemPendiente(p)).join('');
  } else {
    card.style.display = 'none';
  }
}

function renderClasesDia(sel, dia){
  const items = state.materias
    .flatMap(m => (m.horarios||[]).filter(h => Number(h.dia) === dia).map(h => ({...h, materia:m})))
    .sort((a,b) => a.inicio.localeCompare(b.inicio));
  const el = $(sel);
  if(!items.length){ el.innerHTML = '<p class="empty-note">Sin clases.</p>'; return; }
  el.innerHTML = items.map(h => `
    <div class="mini-item">
      <span class="mini-dot" style="background:${h.materia.color}"></span>
      <div class="mini-item-text">
        <div class="mini-item-title">${escapeHtml(h.materia.nombre)}</div>
        ${h.aula ? `<div class="mini-item-meta">Aula ${escapeHtml(h.aula)}</div>` : ''}
      </div>
      <div class="mini-item-time">${h.inicio}–${h.fin}</div>
    </div>
  `).join('');
}

function renderPendientesDia(sel, fecha){
  const items = state.pendientes.filter(p => p.fecha === fecha && !p.completado)
    .sort((a,b) => prioRank(b.prioridad) - prioRank(a.prioridad));
  const el = $(sel);
  if(!items.length){ el.innerHTML = '<p class="empty-note">Nada pendiente.</p>'; return; }
  el.innerHTML = items.map(p => miniItemPendiente(p)).join('');
}
function prioRank(p){ return p==='alta'?2:p==='media'?1:0; }

function miniItemPendiente(p){
  const materia = state.materias.find(m => m.id === p.materiaId);
  return `
    <div class="mini-item">
      <span class="pend-prio ${p.prioridad}"></span>
      <div class="mini-item-text">
        <div class="mini-item-title">${escapeHtml(p.titulo)}</div>
        <div class="mini-item-meta">${materia ? escapeHtml(materia.nombre) : 'Sin materia'} · ${fmtFecha(p.fecha)}</div>
      </div>
    </div>
  `;
}

// ============================================================
// CALENDARIO
// ============================================================
$$('[data-cal-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    calMode = btn.dataset.calMode;
    $$('[data-cal-mode]').forEach(b => b.classList.toggle('is-active', b===btn));
    $('#cal-semana').classList.toggle('hidden', calMode !== 'semana');
    $('#cal-mes').classList.toggle('hidden', calMode !== 'mes');
    if(calMode === 'mes') renderMesGrid();
  });
});
$('#mes-prev').addEventListener('click', () => { mesActual.setMonth(mesActual.getMonth()-1); renderMesGrid(); });
$('#mes-next').addEventListener('click', () => { mesActual.setMonth(mesActual.getMonth()+1); renderMesGrid(); });

function renderCalendario(){ renderSemanaGrid(); if(calMode==='mes') renderMesGrid(); }

function renderSemanaGrid(){
  const grid = $('#cal-week-grid');
  const totalHours = CAL_END_HOUR - CAL_START_HOUR;
  let html = `<div class="cal-head-cell"></div>`;
  DIAS.forEach(d => html += `<div class="cal-head-cell">${d}</div>`);

  for(let h = CAL_START_HOUR; h < CAL_END_HOUR; h++){
    html += `<div class="cal-hour-cell">${String(h).padStart(2,'0')}:00</div>`;
    for(let d = 1; d <= 7; d++){
      html += `<div class="cal-slot" data-dia="${d}" data-hora="${h}"></div>`;
    }
  }
  grid.style.gridTemplateRows = `32px repeat(${totalHours}, 52px)`;
  grid.innerHTML = html;

  // bloques de horario posicionados absolutamente sobre la columna del día
  state.materias.forEach(m => (m.horarios||[]).forEach(h => {
    const dia = Number(h.dia);
    if(dia < 1 || dia > 7) return;
    const slot = grid.querySelector(`.cal-slot[data-dia="${dia}"][data-hora="${CAL_START_HOUR}"]`);
    if(!slot) return;
    const [ih, im] = h.inicio.split(':').map(Number);
    const [fh, fm] = h.fin.split(':').map(Number);
    const height = Math.max(((fh - ih) + (fm-im)/60) * 52, 24);
    const block = document.createElement('div');
    block.className = 'cal-block';
    block.style.background = m.color;
    block.style.position = 'absolute';
    block.style.top = (32 + (ih - CAL_START_HOUR) * 52 + (im/60*52)) + 'px';
    block.style.height = height + 'px';
    const colIndex = dia; // 1..7
    block.style.left = `calc(56px + (100% - 56px)/7 * ${colIndex - 1} + 3px)`;
    block.style.width = `calc((100% - 56px)/7 - 6px)`;
    block.innerHTML = `${escapeHtml(m.nombre)}<small>${h.inicio}–${h.fin}${h.aula? ' · '+escapeHtml(h.aula):''}</small>`;
    grid.appendChild(block);
  }));
}

function renderMesGrid(){
  const y = mesActual.getFullYear(), m = mesActual.getMonth();
  $('#mes-label').textContent = `${MESES[m]} ${y}`;

  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const daysInPrevMonth = new Date(y, m, 0).getDate();

  let cells = [];
  for(let i = startOffset; i > 0; i--) cells.push({ day: daysInPrevMonth - i + 1, outside:true, date:null });
  for(let d = 1; d <= daysInMonth; d++){
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day:d, outside:false, date:dateStr });
  }
  let nextDay = 1;
  while(cells.length % 7 !== 0) cells.push({ day: nextDay++, outside:true, date:null });

  const dowHtml = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => `<div class="cal-month-dow">${d}</div>`).join('');

  const cellsHtml = cells.map(c => {
    if(c.outside) return `<div class="cal-day-cell is-outside"><div class="cal-day-num">${c.day}</div></div>`;
    const isToday = c.date === todayStr();
    const isSel = c.date === diaSeleccionadoMes;
    const eventos = state.pendientes.filter(p => p.fecha === c.date);
    const dots = eventos.slice(0,4).map(e => {
      const materia = state.materias.find(mm => mm.id === e.materiaId);
      const color = materia ? materia.color : 'var(--ink-faint)';
      return `<span class="cal-day-dot" style="background:${color}"></span>`;
    }).join('');
    return `<div class="cal-day-cell ${isToday?'is-today':''} ${isSel?'is-selected':''}" data-date="${c.date}">
      <div class="cal-day-num">${c.day}</div>
      <div class="cal-day-dots">${dots}</div>
    </div>`;
  }).join('');

  $('#cal-month-grid').innerHTML = dowHtml + cellsHtml;

  $$('.cal-day-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      diaSeleccionadoMes = cell.dataset.date;
      renderMesGrid();
      renderDiaDetalle(diaSeleccionadoMes);
    });
  });

  if(diaSeleccionadoMes) renderDiaDetalle(diaSeleccionadoMes);
}

function renderDiaDetalle(dateStr){
  $('#cal-day-detail-title').textContent = fmtFecha(dateStr);
  const eventos = state.pendientes.filter(p => p.fecha === dateStr);
  const el = $('#cal-day-detail-list');
  if(!eventos.length){ el.innerHTML = '<p class="empty-note">Sin pendientes ese día.</p>'; return; }
  el.innerHTML = eventos.map(p => miniItemPendiente(p)).join('');
}

// ============================================================
// PENDIENTES
// ============================================================
function renderMateriaSelects(){
  const opts = state.materias.map(m => `<option value="${m.id}">${escapeHtml(m.nombre)}</option>`).join('');
  $('#pend-materia').innerHTML = '<option value="">Sin materia</option>' + opts;
  const filtroActual = $('#pend-filtro-materia').value;
  $('#pend-filtro-materia').innerHTML = '<option value="">Todas las materias</option>' + opts;
  $('#pend-filtro-materia').value = filtroActual;
}

$('#pend-filtro-materia').addEventListener('change', renderPendientes);

$('#add-pendiente-btn').addEventListener('click', () => {
  $('#form-pendiente').reset();
  $('#pend-id').value = '';
  $('#modal-pendiente-title').textContent = 'Nuevo pendiente';
  $('#pend-fecha').value = todayStr();
  $('#modal-pendiente').showModal();
});

$('#form-pendiente').addEventListener('submit', async (e) => {
  const data = {
    titulo: $('#pend-titulo').value.trim(),
    materiaId: $('#pend-materia').value || null,
    fecha: $('#pend-fecha').value || null,
    prioridad: $('#pend-prioridad').value,
    link: $('#pend-link').value.trim() || null,
  };
  if(!data.titulo) return;
  const id = $('#pend-id').value;
  const col = userDoc(currentUser.uid).collection('pendientes');
  if(id){
    await col.doc(id).update(data);
  } else {
    data.completado = false;
    data.creado = firebase.firestore.FieldValue.serverTimestamp();
    await col.add(data);
  }
});

function renderPendientes(){
  const filtro = $('#pend-filtro-materia').value;
  const hoy = todayStr();
  const finSemana = addDays(hoy, 7);

  const activos = state.pendientes.filter(p => !p.completado && (!filtro || p.materiaId === filtro));
  const completados = state.pendientes.filter(p => p.completado && (!filtro || p.materiaId === filtro))
    .sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'')).slice(0,15);

  const grupos = {
    'Hoy': activos.filter(p => p.fecha === hoy),
    'Mañana': activos.filter(p => p.fecha === addDays(hoy,1)),
    'Esta semana': activos.filter(p => p.fecha && p.fecha > addDays(hoy,1) && p.fecha <= finSemana),
    'Más adelante': activos.filter(p => p.fecha && p.fecha > finSemana),
    'Sin fecha': activos.filter(p => !p.fecha),
  };

  let html = '';
  for(const [titulo, items] of Object.entries(grupos)){
    if(!items.length) continue;
    items.sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'') || prioRank(b.prioridad)-prioRank(a.prioridad));
    html += `<div class="pend-group"><div class="pend-group-title">${titulo}</div>${items.map(pendRowHtml).join('')}</div>`;
  }
  if(completados.length){
    html += `<div class="pend-group"><div class="pend-group-title">Completados</div>${completados.map(pendRowHtml).join('')}</div>`;
  }
  if(!html) html = '<p class="empty-note">No hay pendientes cargados todavía.</p>';
  $('#pendientes-groups').innerHTML = html;

  $$('.pend-check').forEach(btn => btn.addEventListener('click', () => togglePendiente(btn.dataset.id, btn.classList.contains('is-done'))));
  $$('[data-edit-pend]').forEach(btn => btn.addEventListener('click', () => editPendiente(btn.dataset.editPend)));
  $$('[data-del-pend]').forEach(btn => btn.addEventListener('click', () => delPendiente(btn.dataset.delPend)));
}

function pendRowHtml(p){
  const materia = state.materias.find(m => m.id === p.materiaId);
  return `
    <div class="pend-row ${p.completado?'is-done':''}">
      <button class="pend-check ${p.completado?'is-done':''}" data-id="${p.id}">${p.completado?'✓':''}</button>
      <div class="pend-body">
        <div class="pend-title">${escapeHtml(p.titulo)}</div>
        <div class="pend-meta">
          ${materia ? `<span class="mini-dot" style="width:6px;height:6px;background:${materia.color};display:inline-block;border-radius:50%"></span> ${escapeHtml(materia.nombre)}` : 'Sin materia'}
          ${p.fecha ? `· ${fmtFecha(p.fecha)}` : ''}
          <span class="pend-prio ${p.prioridad}"></span>
          ${p.link ? `<a class="pend-link" href="${escapeAttr(p.link)}" target="_blank" rel="noopener">Ver resumen ↗</a>` : ''}
        </div>
      </div>
      <div class="pend-actions">
        <button class="row-icon-btn" data-edit-pend="${p.id}" title="Editar">✎</button>
        <button class="row-icon-btn" data-del-pend="${p.id}" title="Eliminar">✕</button>
      </div>
    </div>
  `;
}

async function togglePendiente(id, wasDone){
  await userDoc(currentUser.uid).collection('pendientes').doc(id).update({ completado: !wasDone });
}
function editPendiente(id){
  const p = state.pendientes.find(x => x.id === id);
  if(!p) return;
  $('#pend-id').value = p.id;
  $('#pend-titulo').value = p.titulo;
  $('#pend-materia').value = p.materiaId || '';
  $('#pend-fecha').value = p.fecha || '';
  $('#pend-prioridad').value = p.prioridad || 'media';
  $('#pend-link').value = p.link || '';
  $('#modal-pendiente-title').textContent = 'Editar pendiente';
  $('#modal-pendiente').showModal();
}
async function delPendiente(id){
  if(!confirm('¿Eliminar este pendiente?')) return;
  await userDoc(currentUser.uid).collection('pendientes').doc(id).delete();
}

// ============================================================
// MATERIAS
// ============================================================
function buildColorPicker(){
  const el = $('#mat-color-picker');
  el.innerHTML = COLORES.map(c => `<button type="button" class="color-swatch" data-color="${c}" style="background:${c}"></button>`).join('');
  $$('.color-swatch', el).forEach(sw => sw.addEventListener('click', () => {
    $('#mat-color').value = sw.dataset.color;
    $$('.color-swatch', el).forEach(s => s.classList.remove('is-selected'));
    sw.classList.add('is-selected');
  }));
}
buildColorPicker();

function addHorarioRow(h = {}){
  const rowId = 'hr' + (horarioRowSeq++);
  const wrap = document.createElement('div');
  wrap.className = 'horario-row';
  wrap.dataset.rowId = rowId;
  wrap.innerHTML = `
    <select class="input hr-dia">${DIAS.map((d,i) => `<option value="${i+1}" ${Number(h.dia)===i+1?'selected':''}>${d}</option>`).join('')}</select>
    <input class="input hr-inicio" type="time" value="${h.inicio||'08:00'}">
    <input class="input hr-fin" type="time" value="${h.fin||'10:00'}">
    <input class="input hr-aula" type="text" placeholder="Aula" value="${h.aula?escapeAttr(h.aula):''}" style="max-width:80px">
    <button type="button" class="row-icon-btn" data-rm-row>✕</button>
  `;
  wrap.querySelector('[data-rm-row]').addEventListener('click', () => wrap.remove());
  $('#mat-horarios-list').appendChild(wrap);
}
$('#add-horario-row').addEventListener('click', () => addHorarioRow());

function addDocRow(doc = {}){
  const wrap = document.createElement('div');
  wrap.className = 'doc-row';
  wrap.innerHTML = `
    <input class="input doc-titulo" type="text" placeholder="Título (ej: Resumen unidad 1)" value="${doc.titulo?escapeAttr(doc.titulo):''}">
    <input class="input doc-url" type="url" placeholder="URL de Google Docs" value="${doc.url?escapeAttr(doc.url):''}">
    <button type="button" class="row-icon-btn" data-rm-row>✕</button>
  `;
  wrap.querySelector('[data-rm-row]').addEventListener('click', () => wrap.remove());
  $('#mat-docs-list').appendChild(wrap);
}
$('#add-doc-row').addEventListener('click', () => addDocRow());
$('#crear-doc-btn').addEventListener('click', () => {
  window.open('https://docs.google.com/document/create', '_blank');
  addDocRow({ titulo: '', url: '' });
});

$('#add-materia-btn').addEventListener('click', () => {
  $('#form-materia').reset();
  $('#mat-id').value = '';
  $('#mat-color').value = COLORES[0];
  $$('.color-swatch').forEach((s,i) => s.classList.toggle('is-selected', i===0));
  $('#mat-horarios-list').innerHTML = '';
  $('#mat-docs-list').innerHTML = '';
  addHorarioRow();
  $('#modal-materia').showModal();
});

$('#form-materia').addEventListener('submit', async () => {
  const nombre = $('#mat-nombre').value.trim();
  if(!nombre) return;
  const horarios = $$('.horario-row', $('#mat-horarios-list')).map(r => ({
    dia: r.querySelector('.hr-dia').value,
    inicio: r.querySelector('.hr-inicio').value,
    fin: r.querySelector('.hr-fin').value,
    aula: r.querySelector('.hr-aula').value.trim(),
  })).filter(h => h.inicio && h.fin);
  const docs = $$('.doc-row', $('#mat-docs-list')).map(r => ({
    titulo: r.querySelector('.doc-titulo').value.trim(),
    url: r.querySelector('.doc-url').value.trim(),
  })).filter(d => d.titulo && d.url);

  const data = { nombre, color: $('#mat-color').value, horarios, docs };
  const id = $('#mat-id').value;
  const col = userDoc(currentUser.uid).collection('materias');
  if(id) await col.doc(id).update(data);
  else await col.add(data);
});

function renderMaterias(){
  const el = $('#materias-grid');
  if(!state.materias.length){ el.innerHTML = '<p class="empty-note">Todavía no cargaste materias.</p>'; return; }
  el.innerHTML = state.materias.map(m => `
    <div class="materia-card" style="border-top-color:${m.color}">
      <div class="materia-name">${escapeHtml(m.nombre)}</div>
      ${(m.horarios||[]).map(h => `<div class="materia-horario">${DIAS[Number(h.dia)-1]||''} · ${h.inicio}–${h.fin}${h.aula?' · Aula '+escapeHtml(h.aula):''}</div>`).join('') || '<div class="materia-horario">Sin horario cargado</div>'}
      <div class="materia-docs">
        ${(m.docs||[]).map(d => `<a class="materia-doc-link" href="${escapeAttr(d.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(d.titulo)}</a>`).join('') || '<p class="empty-note">Sin resúmenes vinculados.</p>'}
      </div>
      <div class="materia-card-actions">
        <button class="btn btn-ghost btn-small" data-edit-mat="${m.id}">Editar</button>
        <button class="btn btn-ghost btn-small" data-del-mat="${m.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  $$('[data-edit-mat]').forEach(btn => btn.addEventListener('click', () => editMateria(btn.dataset.editMat)));
  $$('[data-del-mat]').forEach(btn => btn.addEventListener('click', () => delMateria(btn.dataset.delMat)));
}

function editMateria(id){
  const m = state.materias.find(x => x.id === id);
  if(!m) return;
  $('#mat-id').value = m.id;
  $('#mat-nombre').value = m.nombre;
  $('#mat-color').value = m.color;
  $$('.color-swatch').forEach(s => s.classList.toggle('is-selected', s.dataset.color === m.color));
  $('#mat-horarios-list').innerHTML = '';
  (m.horarios||[]).forEach(h => addHorarioRow(h));
  if(!(m.horarios||[]).length) addHorarioRow();
  $('#mat-docs-list').innerHTML = '';
  (m.docs||[]).forEach(d => addDocRow(d));
  $('#modal-materia').showModal();
}
async function delMateria(id){
  if(!confirm('¿Eliminar esta materia? También se quitará del calendario.')) return;
  await userDoc(currentUser.uid).collection('materias').doc(id).delete();
}

// ============================================================
// PROGRESO
// ============================================================
const ESTADOS = [
  { v:'no_cursada', label:'No cursada' },
  { v:'cursando', label:'Cursando' },
  { v:'regular', label:'Regular' },
  { v:'promocionada', label:'Promocionada' },
  { v:'aprobada', label:'Aprobada' },
];

$('#edit-carrera-btn').addEventListener('click', () => {
  $('#carrera-nombre').value = state.carrera.nombre || '';
  $('#carrera-universidad').value = state.carrera.universidad || '';
  $('#modal-carrera').showModal();
});
$('#form-carrera').addEventListener('submit', async () => {
  const carrera = { nombre: $('#carrera-nombre').value.trim(), universidad: $('#carrera-universidad').value.trim() };
  await userDoc(currentUser.uid).set({ carrera }, { merge:true });
});

$('#add-plan-materia-btn').addEventListener('click', () => {
  $('#form-plan-materia').reset();
  $('#plan-id').value = '';
  $('#modal-plan-materia').querySelector('.modal-title').textContent = 'Agregar materia al plan';
  buildCorrelativasSelect(null);
  $('#modal-plan-materia').showModal();
});

function buildCorrelativasSelect(excludeId){
  const sel = $('#plan-correlativas');
  sel.innerHTML = state.plan
    .filter(p => p.id !== excludeId)
    .sort((a,b) => a.anio - b.anio || a.nombre.localeCompare(b.nombre))
    .map(p => `<option value="${p.id}">${p.anio}° año — ${escapeHtml(p.nombre)}</option>`)
    .join('');
}

$('#form-plan-materia').addEventListener('submit', async () => {
  const nombre = $('#plan-nombre').value.trim();
  if(!nombre) return;
  const correlativas = $$('#plan-correlativas option:checked').map(o => o.value);
  const data = {
    nombre,
    anio: Number($('#plan-anio').value),
    cuatrimestre: $('#plan-cuatrimestre').value,
    correlativas,
  };
  const id = $('#plan-id').value;
  const col = userDoc(currentUser.uid).collection('plan');
  if(id){
    await col.doc(id).update(data);
  } else {
    data.estado = 'no_cursada';
    data.nota = null;
    await col.add(data);
  }
});

function renderProgresoHeader(){
  $('#progreso-carrera-label').textContent = state.carrera.nombre
    ? `${state.carrera.nombre}${state.carrera.universidad ? ' · ' + state.carrera.universidad : ''}`
    : 'Configurá tu carrera';
}

function renderProgreso(){
  renderProgresoHeader();
  const total = state.plan.length;
  const aprobadas = state.plan.filter(p => p.estado === 'aprobada');
  const pct = total ? Math.round(aprobadas.length / total * 100) : 0;

  $('#progreso-big-pct').textContent = pct + '%';
  $('#progreso-count').textContent = `${aprobadas.length} de ${total} materias aprobadas`;
  $('#progreso-fill').style.width = pct + '%';
  $('#sidebar-progress-pct').textContent = pct + '%';
  $('#sidebar-progress-fill').style.width = pct + '%';

  const notas = aprobadas.map(p => Number(p.nota)).filter(n => !isNaN(n));
  $('#progreso-promedio').textContent = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(2) : '—';

  const porAnio = {};
  state.plan.forEach(p => { (porAnio[p.anio] = porAnio[p.anio] || []).push(p); });
  const anios = Object.keys(porAnio).sort((a,b) => a-b);

  if(!anios.length){
    $('#plan-years').innerHTML = '<p class="empty-note">Todavía no cargaste el plan de estudios. Agregá materias con el botón de arriba.</p>';
    return;
  }

  const cuatriLabel = { '1':'1er cuatrimestre', '2':'2do cuatrimestre', 'anual':'Anual' };

  $('#plan-years').innerHTML = anios.map(anio => {
    const items = porAnio[anio].sort((a,b) => String(a.cuatrimestre).localeCompare(String(b.cuatrimestre)) || ((a.orden ?? 1e9) - (b.orden ?? 1e9)) || a.nombre.localeCompare(b.nombre));
    const aprobEnAnio = items.filter(i => i.estado==='aprobada').length;
    return `
      <div class="plan-year" data-anio="${anio}">
        <div class="plan-year-header" data-toggle-year="${anio}">
          <span class="plan-year-caret">▾</span>
          <span class="plan-year-title">${anio}° año</span>
          <span class="plan-year-count">${aprobEnAnio}/${items.length}</span>
        </div>
        <div class="plan-year-body">
          ${items.map(p => planRowHtml(p, cuatriLabel)).join('')}
        </div>
      </div>
    `;
  }).join('');

  $$('[data-toggle-year]').forEach(h => h.addEventListener('click', () => h.closest('.plan-year').classList.toggle('is-collapsed')));
  $$('.plan-tachar').forEach(btn => btn.addEventListener('click', () => toggleAprobada(btn.dataset.id)));
  $$('.plan-estado-select').forEach(sel => sel.addEventListener('change', () => updateEstado(sel.dataset.id, sel.value)));
  $$('.plan-nota-input').forEach(inp => inp.addEventListener('change', () => updateNota(inp.dataset.id, inp.value)));
  $$('[data-edit-plan]').forEach(btn => btn.addEventListener('click', () => editPlanMateria(btn.dataset.editPlan)));
  $$('[data-del-plan]').forEach(btn => btn.addEventListener('click', () => delPlanMateria(btn.dataset.delPlan)));
}

function correlativasPendientes(p){
  return (p.correlativas||[])
    .map(id => state.plan.find(x => x.id === id))
    .filter(x => x && x.estado !== 'aprobada');
}

function planRowHtml(p, cuatriLabel){
  const pendientes = correlativasPendientes(p);
  const locked = pendientes.length > 0 && p.estado !== 'aprobada';
  return `
    <div class="plan-row ${p.estado==='aprobada'?'is-aprobada':''} ${locked?'is-locked':''}">
      <button class="plan-tachar ${p.estado==='aprobada'?'is-aprobada':''}" data-id="${p.id}" title="Marcar aprobada">✓</button>
      <div class="plan-row-name">
        ${escapeHtml(p.nombre)}${p.codigo ? ` <span class="plan-codigo">${escapeHtml(p.codigo)}</span>` : ''}
        <div class="plan-strike"></div>
        <div class="mini-item-meta">${cuatriLabel[p.cuatrimestre]||''}${locked?` · 🔒 requiere: ${pendientes.map(x=>escapeHtml(x.nombre)).join(', ')}`:''}${(!p.correlativas||!p.correlativas.length) && p.correlativasTexto ? ` · ref. PDF: ${escapeHtml(p.correlativasTexto)}` : ''}</div>
      </div>
      <select class="plan-estado-select" data-id="${p.id}">
        ${ESTADOS.map(e => `<option value="${e.v}" ${p.estado===e.v?'selected':''}>${e.label}</option>`).join('')}
      </select>
      ${p.estado==='aprobada' ? `<input class="plan-nota-input" data-id="${p.id}" type="number" min="1" max="10" value="${p.nota??''}" placeholder="nota">` : ''}
      <div class="plan-row-actions">
        <button class="row-icon-btn" data-edit-plan="${p.id}" title="Editar">✎</button>
        <button class="row-icon-btn" data-del-plan="${p.id}" title="Eliminar">✕</button>
      </div>
    </div>
  `;
}

async function toggleAprobada(id){
  const p = state.plan.find(x => x.id === id);
  if(!p) return;
  if(p.estado !== 'aprobada'){
    const pend = correlativasPendientes(p);
    if(pend.length && !confirm(`Todavía no aprobaste: ${pend.map(x=>x.nombre).join(', ')}. ¿Marcar "${p.nombre}" como aprobada igual?`)) return;
    await userDoc(currentUser.uid).collection('plan').doc(id).update({ estado:'aprobada' });
  } else {
    await userDoc(currentUser.uid).collection('plan').doc(id).update({ estado:'regular' });
  }
}
async function updateEstado(id, estado){
  await userDoc(currentUser.uid).collection('plan').doc(id).update({ estado, nota: estado==='aprobada' ? (state.plan.find(p=>p.id===id)?.nota ?? null) : null });
}
async function updateNota(id, val){
  const n = val === '' ? null : Number(val);
  await userDoc(currentUser.uid).collection('plan').doc(id).update({ nota:n });
}
function editPlanMateria(id){
  const p = state.plan.find(x => x.id === id);
  if(!p) return;
  $('#plan-id').value = p.id;
  $('#plan-nombre').value = p.nombre;
  $('#plan-anio').value = p.anio;
  $('#plan-cuatrimestre').value = p.cuatrimestre;
  buildCorrelativasSelect(p.id);
  Array.from($('#plan-correlativas').options).forEach(o => { o.selected = (p.correlativas||[]).includes(o.value); });
  $('#modal-plan-materia').querySelector('.modal-title').textContent = 'Editar materia del plan';
  $('#modal-plan-materia').showModal();
}
async function delPlanMateria(id){
  if(!confirm('¿Eliminar esta materia del plan?')) return;
  await userDoc(currentUser.uid).collection('plan').doc(id).delete();
}

// ============================================================
// IMPORTAR PLAN DESDE PDF
// ============================================================
let importPdfState = null;

function normTxt(s=''){
  return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

async function pdfToLines(file){
  if(!window.pdfjsLib) throw new Error('No se pudo cargar el lector de PDF (revisá tu conexión a internet).');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for(let p = 1; p <= pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .sort((a,b) => b.y - a.y || a.x - b.x);
    let cur = null;
    items.forEach(it => {
      if(!cur || Math.abs(cur.y - it.y) > 3){
        cur = { y: it.y, page: p, items: [] };
        lines.push(cur);
      }
      cur.items.push(it);
    });
  }
  lines.forEach(l => l.items.sort((a,b) => a.x - b.x));
  return lines;
}

// el límite derecho de la columna "asignatura" se ancla en la posición real
// de los códigos de materia en el cuerpo de la tabla (no en el encabezado:
// el texto de datos suele arrancar un poco antes que su propio título de
// columna, y ese margen no es parejo entre columnas ni entre facultades).
function detectColumns(lines){
  let headerX = null;
  lines.slice(0, 60).forEach(line => line.items.forEach(it => {
    const t = normTxt(it.str);
    if(/^(cod|codigo)\.?$/.test(t) && headerX === null) headerX = it.x;
    if(headerX === null && /^(correlativas?|requisitos?)$/.test(t)) headerX = it.x;
  }));

  const codeRe = /^[A-ZÑ]{2,10}\d{2,5}[A-Z]?$/;
  const windowLo = headerX !== null ? headerX - 80 : 0;
  const windowHi = headerX !== null ? headerX + 80 : Infinity;
  let dataCodeX = null;
  lines.forEach(line => line.items.forEach(it => {
    if(it.x >= windowLo && it.x <= windowHi && codeRe.test(it.str.trim())){
      if(dataCodeX === null || it.x < dataCodeX) dataCodeX = it.x;
    }
  }));

  let nombreEndX;
  if(dataCodeX !== null) nombreEndX = dataCodeX - 4;
  else if(headerX !== null) nombreEndX = headerX - 20;
  else {
    const pageWidths = lines.map(l => Math.max(0, ...l.items.map(i => i.x)));
    nombreEndX = (Math.max(...pageWidths, 400)) * 0.55;
  }
  return { nombreEndX };
}

const ANIO_PALABRAS = { primer:1, primero:1, segundo:2, tercer:3, tercero:3, cuarto:4, quinto:5, sexto:6, septimo:7, octavo:8 };

// el número de cuatrimestre suele imprimirse en una celda combinada que
// abarca varias filas, centrada verticalmente en ese grupo — no en la
// primera fila. Por eso el cuatrimestre no se "arrastra" fila por fila:
// se junta la posición de cada marcador encontrado y, al final, cada
// materia queda con el cuatrimestre de su marcador más cercano.
function parsePlanLines(lines){
  const cols = detectColumns(lines);
  const provisional = [];
  const markerRaw = {};      // anio -> [{docY, digit}] (números de la columna "Cuat")
  const markerResolved = {}; // anio -> [{docY, label}] (ya como '1' | '2' | 'anual')
  let anioActual = null;
  let lastRow = null;
  let stopped = false;

  const docY = line => line.page * 100000 - line.y;
  const addRaw = (anio, y, digit) => { (markerRaw[anio] = markerRaw[anio] || []).push({ y, digit }); };
  const addResolved = (anio, y, label) => { (markerResolved[anio] = markerResolved[anio] || []).push({ y, label }); };

  for(const line of lines){
    if(stopped) continue;
    const fullText = line.items.map(i => i.str).join(' ').replace(/\s+/g,' ').trim();
    if(!fullText) continue;

    if(/CR[EÉ]DITOS DE GRADO|CR[EÉ]DITOS TOTALES|REQUISITOS ACAD[EÉ]MIC/i.test(fullText)){ stopped = true; continue; }
    if(/^\(\+\+\)/.test(fullText)) continue;

    const anioMatch = fullText.match(/^(PRIMER|SEGUNDO|TERCER|CUARTO|QUINTO|SEXTO|S[EÉ]PTIMO|OCTAVO)\s+A[ÑN]O\b/i);
    if(anioMatch){
      anioActual = ANIO_PALABRAS[normTxt(anioMatch[1])] || (anioActual||0)+1;
      lastRow = null;
      continue;
    }
    if(/CR[EÉ]DITOS|GRADO (OBLIGATORIOS|OPTATIVAS|PPS|PSC)|REQUISITOS ACAD[EÉ]MIC|SUJETO A VERIFICACI|^(Cu|at|Asignatura|C[oó]d\.?|CG|Hs\.?|Correlativas)$/i.test(fullText)) continue;

    if(/\b1\s*(er|ro)?\.?\s*cuatr|cuatrimestre\s*1\b/i.test(fullText) && fullText.length < 40){ addResolved(anioActual, docY(line), '1'); lastRow = null; continue; }
    if(/\b2\s*(do)?\.?\s*cuatr|cuatrimestre\s*2\b/i.test(fullText) && fullText.length < 40){ addResolved(anioActual, docY(line), '2'); lastRow = null; continue; }
    if(/^anual$/i.test(fullText)){ addResolved(anioActual, docY(line), 'anual'); lastRow = null; continue; }

    let nombreText = line.items.filter(i => i.x < cols.nombreEndX)
      .map(i => i.str).join(' ').replace(/\s+/g,' ').trim();
    const detalleText = line.items.filter(i => i.x >= cols.nombreEndX)
      .map(i => i.str).join(' ').replace(/\s+/g,' ').trim();

    const cuatMarker = nombreText.match(/^(\d{1,2})\s+(\S.*)$/);
    if(cuatMarker){
      addRaw(anioActual, docY(line), cuatMarker[1]);
      nombreText = cuatMarker[2];
    } else if(/^\d{1,2}$/.test(nombreText)){
      addRaw(anioActual, docY(line), nombreText);
      nombreText = '';
    }

    // separa código (y CG/Hs, que se descartan) del resto de correlativas
    let codigo = '', correlativasTexto = detalleText;
    const detalleMatch = detalleText.match(/^([A-ZÑ]{2,10}\d{2,5}[A-Z]?|-)\s*(?:\d{1,2}(?:[.,]\d)?\s*)?(?:\d{2,4}\s*)?(.*)$/);
    if(detalleMatch){
      codigo = detalleMatch[1] === '-' ? '' : detalleMatch[1];
      correlativasTexto = (detalleMatch[2] || '').trim();
    }

    if(nombreText && anioActual){
      const row = { nombre: nombreText, anio: anioActual, docY: docY(line), codigo, correlativasTexto, incluir: true };
      provisional.push(row);
      lastRow = row;
    } else if(detalleText && lastRow){
      lastRow.correlativasTexto = (lastRow.correlativasTexto + ' ' + detalleText).trim();
    }
  }

  // resuelve los marcadores numéricos: el primer valor distinto visto en el
  // año es cuatrimestre 1, el segundo es cuatrimestre 2 (alterna) — el propio
  // valor puede ser una numeración global (1..10) y no siempre 1/2.
  Object.keys(markerRaw).forEach(anio => {
    const seenVals = [];
    markerRaw[anio].forEach(m => { if(!seenVals.includes(m.digit)) seenVals.push(m.digit); });
    markerRaw[anio].forEach(m => addResolved(Number(anio), m.y, seenVals.indexOf(m.digit) % 2 === 0 ? '1' : '2'));
  });

  provisional.forEach(row => {
    const marks = markerResolved[row.anio];
    if(!marks || !marks.length){ row.cuatrimestre = '1'; return; }
    let best = marks[0], bestDist = Math.abs(row.docY - marks[0].y);
    marks.forEach(m => {
      const d = Math.abs(row.docY - m.y);
      if(d < bestDist){ best = m; bestDist = d; }
    });
    row.cuatrimestre = best.label;
    delete row.docY;
  });

  provisional.forEach((r, i) => { r.orden = i; });
  return provisional;
}

$('#import-plan-btn').addEventListener('click', () => {
  $('#import-pdf-file').value = '';
  $('#import-pdf-status').textContent = '';
  $('#import-preview-wrap').classList.add('hidden');
  $('#import-preview-list').innerHTML = '';
  $('#import-confirm-btn').classList.add('hidden');
  importPdfState = null;
  $('#modal-import-plan').showModal();
});

$('#import-pdf-process-btn').addEventListener('click', async () => {
  const file = $('#import-pdf-file').files[0];
  if(!file){ $('#import-pdf-status').textContent = 'Elegí un archivo PDF primero.'; return; }
  $('#import-pdf-status').textContent = 'Procesando…';
  try{
    const lines = await pdfToLines(file);
    const rows = parsePlanLines(lines);
    if(!rows.length){
      $('#import-pdf-status').textContent = 'No se detectaron materias. Puede que el PDF sea una imagen escaneada (sin texto) o tenga un formato muy distinto.';
      return;
    }
    importPdfState = { rows };
    renderImportPreview();
    $('#import-pdf-status').textContent = `${rows.length} materias detectadas.`;
    $('#import-preview-wrap').classList.remove('hidden');
    $('#import-confirm-btn').classList.remove('hidden');
  } catch(err){
    console.error(err);
    $('#import-pdf-status').textContent = 'No se pudo leer el PDF: ' + err.message;
  }
});

function renderImportPreview(){
  const anioOpts = [1,2,3,4,5,6,7].map(n => `<option value="${n}">${n}° año</option>`).join('');
  const cuatOpts = `<option value="1">1er cuat.</option><option value="2">2do cuat.</option><option value="anual">Anual</option>`;
  $('#import-preview-list').innerHTML = importPdfState.rows.map((r, i) => `
    <div class="import-row ${r.incluir?'':'is-excluded'}">
      <div class="import-row-line1">
        <input type="checkbox" class="import-row-check" data-idx="${i}" ${r.incluir?'checked':''}>
        <input type="text" class="input import-row-nombre" data-idx="${i}" value="${escapeAttr(r.nombre)}">
        <select class="input select import-row-anio" data-idx="${i}">${anioOpts}</select>
        <select class="input select import-row-cuat" data-idx="${i}">${cuatOpts}</select>
      </div>
      <div class="import-row-line2">
        <input type="text" class="input import-row-codigo" data-idx="${i}" placeholder="código" value="${escapeAttr(r.codigo||'')}">
        <input type="text" class="input import-row-correl" data-idx="${i}" placeholder="correlativas (referencia, texto libre)" value="${escapeAttr(r.correlativasTexto||'')}">
      </div>
    </div>
  `).join('');
  importPdfState.rows.forEach((r, i) => {
    $(`.import-row-anio[data-idx="${i}"]`).value = String(r.anio);
    $(`.import-row-cuat[data-idx="${i}"]`).value = r.cuatrimestre;
  });
  $$('.import-row-check').forEach(cb => cb.addEventListener('change', () => {
    const i = Number(cb.dataset.idx);
    importPdfState.rows[i].incluir = cb.checked;
    cb.closest('.import-row').classList.toggle('is-excluded', !cb.checked);
  }));
  $$('.import-row-nombre').forEach(inp => inp.addEventListener('input', () => {
    importPdfState.rows[Number(inp.dataset.idx)].nombre = inp.value;
  }));
  $$('.import-row-anio').forEach(sel => sel.addEventListener('change', () => {
    importPdfState.rows[Number(sel.dataset.idx)].anio = Number(sel.value);
  }));
  $$('.import-row-cuat').forEach(sel => sel.addEventListener('change', () => {
    importPdfState.rows[Number(sel.dataset.idx)].cuatrimestre = sel.value;
  }));
  $$('.import-row-codigo').forEach(inp => inp.addEventListener('input', () => {
    importPdfState.rows[Number(inp.dataset.idx)].codigo = inp.value;
  }));
  $$('.import-row-correl').forEach(inp => inp.addEventListener('input', () => {
    importPdfState.rows[Number(inp.dataset.idx)].correlativasTexto = inp.value;
  }));
}

$('#import-confirm-btn').addEventListener('click', async () => {
  if(!importPdfState) return;
  if(!currentUser){
    $('#import-pdf-status').textContent = 'Se cerró tu sesión. Cerrá este cuadro, volvé a iniciar sesión y probá de nuevo.';
    return;
  }
  const seleccion = importPdfState.rows.filter(r => r.incluir && r.nombre.trim());
  if(!seleccion.length) return;
  const btn = $('#import-confirm-btn');
  btn.disabled = true;
  $('#import-pdf-status').textContent = 'Importando…';
  try{
    const col = userDoc(currentUser.uid).collection('plan');
    await Promise.all(seleccion.map(r => col.add({
      nombre: r.nombre.trim(),
      anio: Number(r.anio),
      cuatrimestre: r.cuatrimestre,
      estado: 'no_cursada',
      nota: null,
      correlativas: [],
      codigo: r.codigo || null,
      correlativasTexto: r.correlativasTexto || null,
      orden: r.orden,
    })));
    $('#modal-import-plan').close();
  } catch(err){
    console.error(err);
    $('#import-pdf-status').textContent = 'Error al importar: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------------- helpers de escape ----------------
function escapeHtml(str=''){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str=''){ return escapeHtml(str); }
