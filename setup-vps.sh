#!/bin/bash
# ============================================
# AutoBewerber — Hetzner VPS Setup Script
# Run once on a fresh Ubuntu VPS
# Usage: chmod +x setup-vps.sh && ./setup-vps.sh
# ============================================

set -e

echo "🚀 AutoBewerber VPS Setup"
echo "========================="

# 1. System Update
echo "📦 Updating system..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20 LTS
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install Puppeteer Dependencies (für PDF Generation)
echo "📦 Installing Puppeteer/Chromium dependencies..."
sudo apt install -y \
    ca-certificates \
    fonts-liberation \
    libasound2t64 \
    libatk-bridge2.0-0t64 \
    libatk1.0-0t64 \
    libc6 \
    libcairo2 \
    libcups2t64 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc-s1 \
    libglib2.0-0t64 \
    libgtk-3-0t64 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils

# 4. Install additional fonts (für saubere PDFs)
echo "📦 Installing fonts..."
sudo apt install -y \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fonts-noto \
    fontconfig

# 5. Install PM2
echo "📦 Installing PM2..."
sudo npm install -g pm2

# 6. Install Git
echo "📦 Installing Git..."
sudo apt install -y git

# 7. Create project directory
echo "📁 Setting up project directory..."
sudo mkdir -p /opt/auto-bewerber
sudo chown $USER:$USER /opt/auto-bewerber

# 8. Clone repo (ersetze mit deinem Repo)
echo "📁 Ready for git clone..."
echo "   Run: cd /opt/auto-bewerber && git clone <your-repo-url> ."

# 9. Create data directories
mkdir -p /opt/auto-bewerber/data/zeugnisse
mkdir -p /opt/auto-bewerber/data/bewerbungen
mkdir -p /opt/auto-bewerber/logs

# 10. PM2 startup (auto-start nach reboot)
echo "⚙️  Configuring PM2 startup..."
pm2 startup systemd -u $USER --hp /home/$USER
echo "   Run 'pm2 save' after starting the app"

# 11. Firewall (optional)
echo "🔒 Configuring UFW firewall..."
sudo ufw allow OpenSSH
sudo ufw --force enable

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. cd /opt/auto-bewerber"
echo "  2. git clone <your-repo-url> ."
echo "  3. cp .env.example .env && nano .env"
echo "  4. Upload cv.pdf to data/"
echo "  5. Upload Zeugnisse to data/zeugnisse/"
echo "  6. npm ci && npm run build"
echo "  7. pm2 start ecosystem.config.js"
echo "  8. pm2 save"
