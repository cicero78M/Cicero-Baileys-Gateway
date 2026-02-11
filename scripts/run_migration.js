#!/usr/bin/env node
/**
 * Migration Runner Script
 * 
 * This script safely runs SQL migration files with validation and error handling.
 * It prevents common issues like HTML-encoded SQL or syntax errors.
 * 
 * Usage: node scripts/run_migration.js <migration-file>
 * Example: node scripts/run_migration.js sql/migrations/20260209_add_unique_constraint_user_whatsapp.sql
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables
dotenv.config();

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function validateSQLContent(content) {
  const issues = [];
  
  // Check for HTML entities
  if (content.includes('&lt;') || content.includes('&gt;') || content.includes('&amp;')) {
    issues.push('SQL contains HTML entities (&lt;, &gt;, &amp;). File may have been copied from a web page.');
  }
  
  // Check for truncated lines (skip comment lines)
  // Note: This is a very conservative check focused on detecting obviously corrupted content
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip empty lines and comment lines
    if (line.length === 0 || line.startsWith('--')) {
      continue;
    }
    // Only flag lines that look suspiciously incomplete
    // Must end with a single word fragment (no SQL keywords, no punctuation)
    const lastPart = line.split(/\s+/).pop();
    const endsWithFragment = line.length > 20 && 
                             !line.match(/[;,)(]$/) && 
                             !lastPart.match(/^(NULL|AND|OR|NOT|IS|AS|ON|IN|BY|TO|FROM|WHERE|SET)$/i) &&
                             lastPart.match(/^[a-z]{3,}$/i);
    if (endsWithFragment) {
      issues.push(`Line ${i + 1} may be truncated: "${line.substring(0, 50)}..."`);
    }
  }
  
  // Check for proper SQL structure
  const upperContent = content.toUpperCase();
  const hasUpdate = upperContent.includes('UPDATE');
  const hasCreate = upperContent.includes('CREATE');
  const hasAlter = upperContent.includes('ALTER');
  const hasDrop = upperContent.includes('DROP');
  
  if (!hasUpdate && !hasCreate && !hasAlter && !hasDrop) {
    issues.push('SQL does not contain common DDL/DML statements. May not be a valid migration.');
  }
  
  return issues;
}

async function runMigration(migrationPath) {
  log('\n=== SQL Migration Runner ===\n', colors.cyan);
  
  // Resolve path
  const fullPath = path.isAbsolute(migrationPath) 
    ? migrationPath 
    : path.join(process.cwd(), migrationPath);
  
  log(`Migration file: ${fullPath}`, colors.blue);
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    log(`\n❌ Error: Migration file not found: ${fullPath}`, colors.red);
    process.exit(1);
  }
  
  // Read file content
  const content = fs.readFileSync(fullPath, 'utf-8');
  log(`File size: ${content.length} bytes`, colors.blue);
  
  // Validate SQL content
  log('\nValidating SQL content...', colors.yellow);
  const issues = validateSQLContent(content);
  
  if (issues.length > 0) {
    log('\n⚠️  Validation warnings:', colors.yellow);
    issues.forEach(issue => log(`  - ${issue}`, colors.yellow));
    log('\nPlease review the migration file before continuing.', colors.yellow);
    log('Press Ctrl+C to cancel, or wait 5 seconds to continue anyway...\n', colors.yellow);
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    log('✓ No issues detected in SQL content', colors.green);
  }
  
  // Create database connection
  const client = new pg.Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    port: process.env.DB_PORT || 5432
  });
  
  try {
    log('\nConnecting to database...', colors.cyan);
    log(`  Host: ${process.env.DB_HOST}:${process.env.DB_PORT || 5432}`, colors.blue);
    log(`  Database: ${process.env.DB_NAME}`, colors.blue);
    log(`  User: ${process.env.DB_USER}`, colors.blue);
    
    await client.connect();
    log('✓ Connected to database', colors.green);
    
    log('\nExecuting migration...', colors.cyan);
    await client.query(content);
    log('\n✓ Migration completed successfully!', colors.green);
    
    await client.end();
    process.exit(0);
  } catch (error) {
    log(`\n❌ Migration failed:`, colors.red);
    log(error.message, colors.red);
    if (error.stack) {
      log('\nStack trace:', colors.red);
      log(error.stack, colors.red);
    }
    
    try {
      await client.end();
    } catch {
      // Ignore connection close errors - client may already be disconnected
      // This is safe because we're already in the error handler and about to exit
    }
    
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  log('Usage: node scripts/run_migration.js <migration-file>', colors.yellow);
  log('Example: node scripts/run_migration.js sql/migrations/20260209_add_unique_constraint_user_whatsapp.sql', colors.yellow);
  process.exit(1);
}

// Check required environment variables
const requiredEnvVars = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASS'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  log('\n❌ Missing required environment variables:', colors.red);
  missingVars.forEach(v => log(`  - ${v}`, colors.red));
  log('\nPlease ensure your .env file is configured correctly.', colors.yellow);
  log('See .env.example for reference.', colors.yellow);
  process.exit(1);
}

runMigration(args[0]);
