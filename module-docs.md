> [!NOTE]
> Modules will be moved to a seperate repository soon. A dedicated Wiki will also be created.

# Manifest
Every module must come with a manifest.json file to let the launcher know about it.
## Required
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `name` | `string` | module name (no spaces) |
| `version` | `string` | module version identifier |
| `description` | `string` | a short description of your module |
| `author` | `string` | your name |
| `license` | `string` | Which license the module is distributed under<br> (Please include a copy in your module folder) |
| `dependencies` | `array` | explained in dependencies section |
| `gameArgs` | `array` | explained in gameArgs section |
## Optional
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `additional-setup` | `boolean` | executes setup.js if it is found |
| `updates ` | `boolean` | explained in updates section |
| `autodetect` | `array` | explained in autodetect section |


## Not Yet Implemented
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `multi-version` | `type` | Does your module need/support different versions of a compatability layer |
| `custom-settings` | `boolean` | Use a custom settings page (checks for settings.html) |
| `custom-setup` | `boolean` | Use a custom setup page (checks for setup.html) |

## dependencies
Dependencies are only installed during the setup of the module.<br>
All dependencies will end up in a subfolder called deps in your module folder. Ex: `.../mkxpz/deps/RTP/...`

> [!NOTE]
> Listing dependencies in the manifest is technically optional if updates are enabled, but it is good practice to include them anyway. An update check will be triggered right after installation and any dependencies not listed in the manifest will be installed then.

| Name | Type | Description |
| :------------: | :----------: | :---- |
| `name` | `array` | subfolder name inside deps and what links to use (see example) |
| `arch` | `array` | can be `x86_64`, `arm64`, or `universal` (see example) <br> launcher will auto choose based on the system (universal is preffered) |
| `link` | `string` | link to download from |
| `unzip` | `boolean` | if the file needs to be unzipped |
### Example
`//` below means comment.
```
"dependencies": {
    "nwjs": {                                                                      // Dependency name
        "x86_64": {                                                                // Architecture type
            "link": "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-x64.zip",   // Link to dependency
            "unzip": true                                                          // If extraction is required
        },
        "arm64": {
            "link": "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-arm64.zip",
            "unzip": true
        }
    },
    // ... Other dependencies here
}
```
## gameArgs
These options will be passed into your launch function.
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `name` | `array` | name of your variable |
| `type` | `string` | Variable type, supports `string`, `int`, `float`, `boolean`, `dropdown`, `array`, `multi-version` |
| `label` | `string` | label for the option in settings |
| `default` | any | default value for the option (can be blank "") |

## Basic gameArgs Types
How to format the `string`, `int`, `float`, and `boolean` datatype in the manifest.<br>
`//` below means comment.

```
"gameArgs": {
    "runWithRosetta": {                          // Name of the variable
        "type": "boolean",                       // Type name
        "label": "Force Launch with Rosetta",    // Label
        "default": false                         // Default contents, should match with the type
    },
    // ... Other gameArgs here
}
```

## Advanced gameArgs Types
Advanced types require a bit more formatting due to the extra data required.<br>
`//` below means comment.

### dropdown
A dropdown menu with a list of predefined values.

> [!TIP]
> The default value should match with the corresponding value in the option, not the label. See example below for more details.

```
"gameArgs": {
    "rgssVersion": {                                      // Name of the variable
        "type": "dropdown",                               // dropdown type
        "label": "RGSS Version",                          // Label
        "default": "0",                                   // Default to 0, which selects Auto (0) in the UI
        "options": [                                      // Options should be an array
            { "label": "Auto (0)", "value": "0" },        // Each option should have a label and a value
            { "label": "RGSS1 (XP)", "value": "1" },
            { "label": "RGSS2 (VX)", "value": "2" },
            { "label": "RGSS3 (VX Ace)", "value": "3" }
        ]
    },
    // ... Other gameArgs here
}
```

