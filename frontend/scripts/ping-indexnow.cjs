const https = require('https');

const data = JSON.stringify({
  host: 'nuke-chat.pages.dev',
  key: '63de4f9011714bcfa2e171bcf58d5918',
  keyLocation: 'https://nuke-chat.pages.dev/63de4f9011714bcfa2e171bcf58d5918.txt',
  urlList: [
    'https://nuke-chat.pages.dev/',
    'https://nuke-chat.pages.dev/#/privacy',
    'https://nuke-chat.pages.dev/#/terms',
    'https://nuke-chat.pages.dev/#/blog',
    'https://nuke-chat.pages.dev/#/blog/p2p-webrtc-file-sharing',
    'https://nuke-chat.pages.dev/#/blog/client-side-aes-gcm-encryption',
    'https://nuke-chat.pages.dev/#/blog/serverless-privacy-ephemeral-apps',
    'https://nuke-chat.pages.dev/#/blog/share-large-files-privately-no-cloud',
    'https://nuke-chat.pages.dev/#/blog/discord-slack-alternatives-no-account',
    'https://nuke-chat.pages.dev/#/blog/why-zero-logs-database-retention'
  ]
});

const options = {
  hostname: 'api.indexnow.org',
  port: 443,
  path: '/indexnow',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  }
};

console.log('Sending ping request to IndexNow (Bing/Yandex)...');

const req = https.request(options, (res) => {
  console.log(`IndexNow Status Code: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 202) {
      console.log(`Success! IndexNow has accepted URLs for crawl queue (Status: ${res.statusCode}).`);
    } else {
      console.warn(`Warning: IndexNow returned status code ${res.statusCode}. Response: ${responseData}`);
    }
  });
});

req.on('error', (error) => {
  console.error('Error pinging IndexNow:', error);
});

req.write(data);
req.end();
