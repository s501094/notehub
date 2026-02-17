# NoteHub - Quick Start Guide

## ✅ What You Need

Your **notehub** folder should contain these files:

```
notehub/
├── main.js                    # Main Electron process
├── renderer.js                # App logic (27KB)
├── preload.js                 # Security bridge
├── index.html                 # UI structure
├── package.json               # Dependencies list
├── config.example.json        # Config template
├── README.md                  # Full documentation
├── PLUGIN_DEVELOPMENT.md      # Plugin guide
├── PLUGINS.md                 # Plugin documentation
├── .gitignore                 # Git ignore rules
├── setup.sh                   # Setup checker
├── styles/
│   └── main.css              # All styling (17KB)
└── plugins/
    ├── math-renderer/
    ├── terminal/
    ├── advanced-search/
    ├── docx-converter/
    ├── excel-integration/
    └── example-plugin/
```

## 🚀 Setup Steps

### 1. Download the notehub folder
Make sure you have the complete folder from the outputs.

### 2. Navigate to the folder
```bash
cd /path/to/notehub
```

### 3. Verify structure (optional)
Run the setup checker:
```bash
chmod +x setup.sh
./setup.sh
```

### 4. Install dependencies
```bash
npm install
```

This will download Electron and other required packages (~200MB).

### 5. Start the app!
```bash
npm start
```

## 📝 What Should Happen

1. An Electron window opens
2. You see the NoteHub welcome screen with:
   - "Welcome to NoteHub" title
   - Three feature cards
   - "Create Your First Note" button
3. Sidebar on the left shows:
   - Search box
   - "+ New Note" button
   - "Notebooks" section
   - "All Notes" section

## ⚙️ Configuration Templates

After first run, your config will be created at:
- **macOS**: `~/Library/Application Support/notehub/config.json`
- **Linux**: `~/.config/notehub/config.json`
- **Windows**: `%APPDATA%\notehub\config.json`

### 📋 Complete Config Template

Here's a full config with all available options:

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#cba6f7",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "Monaco, Menlo, Consolas, 'Courier New', monospace",
    "editorFontSize": 14
  },
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 2000,
    "spellCheck": true,
    "lineNumbers": false,
    "wordWrap": true
  },
  "plugins": {
    "enabled": [
      "math-renderer",
      "terminal",
      "advanced-search",
      "docx-converter",
      "excel-integration"
    ]
  },
  "ui": {
    "sidebarWidth": 280,
    "showPreviewByDefault": true
  }
}
```

### 🎨 Theme Examples

#### Catppuccin Mocha (Default)
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#cba6f7",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "Monaco, Menlo, Consolas, monospace",
    "editorFontSize": 14
  }
}
```

#### Catppuccin Latte (Light)
```json
{
  "theme": {
    "mode": "light",
    "accentColor": "#8839ef",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "fontSize": 14
  }
}
```

#### Nord Theme
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#88c0d0",
    "fontFamily": "Inter, system-ui, sans-serif",
    "fontSize": 14
  }
}
```

#### Dracula Theme
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#bd93f9",
    "fontFamily": "Fira Code, monospace",
    "fontSize": 14
  }
}
```

#### Tokyo Night
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#7aa2f7",
    "fontFamily": "JetBrains Mono, monospace",
    "fontSize": 14
  }
}
```

### 📝 Editor Configuration Examples

#### Minimal Distractions
```json
{
  "editor": {
    "defaultView": "edit",
    "autoSave": true,
    "autoSaveInterval": 5000,
    "spellCheck": false,
    "lineNumbers": false,
    "wordWrap": true
  }
}
```

#### Developer Mode
```json
{
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 1000,
    "spellCheck": false,
    "lineNumbers": true,
    "wordWrap": false
  }
}
```

#### Writer Mode
```json
{
  "editor": {
    "defaultView": "preview",
    "autoSave": true,
    "autoSaveInterval": 2000,
    "spellCheck": true,
    "lineNumbers": false,
    "wordWrap": true
  }
}
```

### 🔌 Plugin Configuration Examples

#### All Plugins Enabled
```json
{
  "plugins": {
    "enabled": [
      "math-renderer",
      "terminal",
      "advanced-search",
      "docx-converter",
      "excel-integration"
    ]
  }
}
```

#### Student/Academic Setup
```json
{
  "plugins": {
    "enabled": [
      "math-renderer",
      "advanced-search",
      "docx-converter"
    ]
  }
}
```

#### Developer Setup
```json
{
  "plugins": {
    "enabled": [
      "terminal",
      "advanced-search"
    ]
  }
}
```

#### Data Analyst Setup
```json
{
  "plugins": {
    "enabled": [
      "excel-integration",
      "math-renderer",
      "advanced-search"
    ]
  }
}
```

#### Minimal Setup (No Plugins)
```json
{
  "plugins": {
    "enabled": []
  }
}
```

### 🎯 Complete Configuration Examples

#### Academic Powerhouse
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#cba6f7",
    "fontFamily": "Georgia, serif",
    "fontSize": 15,
    "editorFontFamily": "Fira Code, monospace",
    "editorFontSize": 14
  },
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 2000,
    "spellCheck": true,
    "lineNumbers": false,
    "wordWrap": true
  },
  "plugins": {
    "enabled": [
      "math-renderer",
      "advanced-search",
      "docx-converter",
      "excel-integration"
    ]
  },
  "ui": {
    "sidebarWidth": 300,
    "showPreviewByDefault": true
  }
}
```

