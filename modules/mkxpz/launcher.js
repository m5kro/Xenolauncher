// Launches RPG VX Ace, VX, and XP games using MKXP-Z
// Auto detects the RTP version of the game and sets the correct values in the mkxp.json file
// Uses the kawariki patches to fix some windows API calls
// Still need to add and apply mkxpz advanced options
const mkxpzLaunch = (gamePath, gameFolder, gameArgs) => {
    const fs = require('fs');
    const path = require('path');
    const { exec } = require('child_process');

    const mkxpzJsonPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'mkxpz', 'Z-Universal.app', 'Contents', 'Game', 'mkxp.json');

    // Find the RTP version of the game
    const getRtpValue = (folderPath) => {
        const gameIniPath = path.join(folderPath, 'Game.ini');
        try {
            const data = fs.readFileSync(gameIniPath, 'utf-8');
            const lines = data.split('\n');
            for (const line of lines) {
                const match = line.match(/\s*rtp\s*=\s*(.*)/i);
                if (match) {
                    const rtpValue = match[1].trim().toLowerCase();
                    if (rtpValue === 'standard') {
                        return ['Standard', 1];
                    } else if (rtpValue === 'rpgvx') {
                        return ['RPGVX', 2];
                    } else if (rtpValue === 'rpgvxace') {
                        return ['RPGVXace', 3];
                    } else {
                        return [match[1].trim(), 1];
                    }
                }
            }
            console.warn('RTP value not found in Game.ini. Assuming Standard RTP (RPG XP).');
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error(`Game.ini file not found in the folder: ${folderPath}`);
            } else {
                console.error(`Error reading Game.ini file: ${err.message}`);
            }
        }
        return ['Standard', 1];
    };

    const RTP = getRtpValue(gameFolder);
    const rtpPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'RTP', RTP[0]);
    const kawarikiPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'kawariki', 'preload.rb');
    const midiSoundFontPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'soundfonts', 'GMGSx.SF2');
    
    // Create the mkxp.json file with the correct values
    mkxpzJson = {
        "gameFolder": gameFolder,
        "RTP": [rtpPath],
        "midiSoundFont": midiSoundFontPath,
        "preloadScript": [kawarikiPath],
        "rgssVersion": RTP[1]
    };
    fs.writeFileSync(mkxpzJsonPath, JSON.stringify(mkxpzJson, null, 4));

    // Launch the game using MKXP-Z
    const mkxpzPath = path.join(os.homedir(), 'Library', 'Application Support', 'Xenolauncher', 'mkxpz', 'Z-Universal.app', 'Contents', 'MacOS', 'Z-Universal');
    exec(`"${mkxpzPath}"`, (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(stdout);
    });
}