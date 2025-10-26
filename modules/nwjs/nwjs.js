// Return a dictionary of available versions of NW.js to test multi-version support
async function getAvailable() {
    return {
        "v0.101.0": {
            x86_64: {
                link: "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-x64.zip",
                unzip: true,
            },
            arm64: {
                link: "https://dl.nwjs.io/v0.101.0/nwjs-sdk-v0.101.0-osx-arm64.zip",
                unzip: true,
            },
        },
    };
}
exports.getAvailable = getAvailable;