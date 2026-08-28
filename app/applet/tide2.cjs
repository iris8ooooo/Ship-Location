const https = require('https');

https.get('https://search.naver.com/search.naver?query=%EB%AA%A9%ED%8F%AC+%EB%AC%BC%EB%95%8C', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const matches = data.match(/<div class="tide_time">.*?<\/ul>/s);
    if (matches) {
      console.log(matches[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    } else {
      const match2 = data.match(/<div class="tide_info.*?<\/div>/s);
      if (match2) {
        console.log(match2[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
      } else {
        console.log("No tide info found");
      }
    }
  });
});
