const fs = require('fs');
const data = fs.readFileSync('naver.html', 'utf8');

// The tide data is usually in a JSON object in the page source if it's a React/Vue app, or in specific tags.
// Let's look for "고조" and "저조"
const matches = data.match(/<span class="blind">(고조|저조)<\/span>.*?<span class="time">([^<]+)<\/span>.*?<span class="level">([^<]+)<\/span>/g);
if (matches) {
  console.log(matches.join('\n'));
} else {
  // Try another regex
  const matches2 = data.match(/<em class="level[^>]*>([^<]+)<\/em>.*?<span class="time">([^<]+)<\/span>/g);
  if (matches2) {
    console.log(matches2.join('\n'));
  } else {
    // Just dump all text containing "고조" or "저조"
    const lines = data.split('\n');
    lines.forEach(line => {
      if (line.includes('고조') || line.includes('저조')) {
        console.log(line.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 200));
      }
    });
  }
}
