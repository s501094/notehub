# NoteHub Configuration Templates

Complete configuration examples for different use cases. Copy and paste into your `config.json`.

## 📍 Config Location

- **macOS**: `~/Library/Application Support/notehub/config.json`
- **Linux**: `~/.config/notehub/config.json`
- **Windows**: `%APPDATA%\notehub\config.json`

---

## 🎨 Theme Templates

### Catppuccin Mocha (Default - Purple)
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

### Catppuccin Mocha (Blue Accent)
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#89b4fa",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "fontSize": 14
  }
}
```

### Catppuccin Mocha (Green Accent)
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#a6e3a1",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "fontSize": 14
  }
}
```

### Catppuccin Mocha (Pink Accent)
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#f5c2e7",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "fontSize": 14
  }
}
```

### Nord Theme
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#88c0d0",
    "fontFamily": "Inter, system-ui, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "Fira Code, monospace",
    "editorFontSize": 14
  }
}
```

### Dracula Theme
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#bd93f9",
    "fontFamily": "Fira Sans, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "Fira Code, monospace",
    "editorFontSize": 14
  }
}
```

### Tokyo Night
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#7aa2f7",
    "fontFamily": "JetBrains Mono, monospace",
    "fontSize": 14,
    "editorFontFamily": "JetBrains Mono, monospace",
    "editorFontSize": 13
  }
}
```

### Gruvbox Dark
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#d3869b",
    "fontFamily": "IBM Plex Sans, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "IBM Plex Mono, monospace",
    "editorFontSize": 14
  }
}
```

### Solarized Dark
```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#268bd2",
    "fontFamily": "Source Sans Pro, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "Source Code Pro, monospace",
    "editorFontSize": 14
  }
}
```

---

## 📝 Editor Configuration Templates

### Default (Balanced)
```json
{
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 2000,
    "spellCheck": true,
    "lineNumbers": false,
    "wordWrap": true
  }
}
```

### Minimal Distractions
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

### Developer Mode
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

### Writer Mode
```json
{
  "editor": {
    "defaultView": "edit",
    "autoSave": true,
    "autoSaveInterval": 3000,
    "spellCheck": true,
    "lineNumbers": false,
    "wordWrap": true
  }
}
```

### Preview-First Mode
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

### Aggressive Auto-Save
```json
{
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 500,
    "spellCheck": true,
    "lineNumbers": false,
    "wordWrap": true
  }
}
```

---

## 🔌 Plugin Configuration Templates

### All Plugins
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

### Student/Academic
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

### Developer
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

### Data Analyst
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

### Writer/Blogger
```json
{
  "plugins": {
    "enabled": [
      "advanced-search",
      "docx-converter"
    ]
  }
}
```

### Researcher
```json
{
  "plugins": {
    "enabled": [
      "math-renderer",
      "advanced-search",
      "docx-converter",
      "excel-integration"
    ]
  }
}
```

### Minimal (No Plugins)
```json
{
  "plugins": {
    "enabled": []
  }
}
```

---

## 🎯 Complete Use Case Templates

### 1. University Student
Perfect for taking class notes with math support and document management.

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#89b4fa",
    "fontFamily": "Inter, system-ui, sans-serif",
    "fontSize": 15,
    "editorFontFamily": "JetBrains Mono, monospace",
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
      "docx-converter"
    ]
  },
  "ui": {
    "sidebarWidth": 300,
    "showPreviewByDefault": true
  }
}
```

### 2. Software Developer
Optimized for coding documentation and technical notes.

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#7aa2f7",
    "fontFamily": "SF Pro, system-ui",
    "fontSize": 13,
    "editorFontFamily": "Fira Code, monospace",
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

### 3. Content Writer
Focused on writing without distractions.

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

