import webpush from 'web-push';

const vapidKeys = webpush.generateVAPIDKeys();

console.log('✅ New VAPID Keys Generated:');
console.log('---------------------------');
console.log(`Public Key:  ${vapidKeys.publicKey}`);
console.log(`Private Key: ${vapidKeys.privateKey}`);
console.log('---------------------------');
console.log('Update your .env or render.yaml with these values.');
