const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'artifacts/central/app/(tabs)/bookings.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Replace \` with `
content = content.replace(/\\\`/g, '`');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Cleaned backticks.');
