require('dotenv').config();
const db = require('./db.js');

async function fixMigration() {
    try {
        console.log("Checking session constraint...");
        
        // Find existing constraint name on session
        const [sessionConstraints] = await db.query(`
            SELECT constraint_name 
            FROM information_schema.key_column_usage 
            WHERE table_name = 'session' AND column_name = 'exmoveid';
        `);
        console.log("Constraints on session for exmoveid:", sessionConstraints);
        
        for (let row of sessionConstraints) {
            if (row.constraint_name.endsWith('_fkey')) {
                await db.query(`ALTER TABLE session DROP CONSTRAINT IF EXISTS "${row.constraint_name}";`);
            }
        }

        await db.query(`ALTER TABLE session ADD CONSTRAINT "session_WorkingDayID_ExMoveID_fkey" 
            FOREIGN KEY ("workingdayid", "exmoveid") 
            REFERENCES exerciselist("workingdayid", "exmoveid") 
            ON DELETE CASCADE;`);
            
        // Check ExerciseList
        const [listConstraints] = await db.query(`
            SELECT constraint_name 
            FROM information_schema.key_column_usage 
            WHERE table_name = 'exerciselist' AND column_name = 'exmoveid';
        `);
        console.log("Constraints on exerciselist for exmoveid:", listConstraints);
        
        for (let row of listConstraints) {
            if (row.constraint_name.endsWith('_fkey')) {
                await db.query(`ALTER TABLE exerciselist DROP CONSTRAINT IF EXISTS "${row.constraint_name}";`);
            }
        }
        
        await db.query(`ALTER TABLE exerciselist ADD CONSTRAINT "exerciselist_exmoveid_fkey"
            FOREIGN KEY ("exmoveid") 
            REFERENCES exercisemoves("exmoveid") 
            ON DELETE CASCADE;`);
            
        console.log("Migration executed successfully!");
        process.exit(0);
    } catch (e) {
        console.error("Error running migration:", e);
        process.exit(1);
    }
}
fixMigration();
