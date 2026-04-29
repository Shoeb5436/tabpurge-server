// server.js - TabPurge Analytics Server
// FIXED: UI now shows correct data from database

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname));

// Database setup
// Use Railway's persistent storage
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT || process.cwd();
const DB_PATH = path.join(DATA_DIR, 'tabpurge_analytics.db');

console.log(`📁 Database location: ${DB_PATH}`);

// Use this for database connection instead of just 'tabpurge_analytics.db'
const db = new sqlite3.Database(DB_PATH);



// ============ CREATE TABLES IF NOT EXISTS ============
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      anonymous_id TEXT PRIMARY KEY,
      first_seen TEXT,
      last_seen TEXT,
      total_events INTEGER DEFAULT 0,
      os_platform TEXT,
      language TEXT,
      timezone TEXT,
      extension_version TEXT,
      screen_width INTEGER DEFAULT 0,
      screen_height INTEGER DEFAULT 0,
      total_tabs_purged INTEGER DEFAULT 0,
      total_memory_saved_mb INTEGER DEFAULT 0,
      feature_purge_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Events table
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT,
      session_id TEXT,
      event_name TEXT,
      event_data TEXT,
      timestamp TEXT,
      extension_version TEXT,
      platform TEXT,
      screen_width INTEGER DEFAULT 0,
      screen_height INTEGER DEFAULT 0,
      tab_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Daily stats table
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      total_users INTEGER DEFAULT 0,
      new_users INTEGER DEFAULT 0,
      daily_active_users INTEGER DEFAULT 0,
      total_purges INTEGER DEFAULT 0,
      total_tabs_purged INTEGER DEFAULT 0,
      memory_saved_mb INTEGER DEFAULT 0
    )
  `);

  // Feature usage table
  db.run(`
    CREATE TABLE IF NOT EXISTS feature_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT,
      feature_name TEXT,
      usage_count INTEGER DEFAULT 1,
      last_used TEXT,
      UNIQUE(anonymous_id, feature_name)
    )
  `);

  console.log('✅ Database ready');
});

// ============ HELPER FUNCTIONS ============

// Force refresh daily stats from actual data
// Fix: Update ALL columns in daily_stats table
function refreshDailyStats() {
  const today = new Date().toISOString().split('T')[0];
  
  // Get total users
  db.get(`SELECT COUNT(*) as total FROM users`, (err, usersResult) => {
    if (err) {
      console.error('Error getting total users:', err);
      return;
    }
    const totalUsers = usersResult?.total || 0;
    
    // Get daily active users (users active in last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    db.get(`SELECT COUNT(DISTINCT anonymous_id) as dau FROM events WHERE datetime(created_at) > datetime(?)`, 
      [yesterday.toISOString()], (err2, dauResult) => {
      if (err2) {
        console.error('Error getting daily active:', err2);
        return;
      }
      const dailyActive = dauResult?.dau || 0;
      
      // Get new users today
      db.get(`SELECT COUNT(*) as new FROM users WHERE date(created_at) = ?`, 
        [today], (err3, newResult) => {
        if (err3) {
          console.error('Error getting new users:', err3);
          return;
        }
        const newUsers = newResult?.new || 0;
        
        // Get total tabs purged today
        db.get(`SELECT SUM(json_extract(event_data, '$.tab_count')) as tabs FROM events WHERE event_name = 'tabs_purged' AND date(created_at) = ?`, 
          [today], (err4, tabsResult) => {
          if (err4) {
            console.error('Error getting today\'s tabs:', err4);
            return;
          }
          const todayTabs = tabsResult?.tabs || 0;
          
          // Get total tabs purged all time
          db.get(`SELECT SUM(total_tabs_purged) as total_tabs FROM users`, (err5, totalTabsResult) => {
            const totalTabs = totalTabsResult?.total_tabs || 0;
            
            // Get total purges count for today
            db.get(`SELECT COUNT(*) as count FROM events WHERE event_name = 'tabs_purged' AND date(created_at) = ?`, 
              [today], (err6, purgeResult) => {
              const purgeCount = purgeResult?.count || 0;
              
              // Get memory saved
              const memorySaved = todayTabs * 95;
              
              // Update ALL columns in daily_stats
              db.run(`INSERT OR REPLACE INTO daily_stats 
                (date, total_users, new_users, daily_active_users, total_purges, total_tabs_purged, memory_saved_mb) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [today, totalUsers, newUsers, dailyActive, purgeCount, totalTabs, memorySaved], (err7) => {
                if (err7) {
                  console.error('Error updating daily_stats:', err7);
                } else {
                  console.log(`📊 Daily stats updated: ${totalUsers} users, ${dailyActive} active, ${totalTabs} total tabs`);
                }
              });
            });
          });
        });
      });
    });
  });
}

