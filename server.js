const express = require('express');
const cors = require('cors');
const { createCanvas } = require('canvas'); // <--- The library for drawing

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['https://gym-bro-pink.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());

const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_gymbro_key';

// Mock Auth Middleware -> Real Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(401).json({ error: "Unauthorized" });
        req.user = user;
        next();
    });
};

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Query database
        const [rows] = await db.query('SELECT * FROM User WHERE Username = ? AND Password = ?', [username, password]);
        
        if (rows.length > 0) {
            const user = rows[0];
            
            // Map status to role
            let role = 'gymgoer';
            if (user.Status === 'trainer') role = 'trainer';
            else if (user.Status === 'training client') role = 'training_client';
            
            // Generate JWT token
            const payload = { id: user.UserID, username: user.Username, role: role };
            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

            res.status(200).json({ 
                auth_token: token, 
                user: payload 
            });
        } else {
            res.status(401).json({ error: "Unauthorized (Wrong password or username)" });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Something went wrong. Please try again later." });
    }
});

app.post('/api/workout/save', authenticateToken, async (req, res) => {
    try {
        const { workout_type, weight, reps, date } = req.body;
        
        // Find Exercise Moves ID (assuming workout_type matches Description loosely)
        const [exRows] = await db.query('SELECT ExMoveID FROM ExerciseMoves WHERE Description = ? LIMIT 1', [workout_type]);
        let exMoveID = exRows.length > 0 ? exRows[0].ExMoveID : 1; // Default to 1 if not found
        
        // Calculate WorkingDayID based on date (0-6 mapping in DB schema is Mon-Sun)
        const d = date ? new Date(date) : new Date();
        let dayOfWeek = d.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
        // Map JS getDay (Sun=0, Mon=1) to DB Day (schema implies 0=Monday, wait, schema comment says "0-6 representing Monday-Sunday")
        let dbDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        
        const [dayRows] = await db.query('SELECT WorkingDayID FROM WorkingDay WHERE Day = ? LIMIT 1', [dbDay]);
        let workingDayID = dayRows.length > 0 ? dayRows[0].WorkingDayID : 1; // Default to 1

        // Insert Session
        const sessionDateStr = d.toISOString().split('T')[0];
        const [sessionResult] = await db.query('INSERT INTO Session (UserID, WorkingDayID, ExMoveID, SessionDate) VALUES (?, ?, ?, ?)', [req.user.id, workingDayID, exMoveID, sessionDateStr]);
        const sessionID = sessionResult.insertId;
        
        // Insert PersonalRecord
        const [prResult] = await db.query('INSERT INTO PersonalRecord (SessionID, Weight, Rep, Time) VALUES (?, ?, ?, ?)', [sessionID, weight || null, reps || null, null]);
        const prID = prResult.insertId;
        
        res.status(201).json({ workout_id: prID });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to save workout" });
    }
});

app.get('/api/workout/fetch', authenticateToken, async (req, res) => {
    try {
        const { workout_type, limit } = req.query;
        let query = `
            SELECT pr.PRID as workout_id, s.UserID as user_id, em.Description as workout_type, pr.Weight as weight, pr.Rep as reps, d.Day as day, s.SessionDate as date
            FROM PersonalRecord pr
            JOIN Session s ON pr.SessionID = s.SessionID
            JOIN ExerciseMoves em ON s.ExMoveID = em.ExMoveID
            JOIN WorkingDay d ON s.WorkingDayID = d.WorkingDayID
            WHERE s.UserID = ?
        `;
        const params = [req.user.id];

        if (workout_type) {
            query += ` AND em.Description = ?`;
            params.push(workout_type);
        }

        query += ` ORDER BY pr.PRID DESC`;
        
        if (limit) {
            query += ` LIMIT ?`;
            params.push(parseInt(limit));
        }

        const [rows] = await db.query(query, params);
        
        res.status(200).json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch workouts" });
    }
});

