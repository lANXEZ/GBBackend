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

// Auth Middleware
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

app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM User WHERE UserID = ?', [req.user.id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        
        const user = rows[0];
        delete user.Password; // Remove sensitive information before sending to frontend
        
        res.status(200).json(user);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch user profile" });
    }
});

app.post('/api/workout/create-exercise', authenticateToken, async (req, res) => {
    try {
        const { steps, description, caution, url, accessibility, record_type, progress_type } = req.body;
        
        if (!steps || !description || !accessibility || !record_type || !progress_type) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const [result] = await db.query(
            'INSERT INTO ExerciseMoves (Steps, Description, Caution, URL, Accessibility, UserID, RecordType, ProgressType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [steps, description, caution || null, url || null, accessibility, req.user.id, record_type, progress_type]
        );
        
        res.status(201).json({ message: "Exercise created successfully", ex_move_id: result.insertId });
    } catch (e) {
        console.error("Failed to create exercise:", e);
        res.status(500).json({ error: "Failed to create exercise" });
    }
});

app.get('/api/workout/fetch-public-exercise-move', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM ExerciseMoves WHERE Accessibility = "public"');
        res.status(200).json(rows);
    } catch (e) {
        console.error("Failed to fetch public exercises:", e);
        res.status(500).json({ error: "Failed to fetch public exercises" });
    }
});

