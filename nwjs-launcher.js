// Launches the game using NW.js
// Unfortunately, the NW.js instance being used by Xenolauncher doesn't work due to session conflicts :(
// Requires at least one NW.js version to be installed + permission fixes that are applied during the installation process
const nwjsLaunch = (gamePath, gameArgs) => {
    const path = require('path');
    const { exec } = require('child_process');
    const fs = require('fs');
    if (!gameArgs.nwjsVersion) {
        alert('Please select a NW.js version to launch the game with, or if you haven\'t, please install one');
    } else {
        nwjsPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'nwjs', gameArgs.nwjsVersion, 'nwjs.app', 'Contents', 'MacOS', 'nwjs');
        // Check package.json in the game directory for a name if there isn't then give it one
        const packageJsonPath = path.join(path.dirname(gamePath), 'package.json');
        let gameName = 'Game';
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            if (!(packageJson.name.trim())) {
                // If the name is empty, give it a default name and write to the json file
                packageJson.name = gameName;
                fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4));
            }
        }

        // Launch the game using NW.js
        exec(`"${nwjsPath}" "${path.dirname(gamePath)}"`, (err, stdout, stderr) => {
            if (err) {
            console.error(err);
            return;
            }
            console.log(stdout);
        });
    }
}