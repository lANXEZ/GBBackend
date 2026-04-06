const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
const replacement = 'SELECT ExMoveID AS "ExMoveID", Steps AS "Steps", Description AS "Description", Caution AS "Caution", URL AS "URL", Accessibility AS "Accessibility", UserID AS "UserID", RecordType AS "RecordType", ProgressType AS "ProgressType" FROM ExerciseMoves';
s = s.replace(/SELECT \* FROM ExerciseMoves/g, replacement);
fs.writeFileSync('server.js', s);
