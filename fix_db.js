const keyMap = {
  userid: 'UserID', username: 'Username', password: 'Password', firstname: 'FirstName',
  lastname: 'LastName', dob: 'DoB', status: 'Status', planid: 'PlanID', planname: 'PlanName',
  type: 'Type', providerid: 'ProviderID', workingdayid: 'WorkingDayID', day: 'Day',
  exmoveid: 'ExMoveID', steps: 'Steps', description: 'Description', caution: 'Caution',
  url: 'URL', accessibility: 'Accessibility', recordtype: 'RecordType', progresstype: 'ProgressType',
  sessionid: 'SessionID', sessiondate: 'SessionDate', userweight: 'UserWeight', userheight: 'UserHeight',
  prid: 'PRID', weight: 'Weight', rep: 'Rep', time: 'Time', trainerid: 'TrainerID',
  clientid: 'ClientID', dobstring: 'DoBString', exercisename: 'ExerciseName'
};

function mapKeys(rows) {
  if (!rows || !Array.isArray(rows)) return rows;
  return rows.map(row => {
    const newRow = {};
    for (let k in row) {
      if (keyMap[k]) {
        newRow[keyMap[k]] = row[k];
      } else {
        newRow[k] = row[k];
      }
    }
    return newRow;
  });
}
