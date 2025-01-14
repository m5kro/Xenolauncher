// Launches the game natively using the open or arch command
const macosLaunch = (gamePath, gameArgs) => {
    const { exec } = require('child_process');
    console.log(gameArgs);
    if (gameArgs.runWithRosetta) {
        // Forces the game to run with Rosetta on M series macs, support is not guaranteed
        exec(`arch -x86_64 ${gamePath}/Contents/MacOS/*`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
    } else {
        exec(`open ${gamePath}`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
    }
}