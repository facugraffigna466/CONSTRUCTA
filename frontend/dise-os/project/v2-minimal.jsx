// V2 — Minimal centered
// Single column, generous whitespace. A floating card on a subtle technical
// grid background. Feels like Linear/Vercel — confidence through restraint.

function V2Minimal() {
  const [email, setEmail] = React.useState('facundo@constructa.ar');
  const [pwd, setPwd] = React.useState('');
  const [focus, setFocus] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = () => {
    setLoading(true);
    setTimeout(()=>setLoading(false), 1400);
  };

  return (
    <div style={v2.root}>
      {/* Background — soft tech grid */}
      <svg style={v2.bg} width="100%" height="100%">
        <defs>
          <pattern id="v2grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="rgba(20,24,30,0.045)" strokeWidth="1"/>
          </pattern>
          <radialGradient id="v2fade" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#FAF7F2" stopOpacity="0"/>
            <stop offset="1" stopColor="#FAF7F2" stopOpacity="1"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#v2grid)"/>
        <rect width="100%" height="100%" fill="url(#v2fade)"/>
      </svg>

      {/* Top bar */}
      <header style={v2.header}>
        <div style={v2.brand}>
          <div style={v2.logoBox}>
            <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
              <path d="M3 19V8.5L11 3l8 5.5V19H3z" stroke="#14181E" strokeWidth="2" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={v2.brandName}>Constructa</span>
        </div>
        <div style={v2.headerRight}>
          <span style={v2.statusPill}>
            <span style={v2.statusDot}></span>
            Sistemas operando
          </span>
          <a href="#" style={v2.headerLink}>Documentación</a>
          <a href="#" style={v2.headerCta}>Solicitar demo →</a>
        </div>
      </header>

      {/* Card */}
      <main style={v2.main}>
        <div style={v2.card}>
          {/* version badge */}
          <div style={v2.versionBadge}>
            <span style={{color:'rgba(20,24,30,0.4)'}}>v2.4.1</span>
            <span style={v2.versionDivider}></span>
            <span>Cambios →</span>
          </div>

          <h1 style={v2.title}>Iniciá sesión en Constructa</h1>
          <p style={v2.subtitle}>
            Plataforma de gestión de obras para equipos técnicos.
          </p>

          {/* SSO providers */}
          <div style={v2.ssoRow}>
            <button style={v2.ssoBtn}>
              <span style={v2.ssoIcon}>G</span>
              Google Workspace
            </button>
            <button style={v2.ssoBtn}>
              <span style={v2.ssoIcon}>M</span>
              Microsoft 365
            </button>
          </div>

          <div style={v2.divider}>
            <span style={v2.dividerLine}></span>
            <span style={v2.dividerText}>O CON EMAIL</span>
            <span style={v2.dividerLine}></span>
          </div>

          {/* Email */}
          <div style={{...v2.field, ...(focus==='email' ? v2.fieldFocus : {})}}>
            <label style={v2.fieldLbl}>Email de trabajo</label>
            <input
              style={v2.input}
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              onFocus={()=>setFocus('email')}
              onBlur={()=>setFocus(null)}
              placeholder="vos@empresa.com"
            />
          </div>

          {/* Password */}
          <div style={{...v2.field, ...(focus==='pwd' ? v2.fieldFocus : {})}}>
            <div style={v2.fieldHead}>
              <label style={v2.fieldLbl}>Contraseña</label>
              <a href="#" style={v2.forgot}>¿Olvidaste?</a>
            </div>
            <input
              style={v2.input}
              value={pwd}
              type="password"
              onChange={(e)=>setPwd(e.target.value)}
              onFocus={()=>setFocus('pwd')}
              onBlur={()=>setFocus(null)}
              placeholder="••••••••"
            />
          </div>

          {/* CTA */}
          <button style={v2.cta} onClick={handleSubmit}>
            {loading ? (
              <span style={v2.spinner}></span>
            ) : (
              <>
                Continuar
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{marginLeft:8}}>
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            )}
          </button>

          <p style={v2.terms}>
            Al continuar aceptás los <a href="#" style={v2.termsLink}>Términos</a> y la <a href="#" style={v2.termsLink}>Política de privacidad</a>.
          </p>
        </div>

        {/* Below card — sign up */}
        <p style={v2.signup}>
          ¿No tenés cuenta todavía?{' '}
          <a href="#" style={v2.signupLink}>Crear una cuenta gratis</a>
        </p>

        {/* Trust signals */}
        <div style={v2.trust}>
          <div style={v2.trustItem}>
            <div style={v2.trustIcon}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="6" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M5 6V4a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </div>
            <div>
              <div style={v2.trustLbl}>Cifrado AES-256</div>
              <div style={v2.trustSub}>Datos protegidos extremo a extremo</div>
            </div>
          </div>
          <div style={v2.trustItem}>
            <div style={v2.trustIcon}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 4v4l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={v2.trustLbl}>99.98% uptime</div>
              <div style={v2.trustSub}>Últimos 12 meses</div>
            </div>
          </div>
          <div style={v2.trustItem}>
            <div style={v2.trustIcon}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2l5 2v4c0 3.5-2.5 5.5-5 6-2.5-.5-5-2.5-5-6V4l5-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div style={v2.trustLbl}>ISO 27001 compatible</div>
              <div style={v2.trustSub}>Auditoría anual</div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={v2.footer}>
        <span>© 2026 Constructa · Proyecto de tesis</span>
        <span style={v2.footerLinks}>
          <a href="#" style={v2.footerLink}>Estado</a>
          <a href="#" style={v2.footerLink}>Soporte</a>
          <a href="#" style={v2.footerLink}>Cambios</a>
        </span>
      </footer>
    </div>
  );
}

