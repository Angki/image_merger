/**
 * CLI Unit Tests — Tests for splitmerge.js merge logic.
 * 
 * Uses Node.js built-in test runner (node:test).
 * 
 * Run: node --test tests/cli.test.js
 *   (from the art_split_merger directory)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { mergeImages, parseArgs, fitInBox, parseBgColor } = require('../cli/splitmerge.js');

const TEST_DIR = path.join(__dirname, 'test-images');
const OUTPUT_DIR = path.join(__dirname, 'test-output');

// ─── Setup / Teardown ────────────────────────────────────────────────

before(async () => {
    // Create test image directory
    if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Generate test images
    await sharp({
        create: { width: 500, height: 500, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).png().toFile(path.join(TEST_DIR, 'red_500x500.png'));

    await sharp({
        create: { width: 500, height: 500, channels: 3, background: { r: 0, g: 0, b: 255 } }
    }).png().toFile(path.join(TEST_DIR, 'blue_500x500.png'));

    await sharp({
        create: { width: 300, height: 600, channels: 3, background: { r: 0, g: 255, b: 0 } }
    }).png().toFile(path.join(TEST_DIR, 'green_300x600.png'));

    await sharp({
        create: { width: 800, height: 400, channels: 3, background: { r: 255, g: 255, b: 0 } }
    }).png().toFile(path.join(TEST_DIR, 'yellow_800x400.png'));
});

after(() => {
    // Cleanup output files
    if (fs.existsSync(OUTPUT_DIR)) {
        fs.readdirSync(OUTPUT_DIR).forEach(f => fs.unlinkSync(path.join(OUTPUT_DIR, f)));
        fs.rmdirSync(OUTPUT_DIR);
    }
});

// ─── parseArgs Tests ─────────────────────────────────────────────────

describe('parseArgs', () => {
    it('parses basic flags', () => {
        const args = parseArgs(['node', 'script', '--left', 'a.png', '--right', 'b.png', '--out', 'c.png']);
        assert.equal(args.left, 'a.png');
        assert.equal(args.right, 'b.png');
        assert.equal(args.out, 'c.png');
    });

    it('parses numeric values', () => {
        const args = parseArgs(['node', 'script', '--width', '3000', '--height', '1500']);
        assert.equal(args.width, '3000');
        assert.equal(args.height, '1500');
    });

    it('parses boolean flags', () => {
        const args = parseArgs(['node', 'script', '--help']);
        assert.equal(args.help, true);
    });
});

// ─── fitInBox Tests ──────────────────────────────────────────────────

describe('fitInBox', () => {
    it('scales down to fit', () => {
        const result = fitInBox(1000, 1000, 500, 500);
        assert.equal(result.w, 500);
        assert.equal(result.h, 500);
        assert.equal(result.offsetX, 0);
        assert.equal(result.offsetY, 0);
    });

    it('centers within larger box', () => {
        const result = fitInBox(500, 500, 1000, 1000);
        assert.equal(result.w, 1000);
        assert.equal(result.h, 1000);
        assert.equal(result.offsetX, 0);
        assert.equal(result.offsetY, 0);
    });

    it('handles non-square — landscape in portrait box', () => {
        const result = fitInBox(1000, 500, 500, 500);
        assert.equal(result.w, 500);
        assert.equal(result.h, 250);
        assert.equal(result.offsetX, 0);
        assert.equal(result.offsetY, 125);
    });
});

// ─── parseBgColor Tests ──────────────────────────────────────────────

describe('parseBgColor', () => {
    it('parses 6-digit hex', () => {
        const c = parseBgColor('#ff0000');
        assert.equal(c.r, 255);
        assert.equal(c.g, 0);
        assert.equal(c.b, 0);
    });

    it('parses 3-digit hex', () => {
        const c = parseBgColor('#fff');
        assert.equal(c.r, 255);
        assert.equal(c.g, 255);
        assert.equal(c.b, 255);
    });

    it('parses without hash', () => {
        const c = parseBgColor('00ff00');
        assert.equal(c.r, 0);
        assert.equal(c.g, 255);
        assert.equal(c.b, 0);
    });
});

// ─── Merge Tests ─────────────────────────────────────────────────────

describe('mergeImages', () => {
    it('merges two same-size images — auto dimensions', async () => {
        const outPath = path.join(OUTPUT_DIR, 'merge_same_size.png');
        const result = await mergeImages({
            leftPath: path.join(TEST_DIR, 'red_500x500.png'),
            rightPath: path.join(TEST_DIR, 'blue_500x500.png'),
            outPath,
            width: 0, height: 0, bg: '#000000', mode: 'fit',
        });
        assert.equal(result.width, 1000);
        assert.equal(result.height, 500);
        assert.ok(fs.existsSync(outPath), 'Output file should exist');

        const meta = await sharp(outPath).metadata();
        assert.equal(meta.width, 1000);
        assert.equal(meta.height, 500);
    });

    it('merges with custom dimensions', async () => {
        const outPath = path.join(OUTPUT_DIR, 'merge_custom.png');
        const result = await mergeImages({
            leftPath: path.join(TEST_DIR, 'red_500x500.png'),
            rightPath: path.join(TEST_DIR, 'blue_500x500.png'),
            outPath,
            width: 3000, height: 1500, bg: '#000000', mode: 'fit',
        });
        assert.equal(result.width, 3000);
        assert.equal(result.height, 1500);

        const meta = await sharp(outPath).metadata();
        assert.equal(meta.width, 3000);
        assert.equal(meta.height, 1500);
    });

    it('merges images with different heights', async () => {
        const outPath = path.join(OUTPUT_DIR, 'merge_diff_height.png');
        const result = await mergeImages({
            leftPath: path.join(TEST_DIR, 'green_300x600.png'),
            rightPath: path.join(TEST_DIR, 'yellow_800x400.png'),
            outPath,
            width: 0, height: 0, bg: '#000000', mode: 'fit',
        });
        assert.equal(result.height, 600);
        assert.ok(result.width > 0, 'Width should be positive');
        assert.ok(fs.existsSync(outPath));
    });

    it('merges with stretch mode', async () => {
        const outPath = path.join(OUTPUT_DIR, 'merge_stretch.png');
        const result = await mergeImages({
            leftPath: path.join(TEST_DIR, 'red_500x500.png'),
            rightPath: path.join(TEST_DIR, 'blue_500x500.png'),
            outPath,
            width: 2000, height: 1000, bg: '#000000', mode: 'stretch',
        });
        assert.equal(result.width, 2000);
        assert.equal(result.height, 1000);
    });

    it('saves as JPEG with quality', async () => {
        const outPath = path.join(OUTPUT_DIR, 'merge_output.jpg');
        await mergeImages({
            leftPath: path.join(TEST_DIR, 'red_500x500.png'),
            rightPath: path.join(TEST_DIR, 'blue_500x500.png'),
            outPath,
            width: 0, height: 0, bg: '#000000', mode: 'fit', quality: 80,
        });
        assert.ok(fs.existsSync(outPath));
        const meta = await sharp(outPath).metadata();
        assert.equal(meta.format, 'jpeg');
    });

    it('throws on missing file', async () => {
        await assert.rejects(
            () => mergeImages({
                leftPath: path.join(TEST_DIR, 'nonexistent.png'),
                rightPath: path.join(TEST_DIR, 'blue_500x500.png'),
                outPath: path.join(OUTPUT_DIR, 'fail.png'),
                width: 0, height: 0, bg: '#000000', mode: 'fit',
            }),
            (err) => {
                assert.ok(err.message.includes('not found'));
                return true;
            }
        );
    });

    it('merges with custom width only', async () => {
        const outPath = path.join(OUTPUT_DIR, 'merge_width_only.png');
        const result = await mergeImages({
            leftPath: path.join(TEST_DIR, 'red_500x500.png'),
            rightPath: path.join(TEST_DIR, 'blue_500x500.png'),
            outPath,
            width: 2000, height: 0, bg: '#000000', mode: 'fit',
        });
        assert.equal(result.width, 2000);
        assert.ok(result.height > 0);
    });
});
