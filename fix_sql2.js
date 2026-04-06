const fs = require('fs');
let s = fs.readFileSync('e:/Work/VSCode Repo/GBBackend/server.js', 'utf8');

// Fix SQL syntax inside template literals where d.Day was used
s = s.replace(/\(d\.Day \?\? d\.day\)/g, 'd.Day');

// There might also be row.Day used wrong, wait! row is JS, d is SQL.
// Oh wow, 'd' is a table alias in SQL JOIN WorkingDay d. So d.Day is SQL.
// 'row' is the JavaScript object iterating over rows. So row.Day is JS.
// record is JS. pr is SQL.

fs.writeFileSync('e:/Work/VSCode Repo/GBBackend/server.js', s);
