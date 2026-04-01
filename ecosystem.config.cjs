module.exports = {
  apps: [{
    name: 'sunshine-postcards',
    script: 'node_modules/.bin/next',
    args: 'start -p 3005',
    cwd: '/Users/saturdaysocial/sunshine-postcards',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
