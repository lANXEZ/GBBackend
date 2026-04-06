const express = require('express');
const cors = require('cors');
const { createCanvas } = require('@napi-rs/canvas'); // <--- The library for drawing

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['https://gym-bro-pink.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());

const jwt = require('jsonwebtoken');
const db = require('./db');
const bcrypt = require('bcrypt');

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
        const [rows] = await db.query('SELECT * FROM User WHERE Username = ?', [username]);
        
        if (rows.length > 0) {
            const user = rows[0];
            const match = await bcrypt.compare(password, user.Password);

            if (match) {
                // Map status to role
                let role = 'gymgoer';
                if (user.Status === 'trainer') role = 'trainer';
                else if (user.Status === 'training client') role = 'training_client';
                else if (user.Status === 'admin') role = 'admin';
                
                // Generate JWT token
                const payload = { id: user.UserID, username: user.Username, role: role, FirstName: user.FirstName, LastName: user.LastName };
                const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

                res.status(200).json({ 
                    auth_token: token, 
                    user: payload 
                });
            } else {
                res.status(401).json({ error: "Unauthorized (Wrong password or username)" });
            }
        } else {
            res.status(401).json({ error: "Unauthorized (Wrong password or username)" });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Something went wrong. Please try again later." });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, password, firstName, lastName, birthdate } = req.body;
        
        if (!username || !password || !firstName || !lastName || !birthdate) {
            return res.status(400).json({ error: "All fields are required" });
        }

        // Check if username already exists
        const [existing] = await db.query('SELECT UserID FROM User WHERE Username = ?', [username]);
        if (existing.length > 0) {
            return res.status(409).json({ error: "Username already exists" });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert new user with hashed password and 'user' status
        const [result] = await db.query(
            'INSERT INTO User (Username, Password, FirstName, LastName, DoB, Status) VALUES (?, ?, ?, ?, ?, ?)',
            [username, hashedPassword, firstName, lastName, birthdate, 'user']
        );
        
        // Generate JWT token so they are logged in immediately
        const payload = { id: result.insertId, username: username, role: 'gymgoer', FirstName: firstName, LastName: lastName };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

        res.status(201).json({ 
            message: "User created successfully",
            auth_token: token,
            user: payload
        });
    } catch (e) {
        console.error("Failed to register user:", e);
        res.status(500).json({ error: "Failed to register user" });
    }
});

app.post('/api/user/unsubscribe', authenticateToken, async (req, res) => {
    const conn = await db.getConnection();
    try {
        const userId = req.user.id;
        await conn.beginTransaction();

        await conn.query('UPDATE User SET Status = ? WHERE UserID = ?', ['user', userId]);
        await conn.query('DELETE FROM traininglist WHERE ClientID = ?', [userId]);
        await conn.query('UPDATE WorkoutPlan SET Type = ? WHERE UserID = ? AND Type = ?', ['G', userId, 'P']);

        await conn.commit();
        res.status(200).json({ message: "Unsubscribed successfully" });
    } catch (e) {
        await conn.rollback();
        console.error("Failed to unsubscribe:", e);
        res.status(500).json({ error: "Failed to unsubscribe" });
    } finally {
        conn.release();
    }
});