// ============ API ENDPOINTS ============

// 1. Track Event
app.post('/api/analytics/track', (req, res) => {
  const { 
    anonymous_id, 
    session_id, 
    event_name, 
    event_data, 
    timestamp, 
    extension_version, 
    platform, 
    language, 
    timezone,
    screen_width,
    screen_height,
    tab_count
  } = req.body;

  if (!anonymous_id || !event_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // Check if user exists
  db.get(`SELECT * FROM users WHERE anonymous_id = ?`, [anonymous_id], (err, existingUser) => {
    if (err) return;

    if (!existingUser) {
      // New user
      db.run(`INSERT INTO users (anonymous_id, first_seen, last_seen, total_events, extension_version, language, timezone, screen_width, screen_height) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [anonymous_id, now, now, extension_version, language, timezone, screen_width || 0, screen_height || 0]);
    } else {
      // Existing user
      db.run(`UPDATE users SET 
        last_seen = ?,
        total_events = total_events + 1,
        extension_version = ?,
        language = ?,
        timezone = ?
        WHERE anonymous_id = ?`,
        [now, extension_version, language, timezone, anonymous_id]);
    }

    // Insert event
    db.run(`INSERT INTO events (anonymous_id, session_id, event_name, event_data, timestamp, extension_version, platform, screen_width, screen_height, tab_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [anonymous_id, session_id, event_name, JSON.stringify(event_data || {}), timestamp || now, extension_version, platform || 'unknown', screen_width || 0, screen_height || 0, tab_count || 0]);

    // Update tabs purged count
    if (event_name === 'tabs_purged' && event_data?.tab_count) {
      const tabCount = event_data.tab_count;
      db.run(`UPDATE users SET 
        total_tabs_purged = total_tabs_purged + ?,
        total_memory_saved_mb = total_memory_saved_mb + ?,
        feature_purge_count = feature_purge_count + 1 
        WHERE anonymous_id = ?`,
        [tabCount, tabCount * 95, anonymous_id], (updateErr) => {
          if (!updateErr) {
            // Force refresh after update
            refreshDailyStats();
          }
        });
      
      console.log(`📊 Added ${tabCount} tabs for user`);
    }

    // Update feature usage
    if (event_name === 'feature_used' && event_data?.feature) {
      db.run(`INSERT INTO feature_usage (anonymous_id, feature_name, last_used) VALUES (?, ?, ?) ON CONFLICT(anonymous_id, feature_name) DO UPDATE SET usage_count = usage_count + 1, last_used = excluded.last_used`,
        [anonymous_id, event_data.feature, now]);
    }

    res.json({ success: true });
  });
});

// 2. Dashboard Stats - FIXED to show correct totals
app.get('/api/analytics/dashboard', (req, res) => {
  const stats = {};
  
  // Total users
  db.get(`SELECT COUNT(*) as total FROM users`, (err, users) => {
    if (err) {
      console.error('Error getting users:', err);
      return res.status(500).json({ error: err.message });
    }
    stats.total_users = users?.total || 0;
    
    // Daily active users (last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    db.get(`SELECT COUNT(DISTINCT anonymous_id) as dau FROM events WHERE datetime(created_at) > datetime(?)`, [yesterday.toISOString()], (err2, dau) => {
      stats.daily_active = dau?.dau || 0;
      
      // IMPORTANT: Get total tabs purged from users table SUM
      db.get(`SELECT SUM(total_tabs_purged) as total_tabs FROM users`, (err3, tabsResult) => {
        if (err3) {
          console.error('Error getting tabs:', err3);
          return res.status(500).json({ error: err3.message });
        }
        
        const totalTabs = tabsResult?.total_tabs || 0;
        stats.total_tabs_purged = totalTabs;
        
        //console.log(`📊 Dashboard: Total tabs purged = ${totalTabs}`);
        
        // Get total events
        db.get(`SELECT COUNT(*) as events FROM events`, (err4, events) => {
          stats.total_events = events?.events || 0;
          
          // Recent events
          db.all(`SELECT event_name, timestamp, event_data FROM events ORDER BY timestamp DESC LIMIT 20`, (err5, recent) => {
            stats.recent_events = recent || [];
            
            // Top features
            db.all(`SELECT feature_name, SUM(usage_count) as total_uses FROM feature_usage GROUP BY feature_name ORDER BY total_uses DESC LIMIT 10`, (err6, features) => {
              stats.top_features = features || [];
              res.json(stats);
            });
          });
        });
      });
    });
  });
});

// 3. Daily Stats for Charts
app.get('/api/analytics/daily', (req, res) => {
  db.all(`SELECT date, daily_active_users, total_tabs_purged FROM daily_stats ORDER BY date DESC LIMIT 30`, (err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ stats: stats || [] });
  });
});

