# Changelog

All notable changes to Art Split Merger will be documented in this file.

## [1.1.0] - 2026-02-22

### Added
- **Layout 3 (Mixed)**: 2 images top + 1 image bottom, fixed 3000×3000px output
- **Layout 4 (Grid)**: 2×2 grid, fixed 3000×3000px output
- **Smart Upscaling**: Pica library (Lanczos3) for high-quality image resizing
- **Layout Selector UI**: Buttons to switch between Split, Mixed, and Grid modes
- **Dynamic Drop Grid**: CSS Grid-based drop zones that adapt to selected layout
- **Keyboard Shortcuts**: 
    - `Ctrl + S`: Save PNG
    - `Ctrl + Shift + S`: Save JPG
    - `Ctrl + Shift + C`: Copy to Clipboard
- **Reset All**: New button to clear all image slots and reset preview
- **App Icon**: Custom purple-themed brand icon as a standalone EXE icon

### Fixed
- **Build Success**: Resolved signtool/winCodeSign symlink errors in Electron Builder
- **Dynamic Controls**: Auto-disabling output size inputs for fixed-dimension layouts (3/4)
- **UI Consistency**: Added favicon and updated meta-descriptions for better desktop integration

### Changed
- `imageProcessor.js`: Refactored to async with Pica integration
- `app.js`: Complete rewrite for dynamic slot management and state persistence prep
- `styles.css`: Implemented CSS Grid for drop zones and polished dark theme aesthetics

## [1.0.0] - 2026-02-10

### Added
- Initial release
- Electron desktop app with dark minimal UI
- Two-image side-by-side merge (Split mode)
- Drag & drop, file upload, clipboard paste (Ctrl+V)
- Fit/Stretch resize modes
- Custom output dimensions
- Background color picker
- Real-time canvas preview
- Save as PNG/JPG with quality control
- Copy merged image to clipboard
- Batch mode (pair multiple images)
- CLI tool (`splitmerge`) with Sharp backend
- Native file dialogs via Electron IPC bridge
