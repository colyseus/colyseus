import path from "path";
import fs from "fs";

let handle: fs.WriteStream;
let isClosing: boolean = false;

export function create (filepath: string) {
    if (fs.existsSync(filepath)) {
        const moveTo = `${path.basename(filepath)}.bkp`;
        console.log(`Moving previous "${path.basename(filepath)}" file to "${moveTo}"`);
        fs.renameSync(filepath, path.resolve(path.dirname(filepath), moveTo));
    }
    handle = fs.createWriteStream(filepath);
}

export function write(contents: any, close?: boolean) {
    if (!handle || isClosing) {
        return;
    }

    if (close) {
        isClosing = true;
    }

    return new Promise<void>((resolve, reject) => {
        const now = new Date();
        handle.write(`[${now.toLocaleString()}] ${contents}\n`, (err) => {
            if (err) { return reject(err); }
            if (isClosing) { handle.close(); }
            resolve();
        });

    })
}


