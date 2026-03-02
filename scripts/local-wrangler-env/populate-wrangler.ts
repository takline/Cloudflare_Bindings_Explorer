import { $ } from "bun";
import { unlink } from "node:fs/promises";

async function populateKV() {
  console.log("Populating KV (binding: MOCK_KV)...");
  for (let i = 1; i <= 20; i++) {
    const key = `user_session_${i}`;
    const value = JSON.stringify({ userId: i, loginTime: Date.now(), active: i % 2 === 0 });
    await $`bunx wrangler kv key put ${key} '${value}' --binding MOCK_KV --local`.quiet();
  }
  console.log("KV populated with 20 objects.");
}

async function populateD1() {
  console.log("Populating D1 (database: mock-db)...");
  await $`bunx wrangler d1 execute mock-db --command "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, role TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);" --local`.quiet();
  
  await $`bunx wrangler d1 execute mock-db --command "DELETE FROM users;" --local`.quiet();

  let values = [];
  for (let i = 1; i <= 20; i++) {
    values.push(`(${i}, 'User ${i}', '${i % 3 === 0 ? "admin" : "member"}')`);
  }
  
  const insertCommand = `INSERT INTO users (id, name, role) VALUES ${values.join(", ")};`;
  await $`bunx wrangler d1 execute mock-db --command ${insertCommand} --local`.quiet();
  console.log("D1 populated with 20 objects.");
}

async function populateR2() {
  console.log("Populating R2 (bucket: mock-bucket)...");
  try {
    await $`bunx wrangler r2 bucket create mock-bucket --local`.quiet();
  } catch (e) {
    // Ignore if it already exists
  }

  for (let i = 1; i <= 20; i++) {
    const fileName = `temp-mock-file-${i}.txt`;
    const content = `This is mock file number ${i} with some verifiable text data.\nGenerated at ${new Date().toISOString()}`;
    await Bun.write(fileName, content);
    
    await $`bunx wrangler r2 object put mock-bucket/mock-files/file-${i}.txt --file ${fileName} --local`.quiet();
    
    await unlink(fileName);
  }
  console.log("R2 populated with 20 objects.");
}

async function main() {
  console.log("Starting mock data population...");
  try {
    await populateKV();
    await populateD1();
    await populateR2();
    console.log("Successfully populated local wrangler environment!");
  } catch (error) {
    console.error("Error populating data:", error);
    process.exit(1);
  }
}

main();
