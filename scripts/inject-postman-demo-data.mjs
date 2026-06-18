import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function run() {
  const collectionPath = join(process.cwd(), 'docs', 'postman_collection.json');
  const collection = JSON.parse(await readFile(collectionPath, 'utf-8'));

  // Define collection-level variables with seeded database UUIDs
  collection.variable = [
    {
      key: 'baseUrl',
      value: 'http://localhost:4000/v1',
      type: 'string'
    },
    {
      key: 'bearerToken',
      value: 'your-supabase-jwt-auth-token-here',
      type: 'string',
      description: 'Used for user-authenticated routes'
    },
    {
      key: 'operationsToken',
      value: 'ac5db6691927182a24a938d8b47a087f898557794239d1aa26e5246fc2a7ee62',
      type: 'string',
      description: 'Used for admin operations status endpoint'
    },
    {
      key: 'campusId',
      value: '11111111-1111-1111-1111-111111111111',
      type: 'string',
      description: 'Venite University Seed ID'
    },
    {
      key: 'zoneId',
      value: '21111111-1111-1111-1111-111111111111',
      type: 'string',
      description: 'Zone A Seed ID'
    },
    {
      key: 'locationId',
      value: '22111111-1111-1111-1111-111111111111',
      type: 'string',
      description: 'Unity Hostel Seed ID'
    },
    {
      key: 'vendorId',
      value: '31111111-1111-1111-1111-111111111111',
      type: 'string',
      description: 'Alliday Cafeteria Seed ID'
    },
    {
      key: 'itemId',
      value: '61111111-1111-1111-1111-111111111111',
      type: 'string',
      description: 'Jollof Rice MenuItem Seed ID'
    },
    {
      key: 'slotId',
      value: '51111111-1111-1111-1111-111111111111',
      type: 'string',
      description: '08:00 Delivery Slot Seed ID'
    }
  ];

  // Stringify the collection JSON with indentation
  const updatedContent = JSON.stringify(collection, null, 2);

  // Perform a global string replacement for <uuid> placeholders to make request bodies cleaner
  const withUuids = updatedContent
    .replace(/\"<uuid>\"/g, '"11111111-1111-1111-1111-111111111111"')
    .replace(/\"<string>\"/g, '"demo-value"')
    .replace(/\"<boolean>\"/g, 'true')
    .replace(/\"<number>\"/g, '100');

  await writeFile(collectionPath, withUuids, 'utf-8');
  console.log('Postman collection demo variables injected successfully!');
}

run().catch(console.error);