app.get('/api/workout/is-struggle', authenticateToken, async (req, res) => {
    try {
        const { workout_type } = req.query;
        // Basic struggle logic replaced with DB queries
        const [rows] = await db.query(`
            SELECT pr.Rep 
            FROM PersonalRecord pr
            JOIN Session s ON pr.SessionID = s.SessionID
            JOIN ExerciseMoves em ON s.ExMoveID = em.ExMoveID
            WHERE s.UserID = ? AND em.Description = ?
            ORDER BY pr.PRID DESC LIMIT 5
        `, [req.user.id, workout_type || '']);
        
        if (rows.length < 5) return res.status(400).json({ error: "Insufficient Data" });
        
        let totalReps = 0;
        rows.forEach(r => totalReps += (r.Rep || 0));
        const avgReps = totalReps / rows.length;
        
        res.status(200).json({ struggling: avgReps < 5 });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: "Failed to get struggle status" });
    }
});

app.post('/api/payment/process', authenticateToken, (req, res) => {
    const { amount, source_token, currency = "THB" } = req.body;
    if (amount < 0 || !source_token) return res.status(400).json({ error: "Bad Request" });
    if (source_token === "tok_decline") return res.status(402).json({ error: "Payment Required" });
    res.status(200).json({ status: "success", receipt: "rect_123" });
});

app.get('/api/workout/performance-graph', authenticateToken, async (req, res) => {
    const { workout_type, limit } = req.query;
    if (!workout_type) return res.status(400).json({ error: "Bad Request. Missing workout_type." });
    
    try {
        const [rows] = await db.query(`
            SELECT pr.PRID 
            FROM PersonalRecord pr
            JOIN Session s ON pr.SessionID = s.SessionID
            JOIN ExerciseMoves em ON s.ExMoveID = em.ExMoveID
            WHERE s.UserID = ? AND em.Description = ?
        `, [req.user.id, workout_type]);

        if (rows.length < 2) return res.status(404).json({ error: "Not Found. Not enough data." });

        const width = 800;
        const height = 400;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${workout_type} Performance`, width / 2, 50);

        const buffer = canvas.toBuffer('image/png');
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: "Failed to generate image" });
    }
});

// The Endpoint
app.post('/api/generate-image', authenticateToken, async (req, res) => {
    try {
        console.log("Received request:", req.body);

        const { PRID } = req.body;
        if (!PRID) return res.status(400).json({ error: "Missing PRID" });

        // 1. Get data from the database using PRID
        const [rows] = await db.query(`
            SELECT pr.Weight, pr.Rep, pr.Time, em.Description 
            FROM PersonalRecord pr
            JOIN Session s ON pr.SessionID = s.SessionID
            JOIN ExerciseMoves em ON s.ExMoveID = em.ExMoveID
            WHERE pr.PRID = ? AND s.UserID = ?
        `, [PRID, req.user.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Record not found or unauthorized" });
        }

        const record = rows[0];
        
        if (record.Weight == null && record.Rep == null && record.Time == null) {
            return res.status(400).json({ error: "No record data available to display" });
        }

        let mainStat = "";
        let subStat = "";

        if (record.Weight == null && record.Rep == null) {
            mainStat = `${record.Time}s`;
            subStat = "Time";
        } else {
            mainStat = record.Weight ? `${record.Weight} kg` : "Bodyweight";
            subStat = record.Rep ? `Reps: ${record.Rep}` : "";
        }

        const workoutName = record.Description ? record.Description.toUpperCase() : "MY WORKOUT";
        
        // 2. Setup the Canvas (1080x1920 is IG Story Resolution)
        const width = 1080;
        const height = 1920;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // --- DRAWING SECTION ---

        // A. Background Color (Let's make it a cool dark grey)
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // B. Add a decorative box in the middle
        ctx.fillStyle = '#2d2d2d';
        ctx.fillRect(100, 600, 880, 720);

        // C. Draw the Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 80px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(workoutName, width / 2, 750);

        // D. Draw the Stats (Big and Orange)
        ctx.fillStyle = '#FC4C02'; // Strava Orange
        ctx.font = 'bold 120px sans-serif';
        ctx.fillText(mainStat, width / 2, 950);
        
        if (subStat) {
            ctx.fillStyle = '#aaaaaa';
            ctx.font = '50px sans-serif';
            ctx.fillText(subStat, width / 2, 1100);
        }

        // --- SENDING SECTION ---

        // 3. Convert the canvas to a Buffer (raw image data)
        const buffer = canvas.toBuffer('image/png');

        // 4. Tell the browser "Hey, this is an IMAGE, not text!"
        res.set('Content-Type', 'image/png');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to generate image" });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;