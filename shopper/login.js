// Opens the shopping Chrome profile so you can sign in to Walmart and
// Sam's Club once. Run with `npm run login`, sign in, then close the window.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const PROFILE_DIR = path.join(__dirname, '.chrome-profile');

(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      viewport: null,
    });
  } catch (err) {
    console.error("Couldn't open Google Chrome. Make sure it's installed, and that no other shopping run is using this profile.");
    console.error(err.message.split('\n')[0]);
    process.exit(1);
  }

  const [first] = context.pages();
  const walmart = first || (await context.newPage());
  await walmart.goto('https://www.walmart.com/account/login').catch(() => {});
  const sams = await context.newPage();
  await sams.goto('https://www.samsclub.com/login').catch(() => {});

  console.log('Sign in to Walmart and Sam\'s Club in the Chrome window (one tab each).');
  console.log('Tick "Keep me signed in" if you see it. Close the Chrome window when you\'re done.');
  await new Promise((resolve) => context.on('close', resolve));
  fs.writeFileSync(path.join(PROFILE_DIR, '.signed-in'), new Date().toISOString());
  console.log('Saved. You can now run `npm run shop`.');
})();
