// Script to check WhatsApp number formats in the database
// This will help identify if there are any numbers stored with @c.us or @s.whatsapp.net suffixes

import { query } from '../src/repository/db.js';

async function checkWhatsAppFormats() {
  console.log('Checking WhatsApp number formats in database...\n');
  
  // Get limit from environment or use default
  const limit = process.env.CHECK_LIMIT ? parseInt(process.env.CHECK_LIMIT, 10) : 0;
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';
  
  try {
    // Get all users with WhatsApp numbers
    const { rows: allUsers } = await query(
      `SELECT user_id, nama, whatsapp FROM "user" WHERE whatsapp IS NOT NULL AND whatsapp != '' ${limitClause}`
    );
    
    console.log(`Found ${allUsers.length} users with WhatsApp numbers${limit > 0 ? ` (limited to ${limit})` : ''}:\n`);
    
    let hasOldFormat = false;
    let hasSuffix = false;
    
    // Calculate dynamic column widths
    const maxUserIdLen = Math.max(15, ...allUsers.map(u => (u.user_id || '').length));
    const maxNamaLen = Math.max(20, ...allUsers.map(u => (u.nama || '').substring(0, 30).length));
    const maxWaLen = Math.max(30, ...allUsers.map(u => (u.whatsapp || '').length));
    
    for (const user of allUsers) {
      const wa = user.whatsapp;
      let status = '✓ Clean';
      
      if (wa.includes('@c.us')) {
        status = '❌ OLD FORMAT (@c.us)';
        hasOldFormat = true;
        hasSuffix = true;
      } else if (wa.includes('@s.whatsapp.net')) {
        status = '❌ HAS SUFFIX (@s.whatsapp.net)';
        hasSuffix = true;
      } else if (wa.includes('@')) {
        status = '⚠️ HAS @ SYMBOL';
        hasSuffix = true;
      } else if (!wa.startsWith('62')) {
        status = '⚠️ NO 62 PREFIX';
      }
      
      console.log(`${user.user_id.padEnd(maxUserIdLen)} | ${(user.nama || '').substring(0, 30).padEnd(maxNamaLen)} | ${wa.padEnd(maxWaLen)} | ${status}`);
    }
    
    console.log('\n=== Summary ===');
    console.log(`Total users checked: ${allUsers.length}`);
    console.log(`Has old format (@c.us): ${hasOldFormat ? 'YES ⚠️' : 'NO ✓'}`);
    console.log(`Has any suffix: ${hasSuffix ? 'YES ⚠️' : 'NO ✓'}`);
    
    if (hasOldFormat || hasSuffix) {
      console.log('\n⚠️ MIGRATION NEEDED: Some WhatsApp numbers have old formats or suffixes.');
      console.log('These need to be normalized to pure digits with 62 prefix.');
    } else {
      console.log('\n✓ All WhatsApp numbers are in correct format.');
    }
    
    // Check if there are any users with @c.us specifically
    const { rows: oldFormatUsers } = await query(
      'SELECT COUNT(*) as count FROM "user" WHERE whatsapp LIKE \'%@c.us%\''
    );
    console.log(`\nUsers with @c.us format: ${oldFormatUsers[0].count}`);
    
    // Check if there are any users with @s.whatsapp.net
    const { rows: baileysFormatUsers } = await query(
      'SELECT COUNT(*) as count FROM "user" WHERE whatsapp LIKE \'%@s.whatsapp.net%\''
    );
    console.log(`Users with @s.whatsapp.net format: ${baileysFormatUsers[0].count}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking WhatsApp formats:', error);
    process.exit(1);
  }
}

checkWhatsAppFormats();