#### Developer's Choice
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#7aa2f7",
    "fontFamily": "SF Pro, system-ui",
    "fontSize": 13,
    "editorFontFamily": "JetBrains Mono, monospace",
    "editorFontSize": 13
  },
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 1000,
    "spellCheck": false,
    "lineNumbers": true,
    "wordWrap": false
  },
  "plugins": {
    "enabled": [
      "terminal",
      "advanced-search",
      "math-renderer"
    ]
  },
  "ui": {
    "sidebarWidth": 280,
    "showPreviewByDefault": true
  }
}
```

#### Writer's Haven
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#a6e3a1",
    "fontFamily": "iA Writer Duo, Georgia, serif",
    "fontSize": 16,
    "editorFontFamily": "iA Writer Mono, Monaco",
    "editorFontSize": 15
  },
  "editor": {
    "defaultView": "edit",
    "autoSave": true,
    "autoSaveInterval": 3000,
    "spellCheck": true,
    "lineNumbers": false,
    "wordWrap": true
  },
  "plugins": {
    "enabled": [
      "advanced-search",
      "docx-converter"
    ]
  },
  "ui": {
    "sidebarWidth": 250,
    "showPreviewByDefault": false
  }
}
```

## 🚨 Important Configuration Rules

### ⚠️ DO NOT Break These Rules

1. **Always use valid JSON syntax**
   - Use double quotes `"` not single quotes `'`
   - Add commas between items (but not after the last item)
   - Close all brackets `{}` and arrays `[]`

2. **Plugin names must match exactly**
   - ✅ `"math-renderer"`
   - ❌ `"math_renderer"`
   - ❌ `"MathRenderer"`

3. **Color codes must be hex format**
   - ✅ `"#cba6f7"`
   - ❌ `"purple"`
   - ❌ `"rgb(203, 166, 247)"`

4. **Numbers don't need quotes**
   - ✅ `"fontSize": 14`
   - ❌ `"fontSize": "14"`

5. **Booleans are lowercase**
   - ✅ `"autoSave": true`
   - ❌ `"autoSave": "true"`
   - ❌ `"autoSave": True`

### ✅ Valid Config Structure
```json
{
  "theme": {
    "accentColor": "#cba6f7"
  },
  "plugins": {
    "enabled": ["math-renderer", "terminal"]
  }
}
```

### ❌ Invalid Config (Will Break)
```json
{
  "theme": {
    'accentColor': '#cba6f7',  // Wrong: single quotes
  },  // Wrong: trailing comma
  "plugins": {
    "enabled": ["math_renderer"]  // Wrong: underscore instead of dash
  }
```

## 🛠️ Editing Your Config

### Option 1: From App Menu
1. Go to **Preferences → Open Config File**
2. Edit in your default text editor
3. Save the file
4. Reload NoteHub (`Cmd/Ctrl+R`)

### Option 2: Direct File Access
1. Navigate to config location (see above)
2. Edit `config.json` in any text editor
3. Save
4. Reload NoteHub

### Option 3: In-App Settings
1. Click settings icon in status bar
2. Modify available settings
3. Changes save automatically

## 🐛 Troubleshooting

### "npm: command not found"
Install Node.js from https://nodejs.org (includes npm)

### Files are missing
Re-download the complete notehub folder. Don't use the MarkdownApp folder.

### App won't start
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm start
```

### CSS not loading / black screen
Make sure `styles/main.css` exists and is 17KB+. Re-download if needed.

### Config errors
If the app won't start after editing config:
1. Check JSON syntax with a JSON validator
2. Copy the default config from `config.example.json`
3. Delete your config and let the app recreate it

### Can't scroll in editor
Make sure you're using the latest version. Reload with `Cmd/Ctrl+R`.

### Plugins not loading
1. Check plugin names in config match folder names exactly
2. Verify plugins exist in `plugins/` directory
3. Check console for errors (View → Toggle DevTools)

### Port errors
Close any other Electron apps and try again.

## 🎨 Customizing

After first run, find your config at:
- **macOS**: `~/Library/Application Support/notehub/config.json`
- **Linux**: `~/.config/notehub/config.json`
- **Windows**: `%APPDATA%\notehub\config.json`

Edit colors, fonts, and behavior there!

## 📦 Building for Distribution

```bash
npm run build          # Current platform
npm run build:mac      # macOS
npm run build:win      # Windows
npm run build:linux    # Linux
```

Apps will be in the `dist/` folder.

## 📚 More Resources

- **README.md** - Complete documentation
- **PLUGINS.md** - Plugin guide and examples
- **PLUGIN_DEVELOPMENT.md** - Create your own plugins
- **config.example.json** - Default configuration template

## ❓ Need Help?

1. Check README.md for full documentation
2. Make sure all files from the list above are present
3. Verify Node.js version: `node --version` (should be 16+)
4. Check console for errors in the app: View → Toggle DevTools

---

**Important**: This is the **notehub** app, not MarkdownApp or any other folder!
