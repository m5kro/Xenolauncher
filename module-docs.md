# Manifest
Every module must come with a manifest.json file to let the launcher know about it.
## Required
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `name` | `string` | module name (no spaces) |
| `version` | `string` | module version identifier |
| `description` | `string` | a short description of your module |
| `author` | `string` | your name |
| `dependencies` | `array` | explained in dependencies section |
| `gameArgs` | `array` | explained in gameArgs section |
## Optional
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `additional-setup` | `boolean` | executes setup.js if it is found |


## Not Yet Implemented
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `multi-version` | `boolean` | Does your module need/support different versions of a compatability layer |
| `self-update` | `boolean` | Check for compatability layer updates on launch and prompt user |
| `custom-settings` | `boolean` | Use a custom settings page (checks for settings.html) |
| `custom-setup` | `boolean` | Use a custom setup page (checks for setup.html) |

## dependencies
Dependencies are only installed during the setup of the module.<br>
All dependencies will end up in a subfolder called deps in your module folder. Ex: `.../mkxpz/deps/RTP/...`
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `name` | `array` | subfolder name inside deps and what links to use (see example) |
| `arch` | `array` | can be `x86_64`, `arm64`, or `universal` (see example) <br> launcher will auto choose based on the system (universal is preffered) |
| `link` | `string` | link to download from |
| `unzip` | `boolean` | if the file needs to be unzipped |
### Example
```
"dependencies": {
    "nwjs": {
        "x86_64": {
            "link": "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-x64.zip",
            "unzip": true
        },
        "arm64": {
            "link": "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-arm64.zip",
            "unzip": true
        }
    }
}
```
## gameArgs
These options will be passed into your launch function.
| Name | Type | Description |
| :------------: | :----------: | :---- |
| `name` | `array` | name of your variable |
| `type` | `string` | Variable type, supports `string`, `int`, `float`, `boolean` <br> `dropdown` will also be added in a future update |
| `label` | `string` | label for the option in settings |
| `default` | any | default value for the option (can be blank "") |
### Example
```
"gameArgs": {
    "runWithRosetta": {
        "type": "boolean",
        "label": "Force Launch with Rosetta",
        "default": false
    }
}
```

# launcher.js
**Every module must have a launcher.js with a function named launch that takes in gamePath and gameArgs**<br>
**You must also export the launch function with `exports.launch = launch;`**<br>
<br>
launcher.js is the connector between xenolauncher and the compatability layer being used. It should take in gamePath and gameArgs and apply them to the compatability layer accordingly. It's up to you how it gets done.

### Example
```
const launch = (gamePath, gameArgs) => { // <-- REQUIRED
    const { exec } = require('child_process');
    console.log(gameArgs);
    if (gameArgs.runWithRosetta) {
        // Tim we are not cooking with this
        exec(`xattr -cr "${gamePath}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
        // Forces the game to run with Rosetta on M series macs, support is not guaranteed
        exec(`open --arch x86_64 "${gamePath}"`, (err, stdout, stderr) => {
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
};
exports.launch = launch; // <-- REQUIRED
```