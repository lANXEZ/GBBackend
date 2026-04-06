const fs = require('fs');
let s = fs.readFileSync('e:/Work/VSCode Repo/GBBackend/db.js', 'utf8');

const mapFn = `
const keyMap = {
  userid: 'UserID', username: 'Username', password: 'Password', firstname: 'FirstName',
  lastname: 'LastName', dob: 'DoB', status: 'Status', planid: 'PlanID', planname: 'PlanName',
  type: 'Type', providerid: 'ProviderID', workingdayid: 'WorkingDayID', day: 'Day',
  exmoveid: 'ExMoveID', steps: 'Steps', description: 'Description', caution: 'Caution',
  url: 'URL', accessibility: 'Accessibility', recordtype: 'RecordType', progresstype: 'ProgressType',
  sessionid: 'SessionID', sessiondate: 'SessionDate', userweight: 'UserWeight', userheight: 'UserHeight',
  prid: 'PRID', weight: 'Weight', rep: 'Rep', time: 'Time', trainerid: 'TrainerID',
  clientid: 'ClientID', dobstring: 'DoBString', exercisename: 'ExerciseName',
  ex_move_id: 'ex_move_id', plan_id: 'plan_id', plan_name: 'plan_name'
};

function mapKeys(rows) {
  if (!rows || !Array.isArray(rows)) return rows;
  return rows.map(row => {
    const newRow = {};
    for (let k in row) {
      if (keyMap[k.toLowerCase()]) {
        newRow[keyMap[k.toLowerCase()]] = row[k];
      } else {
        newRow[k] = row[k];
      }
    }
    return newRow;
  });
}
`;

if (!s.includes('function mapKeys(rows)')) {
  s = s.replace('// Executes query and maps response to mysql2 format', mapFn + '\\n// Executes query and maps response to mysql2 format');
  s = s.replace('return [commandResult.rows, commandResult.fields];', 'return [mapKeys(commandResult.rows), commandResult.fields];');
  s = s.replace('return [resultObj, commandResult.fields];', 'return [resultObj, commandResult.fields];');
  fs.writeFileSync('e:/Work/VSCode Repo/GBBackend/db.js', s);
}
