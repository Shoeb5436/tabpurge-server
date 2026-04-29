const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public')); // Change 'public' to your static files folder name

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'tabpurge-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Dashboard password - UPDATE THIS
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

// ============================================
// LOGIN PAGE
// ============================================
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login - TabPurge Dashboard</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .login-container {
                    background: white;
                    padding: 2.5rem;
                    border-radius: 16px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    width: 90%;
                    max-width: 400px;
                }
                h1 {
                    color: #333;
                    margin-bottom: 0.5rem;
                    font-size: 1.8rem;
                }
                .subtitle {
                    color: #666;
                    margin-bottom: 2rem;
                    font-size: 0.9rem;
                }
                input {
                    width: 100%;
                    padding: 12px;
                    margin: 10px 0;
                    border: 2px solid #e0e0e0;
                    border-radius: 8px;
                    font-size: 16px;
                    transition: border-color 0.3s;
                }
                input:focus {
                    outline: none;
                    border-color: #667eea;
                }
                button {
                    width: 100%;
                    padding: 12px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    margin-top: 20px;
                    transition: background 0.3s;
                }
                button:hover {
                    background: #5a67d8;
                }
                .error {
                    background: #fee;
                    color: #c33;
                    padding: 10px;
                    border-radius: 8px;
                    margin-top: 15px;
                    text-align: center;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <h1>🔐 TabPurge</h1>
                <div class="subtitle">Enter password to access analytics dashboard</div>
                <form action="/auth/login" method="POST">
                    <input type="password" name="password" placeholder="Dashboard password" required autofocus>
                    <button type="submit">Access Dashboard →</button>
                </form>
                <div id="errorMsg" class="error" style="display: none;"></div>
            </div>
            <script>
                // Show error if redirected with error param
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.get('error')) {
                    const errorDiv = document.getElementById('errorMsg');
                    errorDiv.textContent = '❌ Invalid password. Please try again.';
                    errorDiv.style.display = 'block';
                }
            </script>
        </body>
        </html>
    `);
});

// ============================================
// HANDLE LOGIN SUBMISSION
// ============================================
app.post('/auth/login', (req, res) => {
    const { password } = req.body;
    
    if (password === DASHBOARD_PASSWORD) {
        req.session.authenticated = true;
        res.redirect('/dashboard.html');
    } else {
        res.redirect('/login?error=1');
    }
});

// ============================================
// LOGOUT ROUTE
// ============================================
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ============================================
// PROTECT YOUR DASHBOARD PAGE
// ============================================
app.get('/dashboard.html', requireAuth);

// ============================================
// PROTECT YOUR EXISTING API ENDPOINTS
// ============================================
// Add this to any API route that provides data to dashboard
// Example:
/*
app.get('/api/users', requireAuth, (req, res) => {
    // Your existing API code here
});

app.get('/api/events', requireAuth, (req, res) => {
    // Your existing API code here
});
*/

// ============================================
// YOUR EXISTING ROUTES GO HERE
// ============================================
// Keep all your existing app.get(), app.post() routes below
// Just add 'requireAuth' middleware to protect them

// Example of protecting existing routes:
// OLD: app.get('/get-users', yourFunction);
// NEW: app.get('/get-users', requireAuth, yourFunction);

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`🔐 Dashboard password is: ${DASHBOARD_PASSWORD}`);
    console.log(`📊 Access dashboard at: http://localhost:${PORT}/dashboard.html`);
    console.log(`🔑 Login page: http://localhost:${PORT}/login`);
});