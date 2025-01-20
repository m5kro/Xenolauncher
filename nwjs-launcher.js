// Launches the game using NW.js
// Unfortunately, the NW.js instance being used by Xenolauncher doesn't work due to session conflicts :(
// Requires at least one NW.js version to be installed + permission fixes that are applied during the installation process
const nwjsLaunch = (gamePath, gameArgs) => {
    const path = require('path');
    const { exec } = require('child_process');
    if (!gameArgs.nwjsVersion) {
        alert('Please select a NW.js version to launch the game with, or if you haven\'t, please install one');
    } else {
        nwjsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'nwjs', gameArgs.nwjsVersion, 'nwjs.app', 'Contents', 'MacOS', 'nwjs');
        exec(`"${nwjsPath}" "${path.dirname(gamePath)}"`, (err, stdout, stderr) => {
            if (err) {
            console.error(err);
            return;
            }
            console.log(stdout);
        });
    }
}