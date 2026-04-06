require('dotenv').config();
const db = require('./db.js');

async function test() {
  const query = 
      SELECT pr.PRID as workout_id, s.UserID as user_id,
      em.Description as workout_type, pr.Weight as weight, pr.Rep as reps, pr.Time as time, d.Day as day, s.SessionDate as date
      FROM PersonalRecord pr
      JOIN Session s ON pr.SessionID = s.SessionID
      JOIN ExerciseMoves em ON s.ExMoveID = em.ExMoveID
      JOIN WorkingDay d ON s.WorkingDayID = d.WorkingDayID
      WHERE s.UserID = 2
  ;
  const [rows] = await db.query(query);
  console.log("Fetch 1:", rows[0]);

  const q2 = SELECT pr.Weight, pr.Rep, pr.Time, em.Description FROM PersonalRecord pr JOIN Session s ON pr.SessionID = s.SessionID JOIN ExerciseMoves em ON s.ExMoveID = em.ExMoveID LIMIT 1;
  const [rows2] = await db.query(q2);
  console.log("Fetch 2:", rows2[0]);

  process.exit();
}
test();
