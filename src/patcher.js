process.noAsar = true;

const fs = require('fs');
const path = require('path');

function patchAsarArchive(sourceAsarPath, destinationAsarPath) {
    const targetOutput = destinationAsarPath || sourceAsarPath;

    if (!sourceAsarPath || !fs.existsSync(sourceAsarPath)) {
        throw new Error(`Target ASAR archive not found: ${sourceAsarPath}`);
    }

    const sourceDescriptor = fs.openSync(sourceAsarPath, 'r');
    const headerPrefix = Buffer.alloc(16);
    fs.readSync(sourceDescriptor, headerPrefix, 0, 16, 0);

    if (headerPrefix.readUInt32LE(0) !== 4) {
        fs.closeSync(sourceDescriptor);
        throw new Error('Invalid ASAR archive signature');
    }

    const headerLength = headerPrefix.readUInt32LE(12);
    const headerBuffer = Buffer.alloc(headerLength);
    fs.readSync(sourceDescriptor, headerBuffer, 0, headerLength, 16);
    const headerStructure = JSON.parse(headerBuffer.toString('utf8'));

    const headerAlignedOffset = 16 + (headerLength % 4 === 0 ? headerLength : headerLength + (4 - (headerLength % 4)));

    const fileEntries = [];
    const traverseDirectory = (node, relativePath = '') => {
        for (const [name, entry] of Object.entries(node.files || {})) {
            const currentPath = relativePath ? `${relativePath}/${name}` : name;
            if (entry.files) {
                traverseDirectory(entry, currentPath);
            } else if (!entry.unpacked) {
                fileEntries.push({
                    path: currentPath,
                    node: entry,
                    originalOffset: BigInt(entry.offset),
                    originalSize: entry.size
                });
            }
        }
    };

    traverseDirectory(headerStructure);
    fileEntries.sort((a, b) => Number(a.originalOffset - b.originalOffset));

    const mainEntry = fileEntries.find(file => file.path === 'main.js');
    if (!mainEntry) {
        fs.closeSync(sourceDescriptor);
        throw new Error('main.js entry missing from ASAR archive');
    }

    const mainSourceBuffer = Buffer.alloc(mainEntry.originalSize);
    fs.readSync(sourceDescriptor, mainSourceBuffer, 0, mainEntry.originalSize, headerAlignedOffset + Number(mainEntry.originalOffset));
    let mainScriptSource = mainSourceBuffer.toString('utf8');

    const hookSignature = '/* FACEIT_EXT_LOADER */';
    if (!mainScriptSource.includes(hookSignature)) {
        const injectionTarget = 'let f=require("electron");f=u(f,1);';
        if (!mainScriptSource.includes(injectionTarget)) {
            fs.closeSync(sourceDescriptor);
            throw new Error('Target entrypoint pattern not found in main.js');
        }

        const loaderHook = `${injectionTarget}\n${hookSignature}try{require(require("path").join(__dirname,"..","extensionLoader.js"));}catch(e){console.error("[ExtLoader] Init failure:",e);}\n`;
        mainScriptSource = mainScriptSource.replace(injectionTarget, loaderHook);
    }

    const updatedMainBuffer = Buffer.from(mainScriptSource, 'utf8');
    const outputBuffers = [];
    let cumulativeOffset = 0n;

    for (const file of fileEntries) {
        let payload;
        if (file.path === 'main.js') {
            payload = updatedMainBuffer;
            delete file.node.integrity;
        } else {
            payload = Buffer.alloc(file.originalSize);
            fs.readSync(sourceDescriptor, payload, 0, file.originalSize, headerAlignedOffset + Number(file.originalOffset));
        }

        file.node.size = payload.length;
        file.node.offset = cumulativeOffset.toString();
        cumulativeOffset += BigInt(payload.length);
        outputBuffers.push(payload);
    }

    fs.closeSync(sourceDescriptor);

    const serializedHeader = JSON.stringify(headerStructure);
    let serializedBuffer = Buffer.from(serializedHeader, 'utf8');
    const alignmentRemainder = serializedBuffer.length % 4;
    const paddingLength = alignmentRemainder === 0 ? 0 : 4 - alignmentRemainder;

    if (paddingLength > 0) {
        serializedBuffer = Buffer.concat([serializedBuffer, Buffer.alloc(paddingLength)]);
    }

    const outputHeaderPrefix = Buffer.alloc(16);
    outputHeaderPrefix.writeUInt32LE(4, 0);
    outputHeaderPrefix.writeUInt32LE(serializedBuffer.length + 8, 4);
    outputHeaderPrefix.writeUInt32LE(serializedBuffer.length + 4, 8);
    outputHeaderPrefix.writeUInt32LE(Buffer.byteLength(serializedHeader, 'utf8'), 12);

    const temporaryPath = `${targetOutput}.tmp`;
    const destinationDescriptor = fs.openSync(temporaryPath, 'w');

    fs.writeSync(destinationDescriptor, outputHeaderPrefix);
    fs.writeSync(destinationDescriptor, serializedBuffer);

    for (const buffer of outputBuffers) {
        fs.writeSync(destinationDescriptor, buffer);
    }

    fs.closeSync(destinationDescriptor);

    if (fs.existsSync(targetOutput)) {
        fs.unlinkSync(targetOutput);
    }
    fs.renameSync(temporaryPath, targetOutput);
}

try {
    const inputAsar = process.argv[2];
    const outputAsar = process.argv[3] || inputAsar;
    patchAsarArchive(inputAsar, outputAsar);
    process.exit(0);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
