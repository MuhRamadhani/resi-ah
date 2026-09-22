// Script to find orphaned files in Storage (files not in database)
// Run: node find_orphaned_files.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ytsvvbbsrnoxwlsbaoja.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SERVICE_KEY_HERE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function findOrphanedFiles() {
  console.log('🔍 Fetching all files from Storage...');
  
  // Get all files from storage
  const { data: files, error: storageError } = await supabase.storage
    .from('receipts')
    .list('', {
      limit: 10000,
      sortBy: { column: 'name', order: 'asc' }
    });
  
  if (storageError) {
    console.error('❌ Storage error:', storageError);
    return;
  }
  
  console.log(`📦 Total files in Storage: ${files.length}`);
  
  // Get all image_url from database
  console.log('🔍 Fetching all image_url from database...');
  const { data: receipts, error: dbError } = await supabase
    .from('receipts')
    .select('image_url, status')
    .not('image_url', 'is', null)
    .neq('image_url', '');
  
  if (dbError) {
    console.error('❌ Database error:', dbError);
    return;
  }
  
  console.log(`📋 Total receipts with image_url: ${receipts.length}`);
  
  // Extract filenames from image_url
  const dbFilenames = new Set();
  receipts.forEach(r => {
    const match = r.image_url.match(/\/receipts\/(.+)$/);
    if (match) {
      const originalFile = match[1];
      dbFilenames.add(originalFile);
      // Also add expected thumbnail
      const thumbFile = originalFile.replace('.jpg', '_thumb.jpg');
      dbFilenames.add(thumbFile);
    }
  });
  
  console.log(`✅ Expected files in Storage (from DB): ${dbFilenames.size}`);
  
  // Find orphaned files
  const orphanedFiles = [];
  const orphanedThumbnails = [];
  
  files.forEach(f => {
    if (!dbFilenames.has(f.name)) {
      orphanedFiles.push(f.name);
      if (f.name.includes('_thumb.jpg')) {
        orphanedThumbnails.push(f.name);
      }
    }
  });
  
  console.log('\n📊 RESULTS:');
  console.log(`❌ Orphaned files: ${orphanedFiles.length}`);
  console.log(`   - Orphaned thumbnails: ${orphanedThumbnails.length}`);
  console.log(`   - Orphaned originals: ${orphanedFiles.length - orphanedThumbnails.length}`);
  
  if (orphanedFiles.length > 0) {
    console.log('\n🗑️  Orphaned files (first 20):');
    orphanedFiles.slice(0, 20).forEach(name => {
      console.log(`   - ${name}`);
    });
    
    console.log('\n💡 To delete these files, run:');
    console.log('   node delete_orphaned_files.js');
  } else {
    console.log('\n✅ No orphaned files found! Storage is clean.');
  }
  
  // Check Approved receipts that still have images
  console.log('\n🔍 Checking Approved receipts with images...');
  const approvedWithImages = receipts.filter(r => r.status === 'Approved');
  console.log(`⚠️  Approved receipts still with images: ${approvedWithImages.length}`);
  
  if (approvedWithImages.length > 0) {
    console.log('   These should be deleted after approval (old receipts before fix)');
  }
}

findOrphanedFiles().catch(console.error);
