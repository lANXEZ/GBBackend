const fs = require('fs');
let s = fs.readFileSync('e:/Work/VSCode Repo/GBBackend/server.js', 'utf8');

// Fix the corrupted SQL
s = s.replace(/p\(r\.Rep \|\| r\.rep\)/g, 'pr.Rep');
s = s.replace(/p\(r\.Weight \|\| r\.weight\)/g, 'pr.Weight');
s = s.replace(/p\(r\.Time \|\| r\.time\)/g, 'pr.Time');

// But also wait! I still need to make sure the JS objects fall back correctly.
// Let's use more specific regex for JavaScript object accesses
/*
r.Rep || r.rep which is correct for JS!
Where was r.Rep used?
Line 1057: rows.forEach(r => totalReps += (r.Rep || 0));
*/

fs.writeFileSync('e:/Work/VSCode Repo/GBBackend/server.js', s);
