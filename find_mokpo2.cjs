const https = require('https');

https.get('https://www.badatime.com/search.jsp?search_word=%EB%AA%A9%ED%8F%AC', (res) => {
  const chunks = [];
  res.on('data', (chunk) => {
    chunks.push(chunk);
  });
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const decoder = new TextDecoder('euc-kr');
    const data = decoder.decode(buffer);
    const matches = data.match(/href="([^"]+)">목포/g);
    if (matches) {
      console.log(matches);
    } else {
      console.log("Not found");
    }
  });
});
