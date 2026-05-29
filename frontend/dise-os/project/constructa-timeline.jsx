// constructa-timeline.jsx — el corazón del dashboard: cronograma con drag real.
// El estado de drag vive en App, lo recibimos por props.

const STATUS = window.ConstructaDashboard_STATUS;
const DAY_W = window.ConstructaDashboard_DAY_W;
const ROW_H = window.ConstructaDashboard_ROW_H;
const TODAY = window.ConstructaDashboard_TODAY;
const addDays = window.ConstructaDashboard_addDays;
const fmt = window.ConstructaDashboard_fmt;
const dayName = window.ConstructaDashboard_dayName;
const isWeekend = window.ConstructaDashboard_isWeekend;
const StatusIcon = window.ConstructaDashboard_StatusIcon;
const I = window.ConstructaDashboard_I;
const avatarColor = window.ConstructaDashboard_avatarColor;

const RANGE_START = -4;
const RANGE_END = 14;

function Timeline({tasks, drag, setDrag, selectedId, setSelectedId, railRef}) {
  const [hoverTaskId, setHoverTaskId] = React.useState(null);
  const totalDays = RANGE_END - RANGE_START + 1;

  function startMove(e, task) {
    if (e.target.closest('.edge-handle')) return;
    e.preventDefault();
    setDrag({
      kind:'move', taskId:task.id, startX:e.clientX,
      originalStart:task.start, originalEnd:task.end, deltaDays:0,
    });
    setSelectedId(task.id);
  }
  function startResize(e, task, side) {
    e.preventDefault(); e.stopPropagation();
    setDrag({
      kind:side==='right'?'resize-right':'resize-left',
      taskId:task.id, startX:e.clientX,
      originalStart:task.start, originalEnd:task.end, deltaDays:0,
    });
    setSelectedId(task.id);
  }

  function taskRect(task) {
    let start = task.start, end = task.end;
    if (drag && drag.taskId === task.id) {
      if (drag.kind==='move') { start += drag.deltaDays; end += drag.deltaDays; }
      if (drag.kind==='resize-right') { end = Math.max(start, end + drag.deltaDays); }
      if (drag.kind==='resize-left') { start = Math.min(end, start + drag.deltaDays); }
    }
    const left = (start - RANGE_START) * DAY_W + 4;
    const width = (end - start + 1) * DAY_W - 8;
    return {start, end, left, width};
  }

  return (
    <section style={tS.wrap}>
      <div style={tS.head}>
        <div style={tS.headLeft}>
          <h2 style={tS.h2}>Cronograma de tareas</h2>
          <span style={tS.headMeta}>{tasks.length} tareas · semana del {fmt(addDays(TODAY, -3))}</span>
        </div>
        <div style={tS.headRight}>
          <div style={tS.segment}>
            <button style={{...tS.segBtn, ...tS.segBtnActive}}>Semana</button>
            <button style={tS.segBtn}>Mes</button>
            <button style={tS.segBtn}>Trim.</button>
          </div>
          <button style={tS.iconBtn} title="Filtrar">{I.filter}</button>
          <button style={tS.iconBtn} title="Ir a hoy">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" fill="#E76A2D"/><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/></svg>
          </button>
        </div>
      </div>

      <div style={tS.body}>
        <div style={tS.taskCol}>
          <div style={tS.colHead}>Tarea</div>
          <div style={tS.taskColBody}>
            {tasks.map((task) => {
              const isSel = selectedId === task.id;
              return (
                <div key={task.id}
                  onClick={()=>setSelectedId(task.id)}
                  style={{...tS.nameRow, background: isSel ? '#F4F1EB' : 'transparent'}}>
                  <span style={tS.gripMini}>{I.grip}</span>
                  <StatusIcon status={task.status} size={13}/>
                  <div style={tS.nameRowText}>
                    <span style={tS.nameRowName}>{task.name}</span>
                    <span style={tS.nameRowMeta}>{task.tag}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={tS.gridCol}>
          <div style={tS.daysRow}>
            {Array.from({length:totalDays}).map((_, i) => {
              const offset = i + RANGE_START;
              const d = addDays(TODAY, offset);
              const isToday = offset === 0;
              const we = isWeekend(d);
              const hover = drag && drag.kind==='unscheduled' && drag.currentDay === offset;
              return (
                <div key={i} style={{...tS.dayCell, background: hover ? '#FFF1E8' : (we ? '#FAF8F4' : 'transparent')}}>
                  <div style={{...tS.dayName, color: isToday ? '#E76A2D' : '#94928D'}}>{dayName[d.getDay()]}</div>
                  <div style={{...tS.dayNum, color: isToday ? '#1B1B1A' : '#3A3936', fontWeight: isToday ? 600 : 500}}>
                    {isToday ? <span style={tS.todayPill}>Hoy</span> : d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          <div ref={railRef} style={tS.rail}>
            <div style={tS.gridBg}>
              {Array.from({length:totalDays}).map((_, i) => {
                const offset = i + RANGE_START;
                const d = addDays(TODAY, offset);
                const we = isWeekend(d);
                const hover = drag && drag.kind==='unscheduled' && drag.currentDay === offset;
                return (
                  <div key={i} style={{
                    ...tS.gridCol2,
                    background: hover ? 'rgba(231,106,45,0.07)' : (we ? '#FAF8F4' : 'transparent'),
                    borderLeft: i===0 ? 'none' : '1px solid #F0EBE2',
                  }}>
                    {hover && <div style={tS.dropIndicator}>
                      <span style={tS.dropLabel}>↓ Soltar acá</span>
                    </div>}
                  </div>
                );
              })}
              <div style={{...tS.todayLine, left: (0 - RANGE_START) * DAY_W}}></div>
            </div>

            <div style={tS.barsLayer}>
              {tasks.map((task, idx) => {
                const r = taskRect(task);
                const st = STATUS[task.status];
                const isSel = selectedId === task.id;
                const isDragging = drag && drag.taskId === task.id;
                const isHover = hoverTaskId === task.id;
                return (
                  <div key={task.id} style={{...tS.barRow, top: idx * ROW_H}}>
                    {isSel && <div style={tS.rowHighlight}></div>}
                    <div
                      onMouseEnter={()=>setHoverTaskId(task.id)}
                      onMouseLeave={()=>setHoverTaskId(null)}
                      onMouseDown={(e)=>startMove(e, task)}
                      style={{
                        ...tS.bar,
                        left: r.left, width: r.width,
                        background: st.bg, borderColor: st.border,
                        boxShadow: isSel ? `0 0 0 1.5px ${st.stripe}, 0 4px 14px -4px ${st.stripe}55` :
                                  isHover ? '0 4px 12px -3px rgba(20,20,20,0.12)' :
                                  '0 1px 2px rgba(20,20,20,0.06)',
                        cursor: isDragging ? 'grabbing' : 'grab',
                        transform: isDragging ? 'translateY(-1px) scale(1.005)' : 'none',
                        transition: isDragging ? 'none' : 'transform 0.15s, box-shadow 0.15s, left 0.18s cubic-bezier(.2,.7,.3,1), width 0.18s cubic-bezier(.2,.7,.3,1)',
                        zIndex: isDragging ? 5 : (isSel ? 3 : 1),
                      }}
                    >
                      <div style={{...tS.barStripe, background:st.stripe}}></div>
                      <div className="edge-handle" onMouseDown={(e)=>startResize(e, task, 'left')} style={tS.edgeLeft}>
                        <div style={tS.edgeGrip}></div>
                      </div>
                      <div style={tS.barInner}>
                        <StatusIcon status={task.status} size={13}/>
                        <span style={tS.barName}>{task.name}</span>
                        {task.priority==='critical' && <span style={tS.critTag}>Crítica</span>}
                        {task.priority==='high' && <span style={tS.highTag}>Alta</span>}
                      </div>
                      <div style={{...tS.barAvatar, background: avatarColor(task.assignee.ini)}}>{task.assignee.ini}</div>
                      <div className="edge-handle" onMouseDown={(e)=>startResize(e, task, 'right')} style={tS.edgeRight}>
                        <div style={tS.edgeGrip}></div>
                      </div>
                    </div>

                    {isDragging && (drag.kind==='move' || drag.kind==='resize-right' || drag.kind==='resize-left') && drag.deltaDays !== 0 && (
                      <div style={{...tS.deltaLabel, left: Math.max(0, r.left + r.width/2 - 100)}}>
                        {drag.deltaDays > 0 ? '+' : ''}{drag.deltaDays}d · {fmt(addDays(TODAY, r.start))} → {fmt(addDays(TODAY, r.end))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={tS.legend}>
        {['pending','progress','review','blocked','completed'].map(k => (
          <div key={k} style={tS.legendItem}>
            <span style={{...tS.legendSwatch, background:STATUS[k].bg, borderColor:STATUS[k].border}}>
              <span style={{...tS.legendStripe, background:STATUS[k].stripe}}></span>
            </span>
            <span>{STATUS[k].label}</span>
          </div>
        ))}
        <div style={{flex:1}}></div>
        <div style={tS.legendHint}>
          <span style={tS.hintKey}>Arrastrá</span> para mover ·
          <span style={tS.hintKey}>Bordes</span> para cambiar duración ·
          <span style={tS.hintKey}>Clic</span> para seleccionar
        </div>
      </div>
    </section>
  );
}

function UnschedGhost({drag}) {
  const [pos, setPos] = React.useState({x:drag.startX, y:drag.startY});
  React.useEffect(() => {
    const handler = (e) => setPos({x:e.clientX, y:e.clientY});
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);
  return (
    <div style={{
      position:'fixed', left:pos.x+10, top:pos.y+10,
      background:'#fff', border:'1.5px solid #E76A2D',
      borderRadius:8, padding:'8px 12px',
      fontSize:12.5, color:'#1B1B1A', fontWeight:500,
      boxShadow:'0 12px 32px -6px rgba(231,106,45,0.35), 0 0 0 4px rgba(231,106,45,0.10)',
      pointerEvents:'none', zIndex:1000,
      display:'flex', alignItems:'center', gap:8,
    }}>
      <span style={{
        width:18, height:18, borderRadius:5, background:'#FFEEE2',
        display:'flex', alignItems:'center', justifyContent:'center',
        color:'#E76A2D', fontSize:11, fontWeight:600,
      }}>↗</span>
      {drag.ghostName}
      <span style={{
        fontSize:10.5, padding:'1px 6px', borderRadius:99,
        background:'#FFEEE2', color:'#E76A2D', fontFamily:"'JetBrains Mono', monospace",
      }}>{drag.duration}d</span>
    </div>
  );
}

function UnscheduledDrawer({unscheduled, onStart}) {
  return (
    <section style={tS.usWrap}>
      <div style={tS.usHead}>
        <div style={{display:'flex', alignItems:'center', gap:9}}>
          <h3 style={tS.usH3}>Tareas sin programar</h3>
          <span style={tS.usCount}>{unscheduled.length}</span>
        </div>
        <button style={tS.iconBtn} title="Agregar">{I.plus}</button>
      </div>
      <div style={tS.usHint}>
        <span style={tS.usHintDot}></span>
        <span>Arrastrá una tarjeta al cronograma para programarla</span>
      </div>
      <div style={tS.usList}>
        {unscheduled.length === 0 ? (
          <div style={tS.usEmpty}>
            <div style={tS.usEmptyCheck}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" fill="#E2F3E9"/><path d="M7 11l3 3 5-6" stroke="#1F9A5A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
            </div>
            <div style={{fontWeight:600, fontSize:13, color:'#1B1B1A'}}>Todas programadas</div>
            <div style={{fontSize:11.5, color:'#94928D', marginTop:2}}>Buen trabajo, equipo completo.</div>
          </div>
        ) : unscheduled.map(u => (
          <div key={u.id}
            onMouseDown={(e)=>onStart(e, u)}
            style={tS.usCard}
            onMouseEnter={(e)=>e.currentTarget.style.borderColor='#E76A2D'}
            onMouseLeave={(e)=>e.currentTarget.style.borderColor='#ECE7DD'}>
            <span style={tS.usGrip}>{I.grip}</span>
            <div style={{flex:1, minWidth:0}}>
              <div style={tS.usName}>{u.name}</div>
              <div style={tS.usMeta}>
                <span>{u.tag}</span>
                <span style={{color:'#D6D2CB'}}>·</span>
                <span>{u.duration} días</span>
              </div>
            </div>
            {u.priority==='high' && <span style={tS.highTag}>Alta</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityFeed({items}) {
  const kindCol = {move:'#3A6BD9', done:'#1F9A5A', review:'#3A6BD9', block:'#D03A3A', create:'#94928D'};
  return (
    <section style={tS.actWrap}>
      <div style={tS.usHead}>
        <h3 style={tS.usH3}>Actividad reciente</h3>
        <button style={tS.linkBtn}>Ver todo →</button>
      </div>
      <div style={tS.actList}>
        {items.map((it, i) => (
          <div key={i} style={{...tS.actItem, borderBottom: i===items.length-1 ? 'none' : '1px solid #F4F1EB'}}>
            <div style={{...tS.actAvatar, background:avatarColor(it.ini)}}>{it.ini}</div>
            <div style={{flex:1, minWidth:0}}>
              <div style={tS.actText}>
                <span style={{fontWeight:600, color:'#1B1B1A'}}>{it.who}</span>{' '}
                <span style={{color:'#6B6A66'}}>{it.action}</span>{' '}
                <span style={{color:'#1B1B1A', fontWeight:500}}>{it.target}</span>
                {it.detail && <div style={{color:'#94928D', marginTop:2, fontSize:11.5}}>{it.detail}</div>}
              </div>
              <div style={tS.actTime}>{it.time}</div>
            </div>
            <div style={{...tS.actMark, background:kindCol[it.kind]}}></div>
          </div>
        ))}
      </div>
    </section>
  );
}

window.ConstructaDashboard_Timeline = Timeline;
window.ConstructaDashboard_UnscheduledDrawer = UnscheduledDrawer;
window.ConstructaDashboard_ActivityFeed = ActivityFeed;
window.ConstructaDashboard_UnschedGhost = UnschedGhost;
window.ConstructaDashboard_RANGE_START = RANGE_START;
window.ConstructaDashboard_RANGE_END = RANGE_END;

const tS = {
  wrap: { background:'#fff', border:'1px solid #ECE7DD', borderRadius:14, overflow:'hidden' },
  head: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid #F0EBE2' },
  headLeft: { display:'flex', alignItems:'baseline', gap:10 },
  h2: { margin:0, fontSize:15, fontWeight:600, letterSpacing:'-0.015em' },
  headMeta: { fontSize:12, color:'#94928D' },
  headRight: { display:'flex', alignItems:'center', gap:8 },
  segment: { display:'flex', background:'#F4F1EB', borderRadius:7, padding:2, border:'1px solid #ECE7DD' },
  segBtn: { background:'transparent', border:'none', cursor:'pointer', padding:'4px 10px', fontSize:11.5, fontWeight:500, color:'#6B6A66', borderRadius:5 },
  segBtnActive: { background:'#fff', color:'#1B1B1A', boxShadow:'0 1px 2px rgba(0,0,0,0.05)' },
  iconBtn: { width:28, height:28, borderRadius:6, background:'#fff', border:'1px solid #ECE7DD', display:'flex', alignItems:'center', justifyContent:'center', color:'#3A3936', cursor:'pointer' },

  body: { display:'flex', position:'relative' },
  taskCol: { width:260, flexShrink:0, borderRight:'1px solid #F0EBE2', background:'#FAF8F4', display:'flex', flexDirection:'column' },
  colHead: { height:32, display:'flex', alignItems:'center', padding:'0 18px', fontSize:10.5, fontWeight:600, letterSpacing:'0.06em', color:'#94928D', textTransform:'uppercase', borderBottom:'1px solid #F0EBE2' },
  taskColBody: { display:'flex', flexDirection:'column' },
  nameRow: { height:ROW_H, display:'flex', alignItems:'center', gap:9, padding:'0 14px 0 6px', cursor:'pointer', transition:'background .12s', borderBottom:'1px solid #F4F1EB' },
  gripMini: { color:'#C9C3B6', display:'flex' },
  nameRowText: { display:'flex', flexDirection:'column', minWidth:0, flex:1 },
  nameRowName: { fontSize:13, fontWeight:500, color:'#1B1B1A', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' },
  nameRowMeta: { fontSize:10.5, color:'#94928D' },

  gridCol: { flex:1, overflow:'auto', position:'relative' },
  daysRow: { display:'flex', height:32, alignItems:'stretch', borderBottom:'1px solid #F0EBE2', background:'#FAF8F4', position:'sticky', top:0, zIndex:6 },
  dayCell: { width:DAY_W, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2, padding:'4px 0', borderLeft:'1px solid #F0EBE2' },
  dayName: { fontSize:10, fontWeight:500, letterSpacing:'0.06em', textTransform:'uppercase' },
  dayNum: { fontSize:12.5, display:'flex', alignItems:'center' },
  todayPill: { fontSize:10.5, padding:'2px 8px', borderRadius:99, background:'#E76A2D', color:'#fff', fontWeight:600 },

  rail: { position:'relative', minHeight: ROW_H * 7 },
  gridBg: { position:'absolute', inset:0, display:'flex' },
  gridCol2: { width:DAY_W, flexShrink:0, position:'relative', height:'100%' },
  todayLine: { position:'absolute', top:0, bottom:0, width:1.5, background:'#E76A2D', boxShadow:'0 0 0 0.5px rgba(231,106,45,0.30)', zIndex:2, pointerEvents:'none' },
  dropIndicator: { position:'absolute', top:6, bottom:6, left:4, right:4, border:'2px dashed #E76A2D', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(231,106,45,0.05)', pointerEvents:'none' },
  dropLabel: { fontSize:10, fontWeight:600, color:'#E76A2D', textAlign:'center' },

  barsLayer: { position:'absolute', inset:0 },
  barRow: { position:'absolute', left:0, right:0, height:ROW_H, borderBottom:'1px solid #F4F1EB' },
  rowHighlight: { position:'absolute', inset:0, background:'rgba(231,106,45,0.04)' },
  bar: { position:'absolute', top:6, bottom:6, border:'1px solid', borderRadius:8, display:'flex', alignItems:'center', overflow:'visible', userSelect:'none' },
  barStripe: { position:'absolute', left:0, top:6, bottom:6, width:3, borderRadius:99 },
  barInner: { display:'flex', alignItems:'center', gap:7, padding:'0 12px 0 14px', flex:1, minWidth:0 },
  barName: { fontSize:12.5, fontWeight:500, color:'#1B1B1A', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' },
  critTag: { fontSize:10, padding:'1px 6px', borderRadius:99, background:'#D03A3A', color:'#fff', fontWeight:600, fontFamily:"'JetBrains Mono', monospace", letterSpacing:'0.02em', flexShrink:0 },
  highTag: { fontSize:10, padding:'1px 6px', borderRadius:99, background:'rgba(231,106,45,0.15)', color:'#C25420', fontWeight:600, fontFamily:"'JetBrains Mono', monospace", letterSpacing:'0.02em', flexShrink:0 },
  barAvatar: { width:22, height:22, borderRadius:99, color:'#fff', fontSize:9.5, fontWeight:600, marginRight:8, display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #fff', boxShadow:'0 1px 2px rgba(0,0,0,0.06)', flexShrink:0 },
  edgeLeft: { position:'absolute', left:-3, top:0, bottom:0, width:10, cursor:'ew-resize', display:'flex', alignItems:'center' },
  edgeRight: { position:'absolute', right:-3, top:0, bottom:0, width:10, cursor:'ew-resize', display:'flex', alignItems:'center', justifyContent:'flex-end' },
  edgeGrip: { width:3, height:14, borderRadius:99, background:'rgba(20,20,20,0.16)' },
  deltaLabel: { position:'absolute', top:-22, width:200, textAlign:'center', fontSize:10.5, padding:'3px 9px', borderRadius:99, background:'#1B1B1A', color:'#fff', fontWeight:500, fontFamily:"'JetBrains Mono', monospace", pointerEvents:'none', zIndex:10, boxShadow:'0 4px 12px -2px rgba(0,0,0,0.20)' },

  legend: { display:'flex', alignItems:'center', gap:14, padding:'10px 18px', borderTop:'1px solid #F0EBE2', fontSize:11.5, color:'#6B6A66', background:'#FAF8F4' },
  legendItem: { display:'flex', alignItems:'center', gap:7 },
  legendSwatch: { width:18, height:12, borderRadius:4, border:'1px solid', position:'relative', overflow:'hidden' },
  legendStripe: { position:'absolute', left:0, top:1, bottom:1, width:2.5, borderRadius:99 },
  legendHint: { fontSize:11.5, color:'#94928D', display:'flex', alignItems:'center', gap:6 },
  hintKey: { padding:'1px 6px', borderRadius:4, background:'#fff', border:'1px solid #ECE7DD', color:'#3A3936', fontFamily:"'JetBrains Mono', monospace", fontSize:10.5, margin:'0 2px' },

  usWrap: { background:'#fff', border:'1px solid #ECE7DD', borderRadius:14, display:'flex', flexDirection:'column', overflow:'hidden' },
  usHead: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #F0EBE2' },
  usH3: { margin:0, fontSize:13, fontWeight:600, letterSpacing:'-0.01em' },
  usCount: { fontSize:10.5, padding:'1px 7px', borderRadius:99, background:'#F4F1EB', color:'#6B6A66', fontWeight:600, fontFamily:"'JetBrains Mono', monospace" },
  usHint: { display:'flex', alignItems:'center', gap:8, padding:'9px 16px', background:'#FFFAF3', borderBottom:'1px solid #F0EBE2', fontSize:11.5, color:'#6B6A66' },
  usHintDot: { width:6, height:6, borderRadius:6, background:'#E76A2D' },
  usList: { padding:10, display:'flex', flexDirection:'column', gap:6, flex:1, overflow:'auto', minHeight:220 },
  usCard: { display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'#FAF8F4', border:'1px solid #ECE7DD', borderRadius:9, cursor:'grab', transition:'border-color .12s, box-shadow .12s' },
  usGrip: { color:'#C9C3B6', display:'flex' },
  usName: { fontSize:12.5, fontWeight:500, color:'#1B1B1A', marginBottom:2 },
  usMeta: { fontSize:11, color:'#94928D', display:'flex', alignItems:'center', gap:6 },
  usEmpty: { padding:'40px 20px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center' },
  usEmptyCheck: { marginBottom:10 },

  linkBtn: { background:'transparent', border:'none', cursor:'pointer', fontSize:11.5, color:'#E76A2D', fontWeight:500 },

  actWrap: { background:'#fff', border:'1px solid #ECE7DD', borderRadius:14, display:'flex', flexDirection:'column', overflow:'hidden' },
  actList: { display:'flex', flexDirection:'column' },
  actItem: { display:'flex', gap:10, padding:'12px 16px', position:'relative', alignItems:'flex-start' },
  actAvatar: { width:28, height:28, borderRadius:99, color:'#fff', fontSize:10, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 },
  actText: { fontSize:12.5, lineHeight:1.45 },
  actTime: { fontSize:10.5, color:'#94928D', marginTop:4, fontFamily:"'JetBrains Mono', monospace" },
  actMark: { width:4, height:30, borderRadius:99, opacity:0.7, flexShrink:0, marginTop:2 },
};

window.ConstructaDashboard_tS = tS;
