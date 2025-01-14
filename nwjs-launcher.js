// Launches the game using NW.js
// Default is the nwjs version that comes with the launcher
// Custom is the nwjs version that the user has installed
// Doesn't work right now, will be enabled in the next update
const nwjsLaunch = (gamePath, gameArgs) => {
    const path = require('path');
    const { exec } = require('child_process');
    let nwjsPath = '';
    if (gameArgs.nwjsVersion === 'default') {
        nwjsPath = 'nwjs';
    } else {
        nwjsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'nwjs', version);
    }
    exec(`${nwjsPath} ${gamePath} ${gameArgs}`, (err, stdout, stderr) => {
        if (err) {
        console.error(err);
        return;
        }
        console.log(stdout);
    });
    }