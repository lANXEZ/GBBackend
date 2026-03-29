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

// Mock DB
let users = [
    { username: 'testgymgoer', password: 'password', id: 1, role: 'gymgoer' },
    { username: 'testclient', password: 'password', id: 2, role: 'training_client', trainer_id: 3 },
    { username: 'testtrainer', password: 'password', id: 3, role: 'trainer' }
];
let workouts = [];
let workoutIdCounter = 1;

// Mock Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Check if it's one of our mock tokens
    const validTokens = {
        'mock_token_gymgoer': 1,
        'mock_token_client': 2,
        'mock_token_trainer': 3
    };

    if (!token || !validTokens[token]) return res.status(401).json({ error: "Unauthorized" });
    
    // Attach user to request
    req.user = users.find(u => u.id === validTokens[token]);
    next();
};

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = users.find(u => u.username === username);
        if (user && user.password === password) {
            // Assign a unique token based on the user's role
            let token = 'mock_token_123';
            if (user.role === 'gymgoer') token = 'mock_token_gymgoer';
            else if (user.role === 'training_client') token = 'mock_token_client';
            else if (user.role === 'trainer') token = 'mock_token_trainer';

            res.status(200).json({ 
                auth_token: token, 
                user: { id: user.id, username: user.username, role: user.role, trainer_id: user.trainer_id } 
            });
        } else {
            res.status(401).json({ error: "Unauthorized (Wrong password or username)" });
        }
    } catch (e) {
        res.status(500).json({ error: "Something went wrong. Please try again later." });
    }
});

app.post('/api/workout/save', authenticateToken, (req, res) => {
    const { workout_type, weight, reps, date } = req.body;
    const newWorkout = { workout_id: workoutIdCounter++, user_id: req.user.id, workout_type, weight, reps, date: new Date(date) };
    workouts.push(newWorkout);
    res.status(201).json({ workout_id: newWorkout.workout_id });
});

app.get('/api/workout/fetch', authenticateToken, (req, res) => {
    const { workout_type, limit } = req.query;
    let userWorkouts = workouts.filter(w => w.user_id === req.user.id);
    if (workout_type) userWorkouts = userWorkouts.filter(w => w.workout_type === workout_type);
    if (userWorkouts.length === 0) return res.status(404).json({ error: "Not found" });
    
    userWorkouts.sort((a, b) => b.date - a.date);
    if (limit) userWorkouts = userWorkouts.slice(0, parseInt(limit));
    res.status(200).json(userWorkouts);
});

app.get('/api/workout/is-struggle', authenticateToken, (req, res) => {
    const { workout_type } = req.query;
    let userWorkouts = workouts.filter(w => w.user_id === req.user.id && w.workout_type === workout_type);
    if (userWorkouts.length < 5) return res.status(400).json({ error: "Insufficient Data" });
    
    userWorkouts.sort((a, b) => b.date - a.date);
    const recent = userWorkouts.slice(0, 5);
    // basic struggle logic: if last 5 sets average reps < 5 or weight dropping
    const isStruggling = Math.random() < 0.5; // mocked logic for now
    res.status(200).json({ struggling: isStruggling });
});

app.post('/api/payment/process', authenticateToken, (req, res) => {
    const { amount, source_token, currency = "THB" } = req.body;
    if (amount < 0 || !source_token) return res.status(400).json({ error: "Bad Request" });
    if (source_token === "tok_decline") return res.status(402).json({ error: "Payment Required" });
    res.status(200).json({ status: "success", receipt: "rect_123" });
});

app.get('/api/workout/performance-graph', authenticateToken, (req, res) => {
    const { workout_type, limit } = req.query;
    if (!workout_type) return res.status(400).json({ error: "Bad Request. Missing workout_type." });
    let userWorkouts = workouts.filter(w => w.user_id === req.user.id && w.workout_type === workout_type);
    if (userWorkouts.length < 2) return res.status(404).json({ error: "Not Found. Not enough data." });

    try {
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
        res.status(500).json({ error: "Failed to generate image" });
    }
});

// The Endpoint
app.post('/api/generate-image', authenticateToken, (req, res) => {
    try {
        console.log("Received request:", req.body);

        // 1. Get data from the frontend (or use defaults)
        // We look for 'stats' inside the body. If it's missing, we use a placeholder.
        const weight = req.body.stats?.weight || "0 kg";
        const reps = req.body.stats?.reps || "0 reps";
        
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
        ctx.fillText("MY WORKOUT", width / 2, 750);

        // D. Draw the Stats (Big and Orange)
        ctx.fillStyle = '#FC4C02'; // Strava Orange
        ctx.font = 'bold 120px sans-serif';
        ctx.fillText(weight, width / 2, 950);
        
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '50px sans-serif';
        ctx.fillText(`Reps: ${reps}`, width / 2, 1100);

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