app.post('/api/workout/save', authenticateToken, async (req, res) => {
    try {
        const { workout_type, weight, reps, date, time } = req.body;
        
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

        // Check if Session already exists today for this User and Exercise
        const sessionDateStr = d.toISOString().split('T')[0];
        const [existingSession] = await db.query(
            'SELECT SessionID FROM Session WHERE UserID = ? AND ExMoveID = ? AND SessionDate = ? LIMIT 1',
            [req.user.id, exMoveID, sessionDateStr]
        );

        let sessionID;
        if (existingSession.length > 0) {
            sessionID = existingSession[0].SessionID;
        } else {
            // Insert new Session if none exists
            const [sessionResult] = await db.query(
                'INSERT INTO Session (UserID, WorkingDayID, ExMoveID, SessionDate) VALUES (?, ?, ?, ?)', 
                [req.user.id, workingDayID, exMoveID, sessionDateStr]
            );
            sessionID = sessionResult.insertId;
        }
        
        // Insert PersonalRecord
        const [prResult] = await db.query('INSERT INTO PersonalRecord (SessionID, Weight, Rep, Time) VALUES (?, ?, ?, ?)', [sessionID, weight || null, reps || null, time || null]);
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
            SELECT pr.PRID as workout_id, s.UserID as user_id, em.Description as workout_type, pr.Weight as weight, pr.Rep as reps, pr.Time as time, d.Day as day, s.SessionDate as date
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

app.get('/api/workout/today-completed', authenticateToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [rows] = await db.query(
            'SELECT DISTINCT ExMoveID FROM Session WHERE UserID = ? AND SessionDate = ?',
            [req.user.id, today]
        );
        const completedIds = rows.map(row => row.ExMoveID);
        res.status(200).json(completedIds);
    } catch (e) {
        console.error("Failed to fetch today completed:", e);
        res.status(500).json({ error: "Failed to fetch today's completed workouts" });
    }
});

app.get('/api/workout/recent-plan', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT wp.PlanID 
            FROM Session s
            JOIN WorkoutRoutine wr ON s.WorkingDayID = wr.WorkingDayID
            JOIN WorkoutPlan wp ON wr.PlanID = wp.PlanID
            WHERE s.UserID = ? AND wp.UserID = ?
            ORDER BY s.SessionDate DESC, s.SessionID DESC
            LIMIT 1;
        `;
        const [rows] = await db.query(query, [req.user.id, req.user.id]);
        
        if (rows.length === 0) {
            return res.status(200).json({ plan_id: null, message: "No recent workout plan found" });
        }

        res.status(200).json({ plan_id: rows[0].PlanID });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch recent workout plan id" });
    }
});

app.post('/api/workout-plan/create', authenticateToken, async (req, res) => {
    const conn = await db.getConnection();
    try {
        const { plan_name, type, provider_id, days } = req.body;
        
        if (!plan_name || !days || !Array.isArray(days)) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        await conn.beginTransaction();

        // 1. Insert WorkoutPlan
        const [planResult] = await conn.query(
            'INSERT INTO WorkoutPlan (PlanName, UserID, Type, ProviderID) VALUES (?, ?, ?, ?)',
            [plan_name, req.user.id, type || 'C', provider_id || null]
        );
        const planID = planResult.insertId;

        // 2. Loop through days and add WorkoutRoutine and ExerciseList
        for (const day of days) {
            const dayIndex = day.day; 
            const exercises = day.exercises; // array of { ex_move_id }

            if (!exercises || exercises.length === 0) continue;

            // Always create a new WorkingDay record for this plan to isolate its ExerciseList
            const [newDay] = await conn.query('INSERT INTO WorkingDay (Day) VALUES (?)', [dayIndex]);
            const workingDayID = newDay.insertId;

            // Link Plan to WorkingDay
            await conn.query(
                'INSERT INTO WorkoutRoutine (PlanID, WorkingDayID) VALUES (?, ?)',
                [planID, workingDayID]
            );

            // Add exercises to ExerciseList for this WorkingDay
            for (const ex of exercises) {
                await conn.query(
                    'INSERT IGNORE INTO ExerciseList (WorkingDayID, ExMoveID) VALUES (?, ?)',
                    [workingDayID, ex.ex_move_id]
                );
            }
        }

        await conn.commit();
        res.status(201).json({ message: "Workout plan created successfully", plan_id: planID });
    } catch (e) {
        await conn.rollback();
        console.error("Failed to create workout plan:", e);
        res.status(500).json({ error: "Failed to create workout plan" });
    } finally {
        conn.release();
    }
});

app.get('/api/workout-plan', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                wp.PlanID, 
                wp.PlanName, 
                wr.WorkingDayID,
                d.Day,
                em.ExMoveID, 
                em.Description AS ExerciseName
            FROM WorkoutPlan wp
            LEFT JOIN WorkoutRoutine wr ON wp.PlanID = wr.PlanID
            LEFT JOIN WorkingDay d ON wr.WorkingDayID = d.WorkingDayID
            LEFT JOIN ExerciseList el ON wr.WorkingDayID = el.WorkingDayID
            LEFT JOIN ExerciseMoves em ON el.ExMoveID = em.ExMoveID
            WHERE wp.UserID = ?
        `;
        const [rows] = await db.query(query, [req.user.id]);
        
        // Group by Plan
        const plansMap = {};
        rows.forEach(row => {
            if (!plansMap[row.PlanID]) {
                plansMap[row.PlanID] = {
                    plan_id: row.PlanID,
                    plan_name: row.PlanName,
                    days: []
                };
            }
            if (row.WorkingDayID) {
                let dayEntry = plansMap[row.PlanID].days.find(d => d.working_day_id === row.WorkingDayID);
                if (!dayEntry) {
                    dayEntry = {
                        working_day_id: row.WorkingDayID,
                        day: row.Day,
                        exercises: []
                    };
                    plansMap[row.PlanID].days.push(dayEntry);
                }
                
                if (row.ExMoveID) {
                    const exerciseExists = dayEntry.exercises.find(e => e.ex_move_id === row.ExMoveID);
                    if (!exerciseExists) {
                        dayEntry.exercises.push({
                            ex_move_id: row.ExMoveID,
                            name: row.ExerciseName
                        });
                    }
                }
            }
        });

        const result = Object.values(plansMap);
        res.status(200).json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch workout plans" });
    }
});

app.get('/api/workout/exercise/:id', authenticateToken, async (req, res) => {
    try {
        const exMoveID = req.params.id;
        const [rows] = await db.query('SELECT * FROM ExerciseMoves WHERE ExMoveID = ?', [exMoveID]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "Exercise not found" });
        }
        
        res.status(200).json(rows[0]);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch exercise details" });
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