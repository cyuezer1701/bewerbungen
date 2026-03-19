module.exports = {
  apps: [{
    name: 'auto-bewerber',
    script: './dist/index.js',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PUPPETEER_EXECUTABLE_PATH: '/home/claude/.cache/ms-playwright/chromium-1208/chrome-linux/chrome'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true
  }]
};
