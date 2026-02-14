const express = require('express');
const cors = require('cors');
const { createCanvas } = require('canvas'); // <--- The library for drawing

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// The Endpoint
app.post('/api/generate-image', (req, res) => {
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});