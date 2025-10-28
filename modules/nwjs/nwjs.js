async function getAvailable() {
    const url = "https://nwjs.io/versions.json";
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const out = {};

    // Expecting shape: { versions: [ { version, files, flavors, ... }, ... ] }
    for (const entry of data.versions || []) {
        const v = entry.version;
        const files = entry.files || [];
        const flavors = entry.flavors || [];

        // Only include SDK flavor downloads cuz they are better for debugging
        if (!flavors.includes("sdk")) continue;

        const archs = {};

        // x64 Intel macOS builds
        if (files.includes("osx-x64")) {
            archs["x86_64"] = {
                link: `https://dl.nwjs.io/${v}/nwjs-sdk-${v}-osx-x64.zip`,
                unzip: true,
            };
        }

        // Apple Silicon macOS builds
        if (files.includes("osx-arm64")) {
            archs["arm64"] = {
                link: `https://dl.nwjs.io/${v}/nwjs-sdk-${v}-osx-arm64.zip`,
                unzip: true,
            };
        }

        if (Object.keys(archs).length > 0) {
            out[v] = archs;
        }
    }

    return out;
}
exports.getAvailable = getAvailable;