// 4. All Users
app.get('/api/analytics/users', (req, res) => {
  db.all(`SELECT anonymous_id, first_seen, last_seen, total_events, total_tabs_purged, language, screen_width, screen_height, extension_version FROM users ORDER BY last_seen DESC LIMIT 100`, (err, users) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ users: users || [] });
  });
});

// 5. Single User Details
app.get('/api/analytics/user/:anonymousId', (req, res) => {
  db.get(`SELECT * FROM users WHERE anonymous_id = ?`, [req.params.anonymousId], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ user: user || null });
  });
});

// 6. User Features
app.get('/api/analytics/user/:anonymousId/features', (req, res) => {
  db.all(`SELECT feature_name, usage_count, last_used FROM feature_usage WHERE anonymous_id = ? ORDER BY usage_count DESC`, [req.params.anonymousId], (err, features) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ features: features || [] });
  });
});

// 7. All Events
app.get('/api/analytics/events/all', (req, res) => {
  db.all(`
    SELECT id, anonymous_id, event_name, event_data, timestamp, platform, screen_width, screen_height
    FROM events 
    ORDER BY timestamp DESC 
    LIMIT 500
  `, (err, events) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ events: events || [] });
  });
});

// 8. Database Summary - Direct from database
app.get('/api/db/summary', (req, res) => {
  const summary = {};
  
  db.get("SELECT COUNT(*) as count FROM users", (err, users) => { 
    summary.users = users?.count || 0;
    
    db.get("SELECT COUNT(*) as count FROM events", (err2, events) => { 
      summary.events = events?.count || 0;
      
      db.get("SELECT SUM(total_tabs_purged) as total_tabs FROM users", (err3, tabsResult) => { 
        summary.total_tabs_purged = tabsResult?.total_tabs || 0;
        console.log(`📊 DB Summary: total_tabs_purged = ${summary.total_tabs_purged}`);
        res.json(summary);
      });
    });
  });
});

// 9. RAW DATA - Direct from users table (for debugging)
app.get('/api/analytics/raw/users', (req, res) => {
  db.all(`SELECT anonymous_id, total_tabs_purged, total_events FROM users`, (err, users) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ users: users || [] });
  });
});

// 10. Create Test Data
app.get('/api/analytics/create-test-data', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  // Insert test user with 5 tabs purged
  db.run(`INSERT OR REPLACE INTO users (anonymous_id, first_seen, last_seen, total_events, total_tabs_purged, language) VALUES (?, ?, ?, ?, ?, ?)`,
    ['test_user_001', new Date().toISOString(), new Date().toISOString(), 10, 5, 'en-US'], (err) => {
      if (err) {
        console.error('Error creating test user:', err);
        return res.json({ success: false, error: err.message });
      }
      
      // Refresh stats
      refreshDailyStats();
      
      res.json({ success: true, message: 'Test user created with 5 tabs purged' });
    });
});

// 11. Test Server
app.get('/api/test', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'TabPurge Analytics Server Running',
    timestamp: new Date().toISOString()
  });
});

// 12. Serve Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ============ START SERVER ============
//const PORT = process.env.PORT || 3000;
  const PORT = process.env.PORT || 3000;

const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log('========================================');
    console.log('🚀 TabPurge Analytics Server Running');
    console.log(`📍 http://localhost:${port}`);
    // Initial refresh
    refreshDailyStats();
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${port} busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
};

startServer(PORT);