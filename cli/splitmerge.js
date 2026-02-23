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

async function mergeImages({ images, outPath, layout = '2', customGrid, gap = 0, width, height, bg, mode, quality }) {
    if (!images || images.length === 0) throw new Error('No input images provided');

    // Load all metadata
    const metas = await Promise.all(images.map(async p => {
        if (!fs.existsSync(p)) throw new Error(`Image not found: ${p}`);
        return { path: p, ...(await sharp(p).metadata()) };
    }));

    // Determine target dimensions
    let outW, outH;
    let gridRows, gridCols;

    if (layout === '3') {
        gridRows = 2; gridCols = 2; // Mixed 2 top, 1 bottom
        outW = 3000; outH = 3000;
    } else if (layout === '4') {
        gridRows = 2; gridCols = 2;
        outW = 3000; outH = 3000;
    } else if (layout === 'custom' && customGrid) {
        gridRows = customGrid.rows;
        gridCols = customGrid.cols;
        outW = width || 3000;
        outH = height || 3000;
    } else {
        // Layout '2' (Split) or default
        gridRows = 1; gridCols = 2;

        // Calculate auto dimensions for layout 2
        const left = metas[0];
        const right = metas[1] || metas[0]; // fallback
        if (width > 0 && height > 0) {
            outW = width; outH = height;
        } else if (width > 0) {
            const hw = (width - gap) / 2;
            const ls = hw / left.width;
            const rs = hw / right.width;
            outH = Math.round(Math.max(left.height * ls, right.height * rs));
            outW = width;
        } else if (height > 0) {
            const ls = height / left.height;
            const rs = height / right.height;
            outW = Math.round(left.width * ls + right.width * rs + gap);
            outH = height;
        } else {
            const th = Math.max(left.height, right.height);
            const ls = th / left.height;
            const rs = th / right.height;
            outW = Math.round(left.width * ls) + Math.round(right.width * rs) + gap;
            outH = th;
        }
    }

    const bgColor = parseBgColor(bg || '#000000');
    const compositeOps = [];

    // Calculate slots
    const slots = [];
    if (layout === '3') {
        const hw = (outW - gap) / 2;
        const hh = (outH - gap) / 2;
        slots.push({ x: 0, y: 0, w: hw, h: hh });
        slots.push({ x: hw + gap, y: 0, w: hw, h: hh });
        slots.push({ x: 0, y: hh + gap, w: outW, h: hh });
    } else if (layout === '4') {
        const hw = (outW - gap) / 2;
        const hh = (outH - gap) / 2;
        slots.push({ x: 0, y: 0, w: hw, h: hh });
        slots.push({ x: hw + gap, y: 0, w: hw, h: hh });
        slots.push({ x: 0, y: hh + gap, w: hw, h: hh });
        slots.push({ x: hw + gap, y: hh + gap, w: hw, h: hh });
    } else if (layout === 'custom' || layout === '2') {
        const cellW = (outW - (gridCols - 1) * gap) / gridCols;
        const cellH = (outH - (gridRows - 1) * gap) / gridRows;
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                slots.push({
                    x: Math.round(c * (cellW + gap)),
                    y: Math.round(r * (cellH + gap)),
                    w: Math.round(cellW),
                    h: Math.round(cellH)
                });
            }
        }
    }

    // Process each image into its slot
    for (let i = 0; i < Math.min(metas.length, slots.length); i++) {
        const meta = metas[i];
        const slot = slots[i];

        let resized;
        let top, left;

        if (mode === 'stretch') {
            resized = await sharp(meta.path)
                .resize(slot.w, slot.h, { fit: 'fill' })
                .toBuffer();
            top = slot.y;
            left = slot.x;
        } else {
            const fit = fitInBox(meta.width, meta.height, slot.w, slot.h);
            resized = await sharp(meta.path)
                .resize(fit.w, fit.h, { fit: 'fill' })
                .toBuffer();
            top = slot.y + fit.offsetY;
            left = slot.x + fit.offsetX;
        }

        compositeOps.push({ input: resized, top, left });
    }

    // Create result
    const result = sharp({
        create: {
            width: outW,
            height: outH,
            channels: 4,
            background: bgColor,
        }
    }).composite(compositeOps);

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
    if (args.help || process.argv.length <= 2) {
        console.log(`
╔══════════════════════════════════════════╗
║        Art Split Merger — CLI v2         ║
╚══════════════════════════════════════════╝

Usage:
  splitmerge [images...] --out <file> [options]
  splitmerge --batch <pairs.json> [--out-dir <dir>] [options]

Core Options:
  --out <file>        Output file path
  --layout <2|3|4|custom> (default: 2)
  --gap <px>          Spacing between images (default: 0)
  --rows <N>          Rows for custom layout
  --cols <N>          Columns for custom layout

Sizing & Styling:
  --width <px>        Output width (auto for layout 2, 3000 for others)
  --height <px>       Output height (auto for layout 2, 3000 for others)
  --bg <hex>          Background color (default: #000000)
  --mode <fit|stretch> Resize mode (default: fit)
  --quality <1-100>   JPEG/WebP quality (default: 92)

Batch Mode:
  --batch <json>      Path to JSON mapping file
  --out-dir <dir>     Output directory (default: .)

Examples:
  splitmerge img1.png img2.png --out merged.png
  splitmerge img1.png img2.png img3.png --layout 3 --gap 20 --out triptych.png
  splitmerge *.jpg --layout custom --rows 2 --cols 5 --out grid.png
    `);
        process.exit(0);
    }

    // Extract positional images
    const images = process.argv.slice(2).filter(a => !a.startsWith('--'));
    // But some flags might have positional-like values (handled by parseArgs)
    // Actually our simple parseArgs might grab them.
    // Let's refine image detection: any arg NOT starting with -- and NOT being a value for a flag.
    const imageList = [];
    const parsed = parseArgs(process.argv);

    // In our simple parser, we'll just use the positional args that aren't flag values
    // to keep it simple, I'll rely on the user providing images first or using --imgs (future)
    // For now, let's just use positional args from the end of process.argv that don't match flags.

    const options = {
        layout: parsed.layout || '2',
        gap: parseInt(parsed.gap) || 0,
        customGrid: {
            rows: parseInt(parsed.rows) || 2,
            cols: parseInt(parsed.cols) || 3
        },
        width: parseInt(parsed.width) || 0,
        height: parseInt(parsed.height) || 0,
        bg: parsed.bg || '#000000',
        mode: parsed.mode || 'fit',
        quality: parseInt(parsed.quality) || 92,
    };

    // Batch mode
    if (parsed.batch) {
        await runBatch(parsed.batch, parsed['out-dir'] || '.', options);
        return;
    }

    // Single mode - images from CLI
    // We need to filter out args that are values for flags
    const realImages = [];
    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg.startsWith('--')) {
            const next = process.argv[i + 1];
            if (next && !next.startsWith('--')) i++; // skip value
            continue;
        }
        realImages.push(arg);
    }

    if (realImages.length === 0 || !parsed.out) {
        console.error('Error: Input images and --out are required.');
        process.exit(1);
    }

    try {
        const result = await mergeImages({
            images: realImages,
            outPath: path.resolve(parsed.out),
            ...options
        });
        console.log(`✅ Merged: ${result.width}×${result.height} → ${parsed.out}`);
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
        const item = pairs[i];
        const outPath = path.resolve(outDir, item.out);

        let images = [];
        if (item.left && item.right) {
            images = [path.resolve(item.left), path.resolve(item.right)];
            process.stdout.write(`[${i + 1}/${pairs.length}] ${item.left} + ${item.right} → `);
        } else if (item.images && Array.isArray(item.images)) {
            images = item.images.map(img => path.resolve(img));
            process.stdout.write(`[${i + 1}/${pairs.length}] ${item.images.join(' + ')} → `);
        } else {
            console.log(`❌ Invalid batch item: must have {left, right} or {images: []}`);
            failed++;
            continue;
        }

        try {
            const result = await mergeImages({
                images,
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
