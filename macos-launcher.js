// Launches the game natively using the open or arch command
// Not "safe" though, as it auto trusts the game to make it more "seamless" for users
// Bypasses apple's stupid "unidentified developer" warning
const macosLaunch = (gamePath, gameArgs) => {
    const { exec } = require('child_process');
    console.log(gameArgs);
    if (gameArgs.runWithRosetta) {
        // Tim we are not cooking with this
        exec(`chmod -R +x "${gamePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
        exec(`xattr -cr "${gamePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
        // Forces the game to run with Rosetta on M series macs, support is not guaranteed
        exec(`arch -x86_64 "${gamePath}/Contents/MacOS/"*`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
    } else {
        // Why apple, why do you have to make this so difficult?
        exec(`xattr -cr "${gamePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
        exec(`open "${gamePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
    }
}