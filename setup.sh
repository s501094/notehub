#!/bin/bash

# Notehub Setup Script
# This script creates the proper directory structure for Notehub

echo "🚀 Setting up Notehub..."

# Check if we're in the right place
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the Notehub directory."
    exit 1
fi

# Create directories
echo "📁 Creating directories..."
mkdir -p styles
mkdir -p plugins/example-plugin

echo "✅ Directory structure created!"

# Check for required files
echo ""
echo "📋 Checking for required files..."

required_files=(
    "main.js"
    "renderer.js"
    "preload.js"
    "index.html"
    "package.json"
    "styles/main.css"
    "plugins/example-plugin/manifest.json"
    "plugins/example-plugin/index.js"
)

missing_files=()

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing: $file"
        missing_files+=("$file")
    else
        echo "✅ Found: $file"
    fi
done

echo ""

if [ ${#missing_files[@]} -eq 0 ]; then
    echo "✅ All required files are present!"
    echo ""
    echo "📦 Ready to install dependencies. Run:"
    echo "   npm install"
    echo ""
    echo "🚀 Then start the app with:"
    echo "   npm start"
else
    echo "❌ Missing ${#missing_files[@]} file(s). Please ensure all files are in place."
    echo ""
    echo "Missing files:"
    for file in "${missing_files[@]}"; do
        echo "  - $file"
    done
fi

echo ""
echo "📖 File structure should look like this:"
echo ""
echo "Notehub/"
echo "├── main.js"
echo "├── renderer.js"
echo "├── preload.js"
echo "├── index.html"
echo "├── package.json"
echo "├── config.example.json"
echo "├── .gitignore"
echo "├── README.md"
echo "├── PLUGIN_DEVELOPMENT.md"
echo "├── styles/"
echo "│   └── main.css"
echo "└── plugins/"
echo "    └── example-plugin/"
echo "        ├── manifest.json"
echo "        └── index.js"
echo ""
