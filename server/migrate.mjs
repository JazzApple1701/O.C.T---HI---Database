import { openDatabase, updateIBMappings } from "./db.mjs";

const db = openDatabase();
console.log("Starting IB mapping migration...");
updateIBMappings(db);
console.log("Migration complete.");
process.exit(0);
