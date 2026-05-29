// constructa-main.jsx — orquesta todo. El estado de drag vive acá arriba
// para que tanto Timeline como UnscheduledDrawer compartan la misma máquina.

function ConstructaDashboardApp() {
  const [tasks, setTasks] = React.useState(window.ConstructaDashboard_INITIAL_TASKS);
  const [unscheduled, setUnscheduled] = React.useState(window.ConstructaDashboard_INITIAL_UNSCHEDULED);
  const [drag, setDrag] = React.useState(null);
  const [selectedId, setSelectedId] = React.useState('t2');
  const railRef = React.useRef(null);

  const Sidebar = window.ConstructaDashboard_Sidebar;
  const TopBar = window.ConstructaDashboard_TopBar;
  const ProjectHeader = window.ConstructaDashboard_ProjectHeader;
  const Timeline = window.ConstructaDashboard_Timeline;
  const UnscheduledDrawer = window.ConstructaDashboard_UnscheduledDrawer;
  const ActivityFeed = window.ConstructaDashboard_ActivityFeed;
  const UnschedGhost = window.ConstructaDashboard_UnschedGhost;
  const ACTIVITY = window.ConstructaDashboard_ACTIVITY;
  const DAY_W = window.ConstructaDashboard_DAY_W;
  const RANGE_START = window.ConstructaDashboard_RANGE_START;
  const RANGE_END = window.ConstructaDashboard_RANGE_END;

  // Global mouse handlers while dragging
  React.useEffect(() => {
    if (!drag) return;
    function onMove(e) {
      const deltaPixels = e.clientX - drag.startX;
      const deltaDays = Math.round(deltaPixels / DAY_W);
      let cd = null;
      if (drag.kind === 'unscheduled' && railRef.current) {
        const rect = railRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const inside = x >= 0 && x <= rect.width && e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inside) cd = Math.floor(x / DAY_W) + RANGE_START;
      }
      setDrag(d => d ? {...d, deltaDays, currentDay: cd} : d);
    }
    function onUp() {
      commitDrag();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind, drag?.taskId, drag?.sourceId, drag?.startX]);

  function commitDrag() {
    if (!drag) return;
    if (drag.kind === 'move') {
      setTasks(ts => ts.map(t => t.id===drag.taskId ? {...t, start:drag.originalStart+drag.deltaDays, end:drag.originalEnd+drag.deltaDays} : t));
    } else if (drag.kind === 'resize-right') {
      setTasks(ts => ts.map(t => t.id===drag.taskId ? {...t, end: Math.max(drag.originalStart, drag.originalEnd + drag.deltaDays)} : t));
    } else if (drag.kind === 'resize-left') {
      setTasks(ts => ts.map(t => t.id===drag.taskId ? {...t, start: Math.min(drag.originalEnd, drag.originalStart + drag.deltaDays)} : t));
    } else if (drag.kind === 'unscheduled') {
      if (drag.currentDay != null && drag.currentDay >= RANGE_START && drag.currentDay <= RANGE_END) {
        const src = unscheduled.find(u => u.id === drag.sourceId);
        if (src) {
          const newTask = {
            id: 'n' + Date.now(),
            name: src.name,
            start: drag.currentDay,
            end: drag.currentDay + src.duration - 1,
            status: 'pending',
            assignee: {ini:'?', name:'Sin asignar'},
            priority: src.priority,
            tag: src.tag,
          };
          setTasks(ts => [...ts, newTask]);
          setUnscheduled(us => us.filter(u => u.id !== drag.sourceId));
          setSelectedId(newTask.id);
        }
      }
    }
    setDrag(null);
  }

  function startUnsched(e, item) {
    e.preventDefault();
    setDrag({
      kind:'unscheduled', sourceId:item.id, startX:e.clientX, startY:e.clientY,
      duration:item.duration, deltaDays:0, currentDay:null,
      ghostName:item.name,
    });
  }

  return (
    <div style={appS.root}>
      <Sidebar/>
      <main style={appS.main}>
        <TopBar/>
        <div style={appS.scroll}>
          <ProjectHeader tasks={tasks}/>
          <div style={appS.section}>
            <Timeline
              tasks={tasks}
              drag={drag}
              setDrag={setDrag}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              railRef={railRef}
            />
          </div>
          <div style={appS.grid2}>
            <UnscheduledDrawer
              unscheduled={unscheduled}
              onStart={startUnsched}
            />
            <ActivityFeed items={ACTIVITY}/>
          </div>
          <div style={{height:24}}></div>
        </div>
      </main>

      {drag && drag.kind === 'unscheduled' && <UnschedGhost drag={drag}/>}
    </div>
  );
}

const appS = {
  root: { display:'flex', height:'100vh', background:'#FAF8F4', overflow:'hidden', fontFamily:"'Geist', -apple-system, sans-serif", color:'#1B1B1A' },
  main: { flex:1, display:'flex', flexDirection:'column', minWidth:0 },
  scroll: { flex:1, overflow:'auto' },
  section: { padding:'18px 28px 0' },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:18, padding:'18px 28px 0' },
};

window.ConstructaDashboardApp = ConstructaDashboardApp;
