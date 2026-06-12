import { useState, useEffect, useMemo } from 'react'
import { Shield, ShieldAlert, Settings, Activity, Home, List, Power, X } from 'lucide-react'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
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
  const [domainStats, setDomainStats] = useState(null)

  const fetchData = async () => {
    try {
      const statsRes = await fetch('/api/stats')
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
    const interval = setInterval(fetchData, 2000)
    return () => clearInterval(interval)
  }, [config, logLimit])

  useEffect(() => {
    const vpnInterval = setInterval(() => {
      if (window.Android && window.Android.isVpnRunning) {
        setIsConnected(window.Android.isVpnRunning())
      }
    }, 1000)
    return () => clearInterval(vpnInterval)
  }, [])

  const toggleVpn = () => {
    if (!isConnected) {
      if (window.Android) {
        window.Android.startVpn()
      } else {
        alert("Not running inside Android App")
      }
    } else {
      if (window.Android) {
        window.Android.stopVpn()
      }
    }
  }

  const toggleList = async (listUrl) => {
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

  // --- Rendering Functions ---

  const renderHome = () => (
    <>
      <div className="connect-container" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 0'}}>
        <label className="switch" style={{transform: 'scale(1.5)', marginBottom: '1rem'}}>
          <input 
            type="checkbox" 
            checked={isConnected}
            onChange={toggleVpn}
          />
          <span className="slider"></span>
        </label>
        <p style={{marginTop: '1rem', fontSize: '1rem', fontWeight: '500', color: isConnected ? 'var(--success-green)' : 'var(--text-secondary)'}}>
          {isConnected ? 'VPN Connected' : 'VPN Disconnected'}
        </p>
      </div>

      <div className="stats-grid">
        <div className="glass-panel stat-card">
          <div className="stat-icon-wrapper" style={{background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6'}}>
            <Activity size={18} />
          </div>
          <span className="stat-value">{stats.total_queries}</span>
          <span className="stat-label">Queries</span>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon-wrapper" style={{background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444'}}>
            <ShieldAlert size={18} />
          </div>
          <span className="stat-value">{stats.blocked}</span>
          <span className="stat-label">Blocked</span>
        </div>
      </div>
    </>
  );

  const renderLogs = () => {
    const filteredLogs = logs.filter(log => {
      if (logFilter === 'allowed') return log.action !== 'BLOCKED';
      if (logFilter === 'blocked') return log.action === 'BLOCKED';
      return true;
    });
    
    return (
    <div className="glass-panel" style={{padding: '1rem 0'}}>
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
    <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
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
        {activeTab === 'protection' && renderProtection()}
      </div>

      <div className="bottom-nav">
        <button className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>
          <Home size={24} />
          <span>Home</span>
        </button>
        <button className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
          <Activity size={24} />
          <span>Activity</span>
        </button>
        <button className={`nav-item ${activeTab === 'protection' ? 'active' : ''}`} onClick={() => setActiveTab('protection')}>
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
