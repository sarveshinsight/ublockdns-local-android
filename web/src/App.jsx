import { useState, useEffect, useMemo } from 'react'
import { Shield, ShieldAlert, Settings, Activity, Home, List, Power, X, PieChart as PieChartIcon, Download } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts'
import './index.css'

export default function App() {
  const [stats, setStats] = useState({ total_queries: 0, blocked: 0, block_rate: 0, top_queried: [], top_blocked: [], history: [] })
  const [logs, setLogs] = useState([])
  const [config, setConfig] = useState(null)
  const [knownLists, setKnownLists] = useState([])
  const [isConnected, setIsConnected] = useState(false)
  
  // Navigation State
  const [activeTab, setActiveTab] = useState('home') // home, logs, protection
  const [logFilter, setLogFilter] = useState('all') // all, allowed, blocked
  const [logLimit, setLogLimit] = useState(50) // limit for Activity logs
  const [selectedDomain, setSelectedDomain] = useState(null)
  const [timeframe, setTimeframe] = useState(24);

  const fetchData = async () => {
    try {
      const statsRes = await fetch(`/api/stats?hours=${timeframe}`)
      if (statsRes.ok) setStats(await statsRes.json())

      const logsRes = await fetch(`/api/logs?limit=${logLimit}`)
      if (logsRes.ok) setLogs(await logsRes.json() || [])

      if (!config) {
        const configRes = await fetch('/api/config')
        if (configRes.ok) {
          const cfgData = await configRes.json()
          cfgData.blocklists = cfgData.blocklists || []
          setConfig(cfgData)
        }
      }

      if (knownLists.length === 0) {
        const catRes = await fetch('/api/catalog')
        if (catRes.ok) setKnownLists(await catRes.json() || [])
      }
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [config, logLimit, timeframe])

  useEffect(() => {
    const vpnInterval = setInterval(() => {
      if (window.Android && window.Android.isVpnRunning) {
        setIsConnected(window.Android.isVpnRunning())
      }
    }, 1000)
    return () => clearInterval(vpnInterval)
  }, [])
  const hapticFeedback = () => {
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(50);
    }
  };

  const toggleVpn = () => {
    hapticFeedback();
    if (!isConnected) {
      if (window.Android) {
        window.Android.startVpn()
        setIsConnected(true)
      } else {
        alert("Not running inside Android App")
      }
    } else {
      if (window.Android) {
        window.Android.stopVpn()
        setIsConnected(false)
      }
    }
  }

  const toggleList = async (listUrl) => {
    hapticFeedback();
    if (!config) return
    const isEnabled = config.blocklists.includes(listUrl)
    const newList = isEnabled ? config.blocklists.filter(url => url !== listUrl) : [...config.blocklists, listUrl]
    const newConfig = { ...config, blocklists: newList }
    setConfig(newConfig)
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newConfig) })
  }

  const handleCustomRulesChange = async (e) => {
    if (!config) return
    const newRules = e.target.value.split('\n')
    const newConfig = { ...config, custom_rules: newRules }
    setConfig(newConfig)
  }
  
  const saveCustomRules = async () => {
    if (!config) return
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    alert("Custom rules saved!")
  }

  const openDomainModal = async (domain) => {
    setSelectedDomain(domain)
    setDomainStats(null)
    try {
      const res = await fetch(`/api/domain/${domain}`)
      if (res.ok) setDomainStats(await res.json())
    } catch (e) {}
  }

  const exportData = () => {
    hapticFeedback();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ stats, logs }, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "ublockdns_export.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  // --- Rendering Functions ---

  const renderHome = () => (
    <div className="page-transition">
      <div className="connect-container" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 0'}}>
        <div style={{ position: 'relative', width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <div style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', background: isConnected ? 'var(--success-green-glow)' : 'var(--accent-red-glow)', animation: 'pulseGlow 2s infinite', opacity: isConnected ? 1 : 0.5, transition: 'all 0.5s' }}></div>
          <Shield size={64} color={isConnected ? 'var(--success-green)' : 'var(--accent-red)'} style={{ zIndex: 2, filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.5))' }} />
        </div>
        
        <label className="switch" style={{transform: 'scale(1.2)', marginBottom: '1rem'}}>
          <input 
            type="checkbox" 
            checked={isConnected}
            onChange={toggleVpn}
          />
          <span className="slider"></span>
        </label>
        <p style={{fontSize: '1.1rem', fontWeight: '600', color: isConnected ? 'var(--success-green)' : 'var(--text-secondary)'}}>
          {isConnected ? 'Protection Active' : 'Protection Disabled'}
        </p>
      </div>

      <div className="timeframe-selector" style={{display: 'flex', background: 'rgba(0,0,0,0.5)', padding: '4px', borderRadius: '12px', marginBottom: '1.5rem', width: 'fit-content', margin: '0 auto 1.5rem auto'}}>
        {[ {l: '1H', v: 1}, {l: '24H', v: 24}, {l: '7D', v: 168}, {l: '30D', v: 720} ].map(tf => (
          <button 
            key={tf.v}
            onClick={() => { hapticFeedback(); setTimeframe(tf.v); }}
            style={{
              background: timeframe === tf.v ? 'var(--panel-bg)' : 'transparent',
              color: timeframe === tf.v ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: timeframe === tf.v ? '1px solid var(--glass-border)' : '1px solid transparent',
              borderRadius: '8px',
              padding: '6px 16px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: timeframe === tf.v ? '0 2px 8px rgba(0,0,0,0.2)' : 'none'
            }}>
            {tf.l}
          </button>
        ))}
      </div>

      <div className="stats-grid" style={{gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px'}}>
        <div className="glass-panel stat-card" style={{padding: '1rem'}}>
          <div className="stat-icon-wrapper" style={{background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)', transform: 'scale(0.8)', right: '-20px', top: '-20px'}}>
            <Activity size={24} />
          </div>
          <span className={`stat-value ${stats.total_queries === 0 && stats.history.length === 0 ? 'skeleton' : ''}`} style={{fontSize: '1.4rem'}}>
            {stats.total_queries === 0 && stats.history.length === 0 ? '\u00A0' : stats.total_queries.toLocaleString()}
          </span>
          <span className="stat-label" style={{fontSize: '0.7rem'}}>Queries</span>
        </div>
        <div className="glass-panel stat-card" style={{padding: '1rem'}}>
          <div className="stat-icon-wrapper" style={{background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success-green)', transform: 'scale(0.8)', right: '-20px', top: '-20px'}}>
            <ShieldAlert size={24} />
          </div>
          <span className={`stat-value ${stats.total_queries === 0 && stats.history.length === 0 ? 'skeleton' : ''}`} style={{fontSize: '1.4rem'}}>
            {stats.total_queries === 0 && stats.history.length === 0 ? '\u00A0' : stats.blocked.toLocaleString()}
          </span>
          <span className="stat-label" style={{fontSize: '0.7rem'}}>Blocked</span>
        </div>
        <div className="glass-panel stat-card" style={{padding: '1rem', position: 'relative'}}>
          <svg style={{position: 'absolute', right: '-15px', top: '-15px', opacity: 0.15}} width="60" height="60" viewBox="0 0 36 36">
            <path strokeDasharray={`${stats.block_rate}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--accent-red)" strokeWidth="4" />
          </svg>
          <span className={`stat-value ${stats.total_queries === 0 && stats.history.length === 0 ? 'skeleton' : ''}`} style={{fontSize: '1.4rem'}}>
            {stats.total_queries === 0 && stats.history.length === 0 ? '\u00A0' : `${stats.block_rate.toFixed(1)}%`}
          </span>
          <span className="stat-label" style={{fontSize: '0.7rem'}}>Rate</span>
        </div>
      </div>

      <div className="glass-panel" style={{marginTop: '1.5rem', padding: '1.5rem 1rem 1rem 0', height: '200px'}}>
        <h3 className="section-title" style={{paddingLeft: '1.5rem', marginBottom: '1rem'}}>Query Volume</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={stats.history}>
            <defs>
              <linearGradient id="colorQueries" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <Tooltip contentStyle={{background: 'var(--panel-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px'}} itemStyle={{color: 'white'}} />
            <Area type="monotone" dataKey="queries" stroke="var(--accent-blue)" strokeWidth={3} fillOpacity={1} fill="url(#colorQueries)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const renderLogs = () => {
    const filteredLogs = logs.filter(log => {
      if (logFilter === 'allowed') return log.action !== 'BLOCKED';
      if (logFilter === 'blocked') return log.action === 'BLOCKED';
      return true;
    });
    
    return (
    <div className="glass-panel page-transition" style={{padding: '1rem 0'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 1.5rem', marginBottom: '1rem'}}>
        <h3 className="section-title" style={{margin: 0}}>Activity</h3>
        <div style={{display: 'flex', gap: '0.5rem'}}>
          <button style={{background: logFilter === 'all' ? 'var(--accent-blue)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600}} onClick={() => setLogFilter('all')}>All</button>
          <button style={{background: logFilter === 'allowed' ? 'var(--success-green)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600}} onClick={() => setLogFilter('allowed')}>Allowed</button>
          <button style={{background: logFilter === 'blocked' ? 'var(--accent-red)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600}} onClick={() => setLogFilter('blocked')}>Blocked</button>
        </div>
      </div>
      {filteredLogs.length === 0 ? (
        <div style={{padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)'}}>
          No queries matching filter.
        </div>
      ) : (
        <>
          {filteredLogs.map((log, i) => (
            <div className="list-item" key={i} onClick={() => openDomainModal(log.domain)}>
              <div className="domain-icon">
                {log.domain.charAt(0).toUpperCase()}
              </div>
              <div className="domain-info">
                <span className="domain-name">{log.domain}</span>
                <span className="domain-meta">{log.type} • {log.speed}</span>
              </div>
              <span className={`action-badge ${log.action === 'BLOCKED' ? 'blocked' : 'allowed'}`}>
                {log.action}
              </span>
            </div>
          ))}
          {logs.length >= logLimit && (
            <button 
              onClick={() => setLogLimit(l => l + 50)} 
              className="btn-primary" 
              style={{margin: '1rem auto', display: 'block', width: 'calc(100% - 3rem)', padding: '12px'}}
            >
              View More
            </button>
          )}
        </>
      )}
    </div>
  )};

  const upstreamProfiles = [
    { name: 'Automatic (Cloudflare + Google)', value: '1.1.1.1:853,8.8.8.8:853' },
    { name: 'Privacy Focus (Cloudflare + Quad9)', value: '1.1.1.1:853,9.9.9.9:853' },
    { name: 'Security Focus (Quad9 + AdGuard)', value: '9.9.9.9:853,94.140.14.14:853' },
    { name: 'Filtering Focus (AdGuard + Cloudflare Family)', value: '94.140.14.14:853,1.1.1.3:853' },
    { name: 'Google Public DNS', value: '8.8.8.8:853' },
    { name: 'Cloudflare', value: '1.1.1.1:853' },
    { name: 'Quad9', value: '9.9.9.9:853' },
    { name: 'AdGuard DNS', value: '94.140.14.14:853' }
  ];

  const handleUpstreamChange = async (e) => {
    if (!config) return;
    const newCfg = { ...config, upstream_dns: e.target.value };
    setConfig(newCfg);
    await fetch(`/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCfg)
    });
  };

  const renderProtection = () => (
    <div className="page-transition" style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
      <div className="glass-panel" style={{padding: '1.5rem'}}>
        <h3 className="section-title">Upstream Provider</h3>
        <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem'}}>
          Select which public DNS resolvers to use.
        </p>
        <select 
          style={{width: '100%', padding: '12px', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'white', fontSize: '0.9rem'}}
          value={config?.upstream_dns || '1.1.1.1:853,8.8.8.8:853'}
          onChange={handleUpstreamChange}
        >
          <optgroup label="Presets (Concurrent)">
            {upstreamProfiles.slice(0, 4).map(p => <option key={p.value} value={p.value}>{p.name}</option>)}
          </optgroup>
          <optgroup label="Specific Providers">
            {upstreamProfiles.slice(4).map(p => <option key={p.value} value={p.value}>{p.name}</option>)}
          </optgroup>
        </select>
      </div>

      <div className="glass-panel" style={{padding: '1rem 0'}}>
        <h3 className="section-title" style={{padding: '0 1.5rem'}}>Blocklists</h3>
        {knownLists.map((list, i) => (
          <div className="toggle-row" key={i}>
            <div className="toggle-info" style={{paddingRight: '1rem'}}>
              <h4>{list.name}</h4>
              <p>{list.desc}</p>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={config?.blocklists?.includes(list.url) || false}
                onChange={() => toggleList(list.url)}
              />
              <span className="slider"></span>
            </label>
          </div>
        ))}
      </div>
      
      <div className="glass-panel" style={{padding: '1.5rem'}}>
        <h3 className="section-title">Custom Rules</h3>
        <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem'}}>
          Add one rule per line. Use standard syntax or domain names. e.g. <code>||ads.example.com^</code> or <code>@@||good.example.com^</code>
        </p>
        <textarea 
          style={{width: '100%', height: '150px', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '1rem', color: 'white', fontFamily: 'monospace', resize: 'vertical'}}
          value={config?.custom_rules?.join('\n') || ''}
          onChange={handleCustomRulesChange}
          placeholder="||example.com^"
        />
        <button className="btn-primary" style={{marginTop: '1rem', padding: '12px'}} onClick={saveCustomRules}>
          Save Rules
        </button>
      </div>
    </div>
  );

  const renderAnalytics = () => {
    // DS-01: Category Intelligence
    const categories = { "Ad Networks": 0, "Telemetry": 0, "Social Trackers": 0, "Other": 0 };
    (stats.top_blocked || []).forEach(d => {
      const dom = d.domain.toLowerCase();
      if (dom.includes('google') || dom.includes('amazon') || dom.includes('doubleclick') || dom.includes('ads')) {
        categories["Ad Networks"] += d.count;
      } else if (dom.includes('metric') || dom.includes('analytic') || dom.includes('telemetry') || dom.includes('logs')) {
        categories["Telemetry"] += d.count;
      } else if (dom.includes('facebook') || dom.includes('meta') || dom.includes('tiktok')) {
        categories["Social Trackers"] += d.count;
      } else {
        categories["Other"] += d.count;
      }
    });
    const pieData = Object.keys(categories).map(k => ({ name: k, value: categories[k] })).filter(c => c.value > 0);
    const COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6'];

    // DS-02: Z-Score Anomalies
    let anomalies = [];
    if (stats.history && stats.history.length > 5) {
      const mean = stats.history.reduce((a, b) => a + b.queries, 0) / stats.history.length;
      const variance = stats.history.reduce((a, b) => a + Math.pow(b.queries - mean, 2), 0) / stats.history.length;
      const stddev = Math.sqrt(variance);
      anomalies = stats.history.filter(h => h.queries > mean + 2 * stddev).map(h => ({
        time: new Date(h.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        queries: h.queries,
        zscore: ((h.queries - mean) / (stddev || 1)).toFixed(1)
      })).slice(-3).reverse();
    }

    // DS-03: Privacy Score
    const pScore = Math.min(100, Math.max(0, Math.round((stats.block_rate || 0) * 1.5 + (isConnected ? 20 : 0))));

    // DS-05: Correlation Heatmap
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const heatmapData = Array(7).fill(0).map(() => Array(24).fill(0));
    let maxHeat = 0;
    (stats.history || []).forEach(h => {
      const d = new Date(h.timestamp * 1000);
      const day = d.getDay();
      const hour = d.getHours();
      heatmapData[day][hour] += h.queries;
      if (heatmapData[day][hour] > maxHeat) maxHeat = heatmapData[day][hour];
    });

    // Overview chart data: total vs blocked per time bucket
    const overviewData = (stats.history || []).map(h => ({
      time: new Date(h.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      'Total Queries': h.queries,
      'Blocked': h.blocked || 0
    }));

    const totalBlocked = (stats.top_blocked || []).reduce((sum, d) => sum + d.count, 0);

    return (
      <div className="page-transition" style={{display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <h2 style={{fontSize: '1.5rem', fontWeight: 800}}>Analytics</h2>
          <button onClick={exportData} style={{background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid var(--glass-border)', padding: '8px 16px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}>
            <Download size={16} /> Export JSON
          </button>
        </div>

        <div className="glass-panel stat-card" style={{padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <div>
            <h3 className="section-title" style={{marginBottom: '0.5rem'}}>Privacy Score</h3>
            <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>Computed from block rate and active protection heuristics.</p>
          </div>
          <div style={{position: 'relative', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <svg style={{position: 'absolute', top: 0, left: 0}} width="80" height="80" viewBox="0 0 36 36">
              <path strokeDasharray={`${pScore}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={pScore > 75 ? 'var(--success-green)' : pScore > 40 ? '#f59e0b' : 'var(--accent-red)'} strokeWidth="4" style={{transition: 'stroke-dasharray 1s ease-out'}} />
            </svg>
            <span style={{fontSize: '1.6rem', fontWeight: 800, color: 'white'}}>{pScore}</span>
          </div>
        </div>

        <div className="glass-panel" style={{padding: '1.5rem', display: 'flex', flexDirection: 'column'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
            <h3 className="section-title" style={{margin: 0}}>Threat Categories</h3>
            <div style={{display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(244, 63, 94, 0.15)', padding: '6px 14px', borderRadius: '20px'}}>
              <ShieldAlert size={14} color="var(--accent-red)" />
              <span style={{fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-red)'}}>{totalBlocked.toLocaleString()} blocked</span>
            </div>
          </div>
          <div style={{height: '220px', width: '100%', marginTop: '1rem'}}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                  {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{background: 'var(--panel-bg)', border: 'none', borderRadius: '8px'}} itemStyle={{color: 'white'}} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', marginTop: '1rem'}}>
            {pieData.map((entry, i) => (
              <div key={i} style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem'}}>
                <div style={{width: '10px', height: '10px', borderRadius: '50%', background: COLORS[i % COLORS.length]}}></div>
                <span style={{color: 'var(--text-secondary)'}}>{entry.name}</span>
                <span style={{fontWeight: 700, color: 'white'}}>{entry.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{padding: '1.5rem 1rem 1rem 0', height: '280px'}}>
          <h3 className="section-title" style={{paddingLeft: '1.5rem', marginBottom: '1rem'}}>Overview</h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={overviewData}>
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-red)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--accent-red)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{fontSize: 10, fill: 'var(--text-secondary)'}} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{fontSize: 10, fill: 'var(--text-secondary)'}} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={{background: 'var(--panel-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px'}} itemStyle={{color: 'white'}} />
              <Legend wrapperStyle={{fontSize: '0.75rem', paddingTop: '8px'}} />
              <Area type="monotone" dataKey="Total Queries" stroke="var(--accent-blue)" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
              <Area type="monotone" dataKey="Blocked" stroke="var(--accent-red)" strokeWidth={2} fillOpacity={1} fill="url(#colorBlocked)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-panel" style={{padding: '1.5rem'}}>
          <h3 className="section-title" style={{marginBottom: '1rem'}}>Volume Anomalies (Z-Score &gt; 2.0)</h3>
          {anomalies.length === 0 ? (
            <div style={{padding: '1.5rem', textAlign: 'center', color: 'var(--success-green)', background: 'rgba(16,185,129,0.1)', borderRadius: '12px'}}>
              ✓ Traffic volume is normal. No anomalies detected.
            </div>
          ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
              {anomalies.map((a, i) => (
                <div key={i} style={{display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--accent-red-glow)', borderRadius: '12px'}}>
                  <div>
                    <strong style={{color: 'var(--accent-red)'}}>{a.time}</strong>
                    <span style={{color: 'white', marginLeft: '10px'}}>{a.queries} queries</span>
                  </div>
                  <span style={{background: 'var(--accent-red)', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800}}>
                    z={a.zscore}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-panel" style={{padding: '1.5rem'}}>
          <h3 className="section-title" style={{marginBottom: '1rem'}}>Traffic Heatmap (Day × Hour)</h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: '4px', overflowX: 'auto', paddingBottom: '0.5rem'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px'}}>
              <span style={{width: '30px'}}></span>
              {[0,6,12,18].map(h => (
                <span key={h} style={{width: `${12*6 + 4*5}px`, fontSize: '0.6rem', color: 'var(--text-secondary)'}}>{h}h</span>
              ))}
            </div>
            {days.map((dayName, dayIndex) => (
              <div key={dayName} style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                <span style={{width: '30px', fontSize: '0.7rem', color: 'var(--text-secondary)'}}>{dayName}</span>
                {heatmapData[dayIndex].map((val, hr) => (
                  <div 
                    key={hr} 
                    title={`${dayName} ${hr}:00 - ${val} queries`}
                    style={{
                      width: '12px', 
                      height: '12px', 
                      borderRadius: '2px', 
                      background: val === 0 ? 'rgba(255,255,255,0.05)' : `rgba(59, 130, 246, ${Math.max(0.2, val / (maxHeat || 1))})`
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="app-header">
        <div className="logo-container">
          <ShieldAlert color="var(--accent-blue)" size={28} />
          <span className="logo-text">uBlockDNS</span>
        </div>
        <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className="status-dot"></div>
          {isConnected ? 'ACTIVE' : 'INACTIVE'}
        </div>
      </div>

      <div className="main-content">
        {activeTab === 'home' && renderHome()}
        {activeTab === 'logs' && renderLogs()}
        {activeTab === 'analytics' && renderAnalytics()}
        {activeTab === 'protection' && renderProtection()}
      </div>

      <div className="bottom-nav">
        <button className={`nav-btn ${activeTab === 'home' ? 'active' : ''}`} onClick={() => { hapticFeedback(); setActiveTab('home'); }}>
          <Home size={24} />
          <span>Home</span>
        </button>
        <button className={`nav-btn ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => { hapticFeedback(); setActiveTab('logs'); }}>
          <Activity size={24} />
          <span>Activity</span>
        </button>
        <button className={`nav-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => { hapticFeedback(); setActiveTab('analytics'); }}>
          <PieChartIcon size={24} />
          <span>Analytics</span>
        </button>
        <button className={`nav-btn ${activeTab === 'protection' ? 'active' : ''}`} onClick={() => { hapticFeedback(); setActiveTab('protection'); }}>
          <Shield size={24} />
          <span>Protection</span>
        </button>
      </div>

      {selectedDomain && (
        <div className="modal-overlay" onClick={() => setSelectedDomain(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="section-title" style={{margin:0}}>{selectedDomain}</h3>
              <button className="close-btn" onClick={() => setSelectedDomain(null)}><X size={18}/></button>
            </div>
            
            <div className="stats-grid" style={{marginBottom: '1.5rem'}}>
              <div className="stat-card" style={{background: 'rgba(255,255,255,0.05)', borderRadius: '12px'}}>
                <span className="stat-value">{domainStats ? domainStats.queries : '...'}</span>
                <span className="stat-label">Queries</span>
              </div>
              <div className="stat-card" style={{background: 'rgba(239,68,68,0.1)', borderRadius: '12px'}}>
                <span className="stat-value" style={{color: '#ef4444'}}>{domainStats ? domainStats.blocked : '...'}</span>
                <span className="stat-label">Blocked</span>
              </div>
            </div>
            
            <button className="btn-primary" onClick={() => setSelectedDomain(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
