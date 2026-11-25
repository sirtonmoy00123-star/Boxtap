// npx tsx tools/config.ts sign   — bumps seq, signs, writes public/config/v1.json for deploy
import { openKeyFile, signConfig } from './lib';
import { CONFIG_OUT, CONFIG_SRC, fail, KEY_FILE, passphrase } from './cli';

if (process.argv[2] !== 'sign') fail('usage: npx tsx tools/config.ts sign');
const signed = await signConfig(await openKeyFile(KEY_FILE, await passphrase()), CONFIG_SRC, CONFIG_OUT);
console.log(`Signed config seq ${signed.body.seq} (${signed.kid}) written to ${CONFIG_OUT}. Commit and deploy it.`);