app.post('/api/user/change-password', async (req, res) => {
    try {
        const { username, birthdate, newPassword } = req.body;
        
        if (!username || !birthdate || !newPassword) {
            return res.status(400).json({ error: "All fields are required" });
        }

        // Query database to check if username and DoB match
        const [rows] = await db.query('SELECT UserID, TO_CHAR(DoB, \'YYYY-MM-DD\') AS DoBString FROM User WHERE Username = ?', [username]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        
        const user = rows[0];
        
        // Safely extract the YYYY-MM-DD part from the birthdate input
        const userDoB = user.DoBString;
        const inputDoB = typeof birthdate === 'string' ? birthdate.split('T')[0] : new Date(birthdate).toISOString().split('T')[0];

        if (userDoB !== inputDoB) {
            return res.status(401).json({ error: "Incorrect Date of Birth" });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        await db.query('UPDATE User SET Password = ? WHERE UserID = ?', [hashedPassword, user.UserID]);

        res.status(200).json({ message: "Password changed successfully" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to change password" });
    }
});

app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const targetUserId = req.query.user_id || req.user.id;
        const [rows] = await db.query('SELECT * FROM User WHERE UserID = ?', [targetUserId]);
        
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

app.get('/api/coach/clients', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT u.UserID, u.Username, u.FirstName, u.LastName, u.Status
            FROM User u
            JOIN traininglist tl ON u.UserID = tl.ClientID
            WHERE tl.TrainerID = ?
        `;
        const [rows] = await db.query(query, [req.user.id]);
        res.status(200).json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch clients" });
    }
});

app.post('/api/coach/invite', authenticateToken, async (req, res) => {
    try {
        const { client_id, username } = req.body;
        
        if (!client_id || !username) {
            return res.status(400).json({ error: "Client ID and username are required" });
        }

        // Verify the client exists
        const [users] = await db.query('SELECT UserID, Status FROM User WHERE UserID = ? AND Username = ?', [client_id, username]);
        
        if (users.length === 0) {
            return res.status(404).json({ error: "User not found or username doesn't match ID" });
        }
        
        const client = users[0];
        
        // Ensure user is not a normal gymgoer
        if (client.Status === 'user') {
            return res.status(403).json({ error: "Cannot add a normal gymgoer. They must upgrade their account first." });
        }

        // Check if already in the list
        const [existing] = await db.query('SELECT * FROM traininglist WHERE TrainerID = ? AND ClientID = ?', [req.user.id, client_id]);
        if (existing.length > 0) {
            return res.status(409).json({ error: "Client is already in your training list" });
        }

        // Insert into traininglist
        await db.query('INSERT INTO traininglist (TrainerID, ClientID) VALUES (?, ?)', [req.user.id, client_id]);
        
        res.status(201).json({ message: "Client added successfully" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to invite client" });
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
        const [rows] = await db.query("SELECT * FROM ExerciseMoves WHERE Accessibility = 'public'");
        res.status(200).json(rows);
    } catch (e) {
        console.error("Failed to fetch public exercises:", e);
        res.status(500).json({ error: "Failed to fetch public exercises" });
    }
});

app.get('/api/workout/exercises', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM ExerciseMoves WHERE Accessibility = 'public' OR UserID = ?", [req.user.id]);
        res.status(200).json(rows);
    } catch (e) {
        console.error("Failed to fetch exercises:", e);
        res.status(500).json({ error: "Failed to fetch exercises" });
    }
});

app.put('/api/workout/exercise/:id', authenticateToken, async (req, res) => {
    try {
        const exMoveID = req.params.id;
        const { description, steps, caution, url, record_type, accessibility, progress_type } = req.body;
        
        const [result] = await db.query(
            'UPDATE ExerciseMoves SET Description = ?, Steps = ?, Caution = ?, URL = ?, RecordType = ?, Accessibility = ?, ProgressType = ? WHERE ExMoveID = ? AND UserID = ?',
            [description, steps, caution || null, url || null, record_type, accessibility, progress_type, exMoveID, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Exercise not found or unauthorized to update" });
        }
        res.status(200).json({ message: "Exercise updated successfully" });
    } catch (e) {
        console.error("Failed to update exercise:", e);
        res.status(500).json({ error: "Failed to update exercise" });
    }
});

app.delete('/api/workout/exercise/:id', authenticateToken, async (req, res) => {
    try {
        const exMoveID = req.params.id;
        const [result] = await db.query('DELETE FROM ExerciseMoves WHERE ExMoveID = ? AND UserID = ?', [exMoveID, req.user.id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Exercise not found or unauthorized to delete" });
        }
        res.status(200).json({ message: "Exercise deleted successfully" });
    } catch (e) {
        console.error("Failed to delete exercise:", e);
        res.status(500).json({ error: "Failed to delete exercise" });
    }
});

app.post('/api/workout/save', authenticateToken, async (req, res) => {
    try {
        const { workout_type, weight, reps, date, time, UserWeight, UserHeight } = req.body;
        
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
                'INSERT INTO Session (UserID, WorkingDayID, ExMoveID, SessionDate, UserWeight, UserHeight) VALUES (?, ?, ?, ?, ?, ?)', 
                [req.user.id, workingDayID, exMoveID, sessionDateStr, UserWeight || null, UserHeight || null]
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
        const { workout_type, limit, user_id } = req.query;
        const targetUserId = user_id || req.user.id;
        let query = `
            SELECT pr.PRID as workout_id, s.UserID as user_id, em.Description as workout_type, pr.Weight as weight, pr.Rep as reps, pr.Time as time, d.Day as day, s.SessionDate as date
            FROM PersonalRecord pr
            JOIN Session s ON pr.SessionID = s.SessionID
            JOIN ExerciseMoves em ON s.ExMoveID = em.ExMoveID
            JOIN WorkingDay d ON s.WorkingDayID = d.WorkingDayID
            WHERE s.UserID = ?
        `;
        const params = [targetUserId];

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

app.get('/api/workout/recent-body-stats', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT UserWeight, UserHeight FROM Session WHERE UserID = ? AND UserWeight IS NOT NULL ORDER BY SessionDate DESC, SessionID DESC LIMIT 1',
            [req.user.id]
        );
        if (rows.length > 0) {
            res.status(200).json(rows[0]);
        } else {
            res.status(200).json({ UserWeight: null, UserHeight: null });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch recent body stats" });
    }
});

app.get('/api/workout/body-stats-history', authenticateToken, async (req, res) => {
    try {
        const targetUserId = req.query.user_id || req.user.id;
        const [rows] = await db.query(
            'SELECT UserWeight, UserHeight, SessionDate FROM Session WHERE UserID = ? AND UserWeight IS NOT NULL AND UserHeight IS NOT NULL ORDER BY SessionDate ASC',
            [targetUserId]
        );
        res.status(200).json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch body stats history" });
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
        const targetUserId = req.query.user_id || req.user.id;
        const query = `
            SELECT wp.PlanID 
            FROM Session s
            JOIN WorkoutRoutine wr ON s.WorkingDayID = wr.WorkingDayID
            JOIN WorkoutPlan wp ON wr.PlanID = wp.PlanID
            WHERE s.UserID = ? AND wp.UserID = ?
            ORDER BY s.SessionDate DESC, s.SessionID DESC
            LIMIT 1;
        `;
        const [rows] = await db.query(query, [targetUserId, targetUserId]);
        
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
        const { plan_name, type, provider_id, user_id, days } = req.body;

        if (!plan_name || !days || !Array.isArray(days)) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        await conn.beginTransaction();

        const targetUserID = user_id || req.user.id;
        const targetProviderID = provider_id || req.user.id;

        // 1. Insert WorkoutPlan
        const [planResult] = await conn.query(
            'INSERT INTO WorkoutPlan (PlanName, UserID, Type, ProviderID) VALUES (?, ?, ?, ?)',
            [plan_name, targetUserID, type || 'C', targetProviderID]
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

app.post('/api/workout-plan/auto-generate', authenticateToken, async (req, res) => {
    const conn = await db.getConnection();
    try {
        const { weight, height, goal, experience, days } = req.body;
        if (!weight || !height || !goal || !experience || !days) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // 1. Get available exercises from DB for the AI to choose from
        const [exercises] = await conn.query("SELECT ExMoveID, Description FROM ExerciseMoves WHERE Accessibility = 'public'");
        const exerciseList = exercises.map(e => `${e.ExMoveID}: ${e.Description}`).join(', ');

        // 2. Build a strict prompt
        const prompt = `
        You are a professional personal trainer. Create a ${days}-day workout plan.
        User Profile: Weight: ${weight}kg, Height: ${height}cm, Experience Level: ${experience}, Goal: ${goal}.

        Available exercises in our database (ID: Name):
        ${exerciseList}

        Return ONLY a raw JSON object exactly matching this structure (no markdown formatting, no comments):
        {
          "plan_name": "AI Generated Plan for ${goal}",
          "days": [
            {
              "day": 0, 
              "exercises": [ 
                { "use_existing": true, "ex_move_id": ID_NUMBER },
                { 
                  "use_existing": false, 
                  "description": "New Exercise Name", 
                  "steps": "1. Step one 2. Step two...", 
                  "caution": "Keep back straight",
                  "record_type": "Weight",
                  "progress_type": "Volume"
                }
              ]
            }
          ]
        }
        Note: "day" should be a number from 0 to 6 (Monday=0, Sunday=6). 
        You CAN use existing ExMoveIDs if they fit perfectly. 
        If you need a specific exercise that is NOT in the available exercises list, set "use_existing": false and provide its full details so we can create it!
        `;

        // 3. Call Google Gemini API (Free alternative)
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not set in the environment.");
        }

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.replace(/"/g, '')}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7 }
            })
        });

        if (!aiResponse.ok) {
            const errData = await aiResponse.text();
            console.error('Gemini Error:', errData);
            throw new Error(`Gemini Error: ${errData}`);
        }

        const aiData = await aiResponse.json();
        let aiContent = "";
        
        try {
            aiContent = aiData.candidates[0].content.parts[0].text.trim();
        } catch (err) {
            console.error('Unexpected Gemini Response format:', aiData);
            throw new Error("AI returned an invalid response format.");
        }
        
        // Ensure string is clean of markdown codeblocks
        const cleanJson = aiContent.replace(/```json/g, '').replace(/```/g, '').trim();
        const planData = JSON.parse(cleanJson);

        // 4. Save to Database (Reusing your create logic)
        await conn.beginTransaction();

        const planName = planData.plan_name || "AI Generated Plan";
        const planDays = planData.days;

        const [planResult] = await conn.query(
            'INSERT INTO WorkoutPlan (PlanName, UserID, Type, ProviderID) VALUES (?, ?, ?, ?)',
            [planName, req.user.id, 'C', req.user.id]
        );
        const planID = planResult.insertId;

        for (const day of planDays) {
            const dayIndex = day.day; 
            const dayExercises = day.exercises;

            if (!dayExercises || dayExercises.length === 0) continue;

            const [newDay] = await conn.query('INSERT INTO WorkingDay (Day) VALUES (?)', [dayIndex]);
            const workingDayID = newDay.insertId;

            await conn.query('INSERT INTO WorkoutRoutine (PlanID, WorkingDayID) VALUES (?, ?)', [planID, workingDayID]);

            for (const ex of dayExercises) {
                let currentExId = null;

                if (ex.use_existing && ex.ex_move_id) {
                    currentExId = ex.ex_move_id;
                } else if (ex.description && ex.steps) {
                    // AI created a brand new exercise! Insert it into ExerciseMoves first
                    const caution = ex.caution || null;
                    const recType = ex.record_type || 'Weight';
                    const progType = ex.progress_type || 'Volume';
                    
                    const [newExRes] = await conn.query(
                        'INSERT INTO ExerciseMoves (Steps, Description, Caution, Accessibility, UserID, RecordType, ProgressType) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [ex.steps, ex.description, caution, 'private', req.user.id, recType, progType]
                    );
                    currentExId = newExRes.insertId;
                }

                if (currentExId) {
                    await conn.query('INSERT IGNORE INTO ExerciseList (WorkingDayID, ExMoveID) VALUES (?, ?)', [workingDayID, currentExId]);
                }
            }
        }

        await conn.commit();
        res.status(201).json({ message: "AI Workout plan created successfully", plan_id: planID });
    } catch (e) {
        await conn.rollback();
        console.error("Failed to auto-generate workout plan:", e);
        res.status(500).json({ error: e.message || "Failed to auto-generate workout plan" });
    } finally {
        conn.release();
    }
});

app.get('/api/workout-plan', authenticateToken, async (req, res) => {
    try {
        const targetUserId = req.query.user_id || req.user.id;
        const query = `
            SELECT 
                wp.PlanID, 
                wp.PlanName, 
                wp.ProviderID,
                wp.UserID,
                wp.Type,
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
        const [rows] = await db.query(query, [targetUserId]);
        
        // Group by Plan
        const plansMap = {};
        rows.forEach(row => {
            if (!plansMap[row.PlanID]) {
                plansMap[row.PlanID] = {
                    plan_id: row.PlanID,
                    plan_name: row.PlanName,
                    provider_id: row.ProviderID,
                    user_id: row.UserID,
                    type: row.Type,
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

app.get('/api/workout-plan/:id', authenticateToken, async (req, res) => {
    try {
        const planId = req.params.id;
        const query = `
            SELECT 
                wp.PlanID, 
                wp.PlanName, 
                wp.ProviderID,
                wp.UserID,
                wp.Type,
                wr.WorkingDayID,
                d.Day,
                em.ExMoveID, 
                em.Description AS ExerciseName
            FROM WorkoutPlan wp
            LEFT JOIN WorkoutRoutine wr ON wp.PlanID = wr.PlanID
            LEFT JOIN WorkingDay d ON wr.WorkingDayID = d.WorkingDayID
            LEFT JOIN ExerciseList el ON wr.WorkingDayID = el.WorkingDayID
            LEFT JOIN ExerciseMoves em ON el.ExMoveID = em.ExMoveID
            WHERE wp.PlanID = ? AND (wp.UserID = ? OR wp.ProviderID = ?)
        `;
        const [rows] = await db.query(query, [planId, req.user.id, req.user.id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "Workout plan not found" });
        }

        const plansMap = {};
        rows.forEach(row => {
            if (!plansMap[row.PlanID]) {
                plansMap[row.PlanID] = {
                    plan_id: row.PlanID,
                    plan_name: row.PlanName,
                    provider_id: row.ProviderID,
                    user_id: row.UserID,
                    type: row.Type,
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
        res.status(200).json(result[0]);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch workout plan" });
    }
});

app.put('/api/workout-plan/:id', authenticateToken, async (req, res) => {
    const conn = await db.getConnection();
    try {
        const planID = req.params.id;
        const { plan_name, days } = req.body;

        if (!plan_name || !days || !Array.isArray(days)) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        await conn.beginTransaction();

        // Ensure user owns this plan AND they are the provider
        const [checkRows] = await conn.query('SELECT * FROM WorkoutPlan WHERE PlanID = ?', [planID]);
        if (checkRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: "Workout plan not found" });
        }
        
        const plan = checkRows[0];
        const uid = req.user.id;
        const planUid = plan.UserID;
        const planPid = plan.ProviderID;
        const type = plan.Type;
        const role = req.user.role || '';
        const isTrainer = role === 'trainer' || role === 'coach';

        let allow = false;
        if (!isTrainer) {
            if (planUid === planPid) allow = true;
            else if (type === 'S') allow = true;
        } else {
            if (uid === planUid) allow = true;
            else if (uid === planPid && type === 'P') allow = true;
        }

        if (!allow) {
            await conn.rollback();
            return res.status(403).json({ error: "You are not authorized to edit this plan." });
        }

        // Update PlanName
        await conn.query('UPDATE WorkoutPlan SET PlanName = ? WHERE PlanID = ?', [plan_name, planID]);

        // Get existing working days to delete their dependencies
        const [oldRoutines] = await conn.query('SELECT WorkingDayID FROM WorkoutRoutine WHERE PlanID = ?', [planID]);
        const oldDayIDs = oldRoutines.map(r => r.WorkingDayID);

        // Delete from WorkoutRoutine
        await conn.query('DELETE FROM WorkoutRoutine WHERE PlanID = ?', [planID]);

        // Optionally delete old ExerciseList and WorkingDay records
        if (oldDayIDs.length > 0) {
            await conn.query('DELETE FROM ExerciseList WHERE WorkingDayID = ANY(?)', [oldDayIDs]);
            await conn.query('DELETE FROM WorkingDay WHERE WorkingDayID = ANY(?)', [oldDayIDs]);
        }

        // Insert new schedules
        for (const day of days) {
            const dayIndex = day.day; 
            const exercises = day.exercises;

            if (!exercises || exercises.length === 0) continue;

            const [newDay] = await conn.query('INSERT INTO WorkingDay (Day) VALUES (?)', [dayIndex]);
            const workingDayID = newDay.insertId;

            await conn.query('INSERT INTO WorkoutRoutine (PlanID, WorkingDayID) VALUES (?, ?)', [planID, workingDayID]);

            for (const ex of exercises) {
                await conn.query('INSERT IGNORE INTO ExerciseList (WorkingDayID, ExMoveID) VALUES (?, ?)', [workingDayID, ex.ex_move_id]);
            }
        }

        await conn.commit();
        res.status(200).json({ message: "Workout plan updated successfully" });
    } catch (e) {
        await conn.rollback();
        console.error("Failed to update workout plan:", e);
        res.status(500).json({ error: "Failed to update workout plan" });
    } finally {
        conn.release();
    }
});

app.delete('/api/workout-plan/:id', authenticateToken, async (req, res) => {
    try {
        const planID = req.params.id;
        
        const [checkRows] = await db.query('SELECT * FROM WorkoutPlan WHERE PlanID = ?', [planID]);
        if (checkRows.length === 0) {
            return res.status(404).json({ error: "Workout plan not found" });
        }
        
        const plan = checkRows[0];
        const uid = req.user.id;
        const planUid = plan.UserID;
        const planPid = plan.ProviderID;
        const type = plan.Type;
        const role = req.user.role || '';
        const isTrainer = role === 'trainer' || role === 'coach';

        let allow = false;
        if (!isTrainer) {
            if (planUid === planPid) allow = true;
            else if (type === 'S') allow = true;
        } else {
            if (uid === planUid) allow = true;
            else if (uid === planPid && type === 'P') allow = true;
        }

        if (!allow) {
            return res.status(403).json({ error: "You are not authorized to delete this plan." });
        }
        
        // Let the cascaded delete delete dependent records, just delete from WorkoutPlan
        await db.query('DELETE FROM WorkoutPlan WHERE PlanID = ?', [planID]);
        
        res.status(200).json({ message: "Workout plan deleted successfully" });
    } catch (e) {
        console.error("Failed to delete workout plan:", e);
        res.status(500).json({ error: "Failed to delete workout plan" });
    }
});



app.post('/api/workout-plan/:id/send', authenticateToken, async (req, res) => {
    const conn = await db.getConnection();
    try {
        const planID = req.params.id;
        const { receiver_id, receiver_username } = req.body;

        if (!receiver_id || !receiver_username) {
            return res.status(400).json({ error: "Missing receiver details" });
        }

        // 1. Verify Receiver
        const [users] = await conn.query('SELECT UserID FROM User WHERE UserID = ? AND Username = ?', [receiver_id, receiver_username]);
        if (users.length === 0) {
            return res.status(404).json({ error: "User not found or username doesn't match ID." });
        }
        const targetUserID = users[0].UserID;

        // 2. Fetch the plan details to copy
        const query = `
            SELECT 
                wp.PlanID, wp.PlanName, wp.ProviderID, wp.UserID, wp.Type,
                wr.WorkingDayID, d.Day, em.ExMoveID
            FROM WorkoutPlan wp
            LEFT JOIN WorkoutRoutine wr ON wp.PlanID = wr.PlanID
            LEFT JOIN WorkingDay d ON wr.WorkingDayID = d.WorkingDayID
            LEFT JOIN ExerciseList el ON wr.WorkingDayID = el.WorkingDayID
            LEFT JOIN ExerciseMoves em ON el.ExMoveID = em.ExMoveID
            WHERE wp.PlanID = ? AND wp.UserID = ?
        `;
        const [rows] = await conn.query(query, [planID, req.user.id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "Plan not found or you don't own this plan." });
        }
        
        // Structure the days like we do in GET /api/workout-plan/:id
        const plan_name = rows[0].PlanName;
        const daysMap = {};
        rows.forEach(row => {
            if (row.Day !== null) {
                if (!daysMap[row.Day]) {
                    daysMap[row.Day] = [];
                }
                if (row.ExMoveID !== null) {
                    daysMap[row.Day].push({ ex_move_id: row.ExMoveID });
                }
            }
        });
        
        const days = Object.keys(daysMap).map(dayIndex => ({
            day: parseInt(dayIndex),
            exercises: daysMap[dayIndex]
        }));
        
        await conn.beginTransaction();

        // 3. Create the new WorkoutPlan for receiver
        const targetProviderID = req.user.id;
        const [planResult] = await conn.query(
            'INSERT INTO WorkoutPlan (PlanName, UserID, Type, ProviderID) VALUES (?, ?, ?, ?)',
            [plan_name, targetUserID, 'S', targetProviderID]
        );
        const newPlanID = planResult.insertId;

        // 4. Create Routine, WorkingDay, and ExerciseList
        for (const day of days) {
            const dayIndex = day.day;
            const exercises = day.exercises;
            
            if (!exercises || exercises.length === 0) continue;
            
            const [newDay] = await conn.query('INSERT INTO WorkingDay (Day) VALUES (?)', [dayIndex]);
            const workingDayID = newDay.insertId;
            
            await conn.query('INSERT INTO WorkoutRoutine (PlanID, WorkingDayID) VALUES (?, ?)', [newPlanID, workingDayID]);
            
            for (const ex of exercises) {
                await conn.query('INSERT IGNORE INTO ExerciseList (WorkingDayID, ExMoveID) VALUES (?, ?)', [workingDayID, ex.ex_move_id]);
            }
        }
        
        await conn.commit();
        res.status(201).json({ message: "Plan sent successfully!", plan_id: newPlanID });
    } catch (e) {
        await conn.rollback();
        console.error("Failed to send plan:", e);
        res.status(500).json({ error: "Failed to send plan" });
    } finally {
        conn.release();
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

app.post('/api/user/upgrade', authenticateToken, async (req, res) => {
    try {
        const [result] = await db.query(
            "UPDATE User SET Status = 'training client' WHERE UserID = ?",
            [req.user.id]
        );

        // Turn the ghosted plan back to the active type P plan as normal
        await db.query(
            "UPDATE WorkoutPlan SET Type = 'P' WHERE UserID = ? AND Type = 'G'",
            [req.user.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        
        const payload = { id: req.user.id, username: req.user.username, role: 'training_client', FirstName: req.user.FirstName, LastName: req.user.LastName };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
        
        res.status(200).json({ message: "Upgraded successfully", auth_token: token, user: payload });
    } catch (e) {
        console.error("Failed to upgrade user:", e);
        res.status(500).json({ error: "Failed to upgrade user" });
    }
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

// Admin Middlewares
const authenticateAdmin = (req, res, next) => {
    authenticateToken(req, res, () => {
        if (req.user && req.user.role === 'admin') {
            next();
        } else {
            res.status(403).json({ error: "Forbidden: Admins only" });
        }
    });
};

app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT UserID, Username, FirstName, LastName, Status FROM User');
        res.status(200).json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

app.put('/api/admin/user/:id/role', authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.body; 
        if (!['user', 'trainer', 'training client', 'admin'].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        await db.query('UPDATE User SET Status = ? WHERE UserID = ?', [status, req.params.id]);
        res.status(200).json({ message: "User status updated" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to update user role" });
    }
});

app.get('/api/admin/exercises', authenticateAdmin, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM ExerciseMoves WHERE Accessibility = 'public'");
        res.status(200).json(rows);
    } catch (e) {
        console.error("Failed to fetch public exercises:", e);
        res.status(500).json({ error: "Failed to fetch public exercises" });
    }
});

app.put('/api/admin/exercise/:id', authenticateAdmin, async (req, res) => {
    try {
        const exMoveID = req.params.id;
        const { description, steps, caution, url, record_type, accessibility, progress_type } = req.body;
        
        const [result] = await db.query(
            'UPDATE ExerciseMoves SET Description = ?, Steps = ?, Caution = ?, URL = ?, RecordType = ?, Accessibility = ?, ProgressType = ? WHERE ExMoveID = ?',
            [description, steps, caution || null, url || null, record_type, accessibility, progress_type, exMoveID]
        );

        if (result.affectedRows === 0) return res.status(404).json({ error: "Exercise not found" });
        res.status(200).json({ message: "Exercise updated successfully" });
    } catch (e) {
        console.error("Failed to update exercise:", e);
        res.status(500).json({ error: "Failed to update exercise" });
    }
});

app.delete('/api/admin/exercise/:id', authenticateAdmin, async (req, res) => {
    try {
        const exMoveID = req.params.id;
        const [result] = await db.query('DELETE FROM ExerciseMoves WHERE ExMoveID = ?', [exMoveID]);
        
        if (result.affectedRows === 0) return res.status(404).json({ error: "Exercise not found" });
        res.status(200).json({ message: "Exercise deleted successfully" });
    } catch (e) {
        console.error("Failed to delete exercise:", e);
        res.status(500).json({ error: "Failed to delete exercise" });
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

        // Helper for rounded corners
        const drawRoundRect = (x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
            ctx.fill();
        };

        // Helper for text wrapping
        const wrapText = (context, text, x, y, maxWidth, lineHeight) => {
            const words = (text || "").toString().split(' ');
            let line = '';
            let currentY = y;
            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = context.measureText(testLine);
                if (metrics.width > maxWidth && n > 0) {
                    context.fillText(line.trim(), x, currentY);
                    line = words[n] + ' ';
                    currentY += lineHeight;
                } else {
                    line = testLine;
                }
            }
            context.fillText(line.trim(), x, currentY);
            return currentY;
        };

        // --- DRAWING SECTION ---

        // A. Background Color (zinc-950 to match frontend)
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, width, height);

        // Add top-left pink glow
        const glow1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 800);
        glow1.addColorStop(0, 'rgba(219, 39, 119, 0.2)'); // pink-600/20
        glow1.addColorStop(1, 'transparent');
        ctx.fillStyle = glow1;
        ctx.fillRect(0, 0, width, height);

        // Add bottom-right purple glow
        const glow2 = ctx.createRadialGradient(width, height, 0, width, height, 800);
        glow2.addColorStop(0, 'rgba(147, 51, 234, 0.2)'); // purple-600/20
        glow2.addColorStop(1, 'transparent');
        ctx.fillStyle = glow2;
        ctx.fillRect(0, 0, width, height);

        // B. Add a decorative box in the middle (zinc-900 to match frontend cards)
        ctx.fillStyle = '#18181b';
        drawRoundRect(80, 560, 920, 800, 48);
        ctx.strokeStyle = '#27272a'; // zinc-800 border
        ctx.lineWidth = 4;
        ctx.stroke();

        // Branding (Gradient)
        const brandGrad = ctx.createLinearGradient(width / 2 - 100, 0, width / 2 + 100, 0);
        brandGrad.addColorStop(0, '#ec4899'); // from-pink-500
        brandGrad.addColorStop(1, '#a855f7'); // to-purple-500

        ctx.fillStyle = brandGrad;
        ctx.font = 'bold 45px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GymBro', width / 2, 660);

        // C. Draw the Title
        ctx.fillStyle = '#ffffff'; // white
        ctx.font = 'bold 80px sans-serif';
        ctx.textAlign = 'center';
        
        let currentY = 780;
        currentY = wrapText(ctx, workoutName, width / 2, currentY, 850, 90);

        // D. Draw the Stats (Big and Gradient)
        currentY += 200; // Spacer between title and stats

        const statGrad = ctx.createLinearGradient(width / 2 - 250, 0, width / 2 + 250, 0);
        statGrad.addColorStop(0, '#ec4899');
        statGrad.addColorStop(1, '#a855f7');
        
        ctx.fillStyle = statGrad;
        ctx.font = 'bold 160px sans-serif';
        ctx.fillText(mainStat, width / 2, currentY);
        
        if (subStat) {
            currentY += 120;
            ctx.fillStyle = '#a1a1aa'; // zinc-400
            ctx.font = '55px sans-serif';
            ctx.fillText(subStat, width / 2, currentY);
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

app.post('/api/generate-plan-image', authenticateToken, async (req, res) => {
    try {
        const { plan_id } = req.body;
        if (!plan_id) return res.status(400).json({ error: "Missing plan_id" });

        // Fetch plan details
        const query = `
            SELECT 
                wp.PlanName, 
                d.Day,
                em.Description AS ExerciseName
            FROM WorkoutPlan wp
            LEFT JOIN WorkoutRoutine wr ON wp.PlanID = wr.PlanID
            LEFT JOIN WorkingDay d ON wr.WorkingDayID = d.WorkingDayID
            LEFT JOIN ExerciseList el ON wr.WorkingDayID = el.WorkingDayID
            LEFT JOIN ExerciseMoves em ON el.ExMoveID = em.ExMoveID
            WHERE wp.PlanID = ? AND wp.UserID = ?
            ORDER BY d.Day ASC, em.ExMoveID ASC
        `;
        const [rows] = await db.query(query, [plan_id, req.user.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Workout plan not found or unauthorized" });
        }

        const planName = rows[0].PlanName || "WORKOUT PLAN";
        
        // Group exercises by day and estimate text bounds for height calculation
        const daysMap = {};
        const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        
        let estimatedRowsLength = 0;
        rows.forEach(row => {
            if (row.Day !== null) {
                if (!daysMap[row.Day]) {
                    daysMap[row.Day] = [];
                }
                if (row.ExerciseName) {
                    daysMap[row.Day].push(row.ExerciseName);
                    // Approx 25 characters per line at 40px font in ~700px width
                    estimatedRowsLength += Math.ceil((row.ExerciseName.length || 1) / 25);
                }
            }
        });

        // Setup the Canvas
        const width = 1080;
        let height = 1920;
        
        // Adjust height based on number of days and exercises
        const numDays = Object.keys(daysMap).length;
        if (numDays > 0) {
            const titleLines = Math.ceil((planName.length || 1) / 15);
            const extraHeight = titleLines * 100 + numDays * 120 + estimatedRowsLength * 60;
            if (extraHeight > 1000) {
                height = 800 + extraHeight;
            }
        }

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Helper for rounded corners
        const drawRoundRect = (x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
            ctx.fill();
        };

        // Helper for text wrapping
        const wrapText = (context, text, x, y, maxWidth, lineHeight) => {
            const words = (text || "").toString().split(' ');
            let line = '';
            let currentY = y;
            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = context.measureText(testLine);
                if (metrics.width > maxWidth && n > 0) {
                    context.fillText(line.trim(), x, currentY);
                    line = words[n] + ' ';
                    currentY += lineHeight;
                } else {
                    line = testLine;
                }
            }
            context.fillText(line.trim(), x, currentY);
            return currentY;
        };

        // Background (zinc-950 to match frontend)
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, width, height);

        // Add top-left pink glow
        const glow1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 800);
        glow1.addColorStop(0, 'rgba(219, 39, 119, 0.2)'); // pink-600/20
        glow1.addColorStop(1, 'transparent');
        ctx.fillStyle = glow1;
        ctx.fillRect(0, 0, width, height);

        // Add bottom-right purple glow
        const glow2 = ctx.createRadialGradient(width, height, 0, width, height, 800);
        glow2.addColorStop(0, 'rgba(147, 51, 234, 0.2)'); // purple-600/20
        glow2.addColorStop(1, 'transparent');
        ctx.fillStyle = glow2;
        ctx.fillRect(0, 0, width, height);

        // Box (zinc-900)
        ctx.fillStyle = '#18181b';
        drawRoundRect(80, 100, 920, height - 200, 48);
        ctx.strokeStyle = '#27272a'; // zinc-800 border
        ctx.lineWidth = 4;
        ctx.stroke();

        // GymBro Branding (Gradient)
        const brandGrad = ctx.createLinearGradient(width / 2 - 100, 0, width / 2 + 100, 0);
        brandGrad.addColorStop(0, '#ec4899'); // from-pink-500
        brandGrad.addColorStop(1, '#a855f7'); // to-purple-500

        ctx.fillStyle = brandGrad;
        ctx.font = 'bold 45px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GymBro', width / 2, 200);

        // Title
        ctx.fillStyle = '#ffffff'; // white
        ctx.font = 'bold 80px sans-serif';
        ctx.textAlign = 'center';
        
        let currentY = 320;
        currentY = wrapText(ctx, planName.toUpperCase(), width / 2, currentY, 850, 90);
        
        currentY += 60;
        // Separator (zinc-800)
        ctx.fillStyle = '#27272a';
        ctx.fillRect(150, currentY, 780, 4);

        // Draw Days and Exercises
        ctx.textAlign = 'left';
        currentY += 100;

        for (let i = 0; i <= 6; i++) {
            if (daysMap[i] && daysMap[i].length > 0) {
                // Determine grad or solid pink/purple
                const dayGrad = ctx.createLinearGradient(150, 0, 400, 0);
                dayGrad.addColorStop(0, '#ec4899'); // pink
                dayGrad.addColorStop(1, '#a855f7'); // purple
                
                ctx.fillStyle = dayGrad;
                ctx.font = 'bold 50px sans-serif';
                ctx.fillText(dayNames[i], 150, currentY);
                currentY += 70;
                
                ctx.fillStyle = '#a1a1aa'; // zinc-400
                ctx.font = '40px sans-serif';
                daysMap[i].forEach(ex => {
                    ctx.fillText('•', 160, currentY);
                    currentY = wrapText(ctx, ex, 200, currentY, 700, 50);
                    currentY += 60;
                });
                currentY += 50;
            }
        }

        const buffer = canvas.toBuffer('image/png');
        res.set('Content-Type', 'image/png');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to generate plan image" });
    }
});

// Health check endpoint for the root URL
app.get('/', (req, res) => {
    res.status(200).json({ message: "Gym Buddy Backend is running successfully!" });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
