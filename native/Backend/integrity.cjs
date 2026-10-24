"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const RECEIPT = ".native-integrity.json";

function relative(value) {
    if (value === ".") return value;
    if (typeof value !== "string" || path.isAbsolute(value) || value.includes("\\")
        || value.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Invalid integrity path");
    return value;
}
function safePath(root, value) {
    relative(value);
    if (value === ".") return root;
    const parts = value.split("/");
    let current = root;
    for (const part of parts.slice(0, -1)) {
        current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked parent directory");
        } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return path.join(root, value);
}
async function entry(file, signal) {
    signal?.throwIfAborted();
    const st = await fs.promises.lstat(file);
    if (st.isSymbolicLink()) return { type: "link", target: await fs.promises.readlink(file) };
    if (st.isDirectory()) return { type: "directory" };
    if (!st.isFile()) throw new Error("Unsupported engine file type");
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk);
    return { type: "file", size: st.size, sha256: hash.digest("hex"), executable: !!(st.mode & 0o111) };
}
async function capture(root, scope, source = {}, signal) {
    relative(scope);
    const files = {};
    async function walk(value) {
        const file = safePath(root, value);
        const info = await entry(file, signal);
        files[value] = info;
        if (info.type === "directory") {
            for (const name of (await fs.promises.readdir(file)).sort()) {
                if (value === "." && (name === "deps" || name === RECEIPT || name.startsWith(RECEIPT + "."))) continue;
                await walk(value === "." ? name : `${value}/${name}`);
            }
        }
    }
    await walk(scope);
    if (!Object.values(files).some(info => info.type === "file")) throw new Error("Empty engine payload");
    return { source, files };
}
function read(root) {
    try {
        const value = JSON.parse(fs.readFileSync(path.join(root, RECEIPT), "utf8"));
        if (value.schema !== 1 || !value.scopes || typeof value.scopes !== "object" || Array.isArray(value.scopes)) throw Error();
        for (const [scope, record] of Object.entries(value.scopes)) {
            relative(scope);
            if (!record.files || typeof record.files !== "object" || !Object.keys(record.files).length) throw Error();
            for (const [file, info] of Object.entries(record.files)) {
                relative(file);
                if (scope !== "." && file !== scope && !file.startsWith(scope + "/")) throw Error();
                if (scope === "." && (file === "deps" || file.startsWith("deps/") || file === RECEIPT)) throw Error();
                if (!["file", "directory", "link"].includes(info.type)) throw Error();
                if (info.type === "file" && (!/^[a-f0-9]{64}$/.test(info.sha256) || typeof info.executable !== "boolean")) throw Error();
                if (info.type === "link" && typeof info.target !== "string") throw Error();
            }
        }
        return value;
    } catch (error) {
        return { schema: 1, scopes: {}, invalid: error.code !== "ENOENT" };
    }
}
function write(root, receipt) {
    const file = path.join(root, RECEIPT);
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify({ schema: 1, scopes: receipt.scopes }, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, file);
    } finally { fs.rmSync(tmp, { force: true }); }
}
async function check(root, receipt, signal, onProgress = () => {}) {
    let checkedFiles = 0;
    const issues = [];
    for (const record of Object.values(receipt.scopes)) {
        for (const [file, expected] of Object.entries(record.files)) {
            signal?.throwIfAborted();
            try {
                const actual = await entry(safePath(root, file), signal);
                const changed = actual.type !== expected.type
                    || (expected.type === "file" && (actual.size !== expected.size || actual.sha256 !== expected.sha256 || (expected.executable && !actual.executable)))
                    || (expected.type === "link" && actual.target !== expected.target);
                if (changed) issues.push({ path: file, reason: "changed" });
            } catch (error) {
                signal?.throwIfAborted();
                issues.push({ path: file, reason: error.code === "ENOENT" ? "missing" : "unreadable" });
            }
            checkedFiles++;
            if (checkedFiles % 50 === 0) onProgress(checkedFiles);
        }
    }
    return { checkedFiles, issues };
}
module.exports = { RECEIPT, relative, safePath, capture, read, write, check };
