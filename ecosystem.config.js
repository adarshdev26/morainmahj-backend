// PM2 process definition. Used on EC2 as:
//   pm2 start ecosystem.config.js --env production
//   pm2 save
//
// cluster mode is deliberately avoided: the ported legacy platform functions and the RLS
// actor middleware assume a single shared pg pool, and a few of the scheduled
// helpers are not safe to run in parallel copies.
module.exports = {
  apps: [
    {
      name: 'morainmahj-api',
      script: 'server.js',
      cwd: '/var/www/morainmahj-backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // A crash loop from a bad DB password should back off rather than spin.
      restart_delay: 2000,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Only Nginx talks to the API; see server.js.
        HOST: '127.0.0.1',
      },
      error_file: '/var/log/morainmahj/api-error.log',
      out_file: '/var/log/morainmahj/api-out.log',
      time: true,
    },
  ],
};
