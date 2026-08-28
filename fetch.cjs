const https = require('https');
const fs = require('fs');

https.get('https://search.naver.com/search.naver?query=%EB%AA%A9%ED%8F%AC+%EB%AC%BC%EB%95%8C', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    fs.writeFileSync('naver.html', data);
  });
});
