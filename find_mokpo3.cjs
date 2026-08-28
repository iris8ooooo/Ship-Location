const https = require('https');

https.get('https://www.badatime.com/search.jsp?search_word=%EB%AA%A9%ED%8F%AC', (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const decoder = new TextDecoder('euc-kr');
    const data = decoder.decode(buffer);
    const match = data.match(/href="([^"]+)">목포/);
    if (match) {
      console.log("Mokpo URL:", match[1]);
    } else {
      console.log("Not found. Let's dump all hrefs with their text.");
      const matches = data.match(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g);
      if (matches) {
        matches.forEach(m => {
          if (m.includes('목포')) console.log(m);
        });
      }
    }
  });
});