const v2 = {
  root: {
    position:'relative', width:'100%', height:'100%',
    background:'#FAF7F2', fontFamily:"'Geist', sans-serif", color:'#14181E',
    display:'flex', flexDirection:'column', overflow:'hidden',
  },
  bg: { position:'absolute', inset:0, zIndex:0 },

  header: {
    position:'relative', zIndex:2,
    padding:'24px 40px', display:'flex',
    alignItems:'center', justifyContent:'space-between',
  },
  brand: { display:'flex', alignItems:'center', gap:10 },
  logoBox: {
    width:28, height:28, borderRadius:7, background:'#fff',
    border:'1px solid rgba(20,24,30,0.10)',
    display:'flex', alignItems:'center', justifyContent:'center',
    boxShadow:'0 1px 2px rgba(0,0,0,0.04)',
  },
  brandName: { fontSize:15, fontWeight:600, letterSpacing:'-0.01em' },
  headerRight: { display:'flex', alignItems:'center', gap:20 },
  statusPill: {
    display:'inline-flex', alignItems:'center', gap:7,
    fontSize:11.5, color:'rgba(20,24,30,0.6)',
    fontFamily:"'JetBrains Mono', monospace", letterSpacing:'0.02em',
    padding:'5px 10px', borderRadius:99,
    background:'#fff', border:'1px solid rgba(20,24,30,0.08)',
  },
  statusDot: { width:7, height:7, borderRadius:7, background:'#3DB76E', boxShadow:'0 0 0 3px rgba(61,183,110,0.18)' },
  headerLink: { fontSize:13.5, color:'rgba(20,24,30,0.7)', textDecoration:'none' },
  headerCta: { fontSize:13.5, color:'#14181E', fontWeight:500, textDecoration:'none' },

  main: {
    position:'relative', zIndex:1, flex:1,
    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
    padding:'0 24px 48px',
  },

  card: {
    width:'100%', maxWidth:420, background:'#fff',
    border:'1px solid rgba(20,24,30,0.08)',
    borderRadius:14, padding:'36px 36px 32px',
    boxShadow:'0 1px 2px rgba(0,0,0,0.04), 0 8px 28px -8px rgba(0,0,0,0.08)',
    position:'relative',
  },
  versionBadge: {
    position:'absolute', top:-12, right:24,
    background:'#14181E', color:'#fff',
    padding:'4px 10px', borderRadius:99,
    fontSize:10.5, fontFamily:"'JetBrains Mono', monospace",
    letterSpacing:'0.04em',
    display:'inline-flex', alignItems:'center', gap:8,
  },
  versionDivider: { width:1, height:10, background:'rgba(255,255,255,0.18)' },

  title: { fontSize:24, fontWeight:600, letterSpacing:'-0.025em', margin:'0 0 6px' },
  subtitle: { fontSize:13.5, color:'rgba(20,24,30,0.55)', margin:'0 0 24px' },

  ssoRow: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:18 },
  ssoBtn: {
    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    background:'#fff', border:'1px solid rgba(20,24,30,0.10)',
    padding:'10px', borderRadius:9, cursor:'pointer',
    fontSize:13, fontWeight:500, color:'#14181E',
    fontFamily:"'Geist', sans-serif", transition:'background .12s',
  },
  ssoIcon: {
    width:18, height:18, borderRadius:5,
    background:'#FAF7F2', color:'#14181E', fontWeight:600, fontSize:11,
    display:'flex', alignItems:'center', justifyContent:'center',
  },

  divider: { display:'flex', alignItems:'center', gap:10, margin:'18px 0' },
  dividerLine: { flex:1, height:1, background:'rgba(20,24,30,0.08)' },
  dividerText: { fontSize:10.5, color:'rgba(20,24,30,0.4)', letterSpacing:'0.10em', fontFamily:"'JetBrains Mono', monospace" },

  field: {
    background:'#FAFAF7', border:'1px solid rgba(20,24,30,0.08)',
    borderRadius:10, padding:'8px 12px 10px', marginBottom:10,
    transition:'border-color .15s, background .15s, box-shadow .15s',
  },
  fieldFocus: {
    background:'#fff', borderColor:'rgba(20,24,30,0.5)',
    boxShadow:'0 0 0 3px rgba(20,24,30,0.06)',
  },
  fieldHead: { display:'flex', justifyContent:'space-between', alignItems:'baseline' },
  fieldLbl: { display:'block', fontSize:11, fontWeight:500, color:'rgba(20,24,30,0.55)', letterSpacing:'0.02em', textTransform:'uppercase' },
  forgot: { fontSize:11, color:'#ED6A36', textDecoration:'none', fontWeight:500 },
  input: {
    width:'100%', border:'none', background:'transparent',
    padding:'4px 0 2px', fontSize:14.5, color:'#14181E',
    fontFamily:"'Geist', sans-serif", outline:'none', boxSizing:'border-box',
  },

  cta: {
    width:'100%', display:'flex', alignItems:'center', justifyContent:'center',
    background:'#14181E', color:'#fff', border:'none',
    padding:'13px 20px', fontSize:14, fontWeight:500,
    borderRadius:10, cursor:'pointer', marginTop:10,
    fontFamily:"'Geist', sans-serif",
    boxShadow:'0 1px 0 rgba(255,255,255,0.08) inset, 0 1px 2px rgba(0,0,0,0.08)',
  },
  spinner: {
    width:14, height:14, borderRadius:14,
    border:'2px solid rgba(255,255,255,0.25)', borderTopColor:'#fff',
    animation:'v2spin 0.7s linear infinite', display:'inline-block',
  },

  terms: { fontSize:11.5, color:'rgba(20,24,30,0.45)', textAlign:'center', marginTop:18, marginBottom:0, lineHeight:1.5 },
  termsLink: { color:'rgba(20,24,30,0.7)', textDecoration:'underline', textUnderlineOffset:2, textDecorationColor:'rgba(20,24,30,0.2)' },

  signup: { marginTop:24, fontSize:13.5, color:'rgba(20,24,30,0.6)' },
  signupLink: { color:'#14181E', fontWeight:500, textDecoration:'none', borderBottom:'1px solid rgba(20,24,30,0.3)', paddingBottom:1 },

  trust: {
    marginTop:48, display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:24,
    width:'100%', maxWidth:680,
  },
  trustItem: { display:'flex', alignItems:'flex-start', gap:10, color:'rgba(20,24,30,0.6)' },
  trustIcon: {
    width:28, height:28, borderRadius:7,
    background:'rgba(20,24,30,0.04)', color:'rgba(20,24,30,0.75)',
    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
  },
  trustLbl: { fontSize:12.5, fontWeight:600, color:'#14181E' },
  trustSub: { fontSize:11.5, color:'rgba(20,24,30,0.5)', marginTop:1 },

  footer: {
    position:'relative', zIndex:2,
    padding:'20px 40px', display:'flex', justifyContent:'space-between',
    fontSize:11.5, color:'rgba(20,24,30,0.45)',
    fontFamily:"'JetBrains Mono', monospace", letterSpacing:'0.03em',
  },
  footerLinks: { display:'flex', gap:16 },
  footerLink: { color:'rgba(20,24,30,0.5)', textDecoration:'none' },
};

window.V2Minimal = V2Minimal;
