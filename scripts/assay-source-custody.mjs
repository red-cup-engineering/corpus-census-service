#!/usr/bin/env node
/**
 * Read three original Git-provider source cuts from bounded standard input.
 * Print one deterministic non-authoritative custody assay. No network, search,
 * filesystem traversal, self-granted source access, writes or Git mutation.
 */
import { assaySourceCustody } from "../src/source-custody.mjs";

const MAX_STDIN_BYTES = 16 * 1024 * 1024;

async function readBoundedInput(stream) {
  const chunks = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.from(value);
    size += chunk.byteLength;
    if (size > MAX_STDIN_BYTES) throw new RangeError("source custody input exceeds 16 MiB bound");
    chunks.push(chunk);
  }
  if (size === 0) throw new TypeError("source custody needs one complete input packet on stdin");
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

try {
  const data = JSON.parse(await readBoundedInput(process.stdin));
  process.stdout.write(JSON.stringify(assaySourceCustody(data)) + "\n");
} catch (error) {
  process.stderr.write("source custody refused: " + error.message + "\n");
  process.exitCode = 1;
}
