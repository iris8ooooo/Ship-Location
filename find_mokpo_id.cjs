const https = require('https');

async function checkUrl(id) {
  return new Promise((resolve) => {
    https.get(`https://www.badatime.com/${id}.html`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const decoder = new TextDecoder('euc-kr');
        const data = decoder.decode(buffer);
        const match = data.match(/<title>(.*?)<\/title>/);
        if (match && match[1].includes('목포')) {
          console.log(`Found Mokpo at ${id}.html: ${match[1]}`);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    }).on('error', () => resolve(false));
  });
}

async function run() {
  for (let i = 150; i <= 170; i++) {
    const found = await checkUrl(i);
    if (found) break;
  }
}
run();
