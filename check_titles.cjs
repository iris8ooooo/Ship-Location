const https = require('https');
const iconv = require('iconv-lite');

async function checkUrl(id) {
  return new Promise((resolve) => {
    https.get(`https://www.badatime.com/${id}.html`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const data = iconv.decode(buffer, 'euc-kr');
        const match = data.match(/<title>(.*?)<\/title>/);
        if (match) {
          console.log(`${id}: ${match[1]}`);
        }
        resolve();
      });
    }).on('error', () => resolve());
  });
}

async function run() {
  for (let i = 160; i <= 170; i++) {
    await checkUrl(i);
  }
}
run();
