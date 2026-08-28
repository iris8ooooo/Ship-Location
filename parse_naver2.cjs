const fs = require('fs');
const data = fs.readFileSync('naver.html', 'utf8');
const idx = data.indexOf('물때');
if (idx !== -1) {
  console.log(data.substring(idx - 200, idx + 500));
} else {
  console.log("Not found");
}
