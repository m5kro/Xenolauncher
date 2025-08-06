
<img src="https://raw.githubusercontent.com/m5kro/Xenolauncher/main/Xenolauncher.png" width="258"/></img>
# Xenolauncher
An in progress modular game launcher and compatability layer for macos. The goal is to load games natively if possible, only using wine as a last resort.

[How to open an app from an unidentified developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) <-- You will need this for first setup

# Supported Game Engines
1. MacOS (.app)
2. RPG MV/MZ (NWjs)

# Planned Game Engines (No Particular Order)
If you have other engines that can work please post it in an issue<br>
1. RPG 2003, 2000 (EasyRPG)
2. Godot
3. Ren'Py (Python)
4. Flash (Ruffle) 
5. Java
6. TyranoBuilder
7. HTML
8. Android (Android Studio)
9. RPG VX Ace, VX, XP (MKXP-Z) <-- In Progress

# Known Unsupported Game Engines
Some of these can still be used with wine<br>
1. Unity
2. Unreal Engine

# Features
1. Dark mode

# Planned Features (No Particular Order)
1. Auto Read Game Folders
2. Add Icons
3. Pull from game database
4. Pull settings from database
5. Autodetect game type
6. Search bar
7. Categories/Tags
8. Check for updates
9. Combine CSS files
10. Better error correction

# How to Build
1. Install nodejs and npm through your preffered method (nodejs website or brew is recommended)
2. Clone the repo `git clone https://github.com/m5kro/Xenolauncher`
3. Enter the app folder `cd Xenolauncher/app`
4. Install node modules `npm install`
5. [Download the nwjs app](https://nwjs.io/)
6. Right click the nwjs app and press show package contents
7. Go to Contents/Resources
8. Create a folder called app.nw
9. Copy everything inside the app folder from the repo into the app.nw folder
