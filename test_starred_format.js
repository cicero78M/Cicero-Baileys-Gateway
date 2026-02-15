import { parseComplaintMessage } from './src/service/complaintService.js';

const testMessage = `*Pesan Komplain*
NRP : 72120290
Nama : DARTOK DARMAWAN
Satker : DITINTELKAM POLDA JATIM
Username IG : @dartokdarmawan72
Username Tiktok : @dartok7853

Kendala
- sudah melaksanakan Instagram belum terdata
- sudah melaksanakan tiktok belum terdata.`;

console.log('Testing starred format parsing...');
const result = parseComplaintMessage(testMessage);

console.log('\nParsed Result:');
console.log('NRP:', result.nrp);
console.log('Name:', result.name);
console.log('Instagram:', result.instagram);
console.log('TikTok:', result.tiktok);
console.log('Issues:', result.issues);

if (result.nrp === '72120290' &&
    result.name === 'DARTOK DARMAWAN' &&
    result.instagram === '@dartokdarmawan72' &&
    result.tiktok === '@dartok7853' &&
    result.issues.length === 2) {
  console.log('\n✓ SUCCESS: Starred format is correctly parsed!');
  process.exit(0);
} else {
  console.log('\n✗ FAILED: Parsing did not work as expected');
  process.exit(1);
}
