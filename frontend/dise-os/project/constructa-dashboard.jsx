// constructa-dashboard.jsx — el dashboard completo en un archivo
// Linear/Height vibe. Timeline con drag-and-drop real (mover, resize, drop desde unscheduled).

const TODAY = new Date(2026, 4, 14);
const DAY_W = 92;
const ROW_H = 48;

const STATUS = {
  pending:   {label:'Pendiente',   bg:'#FEF6E4', border:'#F0C75E', stripe:'#E89B14', dot:'#E89B14'},
  progress:  {label:'En progreso', bg:'#FFEEE2', border:'#F09A66', stripe:'#E76A2D', dot:'#E76A2D'},
  blocked:   {label:'Bloqueada',   bg:'#FCE5E5', border:'#EE8A8A', stripe:'#D03A3A', dot:'#D03A3A'},
  review:    {label:'En revisión', bg:'#E8EFFD', border:'#8AA8EE', stripe:'#3A6BD9', dot:'#3A6BD9'},
  completed: {label:'Completada',  bg:'#E2F3E9', border:'#7AC498', stripe:'#1F9A5A', dot:'#1F9A5A'},
};

const AVATAR_COLORS = ['#E76A2D','#3A6BD9','#1F9A5A','#9A4DC9','#D03A3A','#E89B14','#0EA5A0'];
function avatarColor(seed) {
  let h = 0; for (const c of seed) h = (h*31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const INITIAL_TASKS = [
  {id:'t1', name:'Excavación y movimiento de suelos', start:-6, end:-2, status:'completed', assignee:{ini:'AV', name:'Ana Villar'}, priority:'normal', tag:'Movimiento de suelos'},
  {id:'t2', name:'Hormigón armado · Nivel 3', start:-2, end:3, status:'progress', assignee:{ini:'MR', name:'Mateo Ríos'}, priority:'high', tag:'Estructura'},
  {id:'t3', name:'Encofrado losa N4', start:1, end:5, status:'pending', assignee:{ini:'LP', name:'Laura Paz'}, priority:'normal', tag:'Estructura'},
  {id:'t4', name:'Tendido eléctrico · Planta 2', start:0, end:3, status:'review', assignee:{ini:'JC', name:'Joaquín Caro'}, priority:'normal', tag:'Instalaciones'},
  {id:'t5', name:'Inspección municipal', start:6, end:6, status:'blocked', assignee:{ini:'IM', name:'Inés Moreno'}, priority:'critical', tag:'Documentación'},
  {id:'t6', name:'Aislación hidráulica · subsuelo', start:3, end:7, status:'pending', assignee:{ini:'NS', name:'Nicolás Sosa'}, priority:'normal', tag:'Terminaciones'},
  {id:'t7', name:'Carpintería de aluminio', start:8, end:12, status:'pending', assignee:{ini:'CR', name:'Camila Reyes'}, priority:'normal', tag:'Aberturas'},
];

const INITIAL_UNSCHEDULED = [
  {id:'u1', name:'Revestimientos de pisos', duration:5, priority:'normal', tag:'Terminaciones'},
  {id:'u2', name:'Pintura interior · áreas comunes', duration:7, priority:'normal', tag:'Terminaciones'},
  {id:'u3', name:'Instalación de ascensores', duration:4, priority:'high', tag:'Equipamiento'},
  {id:'u4', name:'Revisión de plomería gruesa', duration:3, priority:'normal', tag:'Instalaciones'},
];

const ACTIVITY = [
  {who:'Mateo Ríos', ini:'MR', action:'movió', target:'Hormigón armado · Nivel 3', detail:'a 12 May → 19 May', time:'hace 12 min', kind:'move'},
  {who:'Ana Villar', ini:'AV', action:'completó', target:'Excavación y movimiento de suelos', time:'hace 1 h', kind:'done'},
  {who:'Joaquín Caro', ini:'JC', action:'envió a revisión', target:'Tendido eléctrico · Planta 2', time:'hace 2 h', kind:'review'},
  {who:'Inés Moreno', ini:'IM', action:'bloqueó', target:'Inspección municipal', detail:'falta documentación A-4', time:'ayer', kind:'block'},
  {who:'Laura Paz', ini:'LP', action:'creó', target:'Encofrado losa N4', time:'ayer', kind:'create'},
];

// ─── helpers ──────────────────────────────────────────────────────────
const dayName = ['dom','lun','mar','mié','jue','vie','sáb'];
function addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function fmt(d){ return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function isWeekend(d){ return d.getDay()===0 || d.getDay()===6; }

// Tiny inline icons
const I = {
  search: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  filter: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  plus: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  chevR: <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chevD: <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  grip: <svg width="10" height="14" viewBox="0 0 10 14" fill="none"><circle cx="3" cy="3" r="1.1" fill="currentColor"/><circle cx="3" cy="7" r="1.1" fill="currentColor"/><circle cx="3" cy="11" r="1.1" fill="currentColor"/><circle cx="7" cy="3" r="1.1" fill="currentColor"/><circle cx="7" cy="7" r="1.1" fill="currentColor"/><circle cx="7" cy="11" r="1.1" fill="currentColor"/></svg>,
  bell: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 12V8a5 5 0 0110 0v4M2 12h12M6 14a2 2 0 004 0" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  cmd: <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M5 3v10M11 3v10M3 5h10M3 11h10" stroke="currentColor" strokeWidth="1.4"/></svg>,
};

function StatusIcon({status, size=14}) {
  const s = STATUS[status];
  if (status==='completed') {
    return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill={s.dot}/><path d="M5 8l2 2 4-4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>;
  }
  if (status==='progress') {
    return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke={s.dot} strokeWidth="1.5" fill="none"/><path d="M8 1.5a6.5 6.5 0 016.5 6.5h-6.5z" fill={s.dot} transform="rotate(-30 8 8)"/></svg>;
  }
  if (status==='blocked') {
    return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill={s.dot}/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round"/></svg>;
  }
  if (status==='review') {
    return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke={s.dot} strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2.5" fill={s.dot}/></svg>;
  }
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke={s.dot} strokeWidth="1.5" strokeDasharray="2 2" fill="none"/></svg>;
}

// ─── sidebar ──────────────────────────────────────────────────────────
function Sidebar() {
  return (
    <aside style={S.side}>
      <div style={S.sideTop}>
        <div style={S.brand}>
          <div style={S.brandMark}>
            <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
              <path d="M3 19V8.5L11 3l8 5.5V19H3z" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{display:'flex', flexDirection:'column', lineHeight:1.1}}>
            <span style={{fontSize:13, fontWeight:600, letterSpacing:'-0.01em'}}>Constructa</span>
            <span style={{fontSize:10.5, color:'#94928D'}}>Estudio Velar</span>
          </div>
          <div style={S.workspaceBtn}>{I.chevD}</div>
        </div>

        <div style={S.searchPill}>
          <span style={{color:'#94928D'}}>{I.search}</span>
          <span style={{flex:1, color:'#94928D'}}>Buscar tareas, obras…</span>
          <span style={S.kbd}>⌘K</span>
        </div>
      </div>

      <nav style={S.nav}>
        <div style={S.navItem}>
          <span style={{...S.navIcon, color:'#94928D'}}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 13V7l5-4 5 4v6H3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
          </span>
          <span>Inicio</span>
        </div>
        <div style={S.navItem}>
          <span style={{...S.navIcon, color:'#94928D'}}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M2 6h12" stroke="currentColor" strokeWidth="1.5"/></svg>
          </span>
          <span>Bandeja</span>
          <span style={S.navCount}>3</span>
        </div>
        <div style={S.navItem}>
          <span style={{...S.navIcon, color:'#94928D'}}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M5 2v3M11 2v3M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </span>
          <span>Mi día</span>
        </div>
      </nav>

      <div style={S.sideSection}>
        <div style={S.sideHead}>
          <span>Obras</span>
          <span style={{...S.sideHeadIcon, cursor:'pointer'}}>{I.plus}</span>
        </div>
        <div style={S.projList}>
          <div style={{...S.projItem, ...S.projActive}}>
            <span style={S.projDot('#E76A2D')}></span>
            <span style={{flex:1}}>Edificio Nórdico</span>
            <span style={S.projMeta}>67%</span>
          </div>
          <div style={S.projItem}>
            <span style={S.projDot('#3A6BD9')}></span>
            <span style={{flex:1}}>Torre Belgrano</span>
            <span style={S.projMeta}>32%</span>
          </div>
          <div style={S.projItem}>
            <span style={S.projDot('#1F9A5A')}></span>
            <span style={{flex:1}}>Casa Pampa</span>
            <span style={S.projMeta}>94%</span>
          </div>
          <div style={S.projItem}>
            <span style={S.projDot('#9A4DC9')}></span>
            <span style={{flex:1}}>Galpón Industrial 4</span>
            <span style={S.projMeta}>11%</span>
          </div>
          <div style={S.projItem}>
            <span style={S.projDot('#94928D')}></span>
            <span style={{flex:1, color:'#94928D'}}>Ver archivadas</span>
          </div>
        </div>
      </div>

      <div style={S.sideSection}>
        <div style={S.sideHead}><span>Vistas</span></div>
        <div style={S.projList}>
          <div style={S.viewItem}>
            <span style={S.viewIcon}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="3" height="8" fill="currentColor"/><rect x="6" y="6" width="3" height="6" fill="currentColor"/><rect x="10" y="3" width="3" height="9" fill="currentColor"/></svg>
            </span>
            <span style={{flex:1}}>Cronograma</span>
          </div>
          <div style={S.viewItem}>
            <span style={S.viewIcon}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="3" height="10" rx="0.6" stroke="currentColor" strokeWidth="1.3"/><rect x="6.5" y="3" width="3" height="6" rx="0.6" stroke="currentColor" strokeWidth="1.3"/><rect x="11" y="3" width="3" height="8" rx="0.6" stroke="currentColor" strokeWidth="1.3"/></svg>
            </span>
            <span style={{flex:1}}>Tablero</span>
          </div>
          <div style={S.viewItem}>
            <span style={S.viewIcon}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </span>
            <span style={{flex:1}}>Lista</span>
          </div>
          <div style={S.viewItem}>
            <span style={S.viewIcon}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 11V6l6-3 6 3v5l-6 3-6-3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
            </span>
            <span style={{flex:1}}>Mapa de obras</span>
          </div>
        </div>
      </div>

      <div style={{marginTop:'auto'}}>
        <div style={S.userCard}>
          <div style={{...S.avatar, background:'#E76A2D'}}>FC</div>
          <div style={{flex:1, lineHeight:1.15, minWidth:0}}>
            <div style={{fontSize:12, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>Facundo C.</div>
            <div style={{fontSize:10.5, color:'#94928D'}}>Jefe de obra</div>
          </div>
          <span style={{color:'#94928D'}}>{I.chevD}</span>
        </div>
      </div>
    </aside>
  );
}

// ─── topbar + project header ──────────────────────────────────────────
function TopBar() {
  return (
    <div style={S.topbar}>
      <div style={S.crumbs}>
        <span style={{color:'#94928D'}}>Workspace</span>
        <span style={{color:'#D6D2CB'}}>/</span>
        <span style={{color:'#94928D'}}>Edificio Nórdico</span>
        <span style={{color:'#D6D2CB'}}>/</span>
        <span style={{color:'#1B1B1A', fontWeight:500}}>Cronograma</span>
      </div>
      <div style={S.topRight}>
        <button style={S.iconBtn}>{I.bell}<span style={S.bellDot}></span></button>
        <div style={S.divLine}></div>
        <button style={S.shareBtn}>Compartir</button>
        <button style={S.primaryBtn}>{I.plus}<span>Nueva tarea</span></button>
      </div>
    </div>
  );
}

function ProjectHeader({tasks}) {
  const total = tasks.length;
  const done = tasks.filter(t=>t.status==='completed').length;
  const progress = tasks.filter(t=>t.status==='progress').length;
  const blocked = tasks.filter(t=>t.status==='blocked').length;
  const review = tasks.filter(t=>t.status==='review').length;
  const pending = tasks.filter(t=>t.status==='pending').length;
  const pct = Math.round((done/total)*100);

  return (
    <header style={S.projHeader}>
      <div style={S.projHeaderTop}>
        <div style={S.projTitleRow}>
          <div style={S.projBadge}>EN</div>
          <div>
            <h1 style={S.projTitle}>Edificio Nórdico</h1>
            <div style={S.projSub}>
              <span style={S.statusPill}>
                <span style={{...S.statusDotSm, background:'#1F9A5A'}}></span>
                En obra · Etapa 3
              </span>
              <span style={{color:'#94928D', fontSize:12.5}}>Av. del Libertador 4820 · CABA</span>
              <span style={{color:'#D6D2CB'}}>·</span>
              <span style={{color:'#94928D', fontSize:12.5}}>Entrega prevista 14 Nov 2026</span>
            </div>
          </div>
        </div>
        <div style={S.membersRow}>
          <div style={S.avatars}>
            {[{i:'AV',c:'#E76A2D'},{i:'MR',c:'#3A6BD9'},{i:'LP',c:'#1F9A5A'},{i:'JC',c:'#9A4DC9'},{i:'IM',c:'#D03A3A'}].map((a,i)=>(
              <div key={i} style={{...S.miniAvatar, background:a.c, marginLeft: i?-7:0, zIndex:10-i}}>{a.i}</div>
            ))}
            <div style={{...S.miniAvatar, background:'#F4F1EB', color:'#6B6A66', marginLeft:-7, zIndex:1, border:'2px solid #fff'}}>+7</div>
          </div>
          <button style={S.ghostBtn}>Invitar</button>
        </div>
      </div>

      <div style={S.pulseRow}>
        <div style={S.pulseProgress}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
            <span style={S.pulseLbl}>Avance general</span>
            <span style={S.pulseVal}>{pct}%</span>
          </div>
          <div style={S.progressBar}>
            <div style={{...S.progressFill, width:`${pct}%`}}></div>
            <div style={{...S.progressDelta, left:`${pct}%`}}></div>
          </div>
          <div style={S.progressLegend}>
            <span><b style={{color:'#1B1B1A'}}>{done}</b> de {total} completadas</span>
            <span style={{color:'#1F9A5A'}}>↑ 4.2% esta semana</span>
          </div>
        </div>

        <div style={S.pulseStats}>
          <div style={S.pulseCell}>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <StatusIcon status="progress" size={13}/>
              <span style={S.pulseLbl}>En progreso</span>
            </div>
            <div style={S.pulseValSm}>{progress}</div>
          </div>
          <div style={S.pulseDiv}></div>
          <div style={S.pulseCell}>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <StatusIcon status="review" size={13}/>
              <span style={S.pulseLbl}>En revisión</span>
            </div>
            <div style={S.pulseValSm}>{review}</div>
          </div>
          <div style={S.pulseDiv}></div>
          <div style={S.pulseCell}>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <StatusIcon status="pending" size={13}/>
              <span style={S.pulseLbl}>Pendientes</span>
            </div>
            <div style={S.pulseValSm}>{pending}</div>
          </div>
          <div style={S.pulseDiv}></div>
          <div style={S.pulseCell}>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <StatusIcon status="blocked" size={13}/>
              <span style={S.pulseLbl}>Bloqueadas</span>
            </div>
            <div style={{...S.pulseValSm, color: blocked>0 ? '#D03A3A' : '#1B1B1A'}}>{blocked}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

window.ConstructaDashboard_Sidebar = Sidebar;
window.ConstructaDashboard_TopBar = TopBar;
window.ConstructaDashboard_ProjectHeader = ProjectHeader;
window.ConstructaDashboard_STATUS = STATUS;
window.ConstructaDashboard_INITIAL_TASKS = INITIAL_TASKS;
window.ConstructaDashboard_INITIAL_UNSCHEDULED = INITIAL_UNSCHEDULED;
window.ConstructaDashboard_ACTIVITY = ACTIVITY;
window.ConstructaDashboard_DAY_W = DAY_W;
window.ConstructaDashboard_ROW_H = ROW_H;
window.ConstructaDashboard_TODAY = TODAY;
window.ConstructaDashboard_addDays = addDays;
window.ConstructaDashboard_fmt = fmt;
window.ConstructaDashboard_dayName = dayName;
window.ConstructaDashboard_isWeekend = isWeekend;
window.ConstructaDashboard_StatusIcon = StatusIcon;
window.ConstructaDashboard_avatarColor = avatarColor;
window.ConstructaDashboard_I = I;

// ─── styles ────────────────────────────────────────────────────────────
const S = {
  side: {
    width:230, height:'100%', background:'#FAF8F4',
    borderRight:'1px solid #ECE7DD',
    display:'flex', flexDirection:'column',
    padding:'14px 10px',
    fontSize:13, color:'#1B1B1A',
  },
  sideTop: { display:'flex', flexDirection:'column', gap:10, paddingBottom:12 },
  brand: {
    display:'flex', alignItems:'center', gap:9, padding:'4px 6px',
    borderRadius:7, cursor:'pointer',
  },
  brandMark: {
    width:24, height:24, borderRadius:6, background:'#1B1B1A',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  workspaceBtn: { color:'#94928D', marginLeft:'auto' },
  searchPill: {
    display:'flex', alignItems:'center', gap:8,
    background:'#fff', border:'1px solid #ECE7DD', borderRadius:7,
    padding:'6px 8px', fontSize:12.5,
  },
  kbd: {
    fontSize:10, padding:'1px 5px', borderRadius:4,
    background:'#F4F1EB', color:'#6B6A66',
    fontFamily:"'JetBrains Mono', monospace",
    border:'1px solid #ECE7DD',
  },

  nav: { display:'flex', flexDirection:'column', gap:1, marginBottom:14 },
  navItem: {
    display:'flex', alignItems:'center', gap:9,
    padding:'6px 8px', borderRadius:6,
    fontSize:13, color:'#3A3936', cursor:'pointer',
  },
  navIcon: { display:'inline-flex', width:16, justifyContent:'center' },
  navCount: {
    fontSize:10.5, padding:'1px 6px', borderRadius:99,
    background:'#E76A2D', color:'#fff', fontWeight:600,
  },

  sideSection: { paddingTop:6, paddingBottom:10 },
  sideHead: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'5px 8px', fontSize:10.5, fontWeight:600, letterSpacing:'0.06em',
    color:'#94928D', textTransform:'uppercase',
  },
  sideHeadIcon: { color:'#94928D', display:'flex' },
  projList: { display:'flex', flexDirection:'column', gap:1 },
  projItem: {
    display:'flex', alignItems:'center', gap:8,
    padding:'5px 8px', borderRadius:6,
    fontSize:13, color:'#3A3936', cursor:'pointer',
  },
  projActive: { background:'#fff', boxShadow:'0 1px 1px rgba(20,20,20,0.04), 0 0 0 1px #ECE7DD', color:'#1B1B1A', fontWeight:500 },
  projDot: (c) => ({ width:8, height:8, borderRadius:99, background:c, flexShrink:0 }),
  projMeta: { fontSize:10.5, color:'#94928D', fontFamily:"'JetBrains Mono', monospace" },
  viewItem: {
    display:'flex', alignItems:'center', gap:9,
    padding:'5px 8px', borderRadius:6,
    fontSize:13, color:'#3A3936', cursor:'pointer',
  },
  viewIcon: { color:'#94928D', width:16, display:'flex', justifyContent:'center' },

  userCard: {
    display:'flex', alignItems:'center', gap:9,
    padding:'7px 8px', borderRadius:7,
    background:'#fff', border:'1px solid #ECE7DD',
  },
  avatar: {
    width:26, height:26, borderRadius:7, color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:10.5, fontWeight:600, flexShrink:0,
  },

  // top bar
  topbar: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'10px 20px',
    borderBottom:'1px solid #ECE7DD',
    background:'#fff',
  },
  crumbs: { display:'flex', alignItems:'center', gap:8, fontSize:13 },
  topRight: { display:'flex', alignItems:'center', gap:8 },
  iconBtn: {
    width:30, height:30, borderRadius:7,
    background:'#fff', border:'1px solid #ECE7DD',
    display:'flex', alignItems:'center', justifyContent:'center',
    color:'#3A3936', cursor:'pointer', position:'relative',
  },
  bellDot: {
    position:'absolute', top:6, right:6, width:6, height:6, borderRadius:6,
    background:'#E76A2D', boxShadow:'0 0 0 2px #fff',
  },
  divLine: { width:1, height:20, background:'#ECE7DD' },
  shareBtn: {
    background:'#fff', border:'1px solid #ECE7DD', borderRadius:7,
    padding:'6px 12px', fontSize:12.5, fontWeight:500, color:'#3A3936',
    cursor:'pointer',
  },
  primaryBtn: {
    background:'#1B1B1A', color:'#fff', border:'none',
    padding:'6px 12px', borderRadius:7,
    fontSize:12.5, fontWeight:500,
    display:'flex', alignItems:'center', gap:7, cursor:'pointer',
    boxShadow:'0 1px 0 rgba(255,255,255,0.06) inset, 0 1px 2px rgba(0,0,0,0.10)',
  },

  // project header
  projHeader: { padding:'20px 28px 0', borderBottom:'1px solid #ECE7DD' },
  projHeaderTop: { display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:24, marginBottom:20 },
  projTitleRow: { display:'flex', alignItems:'center', gap:14 },
  projBadge: {
    width:44, height:44, borderRadius:10,
    background:'linear-gradient(135deg, #E76A2D, #F09A66)',
    color:'#fff', fontWeight:600, fontSize:14, letterSpacing:'0.04em',
    display:'flex', alignItems:'center', justifyContent:'center',
    boxShadow:'0 4px 12px -2px rgba(231,106,45,0.4)',
  },
  projTitle: { margin:0, fontSize:22, fontWeight:600, letterSpacing:'-0.02em' },
  projSub: { display:'flex', alignItems:'center', gap:10, marginTop:5 },
  statusPill: {
    display:'inline-flex', alignItems:'center', gap:6,
    fontSize:11.5, color:'#1F9A5A', fontWeight:500,
    padding:'3px 9px', borderRadius:99,
    background:'#E2F3E9', border:'1px solid #BFE3CE',
  },
  statusDotSm: { width:6, height:6, borderRadius:6, boxShadow:'0 0 0 2.5px rgba(31,154,90,0.18)' },

  membersRow: { display:'flex', alignItems:'center', gap:10 },
  avatars: { display:'flex' },
  miniAvatar: {
    width:30, height:30, borderRadius:99, color:'#fff',
    fontSize:10.5, fontWeight:600,
    display:'flex', alignItems:'center', justifyContent:'center',
    border:'2px solid #fff', boxShadow:'0 1px 2px rgba(0,0,0,0.06)',
  },
  ghostBtn: {
    background:'transparent', border:'1px dashed #C9C3B6', color:'#6B6A66',
    padding:'6px 12px', borderRadius:99,
    fontSize:12.5, cursor:'pointer',
  },

  // pulse strip
  pulseRow: { display:'grid', gridTemplateColumns:'1.1fr 2fr', gap:18, paddingBottom:18 },
  pulseProgress: {
    background:'#fff', border:'1px solid #ECE7DD', borderRadius:11,
    padding:'14px 16px',
  },
  pulseLbl: { fontSize:11, fontWeight:600, letterSpacing:'0.04em', color:'#6B6A66', textTransform:'uppercase' },
  pulseVal: { fontSize:22, fontWeight:600, letterSpacing:'-0.02em', color:'#1B1B1A' },
  progressBar: {
    position:'relative', height:8, borderRadius:99,
    background:'#F4F1EB', overflow:'hidden',
  },
  progressFill: {
    position:'absolute', left:0, top:0, bottom:0,
    background:'linear-gradient(90deg, #E76A2D, #F09A66)', borderRadius:99,
  },
  progressDelta: { position:'absolute' },
  progressLegend: {
    display:'flex', justifyContent:'space-between', marginTop:8,
    fontSize:11.5, color:'#6B6A66',
  },

  pulseStats: {
    background:'#fff', border:'1px solid #ECE7DD', borderRadius:11,
    display:'flex', alignItems:'center', padding:'8px 6px',
  },
  pulseCell: { flex:1, padding:'8px 14px', display:'flex', flexDirection:'column', gap:6 },
  pulseDiv: { width:1, height:32, background:'#ECE7DD' },
  pulseValSm: { fontSize:20, fontWeight:600, letterSpacing:'-0.02em', color:'#1B1B1A' },
};

window.ConstructaDashboard_S = S;
