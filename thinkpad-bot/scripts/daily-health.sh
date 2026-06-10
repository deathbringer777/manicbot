#!/bin/bash
BOT_DIR=/home/kirill/automation/tg-bot
cd $BOT_DIR || exit 1
UPTIME=$(uptime -p 2>/dev/null | sed s/up\ //)
MEM=$(free -m | awk "/Mem:/ {printf \"%.0f%%\", \$3/\$2*100}")
DISK=$(df -h / | awk "NR==2 {print \$5}")
LOAD=$(cat /proc/loadavg | awk "{print \$1,\$2,\$3}")
PM2_ONLINE=$(pm2 list 2>/dev/null | grep -c online || echo 0)
LEADS=$(wc -l < /home/kirill/manicbot-backend/marketing/research/leads.csv 2>/dev/null || echo ?)
MSG="Morning report | Disk: $DISK | RAM: $MEM | Load: $LOAD | Uptime: $UPTIME | PM2 online: $PM2_ONLINE | Leads: $LEADS rows"
node $BOT_DIR/notify.js "$MSG"
