require('dotenv').config(); const db = require('./db'); db.query('SELECT * FROM ExerciseMoves').then(r => console.log(r[0][0])).catch(e=>console.error(e)); setTimeout(()=>process.exit(0), 1000);