### array
An array with multiple values of the same type. Users can add or remove values from the settings.<br>
<br>
```
"gameArgs": {
    "preloadScript": {                        // Name of the variable
        "type": "array",                      // array type
        "label": "Preload Ruby Scripts",      // Label
        "default": ["~/path-here"]            // Default values to include, can have multiple inside the array
    },
    // ... Other gameArgs here
}
```

### multi-version
If there are multiple versions of something that can be used. For example, if a tool introduces a bug in between versions, or different versions of the same tool have varying degrees of support for a game, etc.

> [!NOTE]
> Each multi-version variable must come with a version script that returns an array of available versions. It is not in the same format as the dependency system, so watch out.

A version script is used to determine what has already been installed and what is available. <br>
Format:
```
{
    "Version number": {
        "x86_64": {
            "link": "https://link.here",
            "unzip": true
        },
        "arm64": {
            "link": "https://link.here",
            "unzip": true
        }
    },
    "Version number": {
        "x86_64": {
            "link": "https://link.here",
            "unzip": true
        },
        "arm64": {
            "link": "https://link.here",
            "unzip": true
        }
    } // ... Goes on till the last version
}
```

On the manifest side, the multi version variable will look like a dropdown table but with a button to the right for managing available versions.

```
"gameArgs": {
    "version": {                      // Name of the variable
        "type": "multi-version",      // multi-version type
        "label": "NW.js Version",     // Label
        "version-script": "nwjs.js".  // version-script name
    },
    // ... Other gameArgs here
}
```

# launcher.js
launcher.js is the connector between xenolauncher and the compatability layer being used. It should take in gamePath and gameArgs and apply them to the compatability layer accordingly. It's up to you how it gets done.

> [!NOTE]
> Every module must have a launcher.js with a function named `launch` that takes in gamePath and gameArgs.<br>
> You must also export the launch function with `exports.launch = launch;`

Taking in the gameFolder variable is optional, it's mostly there for convienience. You can use any default nodejs imports but any others will need to be installed through the dependency system as js files.

> [!TIP]
> You don't need to include permission fixes, Xenolauncher will automatically run `chown -R`, `xattr -cr`, and `chmod -R 700` on the game folder.

### Example
```
const launch = (gamePath, gameFolder, gameArgs) => { // <-- REQUIRED
    const { exec } = require('child_process');
    console.log(gameArgs);
    if (gameArgs.runWithRosetta) {
        // Forces the game to run with Rosetta on M series macs, support is not guaranteed
        exec(`open --arch x86_64 "${gamePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
    } else {
        exec(`open "${gamePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
    }
};
exports.launch = launch; // <-- REQUIRED
```

# updates.js
updates.js is used to check for dependency updates. Updates will be applied using the dependency install system, so the return data should be the same format as the manifest dependency list.

> [!NOTE]
> Every update.js must have an **async** `checkUpdates` function.<br>
> You must also export the checkUpdates function with `exports.checkUpdates = checkUpdates;`

### Example
```
async function checkUpdates() {
    // Update finding logic here
    // Use web requests or other methods to find the lastest version
    return {
        "nwjs": {
            x86_64: {
                link: "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-x64.zip", // <-- Replace with new update link found from update finding logic
                unzip: true,
            },
            arm64: {
                link: "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-arm64.zip", // <-- Replace with new update link found from update finding logic
                unzip: true,
            },
        },
    };
}
exports.checkUpdates = checkUpdates;
```

# autodetect
The autodetect variable is used to determine the best compatability layer for the game. It works by selecting the best match based on the folder and file structure of the game.<br>
These are the required variables for autodetect:
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `files` | `array` | A file list, supports folders and path traversal |
| `all_required` | `boolean` | If all the files need to be present for the autodetect to succeed<br> If false, the best match will be selected |

### Example
```
"autodetect": {
    "files": ["Game.ini", "Data", "Graphics", "Audio"],
    "all_required": true
},
```