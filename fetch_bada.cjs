const https = require('https');
const fs = require('fs');

https.get('https://www.badatime.com/search.jsp?search_word=%EB%AA%A9%ED%8F%AC', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    fs.writeFileSync('badatime.html', data);
  });
});
