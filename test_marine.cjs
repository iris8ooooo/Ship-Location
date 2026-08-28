const https = require('https');

https.get('https://marine-api.open-meteo.com/v1/marine?latitude=34.78&longitude=126.46&hourly=ocean_height&timezone=Asia%2FSeoul', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(data.substring(0, 500));
  });
});
