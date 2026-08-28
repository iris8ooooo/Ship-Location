const http = require('http');
const https = require('https');

https.get('https://www.badatime.com/164.html', (res) => {
  const chunks = [];
  res.on('data', (chunk) => {
    chunks.push(chunk);
  });
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const decoder = new TextDecoder('euc-kr');
    const data = decoder.decode(buffer);
    const matches = data.match(/<title>(.*?)<\/title>/);
    if (matches) {
      console.log(matches[1]);
    } else {
      console.log("Not found");
    }
  });
});
