const https = require('https');

https.get('https://www.badatime.com/search.jsp?search_word=%B8%F1%C6%F7', (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const decoder = new TextDecoder('euc-kr');
    const data = decoder.decode(buffer);
    const matches = data.match(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g);
    if (matches) {
      matches.forEach(m => {
        if (m.includes('목포')) console.log(m);
      });
    }
  });
});
