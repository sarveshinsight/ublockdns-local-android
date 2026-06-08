import { useState, useEffect } from 'react'
import { Shield, ShieldAlert, Settings, LogOut, DownloadCloud } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import './index.css'

export default function App() {
  const [stats, setStats] = useState({ total_queries: 0, blocked: 0, block_rate: 0 })
  const [logs, setLogs] = useState([])
  const [config, setConfig] = useState(null)
  
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showExceptions, setShowExceptions] = useState(false)

  const fetchData = async () => {
    try {
      const statsRes = await fetch('/api/stats')
      if (statsRes.ok) setStats(await statsRes.json())

      const logsRes = await fetch('/api/logs')
      if (logsRes.ok) setLogs(await logsRes.json())
      
      if (!config) {
        const configRes = await fetch('/api/config')
        if (configRes.ok) setConfig(await configRes.json())
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

  // Generate fake chart data since we don't store historical timeseries in backend right now
  const chartData = [
    { time: '11:30 PM', queries: 10, blocked: 2 },
    { time: '03:30 AM', queries: 5, blocked: 1 },
    { time: '07:30 AM', queries: 25, blocked: 8 },
    { time: '11:30 AM', queries: Math.max(0, stats.total_queries - 20), blocked: Math.max(0, stats.blocked - 5) },
    { time: 'Now', queries: stats.total_queries, blocked: stats.blocked },
  ]

  const knownLists = [
    { name: "HaGeZi Multi NORMAL", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/normal.txt", desc: "Balanced DNS-native ads and tracker blocking" },
    { name: "HaGeZi Multi PRO", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt", desc: "Stricter DNS-native blocking" },
    { name: "OISD Big", url: "https://big.oisd.nl/", desc: "Broad DNS-native blocklist" },
    { name: "HaGeZi Threat Intelligence Feed", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.txt", desc: "DNS-native malware, phishing, scam" },
    { name: "Steven Black's Unified Hosts", url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts", desc: "Comprehensive malware and adware domain blocklist" },
    { name: "Phishing URL Blocklist", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/phishing.txt", desc: "Blocks known phishing and scam websites" }
  ]

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
            <div className="card-header">Activity</div>
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
                  {logs.slice(0, 10).map((log, i) => (
                    <tr key={i}>
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
            )}
          </div>
        </div>

        <div className="right-panel">
          <div className="card">
            <div className="card-header">Account</div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '8px'}}>Local Device Address</label>
              <div style={{ padding: '12px', backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '4px', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>127.0.0.1:10053</span>
                <span style={{color: '#888'}}>UDP</span>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }}>CONNECT DEVICE</button>
            <button className="btn" style={{ width: '100%' }}><Settings size={16} style={{marginRight: '8px', verticalAlign: 'middle'}}/> SETTINGS</button>
          </div>

          <div className="card">
            <div className="card-header">Protection</div>
            
            <div style={{ display: 'flex', border: '1px solid #2a2a2a', borderRadius: '4px', overflow: 'hidden', marginBottom: '1.5rem' }}>
              <div style={{ flex: 1, padding: '8px', textAlign: 'center', borderRight: '1px solid #2a2a2a', cursor: 'pointer', backgroundColor: '#e63946' }}>Standard</div>
              <div style={{ flex: 1, padding: '8px', textAlign: 'center', borderRight: '1px solid #2a2a2a', cursor: 'pointer' }}>Family</div>
              <div style={{ flex: 1, padding: '8px', textAlign: 'center', cursor: 'pointer' }}>Strict</div>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '1.5rem' }}>Balanced protection for daily browsing.</p>

            <div className="card-header">Extra Protections</div>
            <div className="toggle-row">
              <div className="toggle-info">
                <h4>Adult content</h4>
                <p>Blocks adult and explicit domains.</p>
              </div>
              <label className="switch">
                <input type="checkbox" />
                <span className="slider"></span>
              </label>
            </div>
            <div className="toggle-row">
              <div className="toggle-info">
                <h4>Gambling</h4>
                <p>Blocks betting, casinos, and gambling domains.</p>
              </div>
              <label className="switch">
                <input type="checkbox" />
                <span className="slider"></span>
              </label>
            </div>
            <div className="toggle-row" style={{borderBottom: 'none'}}>
              <div className="toggle-info">
                <h4>Social apps</h4>
                <p>Blocks major social-network domains.</p>
              </div>
              <label className="switch">
                <input type="checkbox" />
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
                <input type="text" placeholder="Add domain... e.g. ||example.com^" style={{ flex: 1, padding: '12px', backgroundColor: '#0d0d0d', border: '1px solid #2a2a2a', color: 'white', borderTopLeftRadius: '4px', borderBottomLeftRadius: '4px', outline: 'none' }} />
                <button className="btn" style={{ borderLeft: 'none', borderRadius: '0', backgroundColor: '#2a2a2a' }}>BLOCK</button>
                <button className="btn" style={{ borderTopLeftRadius: '0', borderBottomLeftRadius: '0' }}>ALLOW</button>
              </div>

              <div style={{ border: '1px dashed #2a2a2a', padding: '2rem', textAlign: 'center', color: '#888', borderRadius: '4px', marginBottom: '1rem' }}>
                {config?.custom_rules?.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, textAlign: 'left' }}>
                    {config.custom_rules.map((rule, i) => (
                      <li key={i} style={{ padding: '8px 0', borderBottom: '1px solid #2a2a2a', color: '#e0e0e0' }}>{rule}</li>
                    ))}
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
    </>
  )
}
