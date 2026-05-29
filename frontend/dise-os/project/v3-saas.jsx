// V3 — SaaS / Dashboard preview
// Right side: clean form on white. Left side: glimpse of what's behind
// the login — a live-looking dashboard with kanban tasks, KPI cards and
// a project timeline. Most "enterprise" of the three.

function V3SaasDashboard() {
  const [email, setEmail] = React.useState('facu@constructa.ar');
  const [pwd, setPwd] = React.useState('');
  const [step, setStep] = React.useState(1); // 1 = email, 2 = password
  const [show, setShow] = React.useState(false);

  return (
    <div style={v3.root}>
      {/* LEFT — Dashboard preview */}
      <div style={v3.left}>
        {/* fake browser frame */}
        <div style={v3.window}>
          {/* sidebar */}
          <div style={v3.sidebar}>
            <div style={v3.sideBrand}>
              <div style={v3.sideLogo}>
                <svg width="13" height="13" viewBox="0 0 22 22" fill="none">
                  <path d="M3 19V8.5L11 3l8 5.5V19H3z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
                </svg>
              </div>
              <span>Constructa</span>
            </div>
            <div style={v3.workspaceCard}>
              <div style={{fontSize:9.5, color:'rgba(255,255,255,0.4)', letterSpacing:'0.06em'}}>OBRA ACTIVA</div>
              <div style={{fontSize:11.5, fontWeight:600, marginTop:2}}>Edificio Nórdico</div>
              <div style={{fontSize:9.5, color:'rgba(255,255,255,0.5)', marginTop:2}}>Etapa 03 · Estructura</div>
            </div>
            <div style={v3.navItems}>
              {[
                {l:'Resumen', a:true, i:'M3 11l8-7 8 7v9H3v-9z'},
                {l:'Tareas', i:'M5 5h10M5 10h10M5 15h6'},
                {l:'Equipo', i:'M10 9a3 3 0 100-6 3 3 0 000 6zM4 17a6 6 0 0112 0'},
                {l:'Calendario', i:'M4 6h12v10H4zM4 9h12'},
                {l:'Reportes', i:'M5 16V8m5 8V5m5 11v-6'},
                {l:'Configuración', i:'M10 13a3 3 0 100-6 3 3 0 000 6z'},
              ].map((n,i)=>(
                <div key={i} style={{...v3.navItem, ...(n.a ? v3.navActive : {})}}>
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                    <path d={n.i} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>{n.l}</span>
                </div>
              ))}
            </div>
            <div style={v3.sideFoot}>
              <div style={v3.avatar}>FC</div>
              <div>
                <div style={{fontSize:10.5, fontWeight:600}}>Facundo C.</div>
                <div style={{fontSize:9, color:'rgba(255,255,255,0.45)'}}>Jefe de obra</div>
              </div>
            </div>
          </div>

          {/* dashboard area */}
          <div style={v3.dash}>
            <div style={v3.dashHead}>
              <div>
                <div style={v3.crumbs}>Obras / <span style={{color:'#fff'}}>Edificio Nórdico</span></div>
                <div style={v3.dashTitle}>Buenos días, Facundo</div>
              </div>
              <div style={v3.dashHeadRight}>
                <div style={v3.searchPill}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <span>Buscar…</span>
                  <span style={v3.kbd}>⌘K</span>
                </div>
                <div style={v3.bellPill}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M3 12V8a5 5 0 0110 0v4M2 12h12M6 14a2 2 0 004 0" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                  </svg>
                  <span style={v3.bellDot}></span>
                </div>
              </div>
            </div>

            {/* KPI row */}
            <div style={v3.kpis}>
              <div style={v3.kpi}>
                <div style={v3.kpiLbl}>AVANCE GLOBAL</div>
                <div style={v3.kpiVal}>67<span style={v3.kpiUnit}>%</span></div>
                <div style={v3.kpiBar}><div style={{...v3.kpiBarFill, width:'67%'}}></div></div>
                <div style={v3.kpiDelta}>↑ 4.2% esta semana</div>
              </div>
              <div style={v3.kpi}>
                <div style={v3.kpiLbl}>TAREAS ABIERTAS</div>
                <div style={v3.kpiVal}>43</div>
                <div style={v3.miniRow}>
                  <span style={{...v3.miniChip, background:'rgba(237,106,54,0.14)', color:'#ED6A36'}}>12 críticas</span>
                  <span style={{...v3.miniChip, background:'rgba(20,24,30,0.06)', color:'rgba(20,24,30,0.7)'}}>31 normales</span>
                </div>
              </div>
              <div style={v3.kpi}>
                <div style={v3.kpiLbl}>EQUIPO EN OBRA</div>
                <div style={v3.kpiVal}>28<span style={v3.kpiUnit}>/32</span></div>
                <div style={v3.avatarRow}>
                  {['AV','MR','LP','JC','+24'].map((a,i)=>(
                    <div key={i} style={{
                      ...v3.miniAvatar,
                      background: i===4 ? 'rgba(20,24,30,0.06)' : ['#ED6A36','#3DB76E','#6B8AD3','#C8A857'][i],
                      color: i===4 ? 'rgba(20,24,30,0.65)' : '#fff',
                    }}>{a}</div>
                  ))}
                </div>
              </div>
            </div>

            {/* Kanban + Timeline */}
            <div style={v3.bottomRow}>
              {/* Kanban */}
              <div style={v3.kanban}>
                <div style={v3.kanbanHead}>
                  <span style={{fontSize:11.5, fontWeight:600, color:'#fff'}}>Pendientes hoy</span>
                  <span style={{fontSize:10, color:'rgba(255,255,255,0.4)', fontFamily:"'JetBrains Mono', monospace"}}>3 de 12</span>
                </div>
                {[
                  {t:'Colado de losa nivel 4', p:'Crítico', d:'10:30', col:'#ED6A36', team:'AV'},
                  {t:'Inspección eléctrica', p:'Hoy', d:'14:00', col:'#C8A857', team:'MR'},
                  {t:'Encofrado columnas', p:'Mañana', d:'08:00', col:'rgba(255,255,255,0.3)', team:'LP'},
                ].map((task,i)=>(
                  <div key={i} style={v3.task}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6}}>
                      <span style={{fontSize:11, fontWeight:500, color:'#fff', lineHeight:1.3}}>{task.t}</span>
                      <span style={{...v3.taskPill, background:task.col==='#ED6A36' ? 'rgba(237,106,54,0.18)' : task.col==='#C8A857'? 'rgba(200,168,87,0.18)':'rgba(255,255,255,0.06)', color:task.col}}>
                        {task.p}
                      </span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <span style={{fontSize:10, color:'rgba(255,255,255,0.45)', fontFamily:"'JetBrains Mono', monospace"}}>● {task.d}</span>
                      <div style={{...v3.miniAvatar, width:18, height:18, fontSize:8.5, background:'rgba(255,255,255,0.10)', color:'#fff'}}>{task.team}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Timeline / Gantt */}
              <div style={v3.timeline}>
                <div style={v3.kanbanHead}>
                  <span style={{fontSize:11.5, fontWeight:600, color:'#fff'}}>Cronograma · Mayo</span>
                  <span style={{fontSize:10, color:'rgba(255,255,255,0.4)', fontFamily:"'JetBrains Mono', monospace"}}>S20</span>
                </div>
                <div style={v3.gantt}>
                  {[
                    {l:'Excavación', s:0, w:18, col:'#3DB76E', done:true},
                    {l:'Fundaciones', s:14, w:22, col:'#3DB76E', done:true},
                    {l:'Estructura H°A°', s:30, w:34, col:'#ED6A36'},
                    {l:'Mampostería', s:55, w:24, col:'rgba(255,255,255,0.18)'},
                    {l:'Instalaciones', s:62, w:30, col:'rgba(255,255,255,0.18)'},
                  ].map((b,i)=>(
                    <div key={i} style={v3.ganttRow}>
                      <span style={v3.ganttLbl}>{b.l}</span>
                      <div style={v3.ganttTrack}>
                        <div style={{
                          ...v3.ganttBar, left:`${b.s}%`, width:`${b.w}%`,
                          background:b.col,
                        }}></div>
                      </div>
                    </div>
                  ))}
                  <div style={v3.todayLine}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Caption */}
        <div style={v3.caption}>
          <div style={v3.captionEyebrow}>
            <span style={v3.captionDot}></span>
            DETRÁS DE TU INICIO DE SESIÓN
          </div>
          <p style={v3.captionTxt}>
            Toda tu obra en una sola vista. Tareas, equipos y avances
            sincronizados desde el campo hasta dirección.
          </p>
        </div>
      </div>

      {/* RIGHT — Form */}
      <div style={v3.right}>
        <div style={v3.topbar}>
          <div style={v3.brand}>
            <div style={v3.logoBox}>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
                <path d="M3 19V8.5L11 3l8 5.5V19H3z" stroke="#14181E" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{fontSize:14, fontWeight:600, letterSpacing:'-0.01em'}}>Constructa</span>
          </div>
          <div style={v3.topRight}>
            <span style={v3.newUser}>¿Sos nuevo?</span>
            <a href="#" style={v3.newBtn}>Crear cuenta</a>
          </div>
        </div>

        <div style={v3.formWrap}>
          <div style={v3.stepRow}>
            <span style={{...v3.stepDot, background:step>=1?'#14181E':'rgba(20,24,30,0.15)'}}></span>
            <span style={{...v3.stepDot, background:step>=2?'#14181E':'rgba(20,24,30,0.15)'}}></span>
            <span style={v3.stepTxt}>Paso {step} de 2</span>
          </div>

          <h2 style={v3.title}>
            {step===1 ? 'Ingresá a Constructa' : `Hola, ${email.split('@')[0]}`}
          </h2>
          <p style={v3.subtitle}>
            {step===1
              ? 'Empezá con tu correo de trabajo. Te llevamos al panel correcto.'
              : 'Ingresá tu contraseña para continuar.'}
          </p>

          {step===1 ? (
            <>
              <div style={v3.field}>
                <label style={v3.lbl}>Email</label>
                <input
                  style={v3.input}
                  value={email}
                  onChange={(e)=>setEmail(e.target.value)}
                  placeholder="vos@empresa.com"
                  autoFocus
                />
              </div>

              <button style={v3.cta} onClick={()=>setStep(2)}>
                Continuar
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              <div style={v3.divider}>
                <span style={v3.dividerLine}></span>
                <span style={v3.dividerTxt}>O CONTINUÁ CON</span>
                <span style={v3.dividerLine}></span>
              </div>

              <div style={v3.ssoCol}>
                <button style={v3.ssoBtn}>
                  <span style={{...v3.ssoIcon, background:'#fff', border:'1px solid rgba(20,24,30,0.08)'}}>G</span>
                  Google Workspace
                  <span style={v3.ssoArrow}>↗</span>
                </button>
                <button style={v3.ssoBtn}>
                  <span style={{...v3.ssoIcon, background:'#fff', border:'1px solid rgba(20,24,30,0.08)'}}>M</span>
                  Microsoft 365
                  <span style={v3.ssoArrow}>↗</span>
                </button>
                <button style={v3.ssoBtn}>
                  <span style={{...v3.ssoIcon, background:'#14181E', color:'#fff'}}>S</span>
                  SAML / SSO empresa
                  <span style={v3.ssoArrow}>↗</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={v3.identityPill}>
                <div style={v3.avatarSm}>{email[0].toUpperCase()}</div>
                <span style={{fontSize:13}}>{email}</span>
                <button style={v3.editBtn} onClick={()=>setStep(1)}>Cambiar</button>
              </div>

              <div style={v3.field}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                  <label style={v3.lbl}>Contraseña</label>
                  <a href="#" style={v3.forgot}>¿Olvidaste?</a>
                </div>
                <div style={{position:'relative'}}>
                  <input
                    style={v3.input}
                    value={pwd}
                    type={show?'text':'password'}
                    onChange={(e)=>setPwd(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                  />
                  <button style={v3.eye} onClick={()=>setShow(!show)}>{show?'Ocultar':'Mostrar'}</button>
                </div>
              </div>

              <button style={v3.cta}>
                Ingresar al panel
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              <p style={v3.helpTxt}>
                ¿Problemas para ingresar? <a href="#" style={v3.helpLink}>Contactar a soporte</a>
              </p>
            </>
          )}
        </div>

        <div style={v3.bottomBar}>
          <div style={v3.statusPill}>
            <span style={v3.statusDot}></span>
            Todos los sistemas operativos
          </div>
          <span style={{fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:'rgba(20,24,30,0.4)'}}>
            v2.4.1
          </span>
        </div>
      </div>
    </div>
  );
}

