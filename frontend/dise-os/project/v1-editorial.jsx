// V1 — Editorial / Architectural
// Split 50/50. Dark image-driven left panel with editorial typography mixing
// a grotesk + an italic serif accent. Clean cream form on the right with
// underline-style inputs. Reads more like an architecture studio site.

function V1Editorial() {
  const [email, setEmail] = React.useState('facundo@constructa.ar');
  const [pwd, setPwd] = React.useState('••••••••••');
  const [show, setShow] = React.useState(false);
  const [remember, setRemember] = React.useState(true);
  const [pressed, setPressed] = React.useState(false);

  return (
    <div style={v1.root}>
      {/* Left: editorial image panel */}
      <div style={v1.left}>
        {/* Architectural blueprint / image placeholder */}
        <div style={v1.imgWrap}>
          <svg width="100%" height="100%" viewBox="0 0 720 900" preserveAspectRatio="xMidYMid slice" style={{display:'block'}}>
            <defs>
              <pattern id="v1grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
              </pattern>
              <pattern id="v1grid2" width="200" height="200" patternUnits="userSpaceOnUse">
                <path d="M200 0H0V200" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
              </pattern>
              <linearGradient id="v1grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0c1014" stopOpacity="0.2"/>
                <stop offset="1" stopColor="#0c1014" stopOpacity="0.85"/>
              </linearGradient>
            </defs>
            <rect width="720" height="900" fill="#1a2028"/>
            <rect width="720" height="900" fill="url(#v1grid)"/>
            <rect width="720" height="900" fill="url(#v1grid2)"/>

            {/* Suggestive architectural lineart — abstract building silhouettes */}
            <g opacity="0.42" stroke="#ED6A36" strokeWidth="1.2" fill="none">
              <rect x="80" y="380" width="180" height="380"/>
              <rect x="80" y="380" width="180" height="60"/>
              <rect x="80" y="500" width="180" height="60"/>
              <rect x="80" y="620" width="180" height="60"/>
              <line x1="125" y1="380" x2="125" y2="760"/>
              <line x1="170" y1="380" x2="170" y2="760"/>
              <line x1="215" y1="380" x2="215" y2="760"/>

              <rect x="290" y="240" width="220" height="520"/>
              <line x1="290" y1="320" x2="510" y2="320"/>
              <line x1="290" y1="400" x2="510" y2="400"/>
              <line x1="290" y1="480" x2="510" y2="480"/>
              <line x1="290" y1="560" x2="510" y2="560"/>
              <line x1="290" y1="640" x2="510" y2="640"/>
              <line x1="290" y1="720" x2="510" y2="720"/>
              <line x1="362" y1="240" x2="362" y2="760"/>
              <line x1="436" y1="240" x2="436" y2="760"/>

              <rect x="540" y="460" width="140" height="300"/>
              <line x1="540" y1="510" x2="680" y2="510"/>
              <line x1="540" y1="560" x2="680" y2="560"/>
              <line x1="540" y1="610" x2="680" y2="610"/>
              <line x1="540" y1="660" x2="680" y2="660"/>
              <line x1="540" y1="710" x2="680" y2="710"/>
            </g>

            {/* horizon line */}
            <line x1="0" y1="760" x2="720" y2="760" stroke="rgba(237,106,54,0.5)" strokeWidth="1"/>
            <rect x="0" y="760" width="720" height="140" fill="rgba(237,106,54,0.04)"/>

            {/* dimension annotations */}
            <g fill="rgba(255,255,255,0.45)" fontFamily="'JetBrains Mono', monospace" fontSize="11" letterSpacing="0.05em">
              <text x="80" y="365">A1 · 18.40m</text>
              <text x="290" y="225">A2 · 22.00m</text>
              <text x="540" y="445">A3 · 14.00m</text>
              <text x="32" y="775" transform="rotate(-90 32 775)">NIVEL ±0.00</text>
            </g>
            <rect width="720" height="900" fill="url(#v1grad)"/>
          </svg>
        </div>

        {/* Wordmark */}
        <div style={v1.brand}>
          <div style={v1.mark}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M3 19V8.5L11 3l8 5.5V19H3z" stroke="#ED6A36" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M11 19v-6.5h0" stroke="#ED6A36" strokeWidth="1.6"/>
            </svg>
          </div>
          <div style={v1.wordmark}>
            <span style={{fontWeight:600, letterSpacing:'0.14em'}}>CONSTRUCTA</span>
            <span style={v1.wordmarkSub}>/ obra inteligente</span>
          </div>
        </div>

        {/* Editorial pull quote */}
        <div style={v1.editorial}>
          <div style={v1.eyebrow}>
            <span style={v1.dot}></span>
            CAPÍTULO 04 — OPERACIÓN
          </div>
          <h1 style={v1.headline}>
            Cada obra es <em style={v1.italic}>un sistema</em><br/>
            de decisiones que<br/>
            ocurren en tiempo real.
          </h1>
          <p style={v1.lede}>
            Constructa convierte los partes diarios, los avances y las
            alertas en una sola línea de mando — accesible desde el sitio,
            la oficina técnica o la dirección.
          </p>
        </div>

        {/* metrics row */}
        <div style={v1.metrics}>
          <div style={v1.metric}>
            <div style={v1.mNum}>312</div>
            <div style={v1.mLbl}>Obras gestionadas</div>
          </div>
          <div style={v1.mDiv}></div>
          <div style={v1.metric}>
            <div style={v1.mNum}>98.4<span style={v1.mUnit}>%</span></div>
            <div style={v1.mLbl}>Disponibilidad</div>
          </div>
          <div style={v1.mDiv}></div>
          <div style={v1.metric}>
            <div style={v1.mNum}>4.8<span style={v1.mUnit}>k</span></div>
            <div style={v1.mLbl}>Tareas / día</div>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div style={v1.right}>
        <div style={v1.topbar}>
          <span style={v1.topMono}>ES · AR</span>
          <span style={v1.topLink}>¿Necesitás ayuda?</span>
        </div>

        <div style={v1.formWrap}>
          <div style={v1.eyebrowDark}>
            <span style={v1.dotDark}></span>
            ACCESO · v2.4.1
          </div>
          <h2 style={v1.h2}>
            Bienvenido<br/>
            <span style={v1.h2Italic}>de vuelta.</span>
          </h2>
          <p style={v1.sub}>Ingresá a tu panel de control de obras.</p>

          <div style={v1.field}>
            <label style={v1.lbl}>Correo electrónico</label>
            <input
              style={v1.input}
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              placeholder="tu@empresa.com"
            />
          </div>

          <div style={v1.field}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
              <label style={v1.lbl}>Contraseña</label>
              <a href="#" style={v1.miniLink}>Olvidé mi contraseña</a>
            </div>
            <div style={{position:'relative'}}>
              <input
                style={v1.input}
                value={pwd}
                type={show ? 'text' : 'password'}
                onChange={(e)=>setPwd(e.target.value)}
              />
              <button onClick={()=>setShow(!show)} style={v1.eyeBtn} aria-label="toggle">
                {show ? '◐' : '○'}
              </button>
            </div>
          </div>

          <label style={v1.remember}>
            <span style={{
              ...v1.check,
              background: remember ? '#ED6A36' : 'transparent',
              borderColor: remember ? '#ED6A36' : 'rgba(20,24,30,0.25)',
            }} onClick={()=>setRemember(!remember)}>
              {remember && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <span>Mantener sesión iniciada por 30 días</span>
          </label>

          <button
            style={{...v1.cta, transform: pressed ? 'translateY(1px)' : 'none'}}
            onMouseDown={()=>setPressed(true)}
            onMouseUp={()=>setPressed(false)}
            onMouseLeave={()=>setPressed(false)}>
            <span>Ingresar al panel</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div style={v1.divider}><span style={v1.dividerTxt}>o</span></div>

          <button style={v1.sso}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 6h10M3 10h10M5 3v10M11 3v10" stroke="#14181E" strokeWidth="1.4"/>
            </svg>
            <span>Ingresar con SSO de empresa</span>
          </button>

          <p style={v1.footer}>
            ¿Aún no tenés cuenta? <a href="#" style={v1.footerLink}>Solicitar acceso →</a>
          </p>
        </div>

        <div style={v1.legalFooter}>
          <span>© 2026 Constructa</span>
          <span>·</span>
          <a href="#" style={v1.legalLink}>Términos</a>
          <a href="#" style={v1.legalLink}>Privacidad</a>
          <a href="#" style={v1.legalLink}>Estado</a>
        </div>
      </div>
    </div>
  );
}

const v1 = {
  root: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    width: '100%',
    height: '100%',
    background: '#FAF7F2',
    fontFamily: "'Geist', -apple-system, sans-serif",
    color: '#14181E',
  },
  left: {
    position: 'relative',
    background: '#14181E',
    color: '#fff',
    padding: '48px 56px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  imgWrap: { position:'absolute', inset:0, opacity:0.9 },
  brand: { position:'relative', display:'flex', alignItems:'center', gap:12, zIndex:2 },
  mark: {
    width:36, height:36, borderRadius:8,
    background:'rgba(237,106,54,0.10)',
    border:'1px solid rgba(237,106,54,0.4)',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  wordmark: { display:'flex', alignItems:'baseline', gap:8, fontSize:13 },
  wordmarkSub: { color:'rgba(255,255,255,0.45)', fontStyle:'italic', fontFamily:"'Instrument Serif', serif", fontSize:15 },
  editorial: { position:'relative', marginTop:'auto', zIndex:2, maxWidth:560 },
  eyebrow: {
    fontFamily:"'JetBrains Mono', monospace",
    fontSize:11, letterSpacing:'0.14em',
    color:'rgba(255,255,255,0.55)',
    display:'flex', alignItems:'center', gap:10, marginBottom:24,
  },
  dot: { width:6, height:6, borderRadius:6, background:'#ED6A36' },
  headline: {
    fontSize:52, lineHeight:1.06, fontWeight:500,
    letterSpacing:'-0.025em', margin:0,
  },
  italic: { fontStyle:'italic', fontFamily:"'Instrument Serif', serif", fontWeight:400, color:'#ED6A36' },
  lede: {
    marginTop:24, fontSize:15.5, lineHeight:1.6,
    color:'rgba(255,255,255,0.62)', maxWidth:440,
  },
  metrics: {
    position:'relative', zIndex:2, marginTop:48,
    paddingTop:24, borderTop:'1px solid rgba(255,255,255,0.10)',
    display:'flex', alignItems:'center', gap:0,
  },
  metric: { flex:1 },
  mDiv: { width:1, height:36, background:'rgba(255,255,255,0.10)' },
  mNum: {
    fontSize:28, fontWeight:500, letterSpacing:'-0.02em',
    fontFamily:"'Geist', sans-serif",
  },
  mUnit: { fontSize:16, color:'rgba(255,255,255,0.45)', marginLeft:2 },
  mLbl: {
    marginTop:2, fontSize:11, letterSpacing:'0.05em',
    color:'rgba(255,255,255,0.45)', fontFamily:"'JetBrains Mono', monospace",
  },

  right: {
    position:'relative', display:'flex', flexDirection:'column',
    padding:'40px 56px',
  },
  topbar: { display:'flex', justifyContent:'space-between', alignItems:'center', color:'rgba(20,24,30,0.5)' },
  topMono: { fontFamily:"'JetBrains Mono', monospace", fontSize:11, letterSpacing:'0.08em' },
  topLink: { fontSize:13, color:'rgba(20,24,30,0.65)', textDecoration:'underline', textUnderlineOffset:3, textDecorationColor:'rgba(20,24,30,0.2)' },

  formWrap: { margin:'auto', width:'100%', maxWidth:400 },
  eyebrowDark: {
    fontFamily:"'JetBrains Mono', monospace",
    fontSize:11, letterSpacing:'0.14em', color:'rgba(20,24,30,0.5)',
    display:'flex', alignItems:'center', gap:10, marginBottom:18,
  },
  dotDark: { width:6, height:6, borderRadius:6, background:'#ED6A36' },
  h2: { fontSize:46, lineHeight:1.04, fontWeight:500, letterSpacing:'-0.025em', margin:0 },
  h2Italic: { fontFamily:"'Instrument Serif', serif", fontStyle:'italic', fontWeight:400 },
  sub: { marginTop:14, marginBottom:32, fontSize:14.5, color:'rgba(20,24,30,0.6)' },

  field: { marginBottom:18 },
  lbl: { display:'block', fontSize:12.5, fontWeight:500, color:'rgba(20,24,30,0.7)', marginBottom:7 },
  input: {
    width:'100%', border:'none', background:'transparent',
    borderBottom:'1px solid rgba(20,24,30,0.15)',
    padding:'10px 0', fontSize:15, color:'#14181E',
    fontFamily:"'Geist', sans-serif", outline:'none', boxSizing:'border-box',
  },
  eyeBtn: {
    position:'absolute', right:0, top:'50%', transform:'translateY(-50%)',
    background:'none', border:'none', cursor:'pointer',
    color:'rgba(20,24,30,0.5)', fontSize:14,
  },
  miniLink: { fontSize:12, color:'#ED6A36', textDecoration:'none' },

  remember: { display:'flex', alignItems:'center', gap:10, marginTop:6, marginBottom:24, fontSize:13, color:'rgba(20,24,30,0.7)', cursor:'pointer' },
  check: {
    width:16, height:16, borderRadius:4, border:'1.5px solid', cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s',
  },

  cta: {
    width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:10,
    background:'#14181E', color:'#fff', border:'none',
    padding:'15px 20px', fontSize:14.5, fontWeight:500, letterSpacing:'-0.005em',
    borderRadius:10, cursor:'pointer', transition:'transform .12s, background .15s',
    fontFamily:"'Geist', sans-serif",
    boxShadow:'0 1px 0 rgba(255,255,255,0.06) inset, 0 1px 2px rgba(0,0,0,0.08)',
  },

  divider: { position:'relative', display:'flex', alignItems:'center', justifyContent:'center', margin:'22px 0' },
  dividerTxt: { background:'#FAF7F2', padding:'0 12px', fontSize:11, color:'rgba(20,24,30,0.4)', letterSpacing:'0.08em', fontFamily:"'JetBrains Mono', monospace", position:'relative', zIndex:1 },

  sso: {
    width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:10,
    background:'transparent', color:'#14181E',
    border:'1px solid rgba(20,24,30,0.15)',
    padding:'13px 20px', fontSize:13.5, fontWeight:500,
    borderRadius:10, cursor:'pointer', fontFamily:"'Geist', sans-serif",
  },

  footer: { marginTop:28, fontSize:13, color:'rgba(20,24,30,0.55)', textAlign:'center' },
  footerLink: { color:'#14181E', textDecoration:'none', fontWeight:500 },

  legalFooter: {
    display:'flex', gap:14, alignItems:'center',
    fontSize:11.5, color:'rgba(20,24,30,0.4)',
    fontFamily:"'JetBrains Mono', monospace", letterSpacing:'0.04em',
  },
  legalLink: { color:'rgba(20,24,30,0.5)', textDecoration:'none' },
};

window.V1Editorial = V1Editorial;
