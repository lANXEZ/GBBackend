const http = require('http');
// Well we can't test authenticate endpoints easily without a token, but we can verify the source code.
const fs = require('fs');
let s = fs.readFileSync('e:/Work/VSCode Repo/GBBackend/server.js', 'utf8');

const regex = /record\.Weight/;
console.log(regex.test(s));

// Wait! When mapping we had \(record.Weight || record.weight)\. Let's see how it looks.
const match = s.match(/.{0,30}record\.weight.{0,30}/);
console.log("Check:", match ? match[0] : "Not found");