const v3 = {
  root: {
    display:'grid', gridTemplateColumns:'1.15fr 1fr',
    width:'100%', height:'100%',
    background:'#FAF7F2', fontFamily:"'Geist', sans-serif", color:'#14181E',
  },

  // LEFT
  left: {
    position:'relative', background:'#14181E',
    padding:'56px 0 56px 56px',
    display:'flex', flexDirection:'column', overflow:'hidden',
  },
  window: {
    flex:1, background:'#1A1F26',
    borderTopLeftRadius:14, borderBottomLeftRadius:14,
    border:'1px solid rgba(255,255,255,0.06)',
    borderRight:'none',
    boxShadow:'0 24px 80px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
    display:'grid', gridTemplateColumns:'180px 1fr',
    overflow:'hidden', position:'relative',
  },
  sidebar: {
    background:'#10141A', borderRight:'1px solid rgba(255,255,255,0.06)',
    padding:'18px 12px', display:'flex', flexDirection:'column',
    color:'#fff',
  },
  sideBrand: {
    display:'flex', alignItems:'center', gap:8,
    fontSize:12.5, fontWeight:600, padding:'2px 8px', marginBottom:18,
  },
  sideLogo: {
    width:22, height:22, borderRadius:5,
    background:'rgba(237,106,54,0.18)',
    border:'1px solid rgba(237,106,54,0.4)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  workspaceCard: {
    background:'rgba(255,255,255,0.04)',
    border:'1px solid rgba(255,255,255,0.06)',
    borderRadius:8, padding:'10px 12px', marginBottom:14,
  },
  navItems: { display:'flex', flexDirection:'column', gap:1, flex:1 },
  navItem: {
    display:'flex', alignItems:'center', gap:9,
    padding:'7px 10px', borderRadius:6,
    fontSize:11.5, color:'rgba(255,255,255,0.55)',
    cursor:'pointer',
  },
  navActive: {
    background:'rgba(255,255,255,0.06)', color:'#fff',
    boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.04)',
  },
  sideFoot: {
    display:'flex', alignItems:'center', gap:9,
    padding:'9px 8px 0', borderTop:'1px solid rgba(255,255,255,0.06)',
    marginTop:8,
  },
  avatar: {
    width:26, height:26, borderRadius:7, background:'#ED6A36', color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:10.5, fontWeight:600,
  },

  dash: { padding:'18px 22px', color:'#fff', display:'flex', flexDirection:'column', gap:14, overflow:'hidden' },
  dashHead: { display:'flex', justifyContent:'space-between', alignItems:'flex-end' },
  crumbs: { fontSize:10.5, color:'rgba(255,255,255,0.45)', fontFamily:"'JetBrains Mono', monospace" },
  dashTitle: { fontSize:18, fontWeight:600, letterSpacing:'-0.02em', marginTop:4 },
  dashHeadRight: { display:'flex', gap:8 },
  searchPill: {
    display:'flex', alignItems:'center', gap:7,
    background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.06)',
    borderRadius:7, padding:'6px 10px',
    fontSize:11, color:'rgba(255,255,255,0.5)',
  },
  kbd: {
    fontSize:9.5, padding:'1px 5px', borderRadius:3,
    background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.6)',
    fontFamily:"'JetBrains Mono', monospace", marginLeft:14,
  },
  bellPill: {
    width:30, height:30, borderRadius:7,
    background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.06)',
    display:'flex', alignItems:'center', justifyContent:'center',
    color:'rgba(255,255,255,0.7)', position:'relative',
  },
  bellDot: { position:'absolute', top:7, right:7, width:6, height:6, borderRadius:6, background:'#ED6A36', boxShadow:'0 0 0 2px #1A1F26' },

  kpis: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 },
  kpi: {
    background:'rgba(255,255,255,0.04)',
    border:'1px solid rgba(255,255,255,0.06)',
    borderRadius:9, padding:'12px 14px',
  },
  kpiLbl: { fontSize:9.5, color:'rgba(255,255,255,0.45)', letterSpacing:'0.08em', fontFamily:"'JetBrains Mono', monospace" },
  kpiVal: { fontSize:24, fontWeight:600, letterSpacing:'-0.02em', marginTop:3 },
  kpiUnit: { fontSize:14, color:'rgba(255,255,255,0.4)', marginLeft:2, fontWeight:400 },
  kpiBar: { height:4, borderRadius:99, background:'rgba(255,255,255,0.06)', marginTop:8, overflow:'hidden' },
  kpiBarFill: { height:'100%', background:'linear-gradient(90deg,#ED6A36,#F08D60)', borderRadius:99 },
  kpiDelta: { fontSize:10, color:'#3DB76E', marginTop:6, fontFamily:"'JetBrains Mono', monospace" },

  miniRow: { display:'flex', gap:5, marginTop:8 },
  miniChip: { fontSize:9.5, padding:'3px 7px', borderRadius:99, fontWeight:500, fontFamily:"'JetBrains Mono', monospace" },

  avatarRow: { display:'flex', marginTop:8 },
  miniAvatar: {
    width:22, height:22, borderRadius:22, marginLeft:-5,
    fontSize:9, fontWeight:600, display:'flex',
    alignItems:'center', justifyContent:'center',
    border:'2px solid #1A1F26',
  },

  bottomRow: { display:'grid', gridTemplateColumns:'1fr 1.3fr', gap:10, flex:1, minHeight:0 },
  kanban: {
    background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)',
    borderRadius:9, padding:'12px 12px', display:'flex', flexDirection:'column', gap:7,
    overflow:'hidden',
  },
  kanbanHead: { display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4 },
  task: {
    background:'rgba(255,255,255,0.03)',
    border:'1px solid rgba(255,255,255,0.05)',
    borderRadius:7, padding:'9px 11px',
  },
  taskPill: { fontSize:9, padding:'2px 6px', borderRadius:99, fontWeight:500, fontFamily:"'JetBrains Mono', monospace", whiteSpace:'nowrap' },

  timeline: {
    background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)',
    borderRadius:9, padding:'12px', display:'flex', flexDirection:'column',
  },
  gantt: { position:'relative', flex:1, display:'flex', flexDirection:'column', gap:7, marginTop:6 },
  ganttRow: { display:'grid', gridTemplateColumns:'80px 1fr', alignItems:'center', gap:8 },
  ganttLbl: { fontSize:10.5, color:'rgba(255,255,255,0.65)' },
  ganttTrack: { position:'relative', height:14, background:'rgba(255,255,255,0.04)', borderRadius:99 },
  ganttBar: { position:'absolute', top:2, bottom:2, borderRadius:99, opacity:0.95 },
  todayLine: { position:'absolute', top:0, bottom:0, left:'55%', width:1, background:'rgba(237,106,54,0.5)', borderTop:'5px solid #ED6A36', borderTopRightRadius:2, borderTopLeftRadius:2 },

  caption: {
    color:'#fff', maxWidth:480, marginTop:24, paddingRight:56,
  },
  captionEyebrow: {
    display:'flex', alignItems:'center', gap:9,
    fontSize:10.5, fontFamily:"'JetBrains Mono', monospace",
    letterSpacing:'0.10em', color:'rgba(255,255,255,0.5)', marginBottom:8,
  },
  captionDot: { width:6, height:6, borderRadius:6, background:'#ED6A36' },
  captionTxt: { fontSize:13.5, color:'rgba(255,255,255,0.7)', margin:0, lineHeight:1.55 },

  // RIGHT
  right: {
    display:'flex', flexDirection:'column',
    padding:'32px 48px', background:'#FAF7F2',
  },
  topbar: { display:'flex', justifyContent:'space-between', alignItems:'center' },
  brand: { display:'flex', alignItems:'center', gap:10 },
  logoBox: {
    width:28, height:28, borderRadius:7, background:'#fff',
    border:'1px solid rgba(20,24,30,0.10)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  topRight: { display:'flex', alignItems:'center', gap:12 },
  newUser: { fontSize:12.5, color:'rgba(20,24,30,0.55)' },
  newBtn: {
    fontSize:12.5, fontWeight:500, color:'#14181E',
    padding:'7px 12px', borderRadius:7,
    border:'1px solid rgba(20,24,30,0.12)', background:'#fff',
    textDecoration:'none',
  },

  formWrap: { margin:'auto', width:'100%', maxWidth:380 },
  stepRow: { display:'flex', alignItems:'center', gap:6, marginBottom:20 },
  stepDot: { width:22, height:4, borderRadius:99, transition:'background .2s' },
  stepTxt: { fontSize:11, color:'rgba(20,24,30,0.5)', fontFamily:"'JetBrains Mono', monospace", marginLeft:8 },

  title: { fontSize:28, fontWeight:600, letterSpacing:'-0.025em', margin:0 },
  subtitle: { fontSize:13.5, color:'rgba(20,24,30,0.6)', marginTop:6, marginBottom:24, lineHeight:1.5 },

  field: { marginBottom:14 },
  lbl: { display:'block', fontSize:11.5, fontWeight:500, color:'rgba(20,24,30,0.65)', marginBottom:6, letterSpacing:'0.01em' },
  input: {
    width:'100%', background:'#fff',
    border:'1px solid rgba(20,24,30,0.10)',
    borderRadius:9, padding:'11px 14px', fontSize:14, color:'#14181E',
    fontFamily:"'Geist', sans-serif", outline:'none', boxSizing:'border-box',
    transition:'border-color .12s, box-shadow .12s',
  },
  eye: { position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:11.5, color:'rgba(20,24,30,0.55)' },
  forgot: { fontSize:11.5, color:'#ED6A36', textDecoration:'none', fontWeight:500 },

  cta: {
    width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    background:'#14181E', color:'#fff', border:'none',
    padding:'13px 20px', fontSize:14, fontWeight:500,
    borderRadius:10, cursor:'pointer', marginTop:6,
    fontFamily:"'Geist', sans-serif",
  },

  divider: { display:'flex', alignItems:'center', gap:10, margin:'22px 0 14px' },
  dividerLine: { flex:1, height:1, background:'rgba(20,24,30,0.10)' },
  dividerTxt: { fontSize:10, color:'rgba(20,24,30,0.45)', letterSpacing:'0.10em', fontFamily:"'JetBrains Mono', monospace" },

  ssoCol: { display:'flex', flexDirection:'column', gap:8 },
  ssoBtn: {
    display:'flex', alignItems:'center', gap:11,
    background:'#fff', border:'1px solid rgba(20,24,30,0.10)',
    padding:'11px 14px', borderRadius:9, cursor:'pointer',
    fontSize:13, fontWeight:500, color:'#14181E',
    fontFamily:"'Geist', sans-serif",
    textAlign:'left',
  },
  ssoIcon: {
    width:22, height:22, borderRadius:5,
    fontWeight:600, fontSize:11,
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  ssoArrow: { marginLeft:'auto', color:'rgba(20,24,30,0.35)', fontSize:13 },

  identityPill: {
    display:'flex', alignItems:'center', gap:10,
    background:'#fff', border:'1px solid rgba(20,24,30,0.10)',
    borderRadius:9, padding:'8px 8px 8px 12px', marginBottom:14,
  },
  avatarSm: {
    width:26, height:26, borderRadius:7, background:'#14181E', color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:11, fontWeight:600,
  },
  editBtn: {
    marginLeft:'auto', background:'transparent', border:'none',
    fontSize:11.5, color:'#ED6A36', cursor:'pointer', fontWeight:500,
    padding:'5px 9px', borderRadius:6,
  },

  helpTxt: { fontSize:12, color:'rgba(20,24,30,0.55)', textAlign:'center', marginTop:18 },
  helpLink: { color:'#14181E', textDecoration:'underline', textUnderlineOffset:2, textDecorationColor:'rgba(20,24,30,0.2)' },

  bottomBar: {
    display:'flex', justifyContent:'space-between', alignItems:'center',
    paddingTop:16, borderTop:'1px solid rgba(20,24,30,0.08)',
  },
  statusPill: {
    display:'inline-flex', alignItems:'center', gap:7,
    fontSize:11, color:'rgba(20,24,30,0.6)',
    fontFamily:"'JetBrains Mono', monospace",
    padding:'4px 9px', borderRadius:99,
    background:'#fff', border:'1px solid rgba(20,24,30,0.08)',
  },
  statusDot: { width:6, height:6, borderRadius:6, background:'#3DB76E', boxShadow:'0 0 0 2.5px rgba(61,183,110,0.16)' },
};

window.V3SaasDashboard = V3SaasDashboard;
