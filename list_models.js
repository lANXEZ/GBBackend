require('dotenv').config();
const key = process.env.GEMINI_API_KEY.replace(/"/g, '');
fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + key)
.then(r => r.json())
.then(d => {
    if (d.models) {
        console.log(JSON.stringify(d.models.map(m => m.name), null, 2));
    } else {
        console.log("No models returned:", d);
    }
})
.catch(e => console.error(e));