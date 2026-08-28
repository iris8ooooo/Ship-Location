const https = require('https');
const iconv = require('iconv-lite');

https.get('https://www.badatime.com/search.jsp?search_word=%B8%F1%C6%F7', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  }
}, (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const data = iconv.decode(buffer, 'euc-kr');
    const matches = data.match(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g);
    if (matches) {
      matches.forEach(m => {
        if (m.includes('목포')) console.log(m);
      });
    }
  });
});
