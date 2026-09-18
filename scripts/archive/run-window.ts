import {
  processWindow,
  sweep,
} from "../src/server/youtube-intelligence/runner.ts";
import { db } from "../src/server/youtube-intelligence/store.ts";
await sweep();
console.log(await processWindow(120000));
await db().close();
