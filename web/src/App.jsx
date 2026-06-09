import { useState, useEffect, useMemo } from 'react'
import { Shield, ShieldAlert, Settings, LogOut, DownloadCloud, X } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import './index.css'

const domainColors = ['#e63946', '#2ecc71', '#3498db', '#f39c12', '#9b59b6', '#1abc9c', '#d35400', '#34495e'];
const getDomainColor = (domain) => {
  if (!domain) return domainColors[0];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  return domainColors[Math.abs(hash) % domainColors.length];
};

const DomainIcon = ({ domain }) => {
  const [error, setError] = useState(false);
  return (
    <div className="domain-icon" style={{ backgroundColor: error ? getDomainColor(domain) : 'transparent' }}>
      {!error ? (
        <img src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} onError={() => setError(true)} alt="" />
      ) : (
        domain ? domain.charAt(0).toUpperCase() : '?'
      )}
    </div>
  );
};

export default function App() {
  const [stats, setStats] = useState({ total_queries: 0, blocked: 0, block_rate: 0, top_queried: [], top_blocked: [], history: [] })
  const [logs, setLogs] = useState([])
  const [updaterStatus, setUpdaterStatus] = useState(null)
  const [visibleLogs, setVisibleLogs] = useState(15)
  const [config, setConfig] = useState(null)
  const [customRuleInput, setCustomRuleInput] = useState("")
  
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showExceptions, setShowExceptions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState(null)
  const [domainStats, setDomainStats] = useState(null)
  const [timeframe, setTimeframe] = useState(24) // hours
  const [knownLists, setKnownLists] = useState([])

  const fetchData = async () => {
    try {
      const statsRes = await fetch('/api/stats')
      if (statsRes.ok) setStats(await statsRes.json())

      const logsRes = await fetch('/api/logs')
      if (logsRes.ok) {
        const data = await logsRes.json()
        setLogs(data || [])
      }

      try {
        const upRes = await fetch('/api/updater/status')
        if (upRes.ok) setUpdaterStatus(await upRes.json())
      } catch (e) {}
      
      if (!config) {
        const configRes = await fetch('/api/config')
        if (configRes.ok) {
          const cfgData = await configRes.json()
          cfgData.blocklists = cfgData.blocklists || []
          cfgData.custom_rules = cfgData.custom_rules || []
          setConfig(cfgData)
        }
      }

      if (knownLists.length === 0) {
        const catRes = await fetch('/api/catalog')
        if (catRes.ok) {
          const catData = await catRes.json()
          setKnownLists(catData || [])
        }
      }
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 2000)
    return () => clearInterval(interval)
  }, [config])

  const toggleList = async (listUrl) => {
    if (!config) return
    const isEnabled = config.blocklists.includes(listUrl)
    let newList = []
    if (isEnabled) {
      newList = config.blocklists.filter(url => url !== listUrl)
    } else {
      newList = [...config.blocklists, listUrl]
    }
    
    const newConfig = { ...config, blocklists: newList }
    setConfig(newConfig)
    
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    })
  }

  const saveSettings = async (e) => {
    e.preventDefault()
    if (!config) return
    const fd = new FormData(e.target)
    const newUpstream = fd.get('upstream_dns') || config.upstream_dns
    const newConfig = { ...config, upstream_dns: newUpstream }
    setConfig(newConfig)
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    })
    setShowSettings(false)
  }

  const forceUpdate = async () => {
    try {
      await fetch('/api/updater/force', { method: 'POST' })
      setTimeout(fetchData, 1000)
    } catch (e) {}
  }

  const formatTimeUntil = (nextTimestamp) => {
    if (!nextTimestamp) return "Calculating...";
    const diff = (nextTimestamp * 1000) - Date.now();
    if (diff <= 0) return "Updating...";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const formatLastUpdate = (lastTimestamp) => {
    if (!lastTimestamp) return "Never";
    const d = new Date(lastTimestamp * 1000);
    return d.toLocaleString();
  };

  const generateChartData = (historyList, tf) => {
    const hist = historyList || []
    const now = new Date()
    
    let buckets = []
    let isDaily = tf > 72
    let isHourly = tf > 1 && tf <= 72
    let isMinutely = tf === 1
    
    if (isDaily) {
      const currentDay = Math.floor(now.getTime() / 1000 / 86400) * 86400
      const days = tf / 24
      
      for (let i = days - 1; i >= 0; i--) {
        const ts = currentDay - (i * 86400)
        const d = new Date(ts * 1000)
        buckets.push({
          timestamp: ts,
          time: `${d.getMonth() + 1}/${d.getDate()}`,
          queries: 0,
          blocked: 0
        })
      }
      
      hist.forEach(h => {
        const dayTs = Math.floor(h.timestamp / 86400) * 86400
        const bucket = buckets.find(b => b.timestamp === dayTs)
        if (bucket) {
          bucket.queries += h.queries || 0
          bucket.blocked += h.blocked || 0
        }
      })
    } else if (isHourly) {
      const currentHour = Math.floor(now.getTime() / 1000 / 3600) * 3600
      for (let i = tf - 1; i >= 0; i--) {
        const ts = currentHour - (i * 3600)
        const d = new Date(ts * 1000)
        let hours = d.getHours()
        let ampm = hours >= 12 ? 'PM' : 'AM'
        hours = hours % 12
        hours = hours ? hours : 12
        buckets.push({
          timestamp: ts,
          time: `${hours}:00 ${ampm}`,
          queries: 0,
          blocked: 0
        })
      }
      
      hist.forEach(h => {
        const hourTs = Math.floor(h.timestamp / 3600) * 3600
        const bucket = buckets.find(b => b.timestamp === hourTs)
        if (bucket) {
          bucket.queries += h.queries || 0
          bucket.blocked += h.blocked || 0
        }
      })
    } else if (isMinutely) {
      const current5Min = Math.floor(now.getTime() / 1000 / 300) * 300
      
      for (let i = 11; i >= 0; i--) {
        const ts = current5Min - (i * 300)
        const d = new Date(ts * 1000)
        let hours = d.getHours()
        let mins = d.getMinutes()
        let ampm = hours >= 12 ? 'PM' : 'AM'
        hours = hours % 12
        hours = hours ? hours : 12
        buckets.push({
          timestamp: ts,
          time: `${hours}:${mins.toString().padStart(2, '0')} ${ampm}`,
          queries: 0,
          blocked: 0
        })
      }
      
      hist.forEach(h => {
        const minTs = Math.floor(h.timestamp / 300) * 300
        const bucket = buckets.find(b => b.timestamp === minTs)
        if (bucket) {
          bucket.queries += h.queries || 0
          bucket.blocked += h.blocked || 0
        }
      })
    }
    return buckets
  }

  const chartData = useMemo(() => generateChartData(stats.history, timeframe), [stats.history, timeframe])
  const domainChartData = useMemo(() => generateChartData(domainStats?.history, timeframe), [domainStats?.history, timeframe])

  const openDomainModal = async (domain) => {
    setSelectedDomain(domain)
    setDomainStats(null)
    try {
      const res = await fetch(`/api/domain/${domain}`)
      if (res.ok) {
        setDomainStats(await res.json())
      }
    } catch (e) {
      console.error(e)
    }
  }

  const addCustomRule = async (domain, isBlock) => {
    if (!config) return
    let cleanDomain = domain.replace(/^(?:\|\||@@\|\|)?(.*?)\^?$/, '$1').trim()
    if (!cleanDomain) return

    try {
      if (cleanDomain.startsWith('http://') || cleanDomain.startsWith('https://')) {
        cleanDomain = new URL(cleanDomain).hostname
      } else if (cleanDomain.includes('/')) {
        cleanDomain = cleanDomain.split('/')[0]
      }
    } catch (e) {
      // fallback to whatever was there if parsing fails
    }

    const blockRule = `||${cleanDomain}^`
    const allowRule = `@@||${cleanDomain}^`
    const targetRule = isBlock ? blockRule : allowRule
    const oppositeRule = isBlock ? allowRule : blockRule
    
    let currentRules = config.custom_rules || []
    
    // If the target rule already exists, do nothing
    if (currentRules.includes(targetRule)) return
    
    // Remove the opposite rule if it exists
    currentRules = currentRules.filter(r => r !== oppositeRule)
    
    const newRules = [...currentRules, targetRule]
    const newConfig = { ...config, custom_rules: newRules }
    setConfig(newConfig)
    
    // Optimistic UI update
    if (domainStats && selectedDomain === cleanDomain) {
      setDomainStats(prev => prev ? { ...prev, is_blocked: isBlock } : prev)
    }

    // Fire and forget
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    }).then(() => {
      fetchData()
    })
  }

  const removeCustomRule = async (ruleToRemove) => {
    if (!config) return
    const newRules = (config.custom_rules || []).filter(r => r !== ruleToRemove)
    const newConfig = { ...config, custom_rules: newRules }
    setConfig(newConfig)
    
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    }).then(() => {
      fetchData()
    })
  }

  const toggleCustomRuleState = async (ruleStr) => {
    if (!config) return
    let newRule
    if (ruleStr.startsWith('! ')) {
      newRule = ruleStr.substring(2)
    } else {
      newRule = '! ' + ruleStr
    }
    const newRules = (config.custom_rules || []).map(r => r === ruleStr ? newRule : r)
    const newConfig = { ...config, custom_rules: newRules }
    setConfig(newConfig)
    
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    }).then(() => {
      fetchData()
    })
  }

  const parseRuleForDisplay = (ruleStr) => {
    const isEnabled = !ruleStr.startsWith('! ')
    const text = ruleStr.replace(/^!\s*/, '')
    const isAllowed = text.startsWith('@@')
    const cleanDomain = text.replace(/^(?:@@)?\|\|(.*?)\^?$/, '$1')
    return { domain: cleanDomain, isAllowed, isEnabled, raw: ruleStr }
  }

  const updateUpstreamDNS = async (value) => {
    if (!config) return
    const newConfig = { ...config, upstream_dns: value }
    setConfig(newConfig)
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    }).then(() => fetchData())
  }

  // knownLists is now fetched from the backend catalog

  return (
    <>
      <div className="topbar">
        <div className="logo-section">
          <ShieldAlert className="logo-icon" size={24} />
          <span>uBlockDNS LOCAL</span>
        </div>
        <button className="btn"><LogOut size={16} style={{marginRight: '8px', verticalAlign: 'middle'}}/> LOGOUT</button>
      </div>

      <div className="main-content">
        <div className="left-panel">
          <div className="card">
            <div className="card-header">Overview</div>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-value">{stats.total_queries}</span>
                <span className="stat-label">Total Queries</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.blocked}</span>
                <span className="stat-label">Blocked</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.block_rate.toFixed(1)}%</span>
                <span className="stat-label">Block Rate</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Activity</span>
              <select 
                value={timeframe} 
                onChange={(e) => setTimeframe(Number(e.target.value))}
                style={{ backgroundColor: '#0d0d0d', color: '#e0e0e0', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '2px 8px', outline: 'none', fontSize: '0.8rem' }}
              >
                <option value={1}>Past Hour</option>
                <option value={24}>24 Hours</option>
                <option value={48}>48 Hours</option>
                <option value={72}>72 Hours</option>
                <option value={720}>Past Month</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '10px', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{width: 8, height: 8, borderRadius: '50%', backgroundColor: '#888'}}></div> Queries</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{width: 8, height: 8, borderRadius: '50%', backgroundColor: '#e63946'}}></div> Blocked</div>
            </div>
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e63946" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#e63946" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorQueries" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#888888" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#888888" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{backgroundColor: '#151515', borderColor: '#2a2a2a'}} />
                  <Area type="monotone" dataKey="queries" stroke="#888888" fillOpacity={1} fill="url(#colorQueries)" />
                  <Area type="monotone" dataKey="blocked" stroke="#e63946" fillOpacity={1} fill="url(#colorBlocked)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
            <div className="domain-card">
              <div className="domain-list-header">TOP BLOCKED DOMAINS</div>
              <ul className="domain-list">
                {(stats.top_blocked || []).length === 0 && <li style={{color: '#888'}}>No blocked queries yet</li>}
                {(stats.top_blocked || []).map((item, i) => (
                  <li key={i} className="domain-list-item" onClick={() => openDomainModal(item.domain)}>
                    <span className="domain-rank">{i + 1}</span>
                    <DomainIcon domain={item.domain} />
                    <span className="domain-name" title={item.domain}>{item.domain}</span>
                    <span className="domain-count-blocked">{item.count}</span>
                    <span className="domain-chevron">&gt;</span>
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="domain-card">
              <div className="domain-list-header">MOST VISITED DOMAINS</div>
              <ul className="domain-list">
                {(stats.top_queried || []).length === 0 && <li style={{color: '#888'}}>No queries yet</li>}
                {(stats.top_queried || []).map((item, i) => (
                  <li key={i} className="domain-list-item" onClick={() => openDomainModal(item.domain)}>
                    <span className="domain-rank">{i + 1}</span>
                    <DomainIcon domain={item.domain} />
                    <span className="domain-name" title={item.domain}>{item.domain}</span>
                    <span className="domain-count-visited">{item.count}</span>
                    <span className="domain-chevron">&gt;</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Recent Queries</span>
              <span style={{ color: '#2ecc71', display: 'flex', alignItems: 'center', gap: '4px'}}><div style={{width: 6, height: 6, borderRadius: '50%', backgroundColor: '#2ecc71'}}></div> CONNECTED</span>
            </div>
            
            {logs.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                <Shield size={64} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                <h3>Waiting for your first DNS query...</h3>
                <p>Set up your device to point to 127.0.0.1:10053, then try visiting any website.</p>
              </div>
            ) : (
              <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Type</th>
                    <th>Action</th>
                    <th>Speed</th>
                    <th>Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(0, visibleLogs).map((log, i) => (
                    <tr key={i} style={{ cursor: 'pointer' }} onClick={() => openDomainModal(log.domain)}>
                      <td>
                        <div className="text-truncate" title={log.domain}>{log.domain}</div>
                      </td>
                      <td><span style={{color: '#888', fontSize: '0.7rem'}}>{log.type}</span></td>
                      <td>
                        <span className={log.action === 'BLOCKED' ? 'badge-blocked' : 'badge-allowed'}>
                          {log.action}
                        </span>
                      </td>
                      <td>{log.speed}</td>
                      <td>{log.seen.split('T')[1]?.split('Z')[0] || log.seen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length > visibleLogs && (
                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                  <button className="btn" onClick={() => setVisibleLogs(prev => prev + 15)}>
                    View More
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        </div>

        <div className="right-panel">
          <div className="card">
            <div className="card-header" style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
               <div style={{width: 24, height: 24, backgroundColor: '#e63946', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                 <ShieldAlert size={14} color="#fff" />
               </div>
               CONNECTION
            </div>
            <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid #2a2a2a', paddingBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '8px'}}>DNS Provider</label>
              <select 
                style={{ width: '100%', padding: '12px', backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '4px', color: '#e0e0e0', outline: 'none' }}
                value={config?.upstream_dns || "1.1.1.1:853,8.8.8.8:853"}
                onChange={(e) => updateUpstreamDNS(e.target.value)}
              >
                <optgroup label="Presets (Concurrent DoT)">
                  <option value="1.1.1.1:853,8.8.8.8:853">Automatic (Cloudflare + Google)</option>
                  <option value="1.1.1.1:853,9.9.9.9:853">Privacy Focus (Cloudflare + Quad9)</option>
                  <option value="9.9.9.9:853,94.140.14.14:853">Security Focus (Quad9 + AdGuard DNS)</option>
                  <option value="94.140.14.14:853,1.1.1.3:853">Filtering Focus (AdGuard DNS + Cloudflare Family)</option>
                </optgroup>
                <optgroup label="Specific Providers (DoT)">
                  <option value="8.8.8.8:853">Google Public DNS</option>
                  <option value="1.1.1.1:853">Cloudflare</option>
                  <option value="9.9.9.9:853">Quad9</option>
                  <option value="94.140.14.14:853">AdGuard DNS</option>
                </optgroup>
              </select>
              <p style={{fontSize: '0.7rem', color: '#888', marginTop: '8px', marginBottom: 0}}>
                {config?.upstream_dns === "1.1.1.1:853,9.9.9.9:853" ? "Uses Cloudflare + Quad9 securely (DoT)." :
                 config?.upstream_dns === "9.9.9.9:853,94.140.14.14:853" ? "Uses Quad9 + AdGuard DNS securely (DoT)." :
                 config?.upstream_dns === "94.140.14.14:853,1.1.1.3:853" ? "Uses AdGuard DNS + Cloudflare Family securely (DoT)." :
                 config?.upstream_dns === "8.8.8.8:853" ? "Uses Google Public DNS securely (DoT)." :
                 config?.upstream_dns === "1.1.1.1:853" ? "Uses Cloudflare securely (DoT)." :
                 config?.upstream_dns === "9.9.9.9:853" ? "Uses Quad9 securely (DoT)." :
                 config?.upstream_dns === "94.140.14.14:853" ? "Uses AdGuard DNS securely (DoT)." :
                 "Uses the fastest available secure route automatically."}
              </p>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '8px'}}>Local Device Address</label>
              <div style={{ padding: '12px', backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '4px', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>127.0.0.1:10053</span>
                <span style={{color: '#888'}}>UDP</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem' }}>
              <a href="ublockdns://enable" style={{ textDecoration: 'none', flex: 1 }}>
                <button className="btn btn-primary" style={{ width: '100%', backgroundColor: '#2ecc71', color: '#000' }}>ENABLE</button>
              </a>
              <a href="ublockdns://disable" style={{ textDecoration: 'none', flex: 1 }}>
                <button className="btn btn-primary" style={{ width: '100%', backgroundColor: '#e63946', color: '#fff' }}>DISABLE</button>
              </a>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#888', marginBottom: '1rem', marginTop: '-0.5rem', textAlign: 'center' }}>System DNS Toggle (Windows Only)</p>
            <button className="btn" style={{ width: '100%' }} onClick={() => setShowSettings(true)}>
              <Settings size={16} style={{marginRight: '8px', verticalAlign: 'middle'}}/> SETTINGS
            </button>
          </div>

          <div className="card">
            <div className="card-header" style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
               <div style={{width: 24, height: 24, backgroundColor: '#3498db', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                 <DownloadCloud size={14} color="#fff" />
               </div>
               BLOCKLIST UPDATER
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
              <span style={{color: '#888'}}>Next Update In:</span>
              <span style={{color: '#e0e0e0', fontWeight: 'bold'}}>{formatTimeUntil(updaterStatus?.nextUpdate)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
              <span style={{color: '#888'}}>Last Update:</span>
              <span style={{color: '#e0e0e0'}}>{formatLastUpdate(updaterStatus?.lastUpdate)}</span>
            </div>
            <button className="btn" style={{ width: '100%', backgroundColor: '#1a1a1a', border: '1px solid #333' }} onClick={forceUpdate}>
              FORCE UPDATE NOW
            </button>
          </div>

          <div className="card">
            <div className="card-header">Protection</div>
            
            <div style={{ display: 'flex', border: '1px solid #2a2a2a', borderRadius: '4px', overflow: 'hidden', marginBottom: '1.5rem' }}>
              <div onClick={() => updateUpstreamDNS('1.1.1.1:853,8.8.8.8:853')} style={{ flex: 1, padding: '8px', textAlign: 'center', borderRight: '1px solid #2a2a2a', cursor: 'pointer', backgroundColor: config?.upstream_dns === '1.1.1.1:853,8.8.8.8:853' ? '#e63946' : 'transparent' }}>Standard</div>
              <div onClick={() => updateUpstreamDNS('94.140.14.14:853,1.1.1.3:853')} style={{ flex: 1, padding: '8px', textAlign: 'center', borderRight: '1px solid #2a2a2a', cursor: 'pointer', backgroundColor: config?.upstream_dns === '94.140.14.14:853,1.1.1.3:853' ? '#e63946' : 'transparent' }}>Family</div>
              <div onClick={() => updateUpstreamDNS('9.9.9.9:853,94.140.14.14:853')} style={{ flex: 1, padding: '8px', textAlign: 'center', cursor: 'pointer', backgroundColor: config?.upstream_dns === '9.9.9.9:853,94.140.14.14:853' ? '#e63946' : 'transparent' }}>Strict</div>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '1.5rem' }}>Balanced protection for daily browsing.</p>

            <div className="card-header">Extra Protections</div>
            <div className="toggle-row">
              <div className="toggle-info">
                <h4>Adult content</h4>
                <p>Blocks adult and explicit domains.</p>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={config?.blocklists?.includes('https://nsfw.oisd.nl/') || false}
                  onChange={() => toggleList('https://nsfw.oisd.nl/')}
                />
                <span className="slider"></span>
              </label>
            </div>
            <div className="toggle-row">
              <div className="toggle-info">
                <h4>Gambling</h4>
                <p>Blocks betting, casinos, and gambling domains.</p>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={config?.blocklists?.includes('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.txt') || false}
                  onChange={() => toggleList('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.txt')}
                />
                <span className="slider"></span>
              </label>
            </div>
            <div className="toggle-row" style={{borderBottom: 'none'}}>
              <div className="toggle-info">
                <h4>Social apps</h4>
                <p>Blocks major social-network domains.</p>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={config?.blocklists?.includes('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/social.txt') || false}
                  onChange={() => toggleList('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/social.txt')}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="card-header" style={{marginTop: '1.5rem'}}>Settings</div>
            
            <div className="toggle-row" style={{ cursor: 'pointer' }} onClick={() => setShowExceptions(true)}>
              <div className="toggle-info">
                <h4 style={{color: '#e0e0e0'}}>Site Exceptions</h4>
                <p>{config?.custom_rules?.length || 0} rules</p>
              </div>
              <span style={{ color: '#888' }}>&gt;</span>
            </div>

            <div className="toggle-row" style={{ borderBottom: 'none', cursor: 'pointer' }} onClick={() => setShowAdvanced(true)}>
              <div className="toggle-info">
                <h4 style={{color: '#e0e0e0'}}>Advanced Lists</h4>
                <p>{config?.blocklists?.length || 0} lists enabled</p>
              </div>
              <span style={{ color: '#888' }}>&gt;</span>
            </div>
          </div>
        </div>
      </div>

      {selectedDomain && (
        <div className="modal-overlay" onClick={() => setSelectedDomain(null)}>
          <div className="modal-content" style={{maxWidth: '600px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 700, fontSize: '1.2rem' }}>
                <div style={{width: 32, height: 32, borderRadius: '50%', backgroundColor: '#e63946', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem'}}>
                  B
                </div>
                {selectedDomain}
              </div>
              <button className="close-btn" onClick={() => setSelectedDomain(null)}>X</button>
            </div>
            
            <div className="modal-body" style={{padding: '20px'}}>
              {/* Tags */}
              <div style={{display: 'flex', gap: '8px', marginBottom: '20px'}}>
                <span style={{fontSize: '0.7rem', color: '#888', border: '1px dashed #2a2a2a', padding: '4px 8px', borderRadius: '4px'}}>MY DEVICE</span>
                <span style={{fontSize: '0.7rem', color: '#888', border: '1px dashed #2a2a2a', padding: '4px 8px', borderRadius: '4px'}}>127.0.0.1</span>
              </div>

              {/* Stats Grid */}
              <div style={{display: 'flex', gap: '10px', marginBottom: '20px'}}>
                <div style={{flex: 1, backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', padding: '15px', borderRadius: '4px', textAlign: 'center'}}>
                  <h2 style={{margin: '0 0 10px 0'}}>{domainStats ? domainStats.queries : '...'}</h2>
                  <span style={{fontSize: '0.7rem', color: '#888'}}>QUERIES</span>
                </div>
                <div style={{flex: 1, backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', padding: '15px', borderRadius: '4px', textAlign: 'center', borderBottom: '2px solid #e63946'}}>
                  <h2 style={{margin: '0 0 10px 0'}}>{domainStats ? domainStats.blocked : '...'}</h2>
                  <span style={{fontSize: '0.7rem', color: '#888'}}>BLOCKED</span>
                </div>
                <div style={{flex: 1, backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', padding: '15px', borderRadius: '4px', textAlign: 'center'}}>
                  <h2 style={{margin: '0 0 10px 0'}}>{domainStats ? domainStats.block_rate.toFixed(1) : '...'}%</h2>
                  <span style={{fontSize: '0.7rem', color: '#888'}}>BLOCK RATE</span>
                </div>
              </div>

              {/* Domain Map */}
              <div style={{backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', padding: '15px', borderRadius: '4px', marginBottom: '20px', height: '200px', display: 'flex', flexDirection: 'column'}}>
                <span style={{fontSize: '0.8rem', color: '#888', marginBottom: 'auto'}}>DOMAIN MAP</span>
                <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, position: 'relative'}}>
                  <svg width="100%" height="100%" style={{position: 'absolute', top: 0, left: 0}}>
                    <line x1="50%" y1="30" x2="50%" y2="100" stroke={domainStats?.is_blocked ? "#e63946" : "#2ecc71"} strokeWidth="2" />
                  </svg>
                  <div style={{position: 'absolute', top: 10, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                    <div style={{width: 40, height: 40, borderRadius: '50%', border: '1px solid #888', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#151515', zIndex: 2}}>
                      <Shield size={20} color="#888"/>
                    </div>
                    <span style={{fontSize: '0.7rem', color: '#888', marginTop: 4, zIndex: 2, padding: '2px 6px', backgroundColor: '#0d0d0d', borderRadius: '4px'}}>My Device</span>
                  </div>
                  <div style={{position: 'absolute', top: 100, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                    <div style={{width: 40, height: 40, borderRadius: '50%', backgroundColor: '#fff', border: `2px solid ${domainStats?.is_blocked ? '#e63946' : '#2ecc71'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2}}>
                      <b style={{color: domainStats?.is_blocked ? '#e63946' : '#2ecc71'}}>{domainStats?.is_blocked ? 'B' : 'A'}</b>
                    </div>
                    <span style={{fontSize: '0.7rem', color: '#fff', marginTop: 4, zIndex: 2, padding: '2px 6px', backgroundColor: '#0d0d0d', borderRadius: '4px'}}>{selectedDomain.replace(/\.$/, '')}</span>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div style={{backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', padding: '15px', borderRadius: '4px', marginBottom: '20px'}}>
                <span style={{fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '10px'}}>LAST {timeframe > 72 ? `${timeframe/24} DAYS` : `${timeframe} HOURS`}</span>
                <div style={{ width: '100%', height: 150 }}>
                  <ResponsiveContainer>
                    <AreaChart data={domainChartData}>
                      <XAxis dataKey="time" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{backgroundColor: '#151515', borderColor: '#2a2a2a'}} />
                      <Area type="monotone" dataKey="blocked" stroke="#e63946" fillOpacity={0.1} fill="#e63946" />
                      <Area type="monotone" dataKey="queries" stroke="#888888" fillOpacity={0} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Attribution */}
              {domainStats?.is_blocked && (
                <div style={{backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', padding: '15px', borderRadius: '4px', marginBottom: '20px'}}>
                  <h3 style={{marginTop: 0, color: '#e63946', textTransform: 'uppercase'}}>{selectedDomain} IS BLOCKED</h3>
                  <p style={{fontSize: '0.8rem', color: '#888'}}>
                    Recent query history attributed blocked requests to this blocklist. This is a live config check.
                  </p>
                  <span style={{fontSize: '0.75rem', border: '1px dashed #2a2a2a', padding: '4px 8px', borderRadius: '4px', color: '#e0e0e0', display: 'inline-block'}}>
                    {domainStats.list_id > 0 && domainStats.list_id <= knownLists.length 
                      ? knownLists[domainStats.list_id - 1].name.toUpperCase() 
                      : (domainStats.list_id > knownLists.length ? "CUSTOM RULE" : "UNKNOWN")}
                  </span>
                </div>
              )}

              {/* Quick Actions */}
              <div style={{backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', padding: '15px', borderRadius: '4px'}}>
                <span style={{fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '10px'}}>QUICK ACTIONS</span>
                <div style={{display: 'flex', gap: '10px'}}>
                  <button className="btn" style={{flex: 1, backgroundColor: '#e63946', color: 'white', border: 'none'}} onClick={() => addCustomRule(selectedDomain, true)}>
                    <ShieldAlert size={16} style={{marginRight: 8, verticalAlign: 'middle'}}/> BLOCK
                  </button>
                  <button className="btn" style={{flex: 1}} onClick={() => addCustomRule(selectedDomain, false)}>
                    ALLOW
                  </button>
                </div>
                <p style={{fontSize: '0.7rem', color: '#888', marginTop: '10px', marginBottom: 0}}>
                  Rules apply to the domain and all its subdomains. Changes apply immediately on the next DNS lookup.
                </p>
              </div>

            </div>
          </div>
        </div>
      )}

      {showAdvanced && (
        <div className="modal-overlay" onClick={() => setShowAdvanced(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <ShieldAlert color="#e63946" size={20} />
                uBlockDNS Advanced Lists
              </div>
              <button className="close-btn" onClick={() => setShowAdvanced(false)}>X</button>
            </div>
            <div className="modal-body">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>RECOMMENDED DNS LISTS</span>
                <span>{config?.blocklists?.length || 0}/{knownLists.length}</span>
              </div>
              
              {knownLists.map((list, i) => (
                <div className="toggle-row" key={i}>
                  <div className="toggle-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <h4 style={{ margin: 0 }}>{list.name}</h4>
                      <span style={{ fontSize: '0.65rem', border: '1px solid #2a2a2a', padding: '2px 4px', borderRadius: '4px', color: '#888'}}>DNS-NATIVE</span>
                    </div>
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
          </div>
        </div>
      )}

      {showExceptions && (
        <div className="modal-overlay" onClick={() => setShowExceptions(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <ShieldAlert color="#e63946" size={20} />
                uBlockDNS Site Exceptions
              </div>
              <button className="close-btn" onClick={() => setShowExceptions(false)}>X</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', marginBottom: '1rem' }}>
                <input 
                  type="text" 
                  value={customRuleInput}
                  onChange={(e) => setCustomRuleInput(e.target.value)}
                  placeholder="Add domain... e.g. ||example.com^ or just example.com" 
                  style={{ flex: 1, padding: '12px', backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', color: 'white', borderTopLeftRadius: '4px', borderBottomLeftRadius: '4px', outline: 'none' }} 
                />
                <button 
                  className="btn" 
                  onClick={() => { addCustomRule(customRuleInput, true); setCustomRuleInput(''); }}
                  style={{ borderLeft: 'none', borderRadius: '0', backgroundColor: '#2a2a2a' }}
                >
                  BLOCK
                </button>
                <button 
                  className="btn" 
                  onClick={() => { addCustomRule(customRuleInput, false); setCustomRuleInput(''); }}
                  style={{ borderTopLeftRadius: '0', borderBottomLeftRadius: '0' }}
                >
                  ALLOW
                </button>
              </div>

              <div style={{ border: '1px dashed #2a2a2a', padding: '2rem', textAlign: 'center', color: '#888', borderRadius: '4px', marginBottom: '1rem' }}>
                {config?.custom_rules?.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, textAlign: 'left' }}>
                    {config.custom_rules.map((ruleStr, i) => {
                      const { domain, isAllowed, isEnabled, raw } = parseRuleForDisplay(ruleStr)
                      return (
                        <li key={i} style={{ padding: '12px 0', borderBottom: '1px solid #2a2a2a', color: '#e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: isEnabled ? 1 : 0.5 }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 'bold',
                              backgroundColor: isAllowed ? 'rgba(76, 175, 80, 0.2)' : 'rgba(230, 57, 70, 0.2)',
                              color: isAllowed ? '#4caf50' : '#e63946'
                            }}>
                              {isAllowed ? 'ALLOW' : 'BLOCK'}
                            </span>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', textDecoration: isEnabled ? 'none' : 'line-through' }}>{domain}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <label className="switch" style={{ transform: 'scale(0.8)', margin: 0 }}>
                              <input 
                                type="checkbox" 
                                checked={isEnabled}
                                onChange={() => toggleCustomRuleState(raw)}
                              />
                              <span className="slider round"></span>
                            </label>
                            <button onClick={() => removeCustomRule(raw)} style={{background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px'}} title="Delete Rule">
                              <X size={18} />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : "No custom rules yet"}
              </div>
              <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '1rem' }}>Custom rules override filter lists.</p>
              
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="btn" style={{ flex: 1 }}><DownloadCloud size={16} style={{marginRight: '8px', verticalAlign: 'middle'}}/> IMPORT</button>
                <button className="btn" style={{ flex: 1 }}>COPY ALL</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                <Settings color="#e0e0e0" size={20} />
                Global Settings
              </div>
              <button className="close-btn" onClick={() => setShowSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <form onSubmit={saveSettings}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '8px'}}>Upstream DNS Server</label>
                  <input 
                    name="upstream_dns"
                    type="text" 
                    defaultValue={config?.upstream_dns || ''}
                    placeholder="e.g. 1.1.1.1:53" 
                    style={{ width: '100%', padding: '12px', backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', color: 'white', borderRadius: '4px', outline: 'none' }} 
                  />
                  <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '8px' }}>The external DNS server used for resolving allowed domains.</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn" onClick={() => setShowSettings(false)}>CANCEL</button>
                  <button type="submit" className="btn btn-primary" style={{ backgroundColor: '#2ecc71', color: '#000' }}>SAVE CHANGES</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
