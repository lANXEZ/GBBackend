const fs = require('fs');
let s = fs.readFileSync('e:/Work/VSCode Repo/GBBackend/server.js', 'utf8');

// replace .Weight -> .(Weight || weight) where appropriate, or just handle cases
// Let's use regex
s = s.replace(/record\.Weight/g, '(record.Weight || record.weight)');
s = s.replace(/record\.Rep/g, '(record.Rep || record.rep)');
s = s.replace(/record\.Time/g, '(record.Time || record.time)');
s = s.replace(/row\.Day/g, '(row.Day ?? row.day)');
s = s.replace(/d\.Day/g, '(d.Day ?? d.day)');
s = s.replace(/r\.Rep/g, '(r.Rep || r.rep)');

fs.writeFileSync('e:/Work/VSCode Repo/GBBackend/server.js', s);
