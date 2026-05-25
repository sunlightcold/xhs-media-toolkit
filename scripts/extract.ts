import { extractOriginalUrlsFromShareText } from "../src/xhs/extractor.js";

const shareText = process.argv.slice(2).join(" ").trim();

if (!shareText) {
  console.error('Usage: pnpm run extract -- "<share text or note URL>"');
  process.exit(1);
}

try {
  const result = await extractOriginalUrlsFromShareText(shareText);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
