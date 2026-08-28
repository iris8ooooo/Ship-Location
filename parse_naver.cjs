const fs = require('fs');
const data = fs.readFileSync('naver.html', 'utf8');
const match = data.match(/<strong class="time">.*?<\/strong>.*?<span class="level">.*?<\/span>/g);
if (match) {
  console.log(match.join('\n'));
} else {
  console.log("Not found");
}
