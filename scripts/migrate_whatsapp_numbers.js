// Migration script to normalize WhatsApp numbers in database
// This fixes WhatsApp numbers that may have @c.us or @s.whatsapp.net suffixes
// from the wwebjs era, ensuring they work with the new Baileys adapter

import { query } from '../src/repository/db.js';
import { normalizeWhatsappNumber } from '../src/utils/waHelper.js';

async function migrateWhatsAppNumbers() {
  console.log('=== WhatsApp Number Migration Script ===\n');
  console.log('This script will normalize all WhatsApp numbers in the database');
  console.log('to pure digits with 62 prefix (e.g., 628123456789)\n');
  
  try {
    // Start transaction
    await query('BEGIN');
    
    // Get all users with WhatsApp numbers
    const { rows: users } = await query(
      'SELECT user_id, nama, whatsapp FROM "user" WHERE whatsapp IS NOT NULL AND whatsapp != \'\''
    );
    
    console.log(`Found ${users.length} users with WhatsApp numbers\n`);
    
    let updatedCount = 0;
    let alreadyCleanCount = 0;
    const updates = [];
    
    for (const user of users) {
      const oldWa = user.whatsapp;
      const normalizedWa = normalizeWhatsappNumber(oldWa);
      
      if (oldWa !== normalizedWa) {
        updates.push({
          user_id: user.user_id,
          nama: user.nama,
          old: oldWa,
          new: normalizedWa
        });
        updatedCount++;
      } else {
        alreadyCleanCount++;
      }
    }
    
    console.log(`Users already in correct format: ${alreadyCleanCount}`);
    console.log(`Users needing update: ${updatedCount}\n`);
    
    if (updatedCount > 0) {
      console.log('=== Updates to be made ===');
      updates.forEach((u, i) => {
        console.log(`${i + 1}. ${u.user_id} (${u.nama})`);
        console.log(`   Old: ${u.old}`);
        console.log(`   New: ${u.new}\n`);
      });
      
      console.log('Applying updates...\n');
      
      for (const update of updates) {
        await query(
          'UPDATE "user" SET whatsapp = $1, updated_at = NOW() WHERE user_id = $2',
          [update.new, update.user_id]
        );
      }
      
      // Commit transaction
      await query('COMMIT');
      
      console.log(`✓ Successfully updated ${updatedCount} WhatsApp numbers`);
    } else {
      // No updates needed, rollback transaction
      await query('ROLLBACK');
      console.log('✓ All WhatsApp numbers are already in correct format');
    }
    
    console.log('\n=== Migration Complete ===');
    process.exit(0);
    
  } catch (error) {
    // Rollback on error
    try {
      await query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError);
    }
    
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateWhatsAppNumbers();