### 4. Data Scientist
Perfect for data analysis with Excel and math support.

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#f5c2e7",
    "fontFamily": "Roboto, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "Source Code Pro, monospace",
    "editorFontSize": 14
  },
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 2000,
    "spellCheck": false,
    "lineNumbers": false,
    "wordWrap": true
  },
  "plugins": {
    "enabled": [
      "excel-integration",
      "math-renderer",
      "advanced-search",
      "terminal"
    ]
  },
  "ui": {
    "sidebarWidth": 280,
    "showPreviewByDefault": true
  }
}
```

### 5. Academic Researcher
Full-featured for research papers with citations and data.

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#cba6f7",
    "fontFamily": "Literata, Georgia, serif",
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

### 6. Project Manager
Documentation and planning focused.

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#89dceb",
    "fontFamily": "Open Sans, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "Monaco, monospace",
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
      "advanced-search",
      "excel-integration",
      "docx-converter"
    ]
  },
  "ui": {
    "sidebarWidth": 280,
    "showPreviewByDefault": true
  }
}
```

### 7. Minimal Setup
Clean and simple, no plugins.

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#cba6f7",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto",
    "fontSize": 14,
    "editorFontFamily": "Monaco, Menlo, Consolas, monospace",
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
    "enabled": []
  },
  "ui": {
    "sidebarWidth": 280,
    "showPreviewByDefault": true
  }
}
```

### 8. Maximum Power
Everything enabled, all features.

```json
{
  "theme": {
    "mode": "dark",
    "accentColor": "#cba6f7",
    "fontFamily": "Inter, system-ui, sans-serif",
    "fontSize": 14,
    "editorFontFamily": "JetBrains Mono, monospace",
    "editorFontSize": 14
  },
  "editor": {
    "defaultView": "split",
    "autoSave": true,
    "autoSaveInterval": 1000,
    "spellCheck": true,
    "lineNumbers": true,
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
    "sidebarWidth": 320,
    "showPreviewByDefault": true
  }
}
```

---

## 🎨 Available Accent Colors

Copy these hex codes for `accentColor`:

### Catppuccin Mocha Colors
- **Rosewater**: `#f5e0dc`
- **Flamingo**: `#f2cdcd`
- **Pink**: `#f5c2e7`
- **Mauve**: `#cba6f7` (default)
- **Red**: `#f38ba8`
- **Maroon**: `#eba0ac`
- **Peach**: `#fab387`
- **Yellow**: `#f9e2af`
- **Green**: `#a6e3a1`
- **Teal**: `#94e2d5`
- **Sky**: `#89dceb`
- **Sapphire**: `#74c7ec`
- **Blue**: `#89b4fa`
- **Lavender**: `#b4befe`

### Popular Theme Colors
- **Nord**: `#88c0d0`
- **Dracula**: `#bd93f9`
- **Tokyo Night**: `#7aa2f7`
- **Gruvbox**: `#d3869b`
- **Solarized**: `#268bd2`
- **One Dark**: `#61afef`
- **Material**: `#82aaff`

---

## 📏 Configuration Rules

### ✅ Valid JSON
- Use double quotes: `"key": "value"`
- Separate items with commas (except last item)
- Close all brackets properly

### ⚠️ Common Mistakes
```json
// ❌ Wrong
{
  'theme': {
    'accentColor': '#cba6f7',  // Single quotes
  },  // Trailing comma

// ✅ Correct
{
  "theme": {
    "accentColor": "#cba6f7"
  }
}
```

### 🔢 Data Types
- **Strings**: `"value"` (with quotes)
- **Numbers**: `14` (no quotes)
- **Booleans**: `true` or `false` (no quotes)
- **Arrays**: `["item1", "item2"]`

---

## 🧪 Testing Your Config

1. Save your config file
2. Reload NoteHub: `Cmd/Ctrl + R`
3. If app doesn't load, config has errors
4. Check browser console: View → Toggle DevTools
5. Fix errors and try again

---

## 💡 Pro Tips

1. **Start small**: Begin with default config, change one thing at a time
2. **Backup**: Keep a copy of working configs
3. **Validate**: Use a JSON validator before reloading
4. **Experiment**: Try different accent colors for different moods
5. **Share**: Save your favorite configs for different tasks

---

**Need help?** Check the main README.md or QUICKSTART.md for troubleshooting!
