#!/usr/bin/env node

/**
 * splitmerge — CLI tool for merging two split album cover images.
 *
 * Usage:
 *   splitmerge --left a.png --right b.png --out output.png
 *   splitmerge --left a.png --right b.png --width 3000 --height 1500 --out output.png
 *   splitmerge --left a.png --right b.png --bg "#ffffff" --mode stretch --out output.jpg --quality 90
 *   splitmerge --batch pairs.json --out-dir ./merged/
 *
 * Batch JSON format:
 *   [
 *     { "left": "a.png", "right": "b.png", "out": "ab_merged.png" },
 *     { "left": "c.png", "right": "d.png", "out": "cd_merged.png" }
 *   ]
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ─── Argument Parser ─────────────────────────────────────────────────

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const key = argv[i];
        if (key.startsWith('--')) {
            const name = key.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                args[name] = next;
                i++;
            } else {
                args[name] = true;
            }
        }
    }
    return args;
}

// ─── Merge Logic ─────────────────────────────────────────────────────

async function mergeImages({ leftPath, rightPath, outPath, width, height, bg, mode, quality }) {
    // Validate inputs exist
    if (!fs.existsSync(leftPath)) throw new Error(`Left image not found: ${leftPath}`);
    if (!fs.existsSync(rightPath)) throw new Error(`Right image not found: ${rightPath}`);

    // Load images
    const leftMeta = await sharp(leftPath).metadata();
    const rightMeta = await sharp(rightPath).metadata();

    const lw = leftMeta.width, lh = leftMeta.height;
    const rw = rightMeta.width, rh = rightMeta.height;

    let outW, outH;

    if (width > 0 && height > 0) {
        outW = width;
        outH = height;
    } else if (width > 0) {
        const halfW = Math.floor(width / 2);
        const leftScale = halfW / lw;
        const rightScale = halfW / rw;
        outH = Math.round(Math.max(lh * leftScale, rh * rightScale));
        outW = width;
    } else if (height > 0) {
        const leftScale = height / lh;
        const rightScale = height / rh;
        outW = Math.round(lw * leftScale + rw * rightScale);
        outH = height;
    } else {
        // Auto: normalize to tallest height
        const targetH = Math.max(lh, rh);
        const leftScale = targetH / lh;
        const rightScale = targetH / rh;
        outW = Math.round(lw * leftScale) + Math.round(rw * rightScale);
        outH = targetH;
    }

    const halfW = Math.round(outW / 2);
    const rightHalfW = outW - halfW;

    // Parse background color
    const bgColor = parseBgColor(bg || '#000000');

    let leftResized, rightResized;
    let leftTop, rightTop, leftLeft, rightLeft;

    if (mode === 'stretch') {
        // Stretch to fill each half
        leftResized = await sharp(leftPath)
            .resize(halfW, outH, { fit: 'fill' })
            .toBuffer();
        rightResized = await sharp(rightPath)
            .resize(rightHalfW, outH, { fit: 'fill' })
            .toBuffer();
        leftTop = 0; leftLeft = 0;
        rightTop = 0; rightLeft = halfW;
    } else {
        // Fit: preserve aspect ratio, center
        const leftFit = fitInBox(lw, lh, halfW, outH);
        const rightFit = fitInBox(rw, rh, rightHalfW, outH);

        leftResized = await sharp(leftPath)
            .resize(leftFit.w, leftFit.h, { fit: 'fill' })
            .toBuffer();
        rightResized = await sharp(rightPath)
            .resize(rightFit.w, rightFit.h, { fit: 'fill' })
            .toBuffer();

        leftTop = leftFit.offsetY;
        leftLeft = leftFit.offsetX;
        rightTop = rightFit.offsetY;
        rightLeft = halfW + rightFit.offsetX;
    }

    // Create output canvas and composite
    const result = sharp({
        create: {
            width: outW,
            height: outH,
            channels: 4,
            background: bgColor,
        }
    }).composite([
        { input: leftResized, top: leftTop, left: leftLeft },
        { input: rightResized, top: rightTop, left: rightLeft },
    ]);

    // Determine output format
    const ext = path.extname(outPath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
        await result.jpeg({ quality: quality || 92 }).toFile(outPath);
    } else if (ext === '.webp') {
        await result.webp({ quality: quality || 92 }).toFile(outPath);
    } else {
        await result.png().toFile(outPath);
    }

    return { width: outW, height: outH };
}

function fitInBox(srcW, srcH, targetW, targetH) {
    const scale = Math.min(targetW / srcW, targetH / srcH);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    const offsetX = Math.round((targetW - w) / 2);
    const offsetY = Math.round((targetH - h) / 2);
    return { w, h, offsetX, offsetY };
}

function parseBgColor(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b, alpha: 1 };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv);

    // Help
    if (args.help || Object.keys(args).length === 0) {
        console.log(`
╔══════════════════════════════════════════╗
║        Art Split Merger — CLI            ║
╚══════════════════════════════════════════╝

Usage:
  splitmerge --left <file> --right <file> --out <file> [options]
  splitmerge --batch <pairs.json> [--out-dir <dir>] [options]

Options:
  --left <file>       Left image path
  --right <file>      Right image path
  --out <file>        Output file path
  --width <px>        Custom output width (default: auto)
  --height <px>       Custom output height (default: auto)
  --bg <hex>          Background color (default: #000000)
  --mode <fit|stretch> Resize mode (default: fit)
  --quality <1-100>   JPEG/WebP quality (default: 92)
  --batch <json>      Batch mode: path to JSON file with pairs
  --out-dir <dir>     Batch output directory (default: current dir)
  --help              Show this help

Examples:
  splitmerge --left cover_a.png --right cover_b.png --out merged.png
  splitmerge --left a.jpg --right b.jpg --width 3000 --height 1500 --out output.png
  splitmerge --batch pairs.json --out-dir ./output/ --bg "#1a1a1a"
    `);
        process.exit(0);
    }

    const options = {
        width: parseInt(args.width) || 0,
        height: parseInt(args.height) || 0,
        bg: args.bg || '#000000',
        mode: args.mode || 'fit',
        quality: parseInt(args.quality) || 92,
    };

    // Batch mode
    if (args.batch) {
        await runBatch(args.batch, args['out-dir'] || '.', options);
        return;
    }

    // Single mode
    if (!args.left || !args.right || !args.out) {
        console.error('Error: --left, --right, and --out are required.');
        process.exit(1);
    }

    try {
        const result = await mergeImages({
            leftPath: path.resolve(args.left),
            rightPath: path.resolve(args.right),
            outPath: path.resolve(args.out),
            ...options
        });
        console.log(`✅ Merged: ${result.width}×${result.height} → ${args.out}`);
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
}

async function runBatch(jsonPath, outDir, options) {
    if (!fs.existsSync(jsonPath)) {
        console.error(`Batch file not found: ${jsonPath}`);
        process.exit(1);
    }

    // Ensure output directory exists
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const pairs = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (!Array.isArray(pairs)) {
        console.error('Batch file must be a JSON array of { left, right, out } objects.');
        process.exit(1);
    }

    console.log(`📦 Batch mode: ${pairs.length} pairs\n`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const outPath = path.resolve(outDir, pair.out);
        process.stdout.write(`[${i + 1}/${pairs.length}] ${pair.left} + ${pair.right} → `);

        try {
            const result = await mergeImages({
                leftPath: path.resolve(pair.left),
                rightPath: path.resolve(pair.right),
                outPath,
                ...options
            });
            console.log(`✅ ${result.width}×${result.height}`);
            success++;
        } catch (err) {
            console.log(`❌ ${err.message}`);
            failed++;
        }
    }

    console.log(`\n📊 Results: ${success} success, ${failed} failed out of ${pairs.length} total.`);
    if (failed > 0) process.exit(1);
}

// Export for testing
module.exports = { mergeImages, parseArgs, fitInBox, parseBgColor };

// Run if executed directly
if (require.main === module) {
    main().catch(err => {
        console.error(`❌ Fatal: ${err.message}`);
        process.exit(1);
    });
}
