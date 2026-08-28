const https = require('https');

https.get('https://www.badatime.com/search.jsp?search_word=%EB%AA%A9%ED%8F%AC', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const matches = data.match(/href="([^"]+)">목포/g);
    if (matches) {
      console.log(matches);
    } else {
      console.log("Not found");
    }
  });
});
